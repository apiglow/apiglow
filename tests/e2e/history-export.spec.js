// IndexedDB history (docs/architecture.md §5.6) and clipboard exports
// (§5.7), including "Copy page".
import { test, expect } from '@playwright/test'
import {
  API_BASE,
  clickNavOp,
  clipboardText,
  closeMobilePanels,
  editInDoc,
  expectResponded,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openHistory,
  openTryItIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'

// Sends a successful listPets request — raw material for the tests below.
async function sendOne(page) {
  const calls = await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  // the duration only appears with a real response (the example already shows "200")
  await expectResponded(page)
  await expect.poll(() => calls.length).toBe(1)
  return calls
}

// Expands a history entry: the DaisyUI collapse checkbox covers the
// title, clicking the title would get intercepted.
function expandEntry(entry) {
  return entry.locator('input[type="checkbox"]').first().check()
}

function historyModal(page) {
  return page.locator('request-history-list .modal-box')
}

test('a sent request lands in the history, sensitive values masked by default', async ({
  page,
}) => {
  await sendOne(page)
  await openHistory(page)
  const entry = historyModal(page).locator('.collapse')
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('200')
  await expect(entry).toContainText('e2e')
  // endpoint group, between the date and the verb
  await expect(entry).toContainText('Pets')
  await expandEntry(entry)
  // the bearer token is sensitive → redacted on display
  await expect(entry).toContainText('••••')
  await expect(entry).not.toContainText('e2e-bearer-token')
  // …explicitly disableable
  await historyModal(page)
    .locator('label', { hasText: 'Mask sensitive values' })
    .locator('input.toggle')
    .uncheck()
  // The toggle rebuilds the list, so the row comes back closed — and a closed
  // row carries no detail at all.
  const rebuilt = historyModal(page).locator('.collapse')
  await expandEntry(rebuilt)
  await expect(rebuilt).toContainText('e2e-bearer-token')
})

// A closed row is a title line and nothing else. Building its detail redacts
// the entry, builds an export bar and re-highlights the response body
// (hljs → DOMPurify → innerHTML) — milliseconds per entry, for content
// `content-visibility: hidden` never lays out, and the whole list is rebuilt on
// every keystroke in the free-text filter.
test('a collapsed entry carries no detail until it is opened', async ({ page }) => {
  await sendOne(page)
  await openHistory(page)
  const entry = historyModal(page).locator('.collapse').first()
  const detail = entry.locator('.collapse-content')
  expect(await detail.evaluate((node) => node.childElementCount)).toBe(0)

  await expandEntry(entry)
  await expect(entry.getByRole('button', { name: 'Replay' })).toBeVisible()
  expect(await detail.evaluate((node) => node.childElementCount)).toBeGreaterThan(0)
})

// `list()` walks the whole timestamp cursor and deserializes every record,
// bodies included — tens of milliseconds on a full store. The filters narrow
// the ROWS, never the read, so the store is read once per open and a keystroke
// costs nothing in IndexedDB.
test('opening the history reads the store once, and filtering re-reads nothing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__historyCursors = 0
    const openCursor = IDBIndex.prototype.openCursor
    IDBIndex.prototype.openCursor = function (...args) {
      if (this.objectStore.transaction.db.name === 'apidoc-history') window.__historyCursors++
      return openCursor.apply(this, args)
    }
  })
  await sendOne(page)
  // The send's `change` event refreshes the local metrics with a walk of its
  // own, asynchronously: the strip it renders is the proof that walk is done.
  // Snapshotting the counter before it lands would count it against the open.
  await expect(page.locator('main section#recent')).toBeVisible()

  // Counted from just before the open: writing an entry purges, which walks the
  // same cursor, and that is not what is being bounded here.
  const before = await page.evaluate(() => window.__historyCursors)
  await openHistory(page)
  await expect(historyModal(page).locator('.collapse')).toHaveCount(1)
  // One walk for the rows, one for the retention line's whole-store stats.
  const onOpen = (await page.evaluate(() => window.__historyCursors)) - before
  expect(onOpen).toBeLessThanOrEqual(2)

  await historyModal(page).locator('input[type="search"]').pressSequentially('listpets')
  await expect(historyModal(page).locator('.collapse')).toHaveCount(1)
  expect((await page.evaluate(() => window.__historyCursors)) - before).toBe(onOpen)
})

