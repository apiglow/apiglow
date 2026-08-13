import { expect, test } from '@playwright/test'
import {
  clickNavOp,
  credentialsCard as credCard,
  gotoApp,
  openTryItIfMobile,
  tryIt,
} from './helpers.js'

// OAuth2 flows of the try-it (competitive analysis, prio 1 item 3). The
// authorization server is simulated by Playwright: /authorize redirects
// immediately to the redirect_uri (instant consent), /token responds in JSON —
// no real network traffic, but the full-page redirect and the PKCE exchange are
// genuinely executed by the application.
const AUTH_BASE = 'https://auth.e2e.test'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': '*',
  'access-control-allow-headers': '*',
}

// Playwright's WebKit refuses `route.fulfill` with a 3xx ("Cannot fulfill with
// redirect status"), so the simulated authorization server hands back a page
// that navigates instead. Same landing, same query string, same full-page
// round trip as far as the app is concerned — `replace` so the mock leaves no
// more history behind than a 302 would.
function redirectTo(route, href) {
  return route.fulfill({
    status: 200,
    headers: CORS,
    contentType: 'text/html',
    body: `<!doctype html><script>location.replace(${JSON.stringify(href)})</script>`,
  })
}

function mockTokenEndpoint(page, respond = {}) {
  const calls = []
  page.route(`${AUTH_BASE}/token`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    calls.push(Object.fromEntries(new URLSearchParams(route.request().postData() ?? '')))
    await route.fulfill({
      status: respond.status ?? 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify(
        respond.body ?? { access_token: 'e2e-access-token', token_type: 'Bearer' },
      ),
    })
  })
  return calls
}

// Instant consent: returns code + state (or an error) to the redirect_uri.
function mockAuthorizeEndpoint(page, { error } = {}) {
  const requests = []
  page.route(`${AUTH_BASE}/authorize*`, async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const redirect = new URL(url.searchParams.get('redirect_uri'))
    if (error) {
      redirect.searchParams.set('error', error)
      redirect.searchParams.set('error_description', 'user refused')
    } else {
      redirect.searchParams.set('code', 'e2e-auth-code')
    }
    redirect.searchParams.set('state', url.searchParams.get('state'))
    await redirectTo(route, redirect.href)
  })
  return requests
}

test('authorization code + PKCE: redirect, code exchange, token stored in the env', async ({
  page,
}) => {
  const authorizeRequests = mockAuthorizeEndpoint(page)
  const tokenCalls = mockTokenEndpoint(page)
  await gotoApp(page)
  await clickNavOp(page, 'createOrder')

  const card = credCard(page)
  await expect(card).toContainText('OAuth 2.0')
  // The host config's clientId pre-fills the field; the scope required by
  // the operation is pre-checked, the other one is not.
  await expect(card.getByLabel('Client ID')).toHaveValue('e2e-client-id')
  const writeScope = card.locator('label', { hasText: 'write:orders' }).locator('input')
  await expect(writeScope).toBeChecked()
  await expect(card.locator('label', { hasText: 'read:orders' }).locator('input')).not.toBeChecked()

  await card.getByRole('button', { name: 'Get a token' }).click()

  // Return from redirect: success toast, cleaned-up URL, restored route. The
  // redirect is a full page load, so below lg the panel is behind the sheet
  // again — the restored route is what the assertions below read from it.
  await expect(page.locator('.toast .alert-success')).toContainText('saved in environment “e2e”')
  await openTryItIfMobile(page)
  expect(new URL(page.url()).searchParams.has('code')).toBe(false)
  expect(page.url()).toContain('#/op/createOrder')

  // The authorization request carried the PKCE and the checked scope.
  expect(authorizeRequests).toHaveLength(1)
  const authorize = authorizeRequests[0]
  expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorize.searchParams.get('code_challenge')).toBeTruthy()
  expect(authorize.searchParams.get('scope')).toBe('write:orders')

  // The exchange sends the code and the verifier, never a secret.
  expect(tokenCalls).toHaveLength(1)
  expect(tokenCalls[0]).toMatchObject({
    grant_type: 'authorization_code',
    code: 'e2e-auth-code',
    client_id: 'e2e-client-id',
  })
  expect(tokenCalls[0].code_verifier).toBeTruthy()
  expect(tokenCalls[0].client_secret).toBeUndefined()

  // Complete credentials: the callout collapses back to the green status.
  const card2 = credCard(page)
  await expect(card2).toContainText('Ready')
  await expect(card2).not.toHaveAttribute('open')
  // Expanded: the obtained token fills in the auth.oauth2Auth field (masked),
  // above the flow block — manual pasting and the flow write the same variable.
  await card2.locator('summary').click()
  await expect(card2).toContainText('auth.oauth2Auth')
  await expect(card2.locator('input[type="password"]').first()).toHaveValue('e2e-access-token')
  await openTryItIfMobile(page)
  await expect(tryIt(page)).toContainText('Authorization: Bearer e2e-access-token')
})

