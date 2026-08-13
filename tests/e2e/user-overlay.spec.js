// The user's own overlay (docs/user-overlay.md): a schema the reader patches
// for themselves, in their browser, on top of everything the host declared.
// What the suite is really guarding is the failure mode the feature creates —
// a page that quietly shows something other than what the API published. So
// every test that patches also asserts the disclosure (badge, diagnostics), and
// the destructive paths assert what storage holds afterwards rather than what
// the panel claims.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closeMobilePanels, clickNavOp, gotoApp, gotoFixture, openSettings } from './helpers.js'

const OVERLAY_PAGE = '/tests/e2e/fixtures/app-overlay.html'
const MULTI_PAGE = '/tests/e2e/fixtures/app-multi.html'
const SEED_PAGE = '/tests/e2e/fixtures/app-seed-overlay.html'
const KEY = 'apidoc:user-overlay'
const SEED_KEY = 'apidoc:user-overlay-seed'

const panel = (page) => page.locator('settings-panel .modal-box')
// The editor's own section: "Clear" is the confirm label of every purge in this
// panel, so the destructive path has to be asked for inside the section that
// owns it.
const section = (page) => panel(page).locator('section:has([data-user-overlay])')
const editor = (page) => panel(page).locator('[data-user-overlay]')
const report = (page) => panel(page).locator('[data-user-overlay-report]')
const badge = (page) => page.locator('[data-user-overlay-badge]')

function overlayDoc(actions) {
  return { overlay: '1.1', info: { title: 'Local fixes', version: '1.0.0' }, actions }
}

const renamePets = (summary) =>
  overlayDoc([{ target: "$.paths['/pets'].get", update: { summary } }])

const stored = (page, key = KEY) => page.evaluate((k) => window.localStorage.getItem(k), key)

// Seeds the document the way a previous session left it, for the tests whose
// subject is what happens to a patch that already exists. Written from the page
// rather than through an init script: those tests end in a reload, and an init
// script would re-seed the very key the reload is meant to find gone.
async function seedOverlay(page, document) {
  await gotoApp(page)
  await page.evaluate(
    ([k, raw]) => window.localStorage.setItem(k, raw),
    [KEY, JSON.stringify(document)],
  )
  await page.reload()
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

async function fillOverlay(page, document) {
  await editor(page).fill(JSON.stringify(document, null, 2))
}

// Save and Clear both end in a reload (decision 4): overlays run once, on the
// parsed source, before anything reads it.
async function waitForReload(page) {
  await page.waitForLoadState()
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

test('a saved patch is applied on the next load, and the page says so', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  // The empty state seeds the shape rather than a blank box, and its example
  // action is inert until moved into `actions`.
  await expect(editor(page)).toHaveValue(/"overlay": "1\.1"/)
  await expect(editor(page)).toHaveValue(/x-example-action/)

  await fillOverlay(page, renamePets('List the pets we kept'))
  await panel(page).locator('[data-user-overlay-save]').click()
  await waitForReload(page)

  // Said where the reader is about to take the file away, and in the terms that
  // matter there: what leaves is the published schema, the patch is theirs and
  // leaves separately.
  await expect(page.locator('main')).toContainText(
    'What you read here is this file plus 1 OpenAPI overlay(s), your own local patch included',
  )

  await clickNavOp(page, 'listPets')
  await expect(page.locator('main h1')).toHaveText('List the pets we kept')

  // The disclosure: a permanent badge that leads to the editor, focused.
  await closeMobilePanels(page)
  await expect(badge(page)).toBeVisible()
  await badge(page).click()
  await expect(editor(page)).toBeFocused()
  await expect(editor(page)).toHaveValue(/List the pets we kept/)
  // And the diagnostics name it as the user's own, not as one more thing the
  // integrator declared.
  await expect(panel(page)).toContainText('Local patch')
  await expect(panel(page)).toContainText('yours, applied last')
})

test('the user patch outranks the host overlays on the same node', async ({ page }) => {
  // The host's YAML overlay already renamed this operation ("List things" →
  // "List widgets"): the user's edit is the one that must survive.
  await gotoFixture(page, OVERLAY_PAGE)
  await expect(page.locator('api-nav a[data-op-id="listThings"]')).toHaveText(/List widgets/)

  await openSettings(page)
  await fillOverlay(
    page,
    overlayDoc([{ target: "$.paths['/things'].get", update: { summary: 'List gizmos' } }]),
  )
  await panel(page).locator('[data-user-overlay-save]').click()
  await waitForReload(page)

  await expect(page.locator('api-nav a[data-op-id="listThings"]')).toHaveText(/List gizmos/)
  await closeMobilePanels(page)
  await openSettings(page)
  // Counted with the host's, and named apart from them.
  await expect(panel(page)).toContainText('4 action(s) from 3 overlay(s)')
  await expect(panel(page)).toContainText('yours, applied last (overlay 3)')
})

test('Check reports what each action would touch, and writes nothing', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  await fillOverlay(
    page,
    overlayDoc([
      { target: "$.paths['/nope'].get", update: { summary: 'Nowhere' } },
      { target: "$.paths['/pets'].get", update: { summary: 'Somewhere' } },
    ]),
  )
  await panel(page).locator('[data-user-overlay-check]').click()

  await expect(report(page)).toContainText('1 of 2 action(s) would apply. Nothing was saved.')
  // The number no warning carries: an action that works emits none.
  await expect(report(page)).toContainText('1 node(s)')
  await expect(report(page)).toContainText("$.paths['/nope'].get matches nothing")

  // No write, no reload: the panel is still open on the same page, and the
  // schema still says what it published.
  expect(await stored(page)).toBeNull()
  await expect(panel(page)).toBeVisible()
  await expect(badge(page)).toHaveCount(0)
})

