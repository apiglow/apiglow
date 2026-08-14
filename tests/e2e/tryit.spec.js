// Try-it: doc↔panel sync, interpolation and blocking, auth injection,
// cURL preview, CORS proxy, network errors (docs/architecture.md §5.4/§5.5).
import { test, expect } from '@playwright/test'
import {
  API_BASE,
  clickInDoc,
  clickNavOp,
  clipboardText,
  credentialsCard,
  editInDoc,
  expectResponded,
  gotoApp,
  isMobileLayout,
  mockApi,
  openTryItIfMobile,
  panelField,
  panelParam,
  send,
  tryIt,
} from './helpers.js'

test('credentials card shows the effective auth from the selected environment', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  const card = credentialsCard(page)
  // auth.bearerAuth is set in the e2e env: card collapsed on the
  // green status, details stay hidden until expanded.
  await expect(card).toContainText('Ready')
  await expect(card).not.toHaveAttribute('open')
  await card.locator('summary').click()
  await expect(card).toHaveAttribute('open')
  await expect(card).toContainText('Bearer')
  await expect(card).toContainText('auth.bearerAuth')
  // Editable field pre-filled, hidden until the eye icon is clicked.
  const field = card.locator('input[type="password"]')
  await expect(field).toHaveValue('e2e-bearer-token')
  await card.getByLabel('Show / hide value').click()
  await expect(card.locator('input[type="text"]')).toHaveValue('e2e-bearer-token')
  await expect(card).toContainText('From environment “e2e”')
})

test('filling a credential in the card saves it to the environment and injects it', async ({
  page,
}) => {
  const calls = await mockApi(page)
  // auth.apiKeyAuth does not exist in the e2e env: the card opens on an
  // empty field, without going through the environments popin.
  await gotoApp(page, '#/op/listOrders')
  const card = credentialsCard(page)
  await expect(card).toContainText('Setup required')
  await expect(card).toHaveAttribute('open')
  await expect(card).toContainText('missing')

  const field = card.locator('input[type="password"]')
  await field.fill('key-from-panel')
  await field.press('Enter')

  // Status recomputed without rebuilding the panel, and the variable persisted.
  await expect(card).toContainText('Ready')
  await expect(card).not.toContainText('missing')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers['x-api-key']).toBe('key-from-panel')

  // Reload: the value indeed comes from the stored environment.
  await gotoApp(page, '#/op/listOrders')
  await expect(credentialsCard(page)).toContainText('Ready')
})

test('http basic exposes two fields, only the password masked, and encodes them', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/getAccount')
  const card = credentialsCard(page)
  await expect(card).toContainText('auth.basicAuth.username')
  await expect(card).toContainText('auth.basicAuth.password')

  // The username is not a secret: plain-text field, unlike the
  // password.
  const username = card.locator('input[type="text"]')
  const password = card.locator('input[type="password"]')
  await username.fill('ada')
  await username.press('Enter')
  await password.fill('s3cret')
  await password.press('Enter')
  await expect(card).toContainText('Ready')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers.authorization).toBe(`Basic ${btoa('ada:s3cret')}`)
})

test('a credential typed in the card does not wipe the request being prepared', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listOrders')
  const card = credentialsCard(page)
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  const name = tryIt(page).locator('input[aria-label="Header name"]').last()
  await name.fill('X-Trace')

  await card.locator('input[type="password"]').fill('key-from-panel')
  await card.locator('input[type="password"]').blur()

  await expect(card).toContainText('Ready')
  await expect(name).toHaveValue('X-Trace')
})

test('clicking an enum value in the doc fills the try-it field (doc → panel sync)', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  await clickInDoc(page, page.locator('section#params-query button.badge', { hasText: 'sold' }))
  await expect(panelField(page, 'status')).toHaveValue('sold')
  // and the cURL preview follows
  await expect(
    tryIt(page).locator('.api-code-panel', { hasText: 'Request' }).locator('pre code').first(),
  ).toContainText('status=sold')
})

test('a long enum is collapsed to 7 chips behind a show-more toggle', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const row = page.locator('section#params-query .api-param-row', {
    has: page.locator('code:text-is("breed")'),
  })
  const values = row.locator('.badge.font-mono')
  const toggle = row.getByRole('button', { name: '+5 more…' })

  await expect(values).toHaveCount(12)
  expect(await values.filter({ visible: true }).count()).toBe(7)
  await expect(row.getByRole('button', { name: '"shiba"' })).toBeHidden()

  await clickInDoc(page, toggle)
  await expect(row.getByRole('button', { name: '"shiba"' })).toBeVisible()
  expect(await values.filter({ visible: true }).count()).toBe(12)

  // The expanded values remain clickable like the others.
  await clickInDoc(page, row.getByRole('button', { name: '"shiba"' }))
  await expect(panelField(page, 'breed')).toHaveValue('shiba')

  await clickInDoc(page, row.getByRole('button', { name: 'Show less' }))
  await expect(row.getByRole('button', { name: '"shiba"' })).toBeHidden()
})

