import { expect, test } from '@playwright/test'
import {
  API_BASE,
  clickNavOp,
  credentialsCard,
  envTrigger,
  gotoApp,
  gotoFixture,
  mockApi,
  openDrawerIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'

// First-touch flow (docs/architecture.md §5.5.7): what stands between opening
// the doc and getting a first response — a required parameter already filled,
// a missing credential that says so and takes the focus, and the generated
// onboarding page that walks through the three.

test('a required parameter starts on the value the schema declares', async ({ page }) => {
  await gotoApp(page, '#/op/getPet')
  // `example: 1` on the path parameter — the send works without typing.
  await expect(panelField(page, 'petId')).toHaveValue('1')
  // The mirror: the doc column edits the same value (rule 20).
  await expect(
    page.locator('.api-param').filter({ hasText: 'petId' }).locator('input').first(),
  ).toHaveValue('1')
})

// A `default` on an OPTIONAL parameter is not a value to send: leaving it out
// asks the server for its own default, which is a different request.
test('an optional parameter with a default stays empty', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await expect(panelField(page, 'limit')).toHaveValue('')
})

test('the prefilled parameter is enough to send', async ({ page }) => {
  const calls = await mockApi(page, { body: { id: 1, name: 'Rex' } })
  await gotoApp(page, '#/op/getPet')
  await send(page)
  await expect(tryIt(page)).toContainText('200')
  expect(calls.at(-1).url).toBe(`${API_BASE}/v1/pets/1`)
})

// GET /orders requires apiKeyAuth, which the fixture environment never sets:
// the send is blocked on a credential rather than on a variable name nobody
// recognizes, and the caret lands in the field that fixes it.
test('a send blocked on a missing credential names it and focuses the field', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listOrders')
  await send(page)
  const alert = tryIt(page).locator('.alert-error')
  await expect(alert).toContainText('apiKeyAuth')
  // The raw variable name belongs to the environment manager, not here.
  await expect(alert).not.toContainText('auth.apiKeyAuth')
  await expect(tryIt(page).locator('[data-cred-var="auth.apiKeyAuth"]')).toBeFocused()
  await expect(page.locator('[data-live-region]')).toContainText('apiKeyAuth')

  // Filling it unblocks the send, from the cartouche alone.
  await credentialsCard(page).locator('[data-cred-var="auth.apiKeyAuth"]').fill('key-123')
  await tryIt(page).locator('[data-cred-var="auth.apiKeyAuth"]').blur()
  await send(page)
  await expect(tryIt(page)).toContainText('200')
})

// A schema loaded on a host that declares no environment: the cartouche used
// to hand back a field disabled into invisibility, and the only way through
// was the environments popin. It now creates what it needs to write.
test('the first credential entered creates the environment it lands in', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoFixture(page, '/tests/e2e/fixtures/app-no-env.html')
  await clickNavOp(page, 'listOrders')
  await expect(envTrigger(page)).toContainText('No environment')

  const field = credentialsCard(page).locator('[data-cred-var="auth.apiKeyAuth"]')
  await expect(field).toBeEnabled()
  await expect(credentialsCard(page)).toContainText('An environment will be created')
  await field.fill('key-123')
  // Provisioning the environment must not rebuild the fields: the write lands
  // on blur, before focus reaches the control the Tab was headed for.
  await field.press('Tab')
  await expect(
    credentialsCard(page).getByRole('button', { name: 'Show / hide value' }),
  ).toBeFocused()

  await expect(envTrigger(page)).toContainText('Environment 1')
  await expect(credentialsCard(page)).toContainText('Environment 1')
  await send(page)
  await expect(tryIt(page)).toContainText('200')
  expect(calls.at(-1).headers['x-api-key']).toBe('key-123')
})

test.describe('generated onboarding page', () => {
  const ONBOARDING = '/tests/e2e/fixtures/app-onboarding.html'

  test('the nav offers it and it walks through the simplest read', async ({ page }) => {
    await gotoFixture(page, ONBOARDING)
    await openDrawerIfMobile(page)
    const entry = page.locator('api-nav a[data-first-call]')
    await expect(entry).toHaveText('First call')
    await entry.click()
    await expect(page).toHaveURL(/#\/first-call$/)
    await expect(page.locator('main')).toContainText('Your first call')
    // listPets: the first GET needing nothing typed.
    await expect(page.locator('main')).toContainText('GET /pets')
    await expect(entry).toHaveClass(/menu-active/)
  })

  test('the page is the real panel, and it sends', async ({ page }) => {
    const calls = await mockApi(page, { body: [{ id: 1, name: 'Rex' }] })
    await gotoFixture(page, `${ONBOARDING}#/first-call`)
    // The steps it numbers are the rail's own controls, not copies of them.
    await expect(tryIt(page).getByRole('group', { name: 'Language' })).toBeVisible()
    await expect(credentialsCard(page)).toBeVisible()
    await send(page)
    await expect(tryIt(page)).toContainText('200')
    expect(calls.at(-1).url).toBe(`${API_BASE}/v1/pets`)
  })

  test('without the feature the route resolves to nothing', async ({ page }) => {
    await gotoApp(page, '#/first-call')
    await expect(page.locator('api-nav a[data-first-call]')).toHaveCount(0)
    await expect(page.locator('main')).toContainText('Page not found')
  })
})