test('a document over the cap is refused, and nothing is stored', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  await fillOverlay(
    page,
    overlayDoc([{ target: '$.info', update: { description: 'x'.repeat(70_000) } }]),
  )
  await panel(page).locator('[data-user-overlay-save]').click()

  await expect(report(page)).toContainText('over the 64 KB kept per schema')
  await expect(report(page)).toContainText('Nothing was saved.')
  expect(await stored(page)).toBeNull()
  await expect(panel(page)).toBeVisible()
})

test('invalid JSON is refused with the reason, and the download waits for it', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  await editor(page).fill('overlay: 1.1\nactions: []\n')
  // The exit is offered on what parses, and a YAML paste does not.
  await expect(panel(page).locator('[data-user-overlay-download]')).toBeDisabled()
  await panel(page).locator('[data-user-overlay-save]').click()
  await expect(report(page)).toContainText('The editor takes JSON only')
  expect(await stored(page)).toBeNull()
})

// The same verdict the disabled Download rides on, said out loud in the frame's
// header: a button greyed out over a document the author is still typing has to
// name what it is waiting for.
test('the frame names the weight of the document, and why it cannot be filed', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  // Nothing stored yet, and the seeded skeleton is nowhere near the cap.
  await expect(section(page)).toContainText('No patch')
  await expect(section(page)).toContainText('/ 64 KB')

  await editor(page).fill('overlay: 1.1\n')
  await expect(section(page)).toContainText('Invalid JSON')
  // Valid JSON, and still not something this editor can save.
  await editor(page).fill('{ "title": "a schema, pasted in the wrong box" }')
  await expect(section(page)).toContainText('Not an overlay')
})

// A dry run answers for the text it was handed. Left on screen while that text
// changes underneath, it becomes the one thing in this panel that lies.
test('editing the document drops the dry run that judged it', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  await fillOverlay(page, renamePets('List the pets we kept'))
  await panel(page).locator('[data-user-overlay-check]').click()
  await expect(report(page)).toContainText('1 of 1 action(s) would apply')

  await editor(page).fill('{')
  await expect(report(page)).not.toContainText('would apply')
  await expect(report(page)).toContainText('Check reports what each action would touch')
})

test('removing the patch brings the published schema back', async ({ page }) => {
  await seedOverlay(page, renamePets('List the pets we kept'))
  await closeMobilePanels(page)
  await badge(page).click()
  await section(page).getByRole('button', { name: 'Remove the patch' }).click()
  await section(page).getByRole('button', { name: 'Clear', exact: true }).click()
  await waitForReload(page)

  await closeMobilePanels(page)
  await expect(badge(page)).toHaveCount(0)
  expect(await stored(page)).toBeNull()
  await clickNavOp(page, 'listPets')
  await expect(page.locator('main h1')).toHaveText('List all pets')
})

test('the settings purge clears the stored patch', async ({ page }) => {
  await seedOverlay(page, renamePets('List the pets we kept'))
  await openSettings(page)
  // Declared in `storageInventory()` through the preferences group: asserted
  // here rather than deduced from where the key happens to fall.
  await expect(panel(page).locator('[data-count-for="preferences"]')).toHaveText('1')
  const row = panel(page).locator('li[data-dataset="preferences"]')
  await row.getByRole('button', { name: 'Clear', exact: true }).click()
  await row.getByRole('button', { name: 'Clear', exact: true }).click()
  await waitForReload(page)

  expect(await stored(page)).toBeNull()
  await closeMobilePanels(page)
  await expect(badge(page)).toHaveCount(0)
})