test('a long enum becomes a filterable combobox in the try-it panel', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const field = panelField(page, 'breed')
  const list = page.locator('ul[role="listbox"]')
  await expect(field).toHaveAttribute('role', 'combobox')

  await field.click()
  await expect(list).toBeVisible()
  await expect(list.getByRole('option')).toHaveCount(12)

  // Filtering as you type, then keyboard selection.
  await page.keyboard.type('ll')
  await expect(list.getByRole('option')).toHaveCount(2)
  await expect(list).toContainText('2 / 12')
  await page.keyboard.press('Enter')
  await expect(list).toBeHidden()
  await expect(field).toHaveValue('bulldog')

  // Exact value: the list reopens in full, otherwise it could never be changed again.
  await field.click()
  await expect(list.getByRole('option')).toHaveCount(12)
  // …and it's the current value that's active, not the first option.
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('bulldog')

  await field.click()
  await list.getByRole('option', { name: 'shiba' }).click()
  await expect(field).toHaveValue('shiba')

  // The chosen value does go out in the request.
  const calls = await mockApi(page)
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].url).toContain('breed=shiba')
})

test('the combobox filters out nothing it cannot match, and Escape closes it', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const field = panelField(page, 'breed')
  const list = page.locator('ul[role="listbox"]')

  await field.click()
  await page.keyboard.type('zzz')
  await expect(list.getByRole('option')).toHaveCount(0)
  await expect(list).toContainText('No matching value')

  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  // The try-it stays open: Escape did not propagate up to the panel.
  await expect(tryIt(page)).toBeVisible()
})

test('a value outside the enum is flagged, but a {{variable}} is not', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const field = panelField(page, 'breed')
  const docField = page.locator('main [aria-label="Try-it value for breed"]')

  await field.click()
  await page.keyboard.type('chihuahua')
  await expect(field).toHaveClass(/input-warning/)
  // The doc's twin field is written without an event: it must flag itself too.
  await expect(docField).toHaveClass(/input-warning/)

  // A template is exempt: its real value only exists at send time.
  await field.fill('{{breed}}')
  await expect(field).not.toHaveClass(/input-warning/)
  await expect(docField).not.toHaveClass(/input-warning/)

  // A declared value obviously isn't flagged either.
  await field.fill('husky')
  await expect(field).not.toHaveClass(/input-warning/)
  await expect(field).toHaveJSProperty('title', '')
})

test('typing in the panel mirrors into the doc inline field (panel → doc sync)', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  await panelField(page, 'limit').fill('5')
  await panelField(page, 'limit').blur()
  await expect(page.locator('main [aria-label="Try-it value for limit"]')).toHaveValue('5')
})

test('send performs the real request: auth header injected, response displayed, tabs work', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await panelField(page, 'status').selectOption('available')
  await send(page)

  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].method).toBe('GET')
  expect(calls[0].url).toBe(`${API_BASE}/v1/pets?status=available`)
  // Authorization must be injected automatically from auth.bearerAuth
  expect(calls[0].headers.authorization).toBe('Bearer e2e-bearer-token')

  const panel = tryIt(page)
  await expect(panel).toContainText('200')
  await expectResponded(page)
  await expect(panel).toContainText('Rex') // body pretty-print
  await panel.getByRole('tab', { name: 'Raw' }).click()
  await expect(panel).toContainText('"name":"Rex"')
  await panel.getByRole('tab', { name: 'Headers' }).click()
  await expect(panel).toContainText(/\d+ header\(s\) received/)
})

test('a missing {{variable}} blocks the send with a clear message, nothing is sent', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  await tryIt(page).locator('input[aria-label="Header name"]').last().fill('X-Broken')
  const value = tryIt(page)
    .locator('input[aria-label="Header name"]')
    .last()
    .locator('xpath=following-sibling::input[1]')
  await value.fill('{{nope}}')
  await expect(value).toHaveClass(/input-error/) // highlighted even before sending
  await send(page)
  await expect(tryIt(page).getByRole('alert')).toContainText('Missing variables: nope')
  expect(calls.length).toBe(0)
})

test('an array query parameter edits as rows and goes out as repeated pairs', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  const tags = panelParam(page, 'tags')

  // One row to start with: the field looks like any other until a second
  // value is needed.
  await expect(tags.locator('input')).toHaveCount(1)
  await tags.locator('input').first().fill('cat')
  await tags.getByRole('button', { name: '+ Add item' }).click()
  await tags.locator('input').nth(1).fill('dog')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(new URL(calls[0].url).searchParams.getAll('tags')).toEqual(['cat', 'dog'])

  // Removing a row drops that value only.
  await tags.getByRole('button', { name: 'Remove item' }).first().click()
  await send(page)
  await expect.poll(() => calls.length).toBe(2)
  expect(new URL(calls[1].url).searchParams.getAll('tags')).toEqual(['dog'])
})

