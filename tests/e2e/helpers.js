import { readFileSync } from 'node:fs'
import { expect } from '@playwright/test'

// The bundle names itself in the footer, the About dialog and the diagnostics.
// Read here rather than spelled out in the specs: a literal turns every version
// bump into a handful of red tests that have nothing to say.
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
export const APP_NAME = pkg.name
export const APP_VERSION = pkg.version

export const APP_PAGE = '/tests/e2e/fixtures/app.html'
export const THEMES_PAGE = '/tests/e2e/fixtures/app-themes.html'
export const API_BASE = 'https://api.e2e.test'

// Intercepts the fake API of the e2e schema (CORS preflights included — the
// try-it's fetch is a real cross-origin fetch) and records every real call
// for assertion. No network traffic leaves Playwright.
export async function mockApi(page, respond = {}) {
  const calls = []
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
  }
  await page.route(`${API_BASE}/**`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    calls.push({
      method: req.method(),
      url: req.url(),
      headers: await req.allHeaders(),
      body: req.postData(),
    })
    // `respond` can be a function: one response per request, which is what
    // scenario chaining requires (POST returns an id, GET uses it).
    const chosen = typeof respond === 'function' ? (respond(req) ?? {}) : respond
    // Used to observe an in-flight send (send indicator): without latency, the
    // response is already there before the first assertion.
    if (chosen.delayMs) await new Promise((r) => setTimeout(r, chosen.delayMs))
    await route.fulfill({
      status: chosen.status ?? 200,
      headers: { ...cors, ...(chosen.headers ?? {}) },
      contentType: 'application/json',
      body: JSON.stringify(chosen.body ?? [{ id: 1, name: 'Rex', status: 'available' }]),
    })
  })
  return calls
}

// What the suite asserts about a copy is the *payload* the app hands to the
// clipboard, never the OS integration — and reading the real clipboard is
// Chromium-only anyway (`clipboard-read` is not a permission Firefox or WebKit
// know, and Firefox has no `readText` for web content at all). So every
// navigation installs a capture: `writeText` records into `window.__copied`
// and still delegates to the real implementation where it works, so the app's
// own error path stays honest. `tryit.spec.js` keeps one Chromium-only test
// reading the actual clipboard, which is what proves the capture is not
// measuring itself.
async function captureClipboard(page) {
  await page.addInitScript(() => {
    // gotoApp/gotoFixture can both run on the same page; the init scripts
    // accumulate and would otherwise wrap the wrapper.
    if (window.__copied !== undefined) return
    window.__copied = ''
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard)
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (payload) => {
        window.__copied = payload
        try {
          await write?.(payload)
        } catch {
          // WebKit and Firefox reject without a user gesture. The capture
          // above is the assertion; swallowing here keeps the app's own
          // catch-and-log path out of the picture.
        }
      },
    })
  })
}

// Playwright's WebKit reports no post body at all once it came from a File or
// Blob: `postData()` and `postDataBuffer()` are both null, while the multipart
// part headers do arrive — the browser sends the bytes, the harness cannot see
// them. Everything else about an upload is asserted on every engine (method,
// URL, content type, the parts and their filenames); only the line reading the
// file's own bytes is conditional, and it is never the only assertion in its
// test.
export const canSeeFileBytes = (browserName) => browserName !== 'webkit'

export async function gotoApp(page, hash = '') {
  await gotoFixture(page, APP_PAGE + hash)
}

