// Webhooks & callbacks (competitive analysis, prio 1 item 4): dedicated section
// in the nav, read-only doc, simulator that delivers the example payload
// to a receiver URL, Callbacks section on the operation page.
import { test, expect } from '@playwright/test'
import {
  API_BASE,
  clickNavOp,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openTryItIfMobile,
} from './helpers.js'

test('nav shows a Webhooks section; the webhook doc is read-only', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav li.menu-title').filter({ hasText: 'Webhooks' })).toBeVisible()
  const link = page.locator('api-nav a[data-op-id="webhook-post-petadopted"]')
  await expect(link).toBeVisible()
  await link.click()
  expect(new URL(page.url()).hash).toBe('#/op/webhook-post-petadopted')
  await expect(page.locator('main h1')).toHaveText('Pet adopted')
  await expect(page.locator('main .badge').filter({ hasText: 'Webhook' }).first()).toBeVisible()
  // Read-only: no try-it input fields in the central doc.
  await expect(page.locator('section#params-header .api-param-row')).toContainText(
    'X-Webhook-Signature',
  )
  await expect(page.locator('section#params-header input')).toHaveCount(0)
  // The right-hand panel is the simulator, not the try-it.
  await openTryItIfMobile(page)
  await expect(page.locator('api-webhook-simulator')).toBeVisible()
  await expect(page.locator('api-try-it-panel')).toBeHidden()
})

test('the simulator delivers the example payload to the receiver URL', async ({ page }) => {
  const calls = await mockApi(page, { status: 200, body: { ok: true } })
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')
  await sim.locator('input[type="url"]').fill(`${API_BASE}/hooks/receiver`)
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('200')
  expect(calls).toHaveLength(1)
  expect(calls[0].method).toBe('POST')
  expect(calls[0].url).toBe(`${API_BASE}/hooks/receiver`)
  expect(JSON.parse(calls[0].body)).toEqual({ petId: 1, adopterEmail: 'jane@example.com' })
  expect(calls[0].headers['content-type']).toBe('application/json')
  // Signature header declared by the webhook, pre-filled with its example.
  expect(calls[0].headers['x-webhook-signature']).toBe('sha256=abc')
})

// Third-party receiver (webhook.site, a bare tunnel, a server-to-server
// handler). A genuine CORS rejection cannot be staged here: Chromium skips the
// CORS check — preflight included — for a response served by route
// interception. What the simulator keys off is the same either way, a fetch
// that rejects, so the blocked case is staged as an aborted request.
const RECEIVER = 'https://receiver.e2e.test/hooks/in'

async function mockReceiver(page, { abort = false } = {}) {
  const calls = []
  await page.route('https://receiver.e2e.test/**', async (route) => {
    const req = route.request()
    calls.push({ method: req.method(), headers: await req.allHeaders(), body: req.postData() })
    if (abort) return route.abort('failed')
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' })
  })
  return calls
}

test('a send blocked at network level points at fire-and-forget', async ({ page }) => {
  await mockReceiver(page, { abort: true })
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')
  await sim.locator('input[type="url"]').fill(RECEIVER)
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('no HTTP response was received')
  await expect(sim).toContainText('may simply not allow this origin')
})

test('fire-and-forget delivers the event, minus the headers the browser drops', async ({
  page,
}) => {
  const calls = await mockReceiver(page)
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')
  await sim.locator('input[type="url"]').fill(RECEIVER)
  await sim.locator('input[data-fire-and-forget]').check()
  // Named before the send, not discovered after it.
  await expect(sim).toContainText(
    'Headers the browser drops in this mode: Content-Type, X-Webhook-Signature',
  )

  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('the receiver answered')
  // Opaque response: no status, no body, so neither may be displayed.
  await expect(sim.locator('.api-code-panel')).toHaveCount(0)

  const delivered = calls.filter((c) => c.method === 'POST')
  expect(delivered).toHaveLength(1)
  expect(JSON.parse(delivered[0].body)).toEqual({ petId: 1, adopterEmail: 'jane@example.com' })
  // The trade the mode makes, on the wire: the signature is gone and the JSON
  // payload travels as text/plain.
  expect(delivered[0].headers['x-webhook-signature']).toBeUndefined()
  expect(delivered[0].headers['content-type']).toMatch(/^text\/plain/)
})