test('array parameter: the central doc edits the same rows as the panel', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const docRow = page.locator('section#params-query .api-param-row', {
    has: page.locator('code:text-is("tags")'),
  })
  await editInDoc(page, async () => {
    await docRow.locator('input').first().fill('husky')
    await docRow.getByRole('button', { name: '+ Add item' }).click()
    await docRow.locator('input').nth(1).fill('shiba')
  })

  const panelInputs = panelParam(page, 'tags').locator('input')
  await expect(panelInputs).toHaveCount(2)
  await expect(panelInputs.first()).toHaveValue('husky')
  await expect(panelInputs.nth(1)).toHaveValue('shiba')
})

test('an object query parameter edits per property and spreads as deepObject', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  const owner = panelParam(page, 'owner')

  // One field per declared property, and the date format shows its shape.
  await expect(owner.locator('input')).toHaveCount(2)
  await expect(owner.locator('input').nth(1)).toHaveAttribute('placeholder', '2024-01-15')

  await owner.getByLabel('owner city').fill('Lyon')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  const sent = new URL(calls[0].url).searchParams
  expect(sent.get('owner[city]')).toBe('Lyon')
  expect(sent.has('owner[since]')).toBe(false)

  // The doc column edits the same properties.
  const docRow = page.locator('section#params-query .api-param-row', {
    has: page.locator('code:text-is("owner")'),
  })
  await editInDoc(page, () => docRow.getByLabel(/owner.*since/).fill('2024-03-01'))
  await expect(panelParam(page, 'owner').getByLabel('owner since')).toHaveValue('2024-03-01')
})

test('an enum field shows a value it cannot list instead of blanking it', async ({ page }) => {
  // Share link carrying a template in an enum parameter: the select has no
  // such option, and used to silently fall back to "—".
  const payload = { v: 1, path: {}, query: { status: '{{who}}' }, headers: [] }
  const req = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  await gotoApp(page, `#/op/listPets?req=${req}`)

  await expect(panelField(page, 'status')).toHaveValue('{{who}}')
  await send(page)
  await expect(tryIt(page).getByRole('alert')).toContainText('Missing variables: who')
})

test('a required path parameter left empty blocks the send', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/getPet')
  // The schema declares an example for petId, so the field arrives filled
  // (first-touch.spec.js): emptying it is what this guard is about.
  await panelField(page, 'petId').fill('')
  await send(page)
  await expect(tryIt(page).getByRole('alert')).toContainText('Path parameter “petId” is required.')
  expect(calls.length).toBe(0)
  await panelField(page, 'petId').fill('42')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].url).toBe(`${API_BASE}/v1/pets/42`)
})

test('body validation: prefilled example, invalid JSON and missing required field block', async ({
  page,
}) => {
  const calls = await mockApi(page, { status: 201, body: { id: 2, name: 'Bello' } })
  await gotoApp(page, '#/op/createPet')
  const body = tryIt(page).locator('textarea')
  await expect(body).toHaveValue(/"name"/) // pre-filled skeleton/example

  await body.fill('this is not json')
  await send(page)
  await expect(tryIt(page).getByRole('alert')).toContainText('Body is not valid JSON.')

  await body.fill('{"status": "sold"}')
  await send(page)
  await expect(tryIt(page).getByRole('alert')).toContainText('missing required field “name”')
  expect(calls.length).toBe(0)

  await body.fill('{"name": "Bello"}')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].method).toBe('POST')
  expect(JSON.parse(calls[0].body)).toEqual({ name: 'Bello' })
  await expect(tryIt(page)).toContainText('201')
})