// Same reading as the try-it panel's, recomputed from the stored headers
// (network-insights decision 3). The two actions stay in the panel, which is
// the only surface that can show what they send back.
test('an archived entry shows the same insights, without the live actions', async ({ page }) => {
  await mockApi(page, {
    headers: {
      'ratelimit-limit': '100',
      'ratelimit-remaining': '7',
      'ratelimit-reset': '30',
      etag: 'W/"pets-p1"',
    },
  })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expectResponded(page)
  await openHistory(page)
  const entry = historyModal(page).locator('.collapse')
  await expandEntry(entry)
  const strip = entry.locator('[data-insight-strip]')
  await expect(strip).toContainText('Rate limit 7/100 left')
  // Spent by the time it is read: a clock time, not a countdown to a past instant.
  await expect(strip).toContainText('reset at')
  await expect(strip).not.toContainText('resets in')
  await expect(strip.getByRole('button', { name: 'Conditional replay' })).toHaveCount(0)
})

// The transfer facts come from the Resource Timing entry, which no route
// interception can stage: Chromium reports the fulfilled body's size for both
// the encoded and the decoded one, so a compression ratio is unstageable. The
// entry the app itself wrote is therefore decorated with the snapshot a real
// h2 + gzip exchange leaves, and the assertion is on the reading of it — which
// is what this session added (network-insights §5.2).
test('the transfer snapshot reads as a protocol badge and a compression ratio', async ({
  page,
}) => {
  await sendOne(page)
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('apidoc-history', 2)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const store = tx.objectStore('entries')
      store.getAll().onsuccess = (event) => {
        for (const entry of event.target.result) {
          entry.transfer = {
            protocol: 'h2',
            transferSize: 9000,
            encodedBodySize: 8192,
            decodedBodySize: 65536,
            fromCache: false,
          }
          store.put(entry)
        }
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  })
  await openHistory(page)
  const entry = historyModal(page).locator('.collapse')
  await expandEntry(entry)
  const strip = entry.locator('[data-insight-strip]')
  await expect(strip).toContainText('HTTP/2')
  await expect(strip).toContainText('Compressed 8.0 kB on the wire → 64.0 kB (×8.0)')
})

// Retention is enforced on every write; if the user can't see the rules, an
// entry disappearing reads as data loss (bounded-storage policy).
test('the history states its retention rules and the age of its oldest entry', async ({ page }) => {
  await sendOne(page)
  await openHistory(page)
  await expect(historyModal(page)).toContainText('1/500 entries kept')
  await expect(historyModal(page)).toContainText('deleted after 30 days')
  // Nothing to state on an empty history — the empty message says it all.
  page.once('dialog', (dialog) => dialog.accept())
  await historyModal(page).getByRole('button', { name: 'Clear history' }).click()
  await expect(historyModal(page)).not.toContainText('entries kept')
})

test('history survives a page reload (IndexedDB)', async ({ page }) => {
  await sendOne(page)
  await page.reload()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeVisible()
  await openHistory(page)
  await expect(historyModal(page).locator('.collapse')).toHaveCount(1)
})

test('replay re-sends the stored request as-is and appends a new entry', async ({ page }) => {
  const calls = await sendOne(page)
  await openHistory(page)
  await expandEntry(historyModal(page).locator('.collapse').first())
  await historyModal(page).getByRole('button', { name: 'Replay' }).click()
  await expect.poll(() => calls.length).toBe(2)
  expect(calls[1].url).toBe(calls[0].url)
  expect(calls[1].headers.authorization).toBe(calls[0].headers.authorization)
  await expect(historyModal(page).locator('.collapse')).toHaveCount(2)
})

test('load in try-it reopens the operation with the stored request as editable state', async ({
  page,
}) => {
  await sendOne(page)
  // starting from another view to verify the navigation
  await clickNavOp(page, 'getPet')
  await openHistory(page)
  await expandEntry(historyModal(page).locator('.collapse').first())
  await historyModal(page).getByRole('button', { name: 'Load in try-it' }).click()
  await expect(historyModal(page)).not.toBeVisible()
  await expect(page.locator('main h1')).toHaveText('List all pets')
  // the stored headers become editable panel rows again
  await openTryItIfMobile(page)
  await expect(tryIt(page).locator('input[aria-label="Header name"]').first()).toBeVisible()
  const names = await tryIt(page)
    .locator('input[aria-label="Header name"]')
    .evaluateAll((els) => els.map((e) => e.value))
  expect(names).toContain('Authorization')
})