// Same wait as gotoApp, for the fixtures that are host pages of their own.
export async function gotoFixture(page, url) {
  await captureClipboard(page)
  await page.goto(url)
  // Endpoint links live inside <details> closed by default:
  // we wait for their presence in the DOM, not their visibility.
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  // A deep link straight to an operation lands with the panel already behind
  // the sheet, without any nav click to hang the opening off. `#/first-call`
  // is one of those links under another name: the generated page IS an
  // operation view, panel included.
  if (/#\/(?:s\/[^/]+\/)?(?:op\/|first-call)/.test(url)) await openTryItIfMobile(page)
}

// --- responsive layout ------------------------------------------------
//
// Below `lg` the two side columns leave the flow: the nav becomes a drawer
// behind the header hamburger, the try-it a bottom sheet behind a floating
// button. A spec written against the desktop layout reaches for a nav link or
// a panel field directly, and at 390 px both are simply not there. Rather than
// a mobile twin of every spec, the helpers below open whatever hides the thing
// first — a no-op above the breakpoint, so the desktop path is unchanged.
//
// Decided on the viewport rather than on what happens to be visible: the
// question is asked right after a route render, and "is the FAB on screen yet"
// is a race where "is this viewport under lg" is a fact.
//
// mobile.spec.js is the one place where the drawer and the sheet are the
// subject instead of the obstacle, and it drives them by hand.
const LG_BREAKPOINT_PX = 1024

export const isMobileLayout = (page) =>
  (page.viewportSize()?.width ?? LG_BREAKPOINT_PX) < LG_BREAKPOINT_PX

// `visibility` flips when the slide-in starts, not when it ends, so a panel
// can be "visible" and still moving — and Playwright refuses to click a moving
// target. The open state is the one where the panel sits at `transform: none`,
// which is the animation's finish line stated exactly rather than slept for.
const expectSettled = (panel) => expect(panel).toHaveCSS('transform', 'none')

// "Is this panel open" is answered by the `is-open` class, never by
// `isVisible()`: `visibility` stays `visible` for the whole 0.25 s slide-out,
// so a panel the app has just closed still reads as visible — and a helper
// that believed it would hand the spec a panel about to leave.
const isOpen = (panel) => panel.evaluate((node) => node.classList.contains('is-open'))

export async function openDrawerIfMobile(page) {
  if (!isMobileLayout(page)) return
  // One panel at a time is the app's own rule, and the sheet's scrim covers
  // the header the hamburger lives in: reaching the nav starts by leaving the
  // panel, exactly as it does with a thumb.
  const drawer = page.locator('aside.api-drawer')
  // Idempotent, because the hamburger is a toggle and navigating closes the
  // drawer by itself: a spec that walks the nav several times calls this
  // before each of them without having to track which state it left behind.
  if (await isOpen(drawer)) return
  await closeMobilePanels(page)
  await page.locator('header button[aria-label="Navigation"]').click()
  await expect(drawer).toBeVisible()
  await expectSettled(drawer)
}

// Called by every helper that lands on an operation. Playwright's visibility
// is about layout, not occlusion, so a doc assertion still reads through the
// open sheet; what the sheet does take away is *clicking* the doc underneath,
// which is why the mirror specs close it again (closeMobilePanels) instead of
// this being conditional on what the spec plans to do.
export async function openTryItIfMobile(page) {
  if (!isMobileLayout(page)) return
  const sheet = page.locator('aside.api-sheet')
  if (await isOpen(sheet)) return
  // Plenty of routes have no panel to open — the home page, a docs page, a
  // scenario, an operation link that matches nothing. Waiting for a FAB that
  // is never coming would spend the test's whole timeout on a helper.
  const trigger = page.getByRole('button', { name: 'Try it' })
  const appeared = await trigger
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => true)
    .catch(() => false)
  if (!appeared) return
  await trigger.click()
  await expect(sheet).toBeVisible()
  await expectSettled(sheet)
}

// Closes whichever off-canvas panel is open — sheet or drawer. Both hang a
// full-inset scrim over everything else, so "get back to the page" is one
// question with one answer, and the specs alternating between columns or
// reaching for the header ask it without tracking which panel they left open.
export async function closeMobilePanels(page) {
  if (!isMobileLayout(page)) return
  const open = page.locator('aside.api-offcanvas.is-open')
  if (!(await open.count())) return
  await page.keyboard.press('Escape')
  await expect(open).toHaveCount(0)
  // The class goes first, the 0.25 s slide-out follows, and `visibility`
  // only flips at the end of it: waiting on that is waiting for the page
  // underneath to be touchable again, which is the point of closing.
  await expect(page.locator('aside.api-drawer')).not.toBeVisible()
  await expect(page.locator('aside.api-sheet')).not.toBeVisible()
}

// Acting on the central doc while the panel is open means getting past the
// sheet's scrim below lg. This is the phone gesture itself — close the sheet,
// act on the doc, bring the panel back to read the effect — and a plain click
// above the breakpoint, which is why the mirror specs can stay one spec.
//
// Required for every kind of edit, not only the ones Playwright refuses to
// deliver through the scrim: an open panel makes the page behind it `inert`, so
// `fill()` and `selectOption()` — which hit-test nothing and used to write into
// a doc no thumb could reach — now write nowhere at all. Reading the doc needs
// none of this; only writing to it does.
export async function editInDoc(page, edit) {
  await closeMobilePanels(page)
  await edit()
  await openTryItIfMobile(page)
}

