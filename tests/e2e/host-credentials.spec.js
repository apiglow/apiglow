import { expect, test } from '@playwright/test'
import {
  APP_PAGE,
  clickNavOp,
  credentialsCard as card,
  expectResponded,
  gotoFixture,
  mockApi,
  openHistory,
  send,
  tryIt,
} from './helpers.js'

// Runtime credentials bridge (docs/host-credentials.md §9), against the packed
// bundle. The fixture's environment declares no auth.bearerAuth: everything
// green below is the host's provider filling that void, and the Authorization
// header on the wire is the only proof that counts.
const FIXTURE = '/tests/e2e/fixtures/app-host-credentials.html'

const probe = (page) => page.evaluate(() => window.__hostCreds)

const authHeaders = (calls) => calls.map((call) => call.headers.authorization)

// The boot fill happens on idle, after the first render: every assertion about
// the overlay waits for it rather than assuming it already ran.
async function waitForFill(page) {
  await expect.poll(async () => (await probe(page)).calls.length).toBeGreaterThan(0)
}

test('the public API is there for both script kinds', async ({ page }) => {
  await gotoFixture(page, FIXTURE)
  const seen = await probe(page)
  // Classic script (runs before any module): only the event can reach it.
  expect(seen.ready).toBe(true)
  // Module script placed after the app's tag: the global is already there.
  expect(seen.globalAtModuleTime).toBe(true)
  expect(
    await page.evaluate(() =>
      ['registerCredentialsProvider', 'setCredentials', 'clearCredentials'].every(
        (key) => typeof window.apidoc[key] === 'function',
      ),
    ),
  ).toBe(true)
})

test('boot fill: the red badge becomes the host badge and the token is sent', async ({ page }) => {
  const calls = await mockApi(page, { body: [] })
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')

  // Nothing was clicked: the fill is the app asking the host on its own.
  await waitForFill(page)
  expect((await probe(page)).calls[0]).toMatchObject({ specId: 'default', reason: 'initial' })

  await expect(card(page)).toContainText('Ready')
  await card(page).locator('summary').click()
  await expect(card(page)).toContainText('provided by the site')
  await expect(card(page)).not.toContainText('missing')
  // The input edits the ENVIRONMENT variable and nothing else: the host value
  // is never shown, not even masked (§6).
  await expect(card(page).locator('input[type="password"]')).toHaveValue('')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers.authorization).toBe('Bearer host-token-1')
})

// §7: the overlay itself never touches storage, but a SENT request persists its
// built headers like any other. What makes that safe is the `sensitive: true`
// every overlay entry carries all the way into the entry's snapshot — this is
// the assertion that the flag survives the merge and reaches redaction.
test('a host token is captured as sensitive: history and exports mask it', async ({ page }) => {
  await mockApi(page, { body: [] })
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')
  await waitForFill(page)
  await send(page)
  await expectResponded(page)

  await openHistory(page)
  const entry = page.locator('request-history-list .modal-box .collapse').first()
  await entry.locator('input[type="checkbox"]').first().check()
  await expect(entry).toContainText('••••')
  await expect(entry).not.toContainText('host-token-1')
})

test('a typed value wins over the host value, clearing it falls back', async ({ page }) => {
  const calls = await mockApi(page, { body: [] })
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')
  await waitForFill(page)
  await card(page).locator('summary').click()

  const field = card(page).locator('input[type="password"]')
  await field.fill('typed-by-hand')
  await field.press('Enter')
  await expect(card(page)).not.toContainText('provided by the site')
  await send(page)
  await expectResponded(page)
  expect(calls.at(-1).headers.authorization).toBe('Bearer typed-by-hand')

  // Emptying the field re-opens the void — the host value comes back.
  await card(page).locator('input[type="password"]').fill('')
  await card(page).locator('input[type="password"]').press('Enter')
  await expect(card(page)).toContainText('provided by the site')
  await send(page)
  await expectResponded(page)
  expect(calls.at(-1).headers.authorization).toBe('Bearer host-token-1')
})

test('401 on host credentials: one refresh, one replay, announced', async ({ page }) => {
  // The first token is stale, anything the refresh produces is accepted.
  const calls = await mockApi(page, (req) =>
    req.headers().authorization === 'Bearer host-token-1'
      ? { status: 401, body: { error: 'expired' } }
      : { body: [] },
  )
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')
  await waitForFill(page)

  await send(page)
  await expect(tryIt(page)).toContainText('Credentials expired')
  await expect(page.locator('[aria-live]')).toContainText('Credentials expired')

  expect(authHeaders(calls)).toEqual(['Bearer host-token-1', 'Bearer host-token-2'])
  expect((await probe(page)).calls.at(-1)).toMatchObject({
    reason: 'expired',
    schemeName: 'bearerAuth',
  })
  // A normal send: the replay leaves its own history entry.
  await expect(tryIt(page).locator('.api-response-view')).toContainText('200')
})

test('the ×1 cap holds when the refresh returns the same token', async ({ page }) => {
  const calls = await mockApi(page, { status: 401, body: { error: 'expired' } })
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')
  await waitForFill(page)
  // From now on the provider answers with the token it already gave.
  await page.evaluate(() => {
    window.__hostCreds.frozen = true
  })

  await send(page)
  await expectResponded(page)
  await expect(tryIt(page).locator('.api-response-view')).toContainText('401')
  // Provider asked, overlay unchanged, nothing resent and nothing claimed.
  expect((await probe(page)).calls.at(-1)).toMatchObject({ reason: 'expired' })
  expect(calls).toHaveLength(1)
  await expect(tryIt(page)).not.toContainText('Credentials expired')
})

test('the refresh button asks the host, clearCredentials brings the red badge back', async ({
  page,
}) => {
  await gotoFixture(page, FIXTURE)
  await clickNavOp(page, 'listPets')
  await waitForFill(page)
  await card(page).locator('summary').click()

  const before = (await probe(page)).calls.length
  await card(page).getByRole('button', { name: 'Refresh credentials' }).click()
  await expect.poll(async () => (await probe(page)).calls.length).toBeGreaterThan(before)
  expect((await probe(page)).calls.at(-1)).toMatchObject({
    reason: 'manual',
    schemeName: 'bearerAuth',
  })

  await page.evaluate(() => window.apidoc.clearCredentials())
  await expect(card(page)).toContainText('missing')
  await expect(card(page)).not.toContainText('provided by the site')
  await expect(card(page)).toContainText('Setup required')

  // A push refills it without any provider round trip.
  await page.evaluate(() => window.apidoc.setCredentials({ bearerAuth: 'pushed-token' }))
  await expect(card(page)).toContainText('provided by the site')
  await expect(card(page)).toContainText('Ready')
})

test('a page that never touches window.apidoc is unchanged', async ({ page }) => {
  const warnings = []
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text())
  })
  await gotoFixture(page, APP_PAGE)
  await clickNavOp(page, 'listPets')
  // The env's own auth.bearerAuth still drives everything, no host badge in sight.
  await expect(card(page)).toContainText('Ready')
  await card(page).locator('summary').click()
  await expect(card(page)).not.toContainText('provided by the site')
  await expect(card(page)).not.toContainText('Refresh credentials')
  expect(warnings.filter((w) => w.includes('credentials'))).toEqual([])
})
