// The layout mechanics of the shell: the mobile bottom sheet's dismiss
// gesture, and the desktop column resizers. Pure DOM behavior over nodes the
// caller owns — nothing here reads the host config.
import { el, iconButton, text } from '../components/dom.js'
import { BOLT_SVG, CLOSE_SVG, MENU_SVG } from '../components/icons.js'
import { t } from '../i18n/index.js'
import { readPref, writePref } from '../storage/prefs.js'

const SHEET_DISMISS_PX = 90

// The page an open panel covers, as a selector on the layout root. Below lg the
// drawer and the sheet are modal surfaces — the scrim already swallows taps —
// so the rest of the layout goes `inert` while one is open: without it Tab
// walks straight out of the panel into content the reader cannot see, and a
// screen reader browses it just as freely.
//
// Stated as the page's landmarks rather than "every sibling": the layout root
// also holds the overlays, and those must keep answering while a panel is open
// — the scrim, the FAB (the sheet's own trigger, and where focus returns), the
// modal dialogs, and the toast stack, whose `role=status` would go silent
// inside an inert subtree.
const BACKDROP = ':scope > header, :scope > footer, :scope > [data-skip-link]'

const DESKTOP_QUERY = '(min-width: 1024px)'

// Closes the bottom sheet on a downward drag from its handle (expected
// gesture on mobile). During the drag the transform is driven inline to
// follow the finger; it's handed back to the stylesheet on release, otherwise
// it would win over the is-open class on subsequent openings.
function dragToDismiss(sheet, handle, close) {
  handle.addEventListener('pointerdown', (down) => {
    // Mouse excluded: the sheet only exists below lg, and a mouse drag
    // there would steal the close button's click.
    if (down.pointerType === 'mouse') return
    let offset = 0
    sheet.style.transition = 'none'
    // Tracked on window (like the column handle): the finger leaves
    // the header within the first few pixels of the gesture.
    const move = (ev) => {
      offset = Math.max(0, ev.clientY - down.clientY)
      sheet.style.transform = `translateY(${offset}px)`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      sheet.style.transform = ''
      sheet.style.transition = ''
      if (offset > SHEET_DISMISS_PX) close()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  })
}

// Resize handle between columns (desktop only). The width
// lives in a CSS variable consumed by lg:w-(--var) on the column — below
// lg, w-full takes back over. invert: handle on the left of the
// column (the try-it grows to the left). Persistence via prefs.
// Maximum share of the window a side column can take. The declared `max`
// values target large screens; without this relative cap, two columns
// pushed to the max on a laptop would leave only a few pixels for the doc.
const SIDE_COL_MAX_RATIO = 0.35

function columnResizer(aside, cssVar, prefKey, { defaultWidth, min, max, invert = false }) {
  let width = readPref(prefKey, defaultWidth)
  const ceiling = () =>
    Math.max(min, Math.min(max, Math.round(window.innerWidth * SIDE_COL_MAX_RATIO)))
  const apply = () => aside.style.setProperty(cssVar, `${Math.min(width, ceiling())}px`)
  apply()
  // The desired width stays in memory: a preference saved on a large
  // screen must come back intact, not clipped by a visit on a small one.
  window.addEventListener('resize', apply)
  const handle = el(
    'div',
    'hidden lg:block w-1 shrink-0 cursor-col-resize touch-none bg-base-300/60 hover:bg-primary/50 active:bg-primary transition-colors',
  )
  // Drag tracked on window (no pointer capture): the handle is 4px wide,
  // the cursor leaves it immediately during the movement.
  handle.addEventListener('pointerdown', (down) => {
    down.preventDefault()
    const startX = down.clientX
    // Starts from the displayed width, not the desired one: otherwise a drag that
    // resumes a clipped preference would make the column jump on the first pixel.
    const startWidth = Math.min(width, ceiling())
    const move = (ev) => {
      const delta = (ev.clientX - startX) * (invert ? -1 : 1)
      width = Math.min(ceiling(), Math.max(min, startWidth + delta))
      apply()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      writePref(prefKey, width)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
  return handle
}

// The three-column layout's movable parts: the nav drawer and the try-it
// bottom sheet below lg, the columns and the FAB above it.
//
// Everything mutable here — which overlay is open, what occupies the right
// column, whether the panel exists at all — is written only inside this
// module. The caller reads it back through the returned functions, which is
// what makes the extraction a move rather than a redesign.
//
// `scenarioActive` and `scenarioOwned` are callbacks, not values: they are
// answered by the scenario machinery, which is built after the layout and
// changes throughout a session. `syncPanels` asks on every call, exactly as
// it did when both lived in the same closure.
export function createPanels({
  nav,
  tryIt,
  webhookSim,
  banners = [],
  scenarioActive,
  scenarioOwned,
}) {
  // Desktop-first: 3 columns from lg up. Below that, the panel
  // becomes a bottom sheet opened by the FAB (see .api-sheet in app.css) —
  // the handle/close header only makes sense there.
  const sheetClose = iconButton('btn btn-ghost btn-sm btn-square', CLOSE_SVG, t('tryit.close'))
  const sheetHandle = el(
    'div',
    'lg:hidden sticky -top-4 z-10 -mx-4 -mt-4 mb-3 px-4 pt-2 pb-3 bg-base-100 border-b border-base-300 touch-none',
    el('div', 'mx-auto mb-2 h-1 w-10 rounded-full bg-base-content/20'),
    el(
      'div',
      'flex items-center justify-between gap-2',
      el('span', 'font-bold', text(t('tryit.title'))),
      sheetClose,
    ),
  )
  const tryItAside = el(
    'aside',
    // `scroll-pt-12` is the sticky handle above (64 px tall, pinned at -16 px,
    // so it covers the first 48 px of the scrollport): without it, focus
    // travelling upward is scrolled flush to the scrollport top and lands
    // entirely behind the handle — WCAG 2.4.11. Dropped from lg, where the
    // handle is not rendered.
    'api-offcanvas api-sheet w-full lg:w-(--tryit-col) shrink-0 border-t lg:border-t-0 lg:border-s border-base-300 lg:overflow-y-auto scroll-pt-12 lg:scroll-pt-0 p-4 bg-base-200/30 hidden',
    sheetHandle,
    ...banners,
    tryIt,
    webhookSim,
  )
  const tryItResizer = columnResizer(tryItAside, '--tryit-col', 'layout.tryItWidth', {
    defaultWidth: 384,
    min: 300,
    max: 1100,
    invert: true,
  })
  const boltIcon = el('span')
  boltIcon.innerHTML = BOLT_SVG
  const tryItFabBtn = el(
    'button',
    'btn btn-primary btn-lg shadow-lg gap-2',
    boltIcon,
    text(t('tryit.open')),
  )
  tryItFabBtn.type = 'button'
  const tryItFab = el('div', 'fab lg:hidden hidden', tryItFabBtn)

  const navAside = el(
    'aside',
    // The padding lives in api-nav (sticky search header requires it).
    // Below lg: off-canvas drawer opened by the header's hamburger.
    // `scroll-pt-14` clears that sticky header (56 px below lg, 48 px above):
    // Shift+Tab scrolls the focused entry flush to the scrollport top, which is
    // exactly where the header is pinned, and a 33 px link ends up 100 % hidden
    // behind it — WCAG 2.4.11.
    'api-offcanvas api-drawer bg-base-100 w-full lg:w-(--nav-col) shrink-0 lg:border-e border-base-300 lg:overflow-y-auto scroll-pt-14',
    nav,
  )
  // Landing point when the drawer opens: the hamburger that opened it is in the
  // header, which the opening makes inert, and focus left on an inert element
  // is dropped on `<body>`. Focusing the drawer itself rather than its first
  // control keeps the virtual keyboard shut — the first control is the nav's
  // search field.
  navAside.tabIndex = -1
  const navResizer = columnResizer(navAside, '--nav-col', 'layout.navWidth', {
    defaultWidth: 288,
    min: 200,
    max: 720,
  })

  // Overlaid mobile panels (nav drawer, try-it bottom sheet):
  // only one open at a time, closed by the scrim, Escape, a route
  // change, or a downward drag of the sheet.
  const scrim = el('div', 'api-scrim lg:hidden')
  const navToggle = iconButton('btn btn-ghost btn-sm btn-square lg:hidden', MENU_SVG, t('nav.open'))
  let openPanel = null
  // The panel stays in the desktop flow even with the sheet closed: only the route
  // (operation or not) decides whether it exists.
  let tryItAvailable = false
  // daisyUI's .fab lives at z-index 999, above the scrim: any open
  // panel (drawer included) must hide it, not just the sheet.
  function syncFab() {
    tryItFab.classList.toggle('hidden', !tryItAvailable || openPanel !== null)
  }

  // The marked nodes are held rather than re-derived on close: unwinding has to
  // undo exactly what was set, whatever the layout looks like by then, and an
  // `inert` left on a node nobody clears is a page that never comes back.
  const desktop = window.matchMedia(DESKTOP_QUERY)
  let inertNodes = []
  const syncInert = () => {
    for (const node of inertNodes) node.inert = false
    inertNodes = []
    // Above lg both panels are ordinary columns and nothing is covered; `inert`
    // is not media-scoped the way the off-canvas CSS is, so crossing the
    // breakpoint has to unwind it by hand.
    if (openPanel === null || desktop.matches) return
    const open = openPanel === 'nav' ? navAside : tryItAside
    const row = open.parentElement
    if (!row) return
    inertNodes = [
      ...[...row.children].filter((node) => node !== open),
      ...(row.parentElement?.querySelectorAll(BACKDROP) ?? []),
    ]
    for (const node of inertNodes) node.inert = true
  }
  desktop.addEventListener('change', syncInert)

  const setOpenPanel = (panel) => {
    openPanel = panel
    navAside.classList.toggle('is-open', panel === 'nav')
    tryItAside.classList.toggle('is-open', panel === 'tryit')
    scrim.classList.toggle('is-open', panel !== null)
    navToggle.setAttribute('aria-expanded', String(panel === 'nav'))
    tryItFabBtn.setAttribute('aria-expanded', String(panel === 'tryit'))
    syncFab()
    syncInert()
  }
  // The trigger is read before the close, and focused after it: both triggers
  // sit in the backdrop the open panel had made inert, and `focus()` on an
  // inert element does nothing at all.
  const closePanels = ({ restoreFocus = false } = {}) => {
    const trigger = openPanel === 'tryit' ? tryItFabBtn : openPanel === 'nav' ? navToggle : null
    setOpenPanel(null)
    if (restoreFocus) trigger?.focus()
  }
  const setTryItVisible = (visible) => {
    tryItAvailable = visible
    tryItAside.classList.toggle('hidden', !visible)
    tryItResizer.classList.toggle('lg:block', visible)
    syncFab()
  }

  // What occupies the right column: the panel, the webhook simulator,
  // or nothing. An ongoing step-by-step keeps it open even outside an operation
  // route (orphan step) — otherwise its banner, and the "Exit" button with it,
  // would become unreachable.
  let panelKind = 'none'
  const syncPanels = (kind = panelKind) => {
    panelKind = kind
    tryIt.classList.toggle('hidden', kind !== 'tryit')
    webhookSim.classList.toggle('hidden', kind !== 'webhook')
    setTryItVisible(kind !== 'none' || scenarioActive())
    // Step-by-step or step editing: the panel belongs to a scenario, and
    // its banner already says so. Same condition as that banner: a step that
    // disappears while being edited closes both at once.
    tryIt.scenarioOwned = scenarioOwned()
  }

  navToggle.addEventListener('click', () => {
    const opening = openPanel !== 'nav'
    setOpenPanel(opening ? 'nav' : null)
    if (opening) navAside.focus()
  })
  tryItFabBtn.addEventListener('click', () => {
    setOpenPanel('tryit')
    sheetClose.focus()
  })
  sheetClose.addEventListener('click', () => closePanels({ restoreFocus: true }))
  scrim.addEventListener('click', () => closePanels({ restoreFocus: true }))
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openPanel) closePanels({ restoreFocus: true })
  })
  dragToDismiss(tryItAside, sheetHandle, () => closePanels({ restoreFocus: true }))

  return {
    navAside,
    navResizer,
    tryItAside,
    tryItResizer,
    scrim,
    navToggle,
    tryItFab,
    setOpenPanel,
    closePanels,
    syncPanels,
  }
}
