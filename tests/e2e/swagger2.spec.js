// Swagger 2.0 read end to end (docs/openapi-coverage.md §4.5): a legacy
// document served as-is, converted at load, and from there indistinguishable
// from a 3.x one — it renders, it says where it came from, and it sends what the
// 2.0 `collectionFormat`s asked for.
import { expect, test } from '@playwright/test'
import {
  canSeeFileBytes,
  expectResponded,
  gotoFixture,
  gotoOp,
  mockApi,
  panelParam,
  send,
  tryIt,
} from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-swagger2.html'

test('a 2.0 document renders, and the diagnostics say it was converted', async ({ page }) => {
  await gotoFixture(page, PAGE)
  // The home page reports the version the app actually reads: the conversion's
  // target. Nothing anywhere claims to be reading 2.0.
  await expect(page.locator('main')).toContainText('OpenAPI 3.0.4')
  await expect(page.locator('api-nav')).toContainText('Books')
  // `host` + `basePath` + `schemes` became a server.
  await expect(page.locator('main')).toContainText('https://api.e2e.test/v3')
  // The security scheme survived `securityDefinitions`.
  await expect(page.locator('main')).toContainText('X-Api-Key')

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const panel = page.locator('settings-panel .modal-box')
  await expect(panel).toBeVisible()
  // The one place the original version is named — without it, "3.0.4" would be
  // unexplainable next to the file the integrator serves.
  await expect(panel).toContainText('Converted from')
  await expect(panel).toContainText('Swagger 2.0')
})

test('the converted serialization is what leaves the browser', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'listBooks')

  // Two values each: one value looks the same under every style, and the styles
  // are the whole point of the `collectionFormat` conversion.
  const fill = async (name, first, second) => {
    const param = panelParam(page, name)
    await param.locator('input').first().fill(first)
    await param.getByRole('button', { name: '+ Add item' }).click()
    await param.locator('input').nth(1).fill(second)
  }
  await fill('shelves', 'scifi', 'classics')
  await fill('tags', 'new', 'used')
  await fill('columns', 'title', 'shelf')
  await send(page)
  await expectResponded(page)

  const url = new URL(calls[0].url)
  // `pipes` → pipeDelimited, `multi` → one pair per value, and `tsv` → the
  // documented comma fallback the audit reports below.
  expect(url.searchParams.get('shelves')).toBe('scifi|classics')
  expect(url.searchParams.getAll('tags')).toEqual(['new', 'used'])
  expect(url.searchParams.get('columns')).toBe('title,shelf')
})

test('a formData file body gets a real file picker and is sent as multipart', async ({
  page,
  browserName,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadCover')

  await expect(tryIt(page)).toContainText('multipart/form-data')
  await tryIt(page).getByLabel('bookId', { exact: true }).fill('7')
  await tryIt(page).getByLabel('caption', { exact: true }).fill('First edition')
  // `type: file` became `format: binary`, which is what gives the field a
  // picker instead of a textarea.
  const picker = tryIt(page).locator('input[type="file"]')
  await expect(picker).toHaveCount(1)
  await picker.setInputFiles({
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from('cover-bytes'),
  })

  await send(page)
  await expectResponded(page)
  expect(calls[0].url).toBe('https://api.e2e.test/v3/books/7/cover')
  expect(calls[0].headers['content-type']).toContain('multipart/form-data')
  expect(calls[0].body).toContain('First edition')
  if (canSeeFileBytes(browserName)) expect(calls[0].body).toContain('cover-bytes')
})

test('the body of an in: body parameter is pre-filled from the moved definition', async ({
  page,
}) => {
  await gotoOp(page, PAGE, 'createBook')
  const body = tryIt(page).locator('textarea').first()
  // `#/definitions/Book` resolved through the rewritten pointer, `default`
  // included — and `readOnly: true` keeps `id` out of the request.
  await expect(body).toHaveValue(/"title": "Dune"/)
  await expect(body).not.toHaveValue(/"id"/)
})

test('the audit names what the conversion could only approximate', async ({ page }) => {
  await gotoFixture(page, `${PAGE}#/audit`)
  const finding = page.locator('audit-report [data-rule-id="conversion-approximation"]')
  await expect(finding).toContainText('collectionFormat: tsv')
  await expect(finding).toContainText('GET /books')
})

// The other direction of the same serialization. A value can arrive as the
// string it was on the wire — a share link, a history entry, a hand-written
// scenario step — and the editor has to split it where the parameter says, not
// on a comma it assumed. `shelves` is pipeDelimited: read back with a comma it
// came home as ONE row holding "scifi|classics", and the reader was shown a
// list of one where they had sent two.
test('a pipe-delimited value read back comes home as its own elements', async ({ page }) => {
  await gotoFixture(page, PAGE)
  const payload = { v: 1, path: {}, query: { shelves: 'scifi|classics' }, headers: [] }
  const req = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  await page.goto(`${PAGE}#/op/listBooks?req=${req}`)

  const shelves = panelParam(page, 'shelves')
  await expect(shelves.locator('input')).toHaveCount(2)
  await expect(shelves.locator('input').first()).toHaveValue('scifi')
  await expect(shelves.locator('input').nth(1)).toHaveValue('classics')
})