// The hint is worth nothing if it names a toggle that has already been used.
test('the fire-and-forget hint disappears once the mode is on', async ({ page }) => {
  await mockReceiver(page, { abort: true })
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')
  await sim.locator('input[type="url"]').fill(RECEIVER)
  await sim.locator('input[data-fire-and-forget]').check()
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('no HTTP response was received')
  await expect(sim).not.toContainText('may simply not allow this origin')
})

// `fetch` rejects a no-cors PUT outright: the mode is absent rather than
// offered and then failing, and the failure hint must not name it either.
test('a webhook whose method no-cors forbids gets no fire-and-forget toggle', async ({ page }) => {
  await mockReceiver(page, { abort: true })
  await gotoApp(page, '#/op/webhook-put-petsynced')
  const sim = page.locator('api-webhook-simulator')
  await expect(sim).toContainText('petSynced')
  await expect(sim.locator('input[data-fire-and-forget]')).toHaveCount(0)
  await sim.locator('input[type="url"]').fill(RECEIVER)
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('no HTTP response was received')
  await expect(sim).not.toContainText('may simply not allow this origin')
})

test('the simulator blocks sending without a valid receiver URL', async ({ page }) => {
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim.getByRole('alert')).toContainText('valid http(s) URL')
})

test('an operation with callbacks renders the Callbacks section', async ({ page }) => {
  await gotoApp(page)
  await clickNavOp(page, 'createPet')
  const section = page.locator('section#callbacks')
  await expect(section).toContainText('onPetStatus')
  await expect(section).toContainText('{$request.body#/callbackUrl}')
  await expect(section).toContainText('Callback received')
})

test('webhooks are searchable from the palette', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('Control+k')
  const input = page.locator('search-palette input[type="search"]')
  await input.fill('adopted')
  const hit = page.locator('search-palette a[data-result-id="webhook-post-petadopted"]')
  await expect(hit).toBeVisible()
  await expect(page.locator('search-palette li.menu-title', { hasText: 'Webhooks' })).toBeVisible()
  await input.press('Enter')
  await expect(page.locator('main h1')).toHaveText('Pet adopted')
})

// Rule 11 binds every send path, the simulator included: it has no auth to
// inject, but it does resolve the selected environment's variables, and an
// unresolved one blocks the send instead of putting the literal on the wire.
test('an unresolved {{var}} blocks the simulator, a defined one is substituted', async ({
  page,
}) => {
  const calls = await mockApi(page, { status: 200, body: { ok: true } })
  await gotoApp(page, '#/op/webhook-post-petadopted')
  const sim = page.locator('api-webhook-simulator')

  await sim.locator('input[type="url"]').fill(`${API_BASE}/hooks/{{unknownHook}}`)
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim.getByRole('alert')).toContainText('Missing variables: unknownHook')
  expect(calls).toHaveLength(0)

  // Same for a header, where nothing in the URL would have hinted at it. The
  // signature row is the webhook's own declared header, not the content type.
  expect(await sim.locator('input[aria-label="Header name"]').nth(1).inputValue()).toBe(
    'X-Webhook-Signature',
  )
  const signature = sim.locator('input[aria-label="Header value"]').nth(1)
  await sim.locator('input[type="url"]').fill(`${API_BASE}/hooks/receiver`)
  await signature.fill('{{missingSecret}}')
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim.getByRole('alert')).toContainText('Missing variables: missingSecret')
  expect(calls).toHaveLength(0)

  // A variable the environment defines resolves, in the URL and in the header.
  await sim.locator('input[type="url"]').fill(`${API_BASE}/hooks/{{token}}`)
  await signature.fill('sig-{{token}}')
  await sim.locator('button', { hasText: 'Send event' }).click()
  await expect(sim).toContainText('200')
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe(`${API_BASE}/hooks/tok-123`)
  expect(calls[0].headers['x-webhook-signature']).toBe('sig-tok-123')
})
