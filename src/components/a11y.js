import { el, text } from './dom.js'

// Accessibility primitives shared by the components (rule 15). One
// implementation rather than one per component: the keyboard model and the
// announcement channel are a contract, and three slightly different
// re-implementations is how that contract rots.

// --- announcements ------------------------------------------------------

// A screen reader announces MUTATIONS of a live region already present in the
// accessibility tree: inserting a node that already carries its text is
// silent. Every `role=alert` box built by the components falls into that trap,
// hence a single region created once, up front, that only ever changes text.
let region = null
let pending = 0

function liveRegion() {
  if (region?.isConnected) return region
  region = el('span', 'sr-only')
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.dataset.liveRegion = ''
  document.body.append(region)
  return region
}

// Long enough for the clear to be committed as its own mutation, short enough
// that the announcement still reads as a reaction to the action.
const ANNOUNCE_DELAY_MS = 60

// Announces an outcome the user cannot see happening (send result, run
// verdict, blocked action). Visible text stays where it is — this only adds
// the spoken channel.
export function announce(message) {
  if (!message) return
  const node = liveRegion()
  // Clear, then write on a later task: the same message twice in a row (the
  // same request sent again) is not a mutation, and clearing in the same task
  // would be coalesced with the write.
  clearTimeout(pending)
  node.textContent = ''
  pending = setTimeout(() => {
    node.textContent = message
  }, ANNOUNCE_DELAY_MS)
}

// A modal `<dialog>` makes the rest of the document inert, and an inert subtree
// is not announced: a region parked on `<body>` goes silent for exactly the
// surfaces that talk the most — the settings clearing a dataset, an import
// landing, the palette counting its results. It rides into the top layer with
// the dialog and comes back out with it. Stacked dialogs: the last one opened
// is the one that speaks, and closing it hands the region back to the one below.
function parkLiveRegion() {
  const open = [...document.querySelectorAll('dialog[open]')]
  ;(open.at(-1) ?? document.body).append(liveRegion())
}

// --- modal dialogs ------------------------------------------------------

// Opens a modal and returns focus where it came from on close. Browsers do
// restore focus to the element that had it, but only if that element is still
// there: several of ours sit in dropdowns and toolbars that re-render while
// the dialog is open, and focus then falls back to <body> — the user is
// dropped at the top of the document with no way back.
export function openModal(dialog, { focus = null } = {}) {
  if (!dialog || dialog.open) return
  const invoker = document.activeElement
  dialog.addEventListener(
    'close',
    () => {
      const target = invoker?.isConnected ? invoker : null
      target?.focus?.()
      parkLiveRegion()
    },
    { once: true },
  )
  // The browser focuses the first focusable descendant, which is the ✕ button
  // in our modals: the caller names a better landing point when it has one.
  // Named through `autofocus`, because that is the hook the dialog's own
  // focusing steps read — WebKit runs them after `showModal()` returns, and
  // takes focus straight back off a `focus()` call made here. The attribute is
  // cleared first: the dialog outlives its body, and yesterday's landing point
  // would win over today's by tree order.
  if (focus) {
    for (const previous of dialog.querySelectorAll('[autofocus]')) previous.autofocus = false
    focus.autofocus = true
  }
  dialog.showModal()
  parkLiveRegion()
  focus?.focus?.()
}

// The dismissal pair every modal of the app carries: the ✕ in the box's top
// corner, and the backdrop that closes on a click outside. Both are bare
// `method="dialog"` forms — the browser closes the dialog itself, so there is
// no listener to forget and none to leak when the component re-renders.
//
// Both labels are required, and their absence throws rather than degrades: a
// missing one leaves a button named by its glyph or by the string "undefined",
// which axe accepts as an accessible name and no test can tell from a real
// one. Throwing at the first render is what the e2e suite can see.
export function modalDismiss({ backdropLabel, closeLabel }) {
  if (!backdropLabel || !closeLabel) throw new Error('modalDismiss: both labels are required')
  const backdrop = el('form', 'modal-backdrop', el('button', '', text(backdropLabel)))
  backdrop.method = 'dialog'
  const button = el('button', 'btn btn-sm btn-circle btn-ghost absolute right-2 top-2', text('✕'))
  button.setAttribute('aria-label', closeLabel)
  const dismiss = el('form', '', button)
  dismiss.method = 'dialog'
  return { backdrop, dismiss }
}

// --- scrollable blocks --------------------------------------------------

// A box that scrolls but holds nothing focusable — a code block, a header
// dump, a wide table. Chromium and Firefox make such a box a tab stop of their
// own so the arrow keys can scroll it; WebKit does not, and everything past
// the visible edge is then reachable by pointer only. So the tab stop is
// declared here rather than inherited, and it carries a name: an anonymous
// `group` is announced as one.
//
// The class is what paints the ring — nothing in daisyUI outlines a <pre> —
// and `tests/e2e/keyboard.spec.js` asserts every stop has one.
export function scrollBlock(node, label) {
  node.classList.add('api-scrollport')
  node.tabIndex = 0
  node.setAttribute('role', 'group')
  node.setAttribute('aria-label', label)
  return node
}

// --- tablists -----------------------------------------------------------

const TAB_DELTA = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }

// Roving tabindex + arrow keys on a `role=tablist` (WAI-ARIA APG). A tablist
// is ONE tab stop: Tab enters it and leaves it, the arrows move within it.
// Without this, a response tab bar of ten status codes costs ten Tab presses
// to walk past.
//
// `onSelect(index)` performs the component's own switch (render, class,
// state). The returned `activate` applies only the ARIA/tabindex side, for
// the programmatic selections a component drives itself.
export function wireTablist(tablist, tabs, onSelect) {
  const activate = (index) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index))
      tab.tabIndex = i === index ? 0 : -1
    })
  }
  tabs.forEach((tab, i) => {
    tab.setAttribute('role', 'tab')
    tab.tabIndex = i === 0 ? 0 : -1
    tab.addEventListener('click', () => onSelect(i))
  })
  tablist.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(event.target)
    if (current < 0) return
    const delta = TAB_DELTA[event.key]
    const next =
      delta !== undefined
        ? (current + delta + tabs.length) % tabs.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : -1
    if (next < 0) return
    event.preventDefault()
    // Selection follows focus: our panels are already built, so there is no
    // cost to rendering them as the user arrows through (APG's default).
    onSelect(next)
    tabs[next].focus()
  })
  return activate
}

// Ties a tablist to its panel. Ids are generated because nothing in the model
// gives a stable, unique one, and duplicate ids are themselves an a11y defect.
let seq = 0
export function linkTabPanel(tabs, panel) {
  const id = `apidoc-tabpanel-${++seq}`
  panel.id = id
  panel.setAttribute('role', 'tabpanel')
  for (const tab of tabs) tab.setAttribute('aria-controls', id)
}
