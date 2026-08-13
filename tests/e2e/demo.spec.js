import { expect, test } from '@playwright/test'
import {
  credentialsCard,
  expectResponded,
  openTryItIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'

// The demo page (demo/cdn-install.html, served at /) is the only place where
// the service-worker mock runs: everywhere else the suite intercepts at the
// Playwright level, against synthetic fixtures. What is checked here is the
// demo's own promise — a visitor lands, sends a request and runs the shipped
// scenario, with no backend and no CORS anywhere.

async function gotoDemo(page, hash = '') {
  await page.goto(`/${hash}`)
  // Published by demo/register-mock-sw.js once the worker controls the page.
  await expect(page.locator('html')).toHaveAttribute('data-mock-api', 'ready')
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

test('the mocked API answers a try-it send, same-origin and unproxied', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/op/getInventory')

  // No environment is configured for the petstore: the base URL comes from
  // the schema's relative server, resolved against the page.
  const base = new URL('/demo-api/v3', page.url()).href
  await expect(tryIt(page)).toContainText(`${base}/store/inventory`)

  await send(page)
  await expectResponded(page)
  const response = tryIt(page).locator('.api-response-view')
  await expect(response).toContainText('200')
  // Seeded inventory: 2 available, 1 pending, 1 sold.
  await expect(response).toContainText('"available": 2')
})

test('the mocked API is stateful: a created pet is readable back', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/op/addPet')
  await openTryItIfMobile(page)
  await tryIt(page)
    .locator('textarea')
    .first()
    .fill('{"name": "Pixel", "photoUrls": [], "status": "pending"}')
  await send(page)
  await expectResponded(page)

  const created = await tryIt(page).locator('.api-response-view').textContent()
  const id = /"id":\s*(\d+)/.exec(created)?.[1]
  expect(id).toBeTruthy()

  await gotoDemo(page, '#/s/petstore/op/getPetById')
  await openTryItIfMobile(page)
  await panelField(page, 'petId').fill(id)
  await send(page)
  await expectResponded(page)
  await openTryItIfMobile(page)
  await expect(tryIt(page).locator('.api-response-view')).toContainText('Pixel')
})

test('the shipped scenario runs green against the mock', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/scenario/order-a-pet')
  const view = page.locator('api-scenario-view')
  await expect(view.locator('li[data-step-id]')).toHaveCount(3)

  await view.getByRole('button', { name: 'Run all' }).click()
  await expect(view.getByRole('status')).toContainText('3/3 steps succeeded')
  for (let i = 0; i < 3; i++) {
    await expect(view.locator('li[data-step-id]').nth(i)).toHaveAttribute('data-step-status', 'ok')
  }
})

// The failure showcase (`errors` tag): the demo really produces the failures
// its schema declares, so the app's failure rendering is reachable by a
// visitor instead of only by the test suite.

test('the failure showcase: a 429 raises the Retry chip with its countdown', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/op/failRateLimit')
  await openTryItIfMobile(page)
  await send(page)
  await expectResponded(page)
  await expect(tryIt(page).locator('.api-response-view')).toContainText('429')
  const strip = tryIt(page).locator('[data-insight-strip]')
  await expect(strip).toContainText('Retry')
  // The Retry-After deadline renders as a live countdown, not a static value.
  await expect(strip).toContainText(/in \d+\s?s/)
})

test('the failure showcase: a bad payload gets the structured 422 body', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/op/failValidation')
  await openTryItIfMobile(page)
  await tryIt(page).locator('textarea').first().fill('{"email": "nope", "quantity": 0}')
  await send(page)
  await expectResponded(page)
  const response = tryIt(page).locator('.api-response-view')
  await expect(response).toContainText('422')
  await expect(response).toContainText('"errors"')
  await expect(response).toContainText('"/email"')
  await expect(response).toContainText('"/quantity"')
})

test('the failure showcase: the 500 renders as an explained failure', async ({ page }) => {
  await gotoDemo(page, '#/s/petstore/op/failServerError')
  await openTryItIfMobile(page)
  await send(page)
  await expectResponded(page)
  const response = tryIt(page).locator('.api-response-view')
  await expect(response).toContainText('500')
  await expect(response).toContainText('Deliberate internal error')
})

// The whole OAuth surface is served by the worker, consent page included: an
// authorization-code round trip works on any static hosting, no authorization
// server anywhere. This is the one place that full trip runs unmocked.
test('the OAuth authorization-code flow round-trips inside the worker', async ({
  page,
  browserName,
}) => {
  // Playwright's Firefox and WebKit builds hand the post-consent return
  // navigation to the network instead of the active worker (the in-page
  // fetch interception the other demo tests rely on works fine there) — a
  // harness gap, not a demo one: the round trip is pinned on Chromium.
  test.skip(
    browserName !== 'chromium',
    'worker-controlled return navigation is Chromium-only under Playwright',
  )
  await gotoDemo(page, '#/s/petstore/op/addPet')
  await openTryItIfMobile(page)

  const card = credentialsCard(page)
  // A token is prefilled by the demo environment, so the card rests
  // collapsed: expand it to reach the flow block.
  if (!(await card.getAttribute('open'))) await card.locator('summary').click()
  await expect(card.getByLabel('Client ID')).toHaveValue('demo-client')
  await card.getByRole('button', { name: 'Get a token' }).click()

  // The consent page is served by the service worker on a top-level
  // navigation — the caveat this test exists to pin.
  await expect(page.locator('h1')).toContainText('Demo authorization server')
  await page.getByRole('link', { name: 'Authorize' }).click()

  // Back in the app: code exchanged against the worker's token endpoint,
  // token saved into the environment.
  await expect(page.locator('.toast .alert-success')).toContainText('saved in environment')
  expect(new URL(page.url()).searchParams.has('code')).toBe(false)
})

// The witness spec (GitHub's REST API description, demo/schemas/NOTICE.md) is
// multi-MB: the perf contract stands only because inactive specs cost nothing
// until selected. This pins the "nothing" half.
test('the frozen witness spec is not downloaded until selected', async ({ page }) => {
  const witnessRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/demo/schemas/github.json')) witnessRequests.push(request.url())
  })
  await gotoDemo(page, '#/s/petstore/op/getInventory')
  await expect(page.locator('spec-switcher')).toContainText('Petstore')
  expect(witnessRequests).toHaveLength(0)
})

test('an unknown endpoint under the mocked prefix answers a JSON 404', async ({ page }) => {
  await gotoDemo(page)
  const body = await page.evaluate(async () => {
    const response = await fetch('/demo-api/v3/nope')
    return { status: response.status, json: await response.json() }
  })
  expect(body.status).toBe(404)
  expect(body.json.message).toContain('/nope')
})