test('history filters narrow the list; clear empties it after confirmation', async ({ page }) => {
  await sendOne(page)
  await openHistory(page)
  const search = historyModal(page).locator('input[type="search"]')
  await search.fill('zzz-no-match')
  await expect(historyModal(page).locator('.collapse')).toHaveCount(0)
  await search.fill('listPets')
  await expect(historyModal(page).locator('.collapse')).toHaveCount(1)
  page.on('dialog', (d) => d.accept())
  await historyModal(page).getByRole('button', { name: 'Clear history' }).click()
  await expect(historyModal(page)).toContainText('No requests yet.')
})

test('a network failure is also recorded, filterable by status "Network error"', async ({
  page,
}) => {
  await page.route('https://api.e2e.test/**', (r) => r.abort('failed'))
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(tryIt(page)).toContainText('Request failed at network level')
  await openHistory(page)
  await historyModal(page).locator('select.w-32').selectOption('error')
  const entry = historyModal(page).locator('.collapse')
  await expect(entry).toHaveCount(1)
  await expandEntry(entry)
  await expect(entry).toContainText('No response (network error)')
})

// --- Try-it export bar (same generators as history) ---

function exportBar(page) {
  return tryIt(page).locator('[data-export-bar]')
}

// The format is chosen in the export bar's icon dropdown.
async function copyExport(page, format) {
  await exportBar(page).locator('[data-format-picker] summary').click()
  await exportBar(page).locator(`[data-format="${format}"]`).click()
  await exportBar(page).getByRole('button', { name: 'Copy', exact: true }).click()
  return clipboardText(page)
}

test('cURL export: secrets masked by default, plain on demand, {{var}} template mode', async ({
  page,
}) => {
  await sendOne(page)
  // Format proposed by default: Debug (everything).
  await expect(exportBar(page).locator('[data-format-picker] summary')).toContainText(
    'Debug (everything)',
  )
  let curl = await copyExport(page, 'curl')
  expect(curl).toContain('curl -X GET')
  expect(curl).toContain('••••')
  expect(curl).not.toContain('e2e-bearer-token')

  await exportBar(page)
    .locator('label', { hasText: 'mask secrets' })
    .locator('input[type="checkbox"]')
    .uncheck()
  curl = await copyExport(page, 'curl')
  expect(curl).toContain('Bearer e2e-bearer-token')

  await exportBar(page)
    .locator('label', { hasText: 'keep {{variables}}' })
    .locator('input[type="checkbox"]')
    .check()
  curl = await copyExport(page, 'curl')
  expect(curl).toContain('{{auth.bearerAuth}}')
})

test('Postman v2.1, Markdown, HAR and Debug exports are generated from the same entry', async ({
  page,
}) => {
  await sendOne(page)

  const postman = JSON.parse(await copyExport(page, 'postman'))
  expect(postman.info.schema).toContain('v2.1.0')
  expect(JSON.stringify(postman)).toContain('/v1/pets')

  const markdown = await copyExport(page, 'markdown')
  expect(markdown).toContain('```')
  expect(markdown).toContain('/v1/pets')
  expect(markdown).toContain('200')

  const har = JSON.parse(await copyExport(page, 'har'))
  expect(har.log.version).toBe('1.2')
  expect(har.log.entries).toHaveLength(1)
  // The entry comes from a real send: `headersMs` is populated, so waiting
  // and receiving are indeed two distinct durations, summing to `time`.
  const { time, timings } = har.log.entries[0]
  expect(timings.wait).toBeGreaterThan(0)
  expect(timings.send + timings.wait + timings.receive).toBe(time)

  const debug = await copyExport(page, 'debug')
  expect(debug).toContain('/v1/pets')
})

// --- "Copy page": endpoint doc → Markdown / LLM (post-MVP) ---

test('copy page as Markdown puts the endpoint doc in the clipboard', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  // Menu and item both live in the doc: the sheet is closed once and stays
  // closed, where clickInDoc would put the panel back over the menu it just
  // opened.
  await closeMobilePanels(page)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  await page.getByRole('button', { name: 'Copy as Markdown' }).click()
  const md = await clipboardText(page)
  expect(md).toContain('List all pets')
  expect(md).toContain('GET')
  expect(md).toContain('/pets')
})

