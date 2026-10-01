// What the schema says about serialization, once the values are typed:
// `allowReserved` and `allowEmptyValue`, an `in: cookie` parameter (T3 — it
// reaches the cURL export and not the network), an XML body, and a urlencoded
// body whose Encoding Object decides how its fields are spelled on the wire;
// and where a relative operation server sends it.
import { expect, test } from '@playwright/test'
import { editInDoc, expectResponded, gotoOp, mockApi, panelField, send, tryIt } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-request.html'

test('allowReserved sends the value as typed, and allowEmptyValue only when asked', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'searchBooks')

  await panelField(page, 'filter').fill('shelves/scifi?live=1')
  // Left alone, an empty field is still "nothing to send".
  await send(page)
  await expectResponded(page)
  expect(calls[0].url).toBe('https://api.e2e.test/v3/search?filter=shelves/scifi?live=1')

  await tryIt(page).getByText('Send empty (name=)').click()
  await send(page)
  await expectResponded(page)
  expect(calls[1].url).toContain('verbose=')
})

test('a cookie parameter is editable, reaches the cURL export, and says it will not be sent', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'searchBooks')

  await panelField(page, 'session').fill('sess-42')
  // The T3 statement sits next to the field, not only in a post-send alert.
  await expect(tryIt(page)).toContainText('Cookie parameters leave in a folded Cookie header')
  await expect(tryIt(page)).toContainText("-H 'Cookie: session=sess-42'")

  await send(page)
  await expectResponded(page)
  // The browser drops the header a script sets; the app warns rather than
  // pretending otherwise.
  expect(calls[0].headers.cookie).toBeUndefined()
  await expect(tryIt(page)).toContainText('browsers drop the Cookie header')
})

test('the cookie field mirrors between the doc and the panel', async ({ page }) => {
  await gotoOp(page, PAGE, 'searchBooks')
  const docField = page.locator('main [aria-label="Try-it value for session"]')
  await editInDoc(page, () => docField.fill('from-doc'))
  await expect(panelField(page, 'session')).toHaveValue('from-doc')
  await panelField(page, 'session').fill('from-panel')
  await expect(docField).toHaveValue('from-panel')
})

test('an XML body is pre-filled as XML and sent as typed', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'createBook')

  const body = tryIt(page).locator('textarea')
  // The schema says just as much in XML as it does in JSON: attribute,
  // wrapped array, item element name.
  await expect(body).toHaveValue(/<book id="7">/)
  await expect(body).toHaveValue(/<authors>\s*<author>Frank<\/author>\s*<\/authors>/)

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers['content-type']).toBe('application/xml')
  expect(calls[0].body).toContain('<title>Dune</title>')
})

// The two variants of a body share one schema, so the XML Object is the only
// thing that tells the columns apart: describing a JSON body with `<book>` and
// a wrapped array both lied and made the media type selector look inert.
test('the XML shape is documented under the XML media type only', async ({ page }) => {
  const bothWays = async (section) => {
    const select = section.getByLabel('Media type')
    await expect(section).toContainText('XML <book>')
    await expect(section).toContainText('XML attribute')

    await select.selectOption({ label: 'application/json' })
    await expect(section).not.toContainText('XML <book>')
    await expect(section).not.toContainText('XML attribute')
    // The schema itself is still there: only its XML reading went away.
    await expect(section).toContainText('authors')

    await select.selectOption({ label: 'application/xml' })
    await expect(section).toContainText('XML <book>')
  }

  // Request body: the selection belongs to the panel, which hands it back.
  await gotoOp(page, PAGE, 'createBook')
  await bothWays(page.locator('main #body'))
  // Responses: the same block, decided locally — no panel in the loop.
  await gotoOp(page, PAGE, 'searchBooks')
  await bothWays(page.locator('main #responses'))
})

test('the XML response example is shown as XML, not as JSON', async ({ page }) => {
  await gotoOp(page, PAGE, 'createBook')
  await expect(tryIt(page).locator('code.language-xml')).toContainText('<book id="7">')
})

test('a urlencoded body follows its encoding object', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadBook')

  // The doc states the serialization the schema alone does not show.
  await expect(page.locator('main #body')).toContainText('Encoding')
  await expect(page.locator('main #body')).toContainText('reserved characters kept')

  await tryIt(page).getByLabel('tags', { exact: true }).fill('sci-fi,classic')
  await tryIt(page).getByLabel('path', { exact: true }).fill('shelves/a')
  await send(page)
  await expectResponded(page)
  // `explode: true` repeats the pair; `allowReserved` keeps the slash.
  expect(calls[0].body).toBe('tags=sci-fi&tags=classic&path=shelves/a')
})

// Fetch cannot carry a GET body, so the page sends the request without it —
// and says so, since the cURL command is the reader's one way to send it.
test('a GET body stays in the cURL command, is said not to leave, and blocks nothing', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'lookupBooks')

  await expect(tryIt(page)).toContainText('A browser cannot send a body with GET')
  const body = tryIt(page).locator('textarea')
  // Invalid JSON missing its required field: it would block a POST.
  await body.fill('{"title": "Dune"')
  await expect(tryIt(page)).toContainText("--data '")

  await send(page)
  await expectResponded(page)
  expect(calls[0].method).toBe('GET')
  expect(calls[0].body).toBeNull()
})

// A browser drops a forbidden header without a word: the panel names it while
// it is being typed, not after a send that silently went without it.
test('a header the browser will not send is named, and the request leaves without it', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'echoOrigin')
  const note = tryIt(page).getByText('The browser will not send these headers')
  await expect(note).toBeHidden()

  await tryIt(page).getByLabel('Header value').fill('https://elsewhere.example')
  await expect(note).toContainText(': Origin.')
  await expect(tryIt(page)).toContainText("-H 'Origin: https://elsewhere.example'")

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers.origin).not.toBe('https://elsewhere.example')
})

test('a TRACE operation says the browser refuses it, instead of a network failure', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'traceEcho')

  await send(page)
  await expect(tryIt(page).locator('.alert-error')).toContainText(
    'Browsers refuse to send a TRACE request',
  )
  await expect(tryIt(page)).not.toContainText('Request failed at network level')
  expect(calls).toHaveLength(0)
})

// The fixture declares `$self` on api.e2e.test while the page and the file sit
// on the test server: a relative operation server resolved against the page
// would send to the test server instead.
test("a relative operation server resolves against the document's own URI", async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'pingLegacy')

  await expect(page.locator('main')).toContainText('https://api.e2e.test/v2/ping')
  await expect(tryIt(page)).toContainText('https://api.e2e.test/v2/ping')
  await send(page)
  await expectResponded(page)
  expect(calls[0].url).toBe('https://api.e2e.test/v2/ping')
})