test('the patch and its file are scoped to the active spec', async ({ page }) => {
  await gotoFixture(page, MULTI_PAGE)
  await openSettings(page)
  const document = renamePets('List the pets we kept')
  await fillOverlay(page, document)

  const downloadPromise = page.waitForEvent('download')
  await panel(page).locator('[data-user-overlay-download]').click()
  const download = await downloadPromise
  // Named after the spec it patches: a multi-spec install cannot produce three
  // files called the same thing.
  expect(download.suggestedFilename()).toBe('overlay-pets.json')
  expect(JSON.parse(readFileSync(await download.path(), 'utf8'))).toEqual(document)

  await panel(page).locator('[data-user-overlay-save]').click()
  await waitForReload(page)
  expect(await stored(page, 'apidoc:pets:user-overlay')).not.toBeNull()
  expect(await stored(page)).toBeNull()
  await clickNavOp(page, 'listPets')
  await expect(page.locator('main h1')).toHaveText('List the pets we kept')
})

// Decision 10: everything downstream reads one document, the overlaid one — the
// audit included, which is what makes it grade the schema actually in use. The
// schema download is the exception, and deliberately so: it re-fetches the file
// the API publishes, so the patch leaves by its own download and never
// contaminates a file handed to someone else as "the schema".
test('the audit grades the patched document, the schema download stays the published file', async ({
  page,
}) => {
  await seedOverlay(page, overlayDoc([{ target: '$.info', update: { title: 'Patched API' } }]))
  await gotoApp(page, '#/audit')
  const identity = page.locator('audit-report [data-audit-identity]')
  await expect(identity.locator('h2')).toHaveText('Patched API')
  // The two exits are distinct, and the page is the one that has to say it:
  // the grade above covers the patched document, the button below hands out
  // the published one.
  await expect(identity).toContainText(
    'This audit grades the schema with 1 OpenAPI overlay(s) applied, your own local patch included',
  )

  const downloadPromise = page.waitForEvent('download')
  await identity.getByRole('button', { name: 'Download the OpenAPI file' }).click()
  const download = await downloadPromise
  const served = readFileSync(new URL('./fixtures/e2e-api.json', import.meta.url), 'utf8')
  expect(readFileSync(await download.path(), 'utf8')).toBe(served)
})

// --- the starting patch declared by the host (decision 11) -------------------
//
// One document, two owners over time: the installation writes it into the
// reader's slot once, the reader owns it from their first edit. The tests below
// are about the seam — that it is applied and attributed honestly on arrival,
// and that the reader's last word on it survives the reload that follows.

test('a patch declared by the host applies on the first visit, and says who wrote it', async ({
  page,
}) => {
  await gotoFixture(page, SEED_PAGE)
  await clickNavOp(page, 'listThings')
  await expect(page.locator('main h1')).toHaveText('List things (patched by the docs)')
  // The disclosure is the same as for a patch the reader typed: what the page
  // shows is not what the API published, and that is the whole point of saying
  // it out loud.
  await closeMobilePanels(page)
  await expect(badge(page)).toBeVisible()

  await openSettings(page)
  await expect(editor(page)).toHaveValue(/Seeded fixes/)
  await expect(section(page)).toContainText('This documentation provides this patch')
  await expect(section(page)).toContainText('Patch from this documentation')
  // …and the diagnostics do not credit the reader with it.
  await expect(panel(page)).toContainText('from this documentation')
  await expect(panel(page)).not.toContainText('yours, applied last')
})

test('editing the seeded patch makes it the reader’s own', async ({ page }) => {
  await gotoFixture(page, SEED_PAGE)
  await openSettings(page)
  await fillOverlay(page, overlayDoc([{ target: '$.info', update: { title: 'Mine now' } }]))
  await panel(page).locator('[data-user-overlay-save]').click()
  await waitForReload(page)

  await openSettings(page)
  await expect(section(page)).toContainText('Patch active')
  await expect(section(page)).not.toContainText('This documentation provides this patch')
  await expect(panel(page)).toContainText('yours, applied last')
})

// The failure mode a seeded document creates, and the reason the fingerprint is
// stored separately: without it, "Remove the patch" would be undone by the very
// reload it triggers, and the reader could never get out.
test('removing the host’s patch keeps it removed across reloads', async ({ page }) => {
  await gotoFixture(page, SEED_PAGE)
  await openSettings(page)
  await section(page).getByRole('button', { name: 'Remove the patch' }).click()
  await section(page).getByRole('button', { name: 'Clear', exact: true }).click()
  await waitForReload(page)

  await page.reload()
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  expect(await stored(page)).toBeNull()
  // The record that the offer was made outlives the document it offered.
  expect(await stored(page, SEED_KEY)).not.toBeNull()
  await closeMobilePanels(page)
  await expect(badge(page)).toHaveCount(0)
  await clickNavOp(page, 'listThings')
  await expect(page.locator('main h1')).toHaveText('List things')
})
