import { expect, test } from '@playwright/test'
import {
  APP_PAGE,
  clickNavOp,
  closeMobilePanels,
  gotoApp,
  isMobileLayout,
  openDrawerIfMobile,
  openTryItIfMobile,
} from './helpers.js'

// The global keyboard sweep, which is the one thing axe structurally cannot
// see: axe judges nodes, and "can a keyboard reach this control, and can it
// tell where it is" is a property of the walk between them. The targeted
// keyboard tests elsewhere (tablists, palette, blocked send) each check one
// widget's own key handling; this file checks the road.
//
// Two surfaces, because they are the two shapes the app ever has: the home
// page (header + nav + content) and an operation with the try-it open, which
// is the same plus a second interactive column. Both run on the mobile
// projects too — below lg the nav is a closed drawer and the panel a sheet, so
// the sweep simply has a different, smaller population, which is exactly the
// question worth asking there.

// Everything the platform makes tabbable, before the tabIndex filter below
// decides which of them actually are.
const FOCUSABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]',
  '[tabindex]',
].join(',')

// Injected once per navigation. Everything here reads the live DOM, so it has
// to be one self-contained source: `page.evaluate` ships a function body, not
// the module scope around it.
const PROBE = `
const FOCUSABLE = ${JSON.stringify(FOCUSABLE)}

// A control counts as reachable when it is tabbable AND rendered. \`tabIndex\`
// is what does the roving-tabindex accounting for free: a tablist wired by
// a11y.js leaves exactly one tab at 0 and the rest at -1, so the expected set
// holds one entry per tablist by construction rather than by an exception
// list. Same for anything a component parks out of the order on purpose.
function tabbable(node) {
  if (node.tabIndex < 0 || node.disabled) return false
  if (node.closest('[inert],[aria-hidden="true"]')) return false
  // \`checkVisibility\` is what answers for a closed <details> or a drawer
  // parked at \`visibility: hidden\` — both are non-tabbable for the same
  // reason the browser refuses to focus them.
  if (!node.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true })) return false
  return node.getClientRects().length > 0
}

// The region of the layout a stop belongs to, in the order that disambiguates
// them: the doc renders <header> elements of its own inside <main>, so "am I in
// the content" has to be asked before "am I in a header".
const REGIONS = [
  ['dialog[open]', 'dialog'],
  ['aside.api-drawer', 'drawer'],
  ['aside.api-sheet', 'sheet'],
  ['main', 'main'],
  ['header', 'header'],
  ['footer', 'footer'],
]

function describe(node) {
  if (!node || node === document.body) return { tag: 'BODY', label: '', where: '' }
  const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\\s+/g, ' ').trim()
  return {
    tag: node.tagName,
    label: label.slice(0, 48),
    where: REGIONS.find(([selector]) => node.closest(selector))?.[1] ?? '',
    mark: node.dataset.kbdSweep ?? null,
    scrollport: scrollport(node),
  }
}

// A scrollport the engine made focusable on its own so that the keyboard can
// scroll it — Chromium and Firefox do, WebKit does not. It is a stop nothing
// in the markup asked for, and it is a behavior we want, so the sweep
// recognises it instead of reporting it as an unexplained tab stop.
function scrollport(node) {
  if (node.tabIndex >= 0) return false
  const cs = getComputedStyle(node)
  return (
    (/auto|scroll/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) ||
    (/auto|scroll/.test(cs.overflowX) && node.scrollWidth > node.clientWidth + 1)
  )
}

function holdsFocusable(node) {
  return [...node.querySelectorAll(FOCUSABLE)].some(tabbable)
}

// A focus indicator, as the app actually paints one: an outline. daisyUI puts
// it either on the control or on the block that owns it — \`.collapse\` outlines
// itself when its <summary> is focused — hence the walk up through the
// focus-within chain. Nothing else is accepted: a box-shadow the element also
// carries when idle is not an indicator, and telling the two apart would mean
// blurring the element, which is the one thing this walk cannot afford.
function focusRing(node) {
  for (let n = node; n && n !== document.body; n = n.parentElement) {
    if (n !== node && !n.matches(':focus-within')) continue
    const cs = getComputedStyle(n)
    if (cs.outlineStyle === 'none') continue
    if (parseFloat(cs.outlineWidth) <= 0) continue
    // \`outline-style: auto\` is the platform ring: it has no color of its own
    // to read, and it is always painted. daisyUI does use a fully transparent
    // outline as a layout placeholder, which is a ring that paints nothing.
    if (cs.outlineStyle !== 'auto' && invisible(cs.outlineColor)) continue
    return { on: n === node ? 'self' : n.tagName.toLowerCase(), outline: cs.outlineWidth + ' ' + cs.outlineStyle }
  }
  return null
}

function invisible(color) {
  const channels = /^rgba?\\(([^)]*)\\)$/.exec(color)?.[1].split(',')
  return channels?.length === 4 && parseFloat(channels[3]) === 0
}

window.__kbd = {
  mark() {
    const nodes = [...document.querySelectorAll(FOCUSABLE)].filter(tabbable)
    return nodes.map((node, i) => {
      node.dataset.kbdSweep = String(i)
      return describe(node)
    })
  },
  stop() {
    const node = document.activeElement
    const at = describe(node)
    return { ...at, ring: node && node !== document.body ? focusRing(node) : null }
  },
  // A box that scrolls and holds nothing focusable is reachable by pointer
  // alone unless the markup declares it a tab stop (scrollBlock in
  // a11y.js). Chromium and Firefox paper over the omission by focusing such a
  // box themselves; WebKit does not, so the content past the edge is simply
  // lost there. Reported on every engine — the missing declaration is the same
  // defect whether or not the engine happens to hide it.
  orphanScrollports() {
    return [...document.querySelectorAll('*')]
      .filter((node) => scrollport(node) && !holdsFocusable(node))
      .filter(
        (node) =>
          node.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }) &&
          node.getClientRects().length > 0,
      )
      .map(describe)
  },
  // Re-derived after the walk: a control the walk itself replaced (a component
  // re-rendering on focus) is a different node from the one that was marked,
  // and answering "was IT reached" about a node that no longer exists would
  // report a gap that nobody can walk into.
  missed(reached) {
    const seen = new Set(reached)
    return [...document.querySelectorAll('[data-kbd-sweep]')]
      .filter((node) => tabbable(node) && !seen.has(node.dataset.kbdSweep))
      .map(describe)
  },
}
`