test('client credentials: direct POST with secret, token stored without redirect', async ({
  page,
}) => {
  const tokenCalls = mockTokenEndpoint(page)
  await gotoApp(page, '#/op/createOrder')

  const card = credCard(page)
  await card.getByLabel('OAuth flow').selectOption('clientCredentials')
  await card.getByLabel('Client secret').fill('shh-secret')
  await card.getByRole('button', { name: 'Get a token' }).click()

  await expect(page.locator('.toast .alert-success')).toContainText('saved in environment “e2e”')
  await openTryItIfMobile(page)
  expect(tokenCalls).toHaveLength(1)
  expect(tokenCalls[0]).toMatchObject({
    grant_type: 'client_credentials',
    client_id: 'e2e-client-id',
    client_secret: 'shh-secret',
  })
  // No redirect: we stayed on the page, the callout collapsed
  // back to the green status on success.
  expect(page.url()).toContain('#/op/createOrder')
  await expect(credCard(page)).toContainText('Ready')
  await expect(credCard(page)).not.toHaveAttribute('open')
  await expect(tryIt(page)).toContainText('Authorization: Bearer e2e-access-token')
})

test('denied authorization surfaces an error toast, no token written', async ({ page }) => {
  mockAuthorizeEndpoint(page, { error: 'access_denied' })
  const tokenCalls = mockTokenEndpoint(page)
  await gotoApp(page, '#/op/createOrder')

  await credCard(page).getByRole('button', { name: 'Get a token' }).click()

  await expect(page.locator('.toast .alert-error')).toContainText('Authorization refused')
  await expect(page.locator('.toast .alert-error')).toContainText('user refused')
  expect(tokenCalls).toHaveLength(0)
  // The token variable stays absent: the callout still flags the missing piece.
  await expect(credCard(page)).toContainText('missing')
})

// Multi-spec: the redirect drops the hash, so on the way back the app has to
// re-decide which spec it is showing. Only the pending handshake remembers who
// asked for the token — the shared `spec.selected` preference may have moved
// under it (another tab). Crediting the wrong spec's environment is silent:
// the token is stored, the toast is green, and the operation that started the
// login still says "missing".
const MULTI_PAGE = '/tests/e2e/fixtures/app-multi.html'

test('the token returns to the spec that started the login, not the selected one', async ({
  page,
}) => {
  const tokenCalls = mockTokenEndpoint(page)
  page.route(`${AUTH_BASE}/authorize*`, async (route) => {
    const url = new URL(route.request().url())
    const back = new URL(url.searchParams.get('redirect_uri'))
    back.searchParams.set('code', 'e2e-auth-code')
    back.searchParams.set('state', url.searchParams.get('state'))
    // Same-origin hop that switches the stored spec mid-flight.
    const relay = new URL('/tests/e2e/fixtures/oauth-relay.html', back.origin)
    relay.searchParams.set('select', 'billing')
    relay.searchParams.set('to', back.href)
    await redirectTo(route, relay.href)
  })

  await page.goto(`${MULTI_PAGE}#/s/pets/op/createOrder`)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  // Raw goto and a full-page redirect back: the panel holding the credentials
  // card is the sheet below lg, on both legs of the trip.
  await openTryItIfMobile(page)
  const card = credCard(page)
  await card.getByLabel('Client ID').fill('e2e-client-id')
  await card.getByRole('button', { name: 'Get a token' }).click()

  await expect(page.locator('.toast .alert-success')).toContainText('saved in environment “e2e”')
  expect(tokenCalls).toHaveLength(1)
  // Back on the Pets spec — with its own route prefix — and the token is the
  // one its credentials card now injects.
  expect(page.url()).toContain('#/s/pets/op/createOrder')
  await openTryItIfMobile(page)
  await expect(tryIt(page)).toContainText('Authorization: Bearer e2e-access-token')
})
