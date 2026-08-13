// Inline schema (`openapi.spec`): the host page carries the document, no schema
// fetch — and the home's download button re-serves this same source.
import { test, expect } from '@playwright/test'

const INLINE_PAGE = '/tests/e2e/fixtures/app-inline.html'

test('boots from a config-embedded schema, with no schema request', async ({ page }) => {
  const schemaRequests = []
  page.on('request', (req) => {
    if (/\.(json|ya?ml)(\?|$)/.test(req.url()) && !req.url().includes('/i18n/')) {
      schemaRequests.push(req.url())
    }
  })
  await page.goto(INLINE_PAGE)
  await expect(page.locator('api-nav a[data-op-id="listThings"]')).toBeAttached()
  await expect(page.locator('header')).toContainText('Inline Docs')
  await expect(page.locator('header')).toContainText('9.9')
  await expect(page.locator('main h1')).toHaveText('Inline API')
  expect(schemaRequests).toEqual([])

  // The internal $ref is properly dereferenced: the doc renders the response schema.
  await page.goto(`${INLINE_PAGE}#/op/listThings`)
  await expect(page.locator('main h1')).toHaveText('List things')
  await expect(page.locator('main')).toContainText('Thing')

  // The home's auth callout describes the scheme of the inline document.
  await page.goto(INLINE_PAGE)
  const card = page.locator('main .card', { hasText: 'Credentials live in environment variables' })
  await expect(card).toContainText('header X-Inline-Key')
  await expect(card).toContainText('Key provided by support.')
})

test('the download button serves the inline schema as JSON', async ({ page }) => {
  await page.goto(INLINE_PAGE)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the OpenAPI file' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('openapi.json')
  const stream = await download.createReadStream()
  const content = await new Promise((resolve, reject) => {
    let out = ''
    stream.on('data', (chunk) => (out += chunk))
    stream.on('end', () => resolve(out))
    stream.on('error', reject)
  })
  const parsed = JSON.parse(content)
  expect(parsed.info.title).toBe('Inline API')
  // The rendered document is the config's, not our normalized model.
  expect(
    parsed.paths['/things'].get.responses['200'].content['application/json'].schema.items.$ref,
  ).toBe('#/components/schemas/Thing')
})