async function installProbe(page) {
  await page.evaluate(PROBE)
}

// One Tab, then what the browser did with it. The walk never presses anything
// else: opening a disclosure mid-sweep would change the population it is
// measuring against.
async function walk(page, steps, key = 'Tab') {
  const stops = []
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key)
    stops.push(await page.evaluate(() => window.__kbd.stop()))
  }
  return stops
}

// One full pass in each direction, plus slack. The sweep cannot start at the
// top of the document — `blur()` leaves the sequential focus navigation
// starting point where it was, and the selection trick that moves it in WebKit
// is ignored by Chromium — so it starts wherever the helpers left focus. Going
// forward and then back is what makes that enough on every engine: Chromium
// and WebKit wrap around through <body> and one pass would do, Firefox hands
// the last Tab to its own toolbar and never comes back, so everything upstream
// of the starting point is only reachable by walking back to it.
const SLACK = 8

// The marks the whole comparison rests on are put on live nodes, so the sweep
// must not start while the boot is still replacing them: the scenario store
// answers after the first render and rebuilds the nav, and the home page's
// cards land with it. Waiting on a quiet DOM rather than on one component's
// signal — what has to have stopped moving is the tab order, and every
// component that renders late is part of it.
const QUIET_MS = 400
const QUIET_CAP_MS = 6000

async function untilQuiet(page) {
  await page.evaluate(
    ([quiet, cap]) =>
      new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          clearTimeout(timer)
          timer = setTimeout(done, quiet)
        })
        const done = () => {
          clearTimeout(timer)
          clearTimeout(ceiling)
          observer.disconnect()
          resolve()
        }
        let timer = setTimeout(done, quiet)
        const ceiling = setTimeout(done, cap)
        observer.observe(document.body, { childList: true, subtree: true })
      }),
    [QUIET_MS, QUIET_CAP_MS],
  )
}