test('a free-form map and a tuple are editable as forms, not only as raw JSON', async ({
  page,
}) => {
  const calls = await mockApi(page, { status: 201, body: { id: 2, name: 'Bello' } })
  await gotoApp(page, '#/op/createPet')
  const body = tryIt(page).locator('textarea')
  const row = (name) =>
    page.locator('api-endpoint-doc .api-schema-row', {
      has: page.locator(`code:text-is("${name}")`),
    })

  // Map: the keys are data too, so they are typed alongside their value.
  const metadata = row('metadata')
  await editInDoc(page, async () => {
    await metadata.getByRole('button', { name: '+ Add key' }).click()
    await metadata.getByLabel('metadata key').fill('breed')
    await metadata.getByLabel('Try-it value for metadata').fill('husky')
  })
  await expect(body).toHaveValue(/"metadata": \{\s*"breed": "husky"/)

  // Tuple: fixed positions, no add/remove — the length is part of the type.
  const coords = row('coords')
  await expect(coords.getByRole('button', { name: '+ Add item' })).toHaveCount(0)
  const slots = coords.locator('input')
  await expect(slots).toHaveCount(2)
  await editInDoc(page, async () => {
    await slots.first().fill('48.85')
    await slots.nth(1).fill('2.35')
  })

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  // Typed values, not strings: the tuple keeps its positions.
  expect(JSON.parse(calls[0].body)).toMatchObject({
    metadata: { breed: 'husky' },
    coords: [48.85, 2.35],
  })
})

// A scenario step chaining an id writes `"age": {{petAge}}` — the token is
// left unquoted so the value lands as a number, which makes the body a
// template rather than JSON. The doc's mirror used to give up on parsing it
// and keep showing empty fields, run scope or not.
test('a bare {{variable}} in the body keeps the doc fields in sync', async ({ page }) => {
  const docField = (name) =>
    page.locator(`api-endpoint-doc [aria-label="Try-it value for ${name}"]`)
  await gotoApp(page, '#/op/createPet')
  const body = tryIt(page).locator('textarea')

  await body.fill('{"name": "Rex", "age": {{petAge}}}')
  await expect(docField('name')).toHaveValue('Rex')
  await expect(docField('age')).toHaveValue('{{petAge}}')

  // The other direction too: editing a neighbouring field rewrites the body
  // without quoting the token — that would send a string where the API
  // expects a number.
  await editInDoc(page, () => docField('name').fill('Bella'))
  await expect(body).toHaveValue(/"name": "Bella"/)
  await expect(body).toHaveValue(/"age": \{\{petAge\}\}/)
})

test('live cURL preview reflects the resolved request and copies as-is', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const preview = tryIt(page).locator('.api-code-panel', { hasText: 'Request' })
  await expect(preview.locator('pre code').first()).toContainText(
    `curl -X GET '${API_BASE}/v1/pets'`,
  )
  await preview.locator('button[aria-label="Copy"]').click()
  const copied = await clipboardText(page)
  // the preview deliberately copies the real values, secrets included — a
  // snippet with placeholders would not be runnable
  expect(copied).toContain('Bearer e2e-bearer-token')
})

// Everywhere else the suite asserts what the app *handed* to the clipboard
// (helpers.js captures `writeText`), because reading it back is Chromium-only.
// This one test reads the real thing, so a capture that silently stopped
// delegating — asserting nothing but itself — fails here.
test('the copy really reaches the system clipboard', async ({ page }, testInfo) => {
  // Pinned to the project, not the engine: `clipboard-read` is granted in the
  // `chromium` project's config alone, and mobile-chrome is the same engine
  // without it.
  test.skip(testInfo.project.name !== 'chromium', 'only the chromium project grants clipboard-read')
  await gotoApp(page, '#/op/listPets')
  const preview = tryIt(page).locator('.api-code-panel', { hasText: 'Request' })
  await preview.locator('button[aria-label="Copy"]').click()
  const real = await page.evaluate(() => navigator.clipboard.readText())
  expect(real).toContain(`curl -X GET '${API_BASE}/v1/pets'`)
})

