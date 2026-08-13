// OpenAPI 3.2: the constructs that did not
// exist in 3.1 must travel through the whole pipeline — normalization,
// nav, doc, and above all the try-it's real send.
import { test, expect } from '@playwright/test'
import { clickNavOp, mockApi, panelField, send, tryIt } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-32.html'

async function goto(page) {
  await page.goto(PAGE)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

test('the query method and a free-form method are documented and sent', async ({ page }) => {
  const calls = await mockApi(page)
  await goto(page)

  await clickNavOp(page, 'searchPets')
  await expect(page.locator('main h1')).toHaveText('Search pets')
  await expect(page.locator('main header .badge').first()).toHaveText('query')
  // response `summary` (3.2): displayed in place of the absent description.
  await expect(page.locator('main #responses')).toContainText('Matching pets')

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].method).toBe('QUERY')
  expect(calls[0].url).toBe('https://api.e2e.test/v3/pets')
  // The `dataValue` example pre-filled the body.
  expect(JSON.parse(calls[0].body)).toEqual({ q: 'Rex' })

  await clickNavOp(page, 'purgePets')
  await expect(page.locator('main header .badge').first()).toHaveText('purge')
  await send(page)
  await expect.poll(() => calls.length).toBe(2)
  expect(calls[1].method).toBe('PURGE')
})

test('an in: querystring parameter goes out as-is, without re-encoding', async ({ page }) => {
  const calls = await mockApi(page)
  await goto(page)

  await clickNavOp(page, 'findPets')
  await expect(tryIt(page)).toContainText('Query string')
  await panelField(page, 'filter').fill("$.pets[?(@.name=='Rex')]")

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(decodeURIComponent(calls[0].url)).toBe(
    "https://api.e2e.test/v3/pets/find?$.pets[?(@.name=='Rex')]",
  )
})

test('a sequential media type displays the schema of a stream item', async ({ page }) => {
  await goto(page)
  await clickNavOp(page, 'streamPets')
  const responses = page.locator('main #responses')
  await expect(responses).toContainText('text/event-stream')
  await expect(responses).toContainText('Stream item')
  await expect(responses).toContainText('name')
})