async function sweep(page) {
  await installProbe(page)
  await untilQuiet(page)
  const expected = await page.evaluate(() => window.__kbd.mark())
  const steps = expected.length + SLACK
  const stops = [...(await walk(page, steps)), ...(await walk(page, steps, 'Shift+Tab'))]
  const reached = stops.map((s) => s.mark).filter((m) => m !== null)
  const missed = await page.evaluate((r) => window.__kbd.missed(r), reached)
  return { expected, stops, missed }
}

const format = (list) => list.map((s) => `${s.where} ${s.tag} “${s.label}”`)

// A stop the walk passes through that carries no marker is a control the
// derivation did not consider tabbable — the mirror defect of a missed one,
// and just as much a surprise for whoever is holding the keyboard. Engine-made
// scrollport stops are the one exception, and they say so about themselves.
function unexpectedStops(stops) {
  return stops.filter((s) => s.tag !== 'BODY' && s.mark === null && !s.scrollport)
}

function ringless(stops) {
  return stops.filter((s) => s.tag !== 'BODY' && !s.ring)
}

for (const [surface, arrive] of [
  ['the home page', async (page) => await gotoApp(page)],
  [
    'an operation with the try-it open',
    async (page) => {
      await gotoApp(page)
      await clickNavOp(page, 'listPets')
      await openTryItIfMobile(page)
      await expect(page.locator('api-try-it-panel')).toBeVisible()
    },
  ],
]) {
  test(`every visible control on ${surface} is reachable by Tab`, async ({ page }) => {
    await arrive(page)
    const { expected, stops, missed } = await sweep(page)
    expect(expected.length).toBeGreaterThan(10)
    // One assertion for both halves: a walk that ends up somewhere the
    // derivation never listed and a control the walk never reached are the
    // same defect read from either end, and seeing only one of them sends the
    // reader looking for the wrong cause.
    expect({
      missed: format(missed),
      unexpected: format(unexpectedStops(stops)),
    }).toEqual({ missed: [], unexpected: [] })
  })

  test(`focus stays visible at every stop on ${surface}`, async ({ page }) => {
    await arrive(page)
    const { stops } = await sweep(page)
    expect(format(ringless(stops))).toEqual([])
  })

  test(`every scrolling block on ${surface} is keyboard-reachable`, async ({ page }) => {
    await arrive(page)
    await installProbe(page)
    await untilQuiet(page)
    expect(format(await page.evaluate(() => window.__kbd.orphanScrollports()))).toEqual([])
  })
}

// The declared tab stops of `scrollBlock` (architecture.md §12): a block
// that scrolls with nothing focusable in it. Chromium and Firefox focus such a
// box on their own, WebKit does not — so what is asserted is that the markup
// says it, and that the ring is real, since daisyUI paints none for a <pre>.
test('a scrolling block is a named tab stop with a ring of its own', async ({ page }) => {
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  // The block lives in the doc, and below lg the nav click left the sheet open
  // over it — the page behind a panel is inert, so nothing there can be focused
  // until the panel is put away. Which is the rule this file asserts just above.
  await closeMobilePanels(page)
  await installProbe(page)
  // Same reason as the sweep's: the doc is rebuilt once more after boot, and a
  // block focused before that is a detached node by the time Tab is pressed.
  await untilQuiet(page)
  const block = page.locator('main pre.api-scrollport').first()
  await expect(block).toHaveAttribute('role', 'group')
  await expect(block).toHaveAttribute('aria-label', /\S/)

  // Focused, stepped off, stepped back onto: the return trip is a real Tab
  // press, which is what makes `:focus-visible` match — a programmatic
  // `focus()` alone would leave the ring unpainted and the check vacuous.
  await block.evaluate((node) => node.focus())
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(block).toBeFocused()
  expect((await page.evaluate(() => window.__kbd.stop())).ring).not.toBeNull()
})

// One Tab to the skip link, one Enter to land in <main>.
const ESCAPE_NAV_BUDGET = 2

// A deep link rather than a click through the nav: "how far is the content
// from a cold start" is a question about a page nobody has touched yet, and
// clicking anything to get there answers a different one. It is also the case
// that matters — every link shared out of this documentation is one of these.
// Nothing is clicked on the mobile projects either, so they ask the same
// question with the drawer and the sheet closed.
async function openDeepLink(page, hash) {
  await page.goto(APP_PAGE + hash)
  await expect(page.locator('main h1')).toBeVisible()
}