test('snippet language switch: read-only Python snippet, copy follows, choice persists after reload', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  const preview = tryIt(page).locator('.api-code-panel', { hasText: 'Request' })
  const langRow = tryIt(page).getByRole('group', { name: 'Language' })
  await expect(langRow.getByRole('button', { name: 'cURL', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await langRow.getByRole('button', { name: 'Python (requests)' }).click()
  await expect(preview.locator('pre code').first()).toContainText('import requests')
  await expect(preview.locator('pre code').first()).toContainText('requests.get(')
  await preview.locator('button[aria-label="Copy"]').click()
  expect(await clipboardText(page)).toContain('import requests')
  // global preference persisted (localStorage), not per operation
  await page.reload()
  await expect(preview.locator('pre code').first()).toContainText('import requests')
})

// Every tile of the row must produce a highlighted snippet: an unregistered
// hljs language throws inside the refresh and leaves the panel on the previous
// source, silently.
test('every language of the row renders its own snippet', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const preview = tryIt(page).locator('.api-code-panel', { hasText: 'Request' })
  const langRow = tryIt(page).getByRole('group', { name: 'Language' })
  const marks = [
    ['JavaScript (fetch)', 'await fetch('],
    ['Node.js (axios)', "import axios from 'axios'"],
    ['PHP (cURL)', 'curl_init('],
    ['Ruby (net/http)', 'Net::HTTP::Get.new(uri)'],
    ['Java (HttpClient)', 'HttpRequest.newBuilder()'],
    ['C# (HttpClient)', 'new HttpRequestMessage(HttpMethod.Get'],
    ['Go', 'http.NewRequest('],
    ['HTTPie', 'http GET '],
  ]
  for (const [name, expected] of marks) {
    await langRow.getByRole('button', { name, exact: true }).click()
    await expect(preview.locator('pre code').first()).toContainText(expected)
    // hljs ran: the source is tokenized, not dumped as plain text.
    await expect(preview.locator('pre code .hljs-string').first()).toBeVisible()
  }
})

// Switching language regenerates one code block, so it rebuilds nothing else:
// the response the user just obtained stays on screen. Only the cURL boundary
// is structural (that mockup embeds the body editor) and still re-renders.
test('a language switch keeps the response and the typed request', async ({ page }) => {
  await mockApi(page, { body: [{ id: 7, name: 'Milou' }] })
  await gotoApp(page, '#/op/listPets')
  const langRow = tryIt(page).getByRole('group', { name: 'Language' })
  await langRow.getByRole('button', { name: 'Python (requests)' }).click()
  await panelField(page, 'breed').fill('corgi')
  await send(page)
  await expect(tryIt(page)).toContainText('Milou')

  await langRow.getByRole('button', { name: 'Go', exact: true }).click()
  await expect(tryIt(page)).toContainText('Milou')
  await expect(panelField(page, 'breed')).toHaveValue('corgi')
  // The tiles still say which one is active, without having been rebuilt.
  await expect(langRow.getByRole('button', { name: 'Go', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(langRow.getByRole('button', { name: 'Python (requests)' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

test('response examples are browsable per status code before any send', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  const panel = tryIt(page).locator('.api-code-panel', { hasText: 'Response' })
  await expect(panel).toContainText('Example')
  await panel.getByRole('button', { name: '401' }).click()
  await expect(panel).toContainText('Missing bearer token')
  // sync mockup badge → status tab of the central doc
  await expect(page.locator('section#responses [role="tab"]', { hasText: '401' })).toHaveClass(
    /tab-active/,
  )
  await panel.getByRole('button', { name: '200' }).click()
  await expect(panel).toContainText('Rex')
  await expect(page.locator('section#responses [role="tab"]', { hasText: '200' })).toHaveClass(
    /tab-active/,
  )
  // reverse sync: doc tab → mockup badge
  await clickInDoc(page, page.locator('section#responses [role="tab"]', { hasText: '401' }))
  await expect(panel).toContainText('Missing bearer token')
  await expect(panel.getByRole('button', { name: '401' })).toHaveAttribute('aria-pressed', 'true')
})

test('the schema-derived example stays reachable after a send, and back', async ({ page }) => {
  await mockApi(page, { body: [{ id: 7, name: 'Milou' }] })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  const panel = tryIt(page).locator('.api-code-panel', { hasText: 'Response' })
  await expect(panel).toContainText('Milou')

  await panel.getByRole('button', { name: 'Example response' }).click()
  await expect(panel).toContainText('Rex') // the example declared by the schema
  await expect(panel).not.toContainText('Milou')

  await panel.getByRole('button', { name: 'Actual response' }).click()
  await expect(panel).toContainText('Milou')
})

test('an unreachable API offers the schema-derived example', async ({ page }) => {
  // No mock: the try-it's fetch fails before any HTTP response.
  await gotoApp(page, '#/op/listPets')
  await send(page)
  const response = tryIt(page).locator('div').filter({ hasText: 'Request failed' }).first()
  await expect(response).toBeVisible()
  await tryIt(page).getByRole('button', { name: 'Example response' }).click()
  await expect(tryIt(page).locator('.api-code-panel', { hasText: 'Response' })).toContainText('Rex')
})

// Showcase headers for the insight strip: a nearly-spent quota, a next page,
// a validator, a correlation id. The mock answers a conditional request with
// the 304 the validator is for.
const INSIGHT_HEADERS = {
  'ratelimit-limit': '100',
  'ratelimit-remaining': '7',
  'ratelimit-reset': '30',
  link: `<${API_BASE}/v1/pets?page=2>; rel="next", <${API_BASE}/v1/pets?page=1>; rel="first"`,
  etag: 'W/"pets-p1"',
  'x-request-id': 'req-42',
}

function mockPagedApi(page) {
  return mockApi(page, (request) => {
    if (request.headers()['if-none-match']) return { status: 304, headers: INSIGHT_HEADERS }
    const second = new URL(request.url()).searchParams.get('page') === '2'
    return {
      headers: INSIGHT_HEADERS,
      body: second ? [{ id: 2, name: 'Idefix' }] : [{ id: 1, name: 'Rex' }],
    }
  })
}

const strip = (page) => tryIt(page).locator('[data-insight-strip]')

test('the insight strip reads what the response headers say', async ({ page }) => {
  await mockPagedApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(strip(page)).toContainText('Rate limit 7/100 left')
  await expect(strip(page)).toContainText('resets in')
  await expect(strip(page)).toContainText('Page links next · first')
  await expect(strip(page)).toContainText('ETag W/"pets-p1"')
  await expect(strip(page)).toContainText('x-request-id req-42')
  // `first` is in the tooltip, not in a fourth button nobody clicks.
  await expect(strip(page).getByRole('button', { name: 'Next page' })).toBeVisible()
  await expect(strip(page).getByRole('button', { name: 'First page' })).toHaveCount(0)
})

// Decision 2 — silence over noise: on a plain API the response panel looks
// exactly as it did before the feature existed.
test('a response with none of the recognized headers shows no strip', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expectResponded(page)
  await expect(strip(page)).toHaveCount(0)
})

test('following the next link sends the server’s own URL and logs an ordinary entry', async ({
  page,
}) => {
  const calls = await mockPagedApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(tryIt(page).locator('.api-code-panel', { hasText: 'Response' })).toContainText('Rex')

  await strip(page).getByRole('button', { name: 'Next page' }).click()
  await expect(tryIt(page).locator('.api-code-panel', { hasText: 'Response' })).toContainText(
    'Idefix',
  )
  await expect.poll(() => calls.at(-1)?.url).toBe(`${API_BASE}/v1/pets?page=2`)
  // An ordinary send: the run selector counts it like any other.
  await expect(tryIt(page)).toContainText('Calls · 2')
})

test('conditional replay sends the validator and gets the 304 it is for', async ({
  page,
  browserName,
}) => {
  // Playwright's WebKit refuses `route.fulfill` on any 3xx ("Cannot fulfill
  // with redirect status"), and a 304 is the whole subject here — there is no
  // other way to hand the app one. Residual gap, recorded in
  // docs/cross-browser.md §4.5.
  test.skip(browserName === 'webkit', 'Playwright cannot fulfill a 304 on WebKit')
  const calls = await mockPagedApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await strip(page).getByRole('button', { name: 'Conditional replay' }).click()
  await expect(tryIt(page).locator('.api-code-panel', { hasText: 'Response' })).toContainText('304')
  await expect.poll(() => calls.at(-1)?.headers['if-none-match']).toBe('W/"pets-p1"')
})

// The verdict is a reading of the failure, never a rewording: the raw browser
// error stays verbatim next to it (network-insights §2, decision 1).
test('an unreachable server is diagnosed as such, next to the raw error', async ({ page }) => {
  // No route at all: nothing answers api.e2e.test, not even the probe.
  await gotoApp(page, '#/op/listPets')
  await send(page)
  const response = tryIt(page).locator('.api-response-view')
  await expect(response).toContainText('Most likely: the server is unreachable')
  await expect(response).toContainText('Request failed at network level')
  // "Verbatim" is exactly why this cannot assert the wording: each engine has
  // its own ("Failed to fetch", "NetworkError when attempting to fetch
  // resource.", "Load failed"). What must hold is that the raw throw is on
  // screen at all, next to the verdict — not rewritten into it.
  await expect(response).toContainText(/TypeError: \S/)
  // The verdict supersedes the generic list of possible causes.
  await expect(response).not.toContainText('Typical causes')
})

test('response copy button copies only the visible content, per active tab', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  const mock = tryIt(page).locator('.api-code-panel', { hasText: 'Response' })
  await expect(mock).toContainText('200')
  await mock.locator('button[aria-label="Copy"]').click()
  let copied = await clipboardText(page)
  expect(copied.trim().startsWith('[')).toBe(true) // the JSON body, nothing else
  expect(copied).toContain('"Rex"')
  expect(copied).not.toContain('curl')
  await mock.getByRole('tab', { name: 'Headers' }).click()
  await mock.locator('button[aria-label="Copy"]').click()
  copied = await clipboardText(page)
  expect(copied).toContain('content-type: application/json')
  expect(copied).not.toContain('Rex')
})

test('CORS proxy toggle routes the request through the configured template', async ({ page }) => {
  const proxied = []
  await page.route('https://proxy.e2e.test/**', async (route) => {
    proxied.push(route.request().url())
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      contentType: 'application/json',
      body: '[]',
    })
  })
  await gotoApp(page, '#/op/listPets')
  await tryIt(page)
    .locator('label', { hasText: 'Route through CORS proxy' })
    .locator('input.toggle')
    .check()
  await send(page)
  await expect.poll(() => proxied.length).toBeGreaterThan(0)
  expect(proxied.at(-1)).toBe(
    `https://proxy.e2e.test/?url=${encodeURIComponent(`${API_BASE}/v1/pets`)}`,
  )
})

test('the send meter times the flight, splits server time when exposed, then fades out', async ({
  page,
}) => {
  await mockApi(page, { delayMs: 700, headers: { 'server-timing': 'db;dur=40, total;dur=300' } })
  await gotoApp(page, '#/op/listPets')
  const meter = tryIt(page).locator('.api-send-meter')

  // At rest the widget keeps its place but shows nothing.
  await expect(meter).toHaveCSS('opacity', '0')
  await expect(meter.locator('.api-send-phases')).toBeEmpty()

  await send(page)
  await expect(meter).toHaveClass(/is-live/)
  // Past the outbound sweep, the bar freezes and the dot spins.
  await expect(meter.locator('.api-send-rail')).toHaveClass(/is-waiting/)

  await expectResponded(page)
  // Readable Server-Timing ⇒ the outbound leg breaks down into network + server.
  // The phases carry no unit, only the total does.
  await expect(meter.locator('.api-send-phases')).toContainText('srv 300')
  await expect(meter.locator('.api-send-total')).toContainText(/\d+ ms/)

  // The widget no longer fades out on its own: the numbers stay readable until the
  // next send, which alone resets the bar to zero.
  await page.waitForTimeout(1500)
  await expect(meter).toHaveClass(/is-live/)
  await expect(meter.locator('.api-send-phases')).toContainText('srv 300')
})

// The two displays used to have two clocks: the widget's started before
// the entry's (forced reflow in the middle) and stopped later (body read).
// They drifted by 1 to 3 ms — enough to contradict each other on screen.
test('the send meter total and the response duration are the same measure', async ({ page }) => {
  await mockApi(page, { delayMs: 200 })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expectResponded(page)

  const meterText = await tryIt(page).locator('.api-send-total').textContent()
  // Scoped to the response mockup: the runs bar above it also shows
  // durations (those of previous calls).
  const responseText = await tryIt(page)
    .locator('.api-response-view .api-code-panel')
    .first()
    .textContent()
  const ms = (text) => Number(/(\d+)\s*ms/.exec(text)?.[1])

  expect(ms(meterText)).toBeGreaterThanOrEqual(200)
  expect(ms(responseText)).toBe(ms(meterText))
})

// The status pill's glow announces a network event: it must therefore
// trigger when a response lands, and only then. A round trip to the
// schema example or viewing an archived call go through the same
// rendering without anything having gone out on the network.
test('the status pill flashes when a response lands, and only then', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  const flash = tryIt(page).locator('.api-code-panel .api-status-flash')

  // The glow must not overlap the beam still in flight: we capture the bar's
  // state at the exact instant the class appears, the only way to prove the
  // ordering without chasing a window of a few dozen ms.
  await page.evaluate(() => {
    const panel = document.querySelector('api-try-it-panel')
    window.__railDoneAtFlash = null
    new MutationObserver(() => {
      if (window.__railDoneAtFlash !== null || !panel.querySelector('.api-status-flash')) return
      window.__railDoneAtFlash = panel.querySelector('.api-send-rail').classList.contains('is-done')
    }).observe(panel, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  })

  await send(page)
  await expectResponded(page)
  await expect(flash).toHaveCount(1)
  expect(await page.evaluate(() => window.__railDoneAtFlash)).toBe(true)
  await expect(flash).toContainText('200')

  await tryIt(page).getByRole('button', { name: 'Example response' }).click()
  await tryIt(page).getByRole('button', { name: 'Actual response' }).click()
  await expect(tryIt(page).locator('.api-code-panel').last()).toContainText('200')
  await expect(flash).toHaveCount(0)

  // Archived call: the "Archived call" banner already says so, the glow must
  // not add a "this just arrived" that would contradict it.
  const runs = tryIt(page).locator('details[data-run-selector]')
  await runs.locator('summary').click()
  await runs.locator('.dropdown-content li button').first().click()
  await expect(tryIt(page).locator('.api-code-panel').last()).toContainText('Archived call')
  await expect(flash).toHaveCount(0)
})

test('a network failure turns the send meter red instead of completing it', async ({ page }) => {
  await page.route(`${API_BASE}/**`, (r) => r.abort('failed'))
  await gotoApp(page, '#/op/listPets')
  await send(page)
  const rail = tryIt(page).locator('.api-send-rail')
  await expect(rail).toHaveClass(/is-error/)
  await expect(rail).not.toHaveClass(/is-returning/)
})

// A server that answers the probe but not the send is, from the browser's side,
// exactly what a CORS block looks like — and it is where the configured proxy
// is worth naming, so the verdict absorbs the standalone hint (§3.2).
test('a reachable server that refuses the send is diagnosed as CORS, proxy named', async ({
  page,
}) => {
  // A real block can't be staged: Playwright's fulfilled responses bypass the
  // browser's CORS check. So what is staged is what the app observes —
  // everything it really sends fails, and only the no-cors probe (a bare GET,
  // no auth header) gets its opaque answer.
  await page.route(`${API_BASE}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.abort('failed')
    const headers = await request.allHeaders()
    if (headers.authorization) return route.abort('failed')
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(tryIt(page)).toContainText('Request failed at network level')
  await expect(tryIt(page)).toContainText('Most likely: blocked by CORS')
  await expect(tryIt(page)).toContainText('enable “Route through CORS proxy” and retry')
})

// `tryIt.requestCredentials` decides whether the browser attaches the API's
// cookies to a try-it send, and nothing in the DOM moves with it: a regression
// pinning the mode to a constant breaks every cookie-authenticated install
// while the page stays perfectly healthy. What the browser does expose is its
// CORS rule — a wildcard `Access-Control-Allow-Origin` is rejected for a
// credentialed fetch and accepted for any other — so the two configurations
// are told apart by what comes back, not by what is displayed.
const CREDENTIALS_PAGE = '/tests/e2e/fixtures/app-credentials.html'

async function sendAgainst(page, fixture, { credentialedCors }) {
  await page.route(`${API_BASE}/**`, async (route) => {
    const req = route.request()
    const origin = (await req.allHeaders()).origin ?? '*'
    const cors = credentialedCors
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization, content-type',
        }
      : { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: '[]',
    })
  })
  await page.goto(`${fixture}#/op/listPets`)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  // Raw goto (the fixture and the routing are the subject here), so the sheet
  // that holds Send below lg has to be asked for explicitly.
  await openTryItIfMobile(page)
  await send(page)
}

test('the default requestCredentials leaves a wildcard-CORS API usable', async ({ page }) => {
  await sendAgainst(page, '/tests/e2e/fixtures/app.html', { credentialedCors: false })
  await expectResponded(page)
})

test('requestCredentials "include" reaches fetch — the browser enforces credentialed CORS', async ({
  page,
}) => {
  await sendAgainst(page, CREDENTIALS_PAGE, { credentialedCors: false })
  // Rejected before any response is exposed: proof the fetch carried
  // credentials, since the very same wildcard answer satisfies the default.
  await expect(tryIt(page)).toContainText('no HTTP response was received')

  await page.unrouteAll()
  await sendAgainst(page, CREDENTIALS_PAGE, { credentialedCors: true })
  await expectResponded(page)
})

// Header memory and the persisted column widths are stores with unit tests and
// no wiring test: the store working says nothing about the panel calling it.
// When the wiring goes, the app looks perfectly healthy — it just quietly
// forgets, which is the whole point of the feature.
const headerNames = (target) =>
  tryIt(target)
    .locator('input[aria-label="Header name"]')
    .evaluateAll((els) => els.map((el) => el.value))
const headerValues = (target) =>
  tryIt(target)
    .locator('input[aria-label="Header value"]')
    .evaluateAll((els) => els.map((el) => el.value))

test('a header typed once follows the user to another operation and across a reload', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  await tryIt(page).locator('input[aria-label="Header name"]').last().fill('X-Tenant')
  await tryIt(page).locator('input[aria-label="Header value"]').last().fill('acme')
  await tryIt(page).locator('input[aria-label="Header value"]').last().blur()

  // Another operation, which declares no such header: the test context is what
  // travels, not the schema.
  await clickNavOp(page, 'createPet')
  // Values live on the property, not the attribute: read them as the browser
  // holds them.
  await expect.poll(() => headerNames(page)).toContain('X-Tenant')
  await expect.poll(() => headerValues(page)).toContain('acme')

  await gotoApp(page, '#/op/getPet')
  await expect.poll(() => headerValues(page)).toContain('acme')

  // Clearing it is how you forget it — the memory is not a one-way ratchet.
  const valueField = tryIt(page)
    .locator('input[aria-label="Header value"]')
    .filter({ hasNot: page.locator('[hidden]') })
  const index = (await headerValues(page)).indexOf('acme')
  await valueField.nth(index).fill('')
  await valueField.nth(index).blur()
  await gotoApp(page, '#/op/listPets')
  await expect.poll(() => headerValues(page)).not.toContain('acme')
})

test('a resized nav column keeps its width across a reload', async ({ page }) => {
  // A column you drag the edge of only exists while the columns are in the
  // flow: below lg the nav is a fixed-width drawer with no handle to grab.
  test.skip(isMobileLayout(page), 'no resizable column below lg — the nav is a drawer')
  await gotoApp(page)
  const aside = page.locator('aside.api-drawer')
  const startWidth = (await aside.boundingBox()).width
  const handle = page.locator('.cursor-col-resize').first()
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const dragged = (await aside.boundingBox()).width
  expect(dragged).toBeGreaterThan(startWidth + 40)

  await gotoApp(page)
  expect((await aside.boundingBox()).width).toBeCloseTo(dragged, 0)
})

// The cancel control (docs/architecture.md §5.5.6): an in-flight send can be
// aborted from the panel; the outcome is announced, nothing is rendered as a
// network failure, and the panel is immediately ready to send again.
test('an in-flight send can be canceled, and the panel recovers', async ({ page }) => {
  await mockApi(page, { delayMs: 30_000 })
  await gotoApp(page, '#/op/listPets')
  await openTryItIfMobile(page)

  const cancel = tryIt(page).getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeHidden()
  await send(page)
  await expect(cancel).toBeVisible()
  await cancel.click()

  await expect(tryIt(page)).toContainText('Request canceled')
  await expect(cancel).toBeHidden()
  // Not a network failure: no diagnosis, no raw error text.
  await expect(tryIt(page).locator('.api-response-view')).not.toContainText('Most likely')
  // Ready to go again, without a reload.
  await expect(tryIt(page).getByRole('button', { name: 'Send' })).toBeEnabled()
})