test('view as Markdown shows the source the copy item would put in the clipboard', async ({
  page,
}) => {
  await gotoApp(page, '#/op/listPets')
  await closeMobilePanels(page)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  await page.getByRole('button', { name: 'View as Markdown' }).click()
  const dialog = page.locator('dialog[data-markdown-source]')
  await expect(dialog).toBeVisible()
  // Source, not rendered Markdown: the heading marks are part of what is shown.
  await expect(dialog.locator('pre')).toContainText('# List all pets')
  await expect(dialog.locator('pre')).toContainText('GET')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download the file' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('listPets.md')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the agent hand-off items register this API, not the endpoint', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await closeMobilePanels(page)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  await page.getByRole('button', { name: 'Copy MCP command' }).click()
  const command = await clipboardText(page)
  expect(command).toMatch(/^claude mcp add e2e-test-api /)
  expect(command).toContain('@ivotoby/openapi-mcp-server')
  expect(command).toContain('/tests/e2e/fixtures/e2e-api.json')
  // Placeholders, never the environment's token (rule 12) — same guarantee as
  // the config block on the home page.
  expect(command).toContain('YOUR_API_KEY')
  expect(command).not.toContain('e2e-bearer-token')
  // The install links carry the same entry, encoded for each editor.
  const cursor = await page.getByRole('link', { name: 'Add to Cursor' }).getAttribute('href')
  expect(cursor).toContain('cursor://anysphere.cursor-deeplink/mcp/install?name=e2e-test-api')
  const vscode = await page.getByRole('link', { name: 'Add to VS Code' }).getAttribute('href')
  expect(JSON.parse(decodeURIComponent(vscode.split('?')[1])).name).toBe('e2e-test-api')
})

test('open in ChatGPT opens a popup with the doc embedded in the prompt', async ({ page }) => {
  await page
    .context()
    .route('https://chatgpt.com/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<html>stub</html>' }),
    )
  await gotoApp(page, '#/op/listPets')
  // Menu and item both live in the doc: the sheet is closed once and stays
  // closed, where clickInDoc would put the panel back over the menu it just
  // opened.
  await closeMobilePanels(page)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open in ChatGPT' }).click()
  const popup = await popupPromise
  await popup.waitForURL(/chatgpt\.com/)
  const q = new URL(popup.url()).searchParams.get('q')
  expect(q).toContain('List all pets')
})

// --- run selector: endpoint history in the response panel ---

// The panel contains two mockups (snippet then response): the last one is
// the response one.
function respPanel(page) {
  return tryIt(page).locator('.api-code-panel').last()
}

function runSelector(page) {
  // The panel carries three dropdowns (runs, export, scenario capture):
  // only an explicit marker distinguishes them without relying on placement.
  return tryIt(page).locator('details[data-run-selector]')
}

async function openRunSelector(page) {
  await runSelector(page).locator('summary').click()
  await expect(runSelector(page).locator('.dropdown-content')).toBeVisible()
}

function runItems(page) {
  return runSelector(page).locator('.dropdown-content li button')
}

test('past calls of the endpoint are listed in the response panel and shown without re-sending', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(respPanel(page)).toContainText('Rex')
  // Route registered after the first: it's the one answering now.
  const failing = await mockApi(page, { status: 503, body: { error: 'down' } })
  await send(page)
  await expect(respPanel(page)).toContainText('down')

  await openRunSelector(page)
  // 2 runs + the "Full history…" entry
  await expect(runItems(page)).toHaveCount(3)
  // the most recent one first, explicitly marked
  await expect(runItems(page).nth(0)).toContainText('Latest')
  await expect(runItems(page).nth(0)).toContainText('503')
  await expect(runItems(page).nth(1)).toContainText('200')
  await expect(runItems(page).nth(1)).not.toContainText('Latest')

  const sentBefore = failing.length
  await runItems(page).nth(1).click()
  await expect(respPanel(page)).toContainText('Archived call')
  await expect(respPanel(page)).toContainText('Rex')
  expect(failing.length).toBe(sentBefore)
})