// Walks the way a reader does: Tab, except on a skip link, which exists to be
// activated. Returns the number of presses it took to land inside <main>.
async function pressesToContent(page, limit) {
  for (let presses = 0; presses <= limit; presses++) {
    const where = await page.evaluate(() => ({
      inMain: !!document.activeElement?.closest('main'),
      onSkip: document.activeElement?.dataset?.skipLink !== undefined,
    }))
    if (where.inMain) return presses
    await page.keyboard.press(where.onSkip ? 'Enter' : 'Tab')
  }
  return Number.POSITIVE_INFINITY
}

test('the content is one skip link away from a cold start', async ({ page }) => {
  await openDeepLink(page, '#/op/listPets')
  await installProbe(page)

  await page.keyboard.press('Tab')
  const skip = page.locator('[data-skip-link]')
  await expect(skip).toBeFocused()
  // sr-only until focused: the link is a keyboard affordance, and a permanent
  // one would be the first thing every reader sees on every page.
  await expect(skip).toBeVisible()
  await expect(skip).toHaveText(/Skip to/i)

  await page.keyboard.press('Enter')
  const landed = await page.evaluate(() => {
    const node = document.activeElement
    return { inMain: !!node?.closest('main'), tag: node?.tagName ?? null }
  })
  expect(landed).toEqual({ inMain: true, tag: 'MAIN' })

  // The next Tab must continue INTO the content, not restart at the top of the
  // document — which is what a landing point without a tabindex would do.
  await page.keyboard.press('Tab')
  expect((await page.evaluate(() => window.__kbd.stop())).where).toBe('main')
})

test('reaching the content never costs more than the budget', async ({ page }) => {
  // Without the skip link this is one press per header tool plus one per nav
  // entry — twenty on this fixture, and a function of the schema's size on a
  // real one. The budget is therefore not a measurement of today's nav but the
  // statement that the nav's length can never be what stands between a
  // keyboard and the content.
  await openDeepLink(page, '#/op/listPets')
  expect(await pressesToContent(page, ESCAPE_NAV_BUDGET + 30)).toBeLessThanOrEqual(
    ESCAPE_NAV_BUDGET,
  )
})

test('the skip link leaves the route alone', async ({ page }) => {
  await openDeepLink(page, '#/op/listPets')
  const before = page.url()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  // The fragment is the router's (docs/architecture.md §5.2): a skip link that
  // really navigated to `#apidoc-main` would parse as an unknown route and drop
  // the reader on the home page — the opposite of skipping to the content.
  expect(page.url()).toBe(before)
  await expect(page.locator('main h1')).toHaveText('List all pets')
})

test('below lg the drawer keeps its contents out of the tab order', async ({ page }) => {
  test.skip(!isMobileLayout(page), 'the nav is a drawer only below lg')
  await gotoApp(page)
  await installProbe(page)
  const inOrder = await page.evaluate(() =>
    window.__kbd.mark().filter((entry) => entry.where === 'drawer'),
  )
  expect(format(inOrder)).toEqual([])
})

// The mirror question, and the one the scrim alone never answered: an open
// panel below lg is a modal surface, so the walk must stay inside it. Both
// panels are asserted because the shell inerts a different set of siblings for
// each, and both ends are read — a stop outside the panel, and a control the
// derivation still counts as tabbable out there — since a page that is merely
// dimmed produces the second without the first only by luck of tree order.
for (const [panel, region, open] of [
  ['drawer', 'drawer', async (page) => await openDrawerIfMobile(page)],
  [
    'bottom sheet',
    'sheet',
    async (page) => {
      await clickNavOp(page, 'listPets')
      await openTryItIfMobile(page)
      await expect(page.locator('api-try-it-panel')).toBeVisible()
    },
  ],
]) {
  test(`below lg the tab walk never leaves the open ${panel}`, async ({ page }) => {
    test.skip(!isMobileLayout(page), 'the panels are off-canvas only below lg')
    await gotoApp(page)
    await open(page)
    const { expected, stops } = await sweep(page)
    expect(expected.length).toBeGreaterThan(3)
    expect({
      outside: format(expected.filter((entry) => entry.where !== region)),
      walkedOut: format(stops.filter((stop) => stop.tag !== 'BODY' && stop.where !== region)),
    }).toEqual({ outside: [], walkedOut: [] })
  })
}