export const clickInDoc = (page, locator) => editInDoc(page, () => locator.click())

// Clicks an endpoint in the nav, opening its <details> group if needed — and,
// below lg, the drawer that holds the nav at all. Navigating closes the drawer
// again, which is the app's own behavior, not something the helper undoes.
// The group is found via `data-ops`, not via its links: a closed group's link
// list does not exist until the group opens, so the link cannot be what
// locates its group.
// A group under a 3.2 tag hierarchy sits inside its parent's disclosure, so
// opening it means opening the chain above it too — clicking one summary is
// not enough, and the inner one is not clickable while its parent is folded.
export async function clickNavOp(page, opId) {
  await openDrawerIfMobile(page)
  const link = page.locator(`api-nav a[data-op-id="${opId}"]`)
  if (!(await link.isVisible())) {
    // Retried: unfolding from the outside can be undone by a nav re-render —
    // the scenario store answers after boot and rebuilds the list, and a group
    // only counts as pinned once its `toggle` has fired.
    await expect(async () => {
      await page.locator(`api-nav details[data-ops~="${opId}"]`).evaluate((group) => {
        for (let node = group; node; node = node.parentElement?.closest('details')) node.open = true
      })
      await expect(link).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
  }
  await link.click()
  await openTryItIfMobile(page)
}

// Opens a fixture and lands on one endpoint — the shape nearly every
// construct-focused spec starts with. `title` asserts the exact <h1> when the
// spec cares which operation it landed on; without it, its presence is the
// proof the doc rendered.
export async function gotoOp(page, fixture, opId, title = null) {
  await gotoFixture(page, fixture)
  await clickNavOp(page, opId)
  const heading = page.locator('main h1')
  await (title ? expect(heading).toHaveText(title) : expect(heading).toBeVisible())
}

// The settings panel has no nav entry by design: the preferences menu is the
// only way in.
// The header sits behind the sheet's scrim below lg, so every way into the
// header closes the sheet first. Grouped here rather than repeated in seven
// specs — which is also what makes the mobile projects free for them.
export async function openHistory(page) {
  await closeMobilePanels(page)
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.locator('request-history-list .modal-box')).toBeVisible()
}

export async function openSearch(page) {
  await closeMobilePanels(page)
  await page.getByRole('button', { name: /Search the docs/ }).click()
  await expect(page.locator('search-palette input[type="search"]')).toBeVisible()
}

// The preferences menu, and the palette list folded inside it. Both are
// disclosures that stay open once open, so both helpers state the condition
// they need rather than clicking blind: a spec that flips three themes in a row
// calls this before each one and only the first opens anything.
export async function openAppMenu(page) {
  await closeMobilePanels(page)
  const trigger = page.locator('[data-app-menu]')
  if (!(await trigger.evaluate((node) => node.parentElement.open))) await trigger.click()
}

export async function openThemeList(page) {
  await openAppMenu(page)
  const toggle = page.locator('[data-theme-palettes]')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

export async function openSettings(page) {
  await openAppMenu(page)
  await page.locator('[data-menu-settings]').click()
  await expect(page.locator('settings-panel .modal-box')).toBeVisible()
}

export function tryIt(page) {
  return page.locator('api-try-it-panel')
}

// Parameter block of the try-it panel, located by the <code> carrying the
// parameter name. A multi-value parameter (array) holds several rows there.
export function panelParam(page, name) {
  return tryIt(page)
    .locator('.api-param')
    .filter({ has: page.locator(`code:text-is("${name}")`) })
}

// Parameter field of the try-it panel (input or select).
export function panelField(page, name) {
  return panelParam(page, name).locator('input, select')
}

// Credentials cartouche of the try-it panel: the collapse holding one field
// per conventional variable, its status badge and the host controls.
export function credentialsCard(page) {
  return tryIt(page).locator('.collapse', { hasText: 'Credentials' })
}

// Trigger of the environment selector (dropdown, not a <select>).
export function envTrigger(page) {
  return page.locator('env-switcher summary')
}

// Name of the active environment, as displayed in the trigger.
export function activeEnvName(page) {
  return page.locator('env-switcher [data-env-name]')
}

export function envOptions(page) {
  return page.locator('env-switcher [data-env-option]')
}

export async function openEnvSwitcher(page) {
  await closeMobilePanels(page)
  await envTrigger(page).click()
  await expect(page.locator('env-switcher .dropdown-content')).toBeVisible()
}

export async function selectEnv(page, name) {
  await openEnvSwitcher(page)
  await envOptions(page).filter({ hasText: name }).first().click()
  await expect(activeEnvName(page)).toHaveText(name)
}

// Management lives in the dropdown list footer since the selector's
// redesign (no more separate button in the header).
export async function openEnvManager(page) {
  await openEnvSwitcher(page)
  await page.locator('env-switcher').getByRole('button', { name: 'Environments' }).click()
  // Named rather than `.modal-box`: the editor box carries `data-env-editor`,
  // and this helper always means the editor.
  await expect(page.locator('env-manager [data-env-editor]')).toBeVisible()
}

export async function closeEnvManager(page) {
  await page.locator('env-manager [data-env-editor] button.btn-circle.absolute').click()
  await expect(page.locator('env-manager [data-env-editor]')).not.toBeVisible()
}

// Reads the capture, not the OS clipboard (see captureClipboard). A spec that
// navigated with a raw `page.goto` gets `undefined` and fails loudly rather
// than asserting against a stale value.
export function clipboardText(page) {
  return page.evaluate(() => window.__copied)
}

export async function send(page) {
  // The panel's primary action, and below lg the panel is the sheet: a spec
  // that reached this operation by a route the helpers do not own (a raw
  // goto, an import, a scenario run) still gets a Send button to press.
  await openTryItIfMobile(page)
  await tryIt(page).getByRole('button', { name: 'Send', exact: true }).click()
}

// The send indicator times the in-flight request: an "N ms" appearing anywhere in
// the try-it no longer proves the response has arrived. Only the response panel's
// duration does.
export async function expectResponded(page) {
  await expect(tryIt(page).locator('.api-response-view')).toContainText(/\d+ ms/)
}

// --- host-disabled features -------------------------------------------

// A `features.*: false` flag is a promise about every way in, not only the
// visible one: a feature merely unrendered still answers its deep link, still
// sits in the search index, still offers its exports. The classes below are
// that promise made into a checklist, and `expectFeatureUnreachable` refuses
// to run when a caller leaves one unanswered — which is how the next flag
// inherits the whole sweep instead of the fraction its author thought of.
const ENTRY_CLASSES = ['nav', 'inPage', 'routes', 'search', 'exports', 'elements']

/**
 * @param {object} checklist
 *   - `open(page, hash)`: opens the fixture with the flag off
 *   - `nav`: texts that must not appear in the nav
 *   - `inPage`: `{ selector, reach? }` entry points inside the page; `reach`
 *     opens whatever surface hosts them (settings, history…)
 *   - `routes`: `{ hash, text }` deep links that must land on the refusal page
 *   - `search`: queries the palette must answer without the feature
 *   - `exports`: `{ selector, reach? }` export controls that must not exist
 *   - `elements`: custom-element tags that must never be constructed
 */
export async function expectFeatureUnreachable(page, checklist) {
  const unanswered = ENTRY_CLASSES.filter((name) => !(name in checklist))
  if (unanswered.length) {
    throw new Error(`Entry classes left unanswered: ${unanswered.join(', ')}`)
  }
  const { open } = checklist
  const expectNoElements = async () => {
    for (const tag of checklist.elements) await expect(page.locator(tag)).toHaveCount(0)
  }

  await open(page)
  for (const label of checklist.nav) {
    await expect(page.locator('api-nav').getByText(label)).toHaveCount(0)
  }
  await expectNoElements()

  // Reopened before each one: a `reach` leaves the page in whatever state its
  // surface needs, and the next entry point must be judged from a clean boot.
  for (const { selector, reach } of [...checklist.inPage, ...checklist.exports]) {
    await open(page)
    if (reach) await reach(page)
    await expect(page.locator(selector)).toHaveCount(0)
  }

  for (const { hash, text } of checklist.routes) {
    await open(page, hash)
    await expect(page.locator('main')).toContainText(text)
    await expectNoElements()
  }

  await open(page)
  for (const query of checklist.search) {
    await openSearch(page)
    const input = page.locator('search-palette input[type="search"]')
    await input.fill(query)
    await expect(page.locator('search-palette')).not.toContainText(query)
    await page.keyboard.press('Escape')
  }
}