test('selecting an archived call reloads the form, and the draft is restorable', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await panelField(page, 'limit').fill('7')
  await send(page)
  await expect(respPanel(page)).toContainText('Rex')
  await panelField(page, 'limit').fill('99')

  // The selection reloads the original request with no other action needed…
  await openRunSelector(page)
  await runItems(page).nth(0).click()
  await expect(panelField(page, 'limit')).toHaveValue('7')
  await expect(respPanel(page)).toContainText('Rex')

  // …and the draft set aside comes back with one click.
  await tryIt(page).getByRole('button', { name: 'Back to my request' }).click()
  await expect(panelField(page, 'limit')).toHaveValue('99')
  await expect(tryIt(page)).not.toContainText('Archived call')

  await openRunSelector(page)
  await runItems(page).last().click()
  await expect(historyModal(page)).toBeVisible()
  await expect(historyModal(page).locator('select').first()).toHaveValue('listPets')
})

test('an archived network failure is shown as archived, not as a failure that just happened', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(respPanel(page)).toContainText('Rex')
  await page.route(`${API_BASE}/**`, (r) => r.abort('failed'))
  await send(page)
  await expect(tryIt(page)).toContainText('Request failed at network level')

  // The failed run can be viewed like any other…
  await openRunSelector(page)
  await expect(runItems(page).nth(0)).toContainText('Network error')
  await runItems(page).nth(1).click()
  await expect(respPanel(page)).toContainText('Rex')

  // …and the archived failure reads back without passing for a current failure.
  await openRunSelector(page)
  await runItems(page).nth(0).click()
  await expect(tryIt(page)).toContainText('Archived call')
  await expect(tryIt(page)).toContainText('Request failed at network level')
})

test('reloading a past call syncs the body fields of the doc, not just the snippet', async ({
  page,
}) => {
  const docField = (name) =>
    page.locator(`api-endpoint-doc [aria-label="Try-it value for ${name}"]`)

  await mockApi(page)
  await gotoApp(page, '#/op/createPet')
  await editInDoc(page, async () => {
    await docField('name').fill('Rex')
    await docField('status').selectOption('sold')
  })
  await send(page)
  await expectResponded(page)

  // We modify the draft: the archived request must bring back ITS values.
  await editInDoc(page, async () => {
    await docField('name').fill('Bella')
    await docField('status').selectOption('pending')
  })

  await openRunSelector(page)
  await runItems(page).nth(0).click()
  await expect(docField('name')).toHaveValue('Rex')
  await expect(docField('status')).toHaveValue('sold')
  await expect(tryIt(page)).toContainText('Rex')

  // Back to the draft: the doc follows in this direction too.
  await tryIt(page).getByRole('button', { name: 'Back to my request' }).click()
  await expect(docField('name')).toHaveValue('Bella')
})

test('loading a request from the history modal syncs the doc body fields too', async ({ page }) => {
  const docField = (name) =>
    page.locator(`api-endpoint-doc [aria-label="Try-it value for ${name}"]`)

  await mockApi(page)
  await gotoApp(page, '#/op/createPet')
  await docField('name').fill('Rex')
  await send(page)
  await expectResponded(page)
  await docField('name').fill('Bella')

  await openHistory(page)
  await expandEntry(historyModal(page).locator('.collapse').first())
  await historyModal(page).getByRole('button', { name: 'Load in try-it' }).click()
  await expect(historyModal(page)).not.toBeVisible()
  await expect(docField('name')).toHaveValue('Rex')
})

test('a long response body is pretty-printed and folded behind Show more', async ({ page }) => {
  const pets = Array.from({ length: 20 }, (_, i) => ({ id: i, name: `pet-${i}` }))
  await mockApi(page, { body: pets })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expectResponded(page)
  await openHistory(page)
  const entry = historyModal(page).locator('.collapse')
  await expandEntry(entry)

  // The body is re-indented (the API responds minified) and colorized.
  const body = entry.locator('pre code.language-json')
  await expect(body).toContainText('"name": "pet-0"')
  const toggle = entry.locator('[data-body-toggle]')
  await expect(toggle).toHaveText('Show more')
  const box = entry.locator('pre:has(code.language-json)')
  const folded = await box.evaluate((el) => el.getBoundingClientRect().height)

  await toggle.click()
  await expect(toggle).toHaveText('Show less')
  expect(await box.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(folded)
})
