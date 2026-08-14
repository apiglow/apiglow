// Imperative DOM construction: guarantees by construction that no
// external content goes through innerHTML (rule 5) — text goes through Text nodes.

export function el(tag, className = '', ...children) {
  const node = document.createElement(tag)
  if (className) node.className = className
  node.append(...children.filter(Boolean))
  return node
}

export function text(value) {
  return document.createTextNode(String(value))
}

// OpenAPI descriptions are potentially long Markdown: the title attribute only
// renders plain text, so we flatten it and cap it rather than letting the
// browser display a wall of text.
const TOOLTIP_MAX_CHARS = 300

export function tooltipText(description) {
  const flat = String(description ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  return flat.length > TOOLTIP_MAX_CHARS ? `${flat.slice(0, TOOLTIP_MAX_CHARS)}…` : flat
}

// Link to content we don't host: new tab, and never a window handle back into
// the app. Vetting the href is the CALLER's job and it happens upstream — every
// URL the model exposes went through its http(s) gate (rule 5), and the one
// exception, a `mailto:` built from `info.contact.email`, is inert by scheme.
export function externalLink(className, url, ...children) {
  const anchor = el('a', className, ...children)
  anchor.href = url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  return anchor
}

// A decorative inline icon: hidden from assistive tech, because every one of
// these sits next to the text that already names it. `svg` is a trusted static
// from the codebase — never external content (rule 5). Kept here next to
// `iconButton`, which does the same for the interactive case: the one thing
// call sites kept forgetting is the `aria-hidden`, and that is what the axe
// sweep gates on.
export function icon(svg, className = '') {
  const span = el('span', className)
  span.innerHTML = svg
  span.setAttribute('aria-hidden', 'true')
  return span
}

// Square button carrying an icon only: the label exists for assistive tech and
// as a tooltip, never as visible text. `svg` is a trusted static from the
// codebase — never external content (rule 5).
export function iconButton(classes, svg, label) {
  const btn = el('button', classes)
  btn.type = 'button'
  btn.innerHTML = svg
  btn.setAttribute('aria-label', label)
  btn.title = label
  return btn
}

// A field under a daisyUI floating label: the label rides on the field's own
// top border, so it has to wrap the field rather than precede it.
export function labeled(label, field) {
  return el('label', 'floating-label', field, el('span', '', text(label)))
}

// A select under its own `<label for>` — the pairing assistive tech reads, and
// the one `getByLabel` pins in the e2e suite. Options are `{ value, label }`
// pairs rather than nodes the caller appends itself, and the select comes back
// next to its node: it is the selection's only holder, so no caller keeps a
// copy in a variable that can drift from what the reader sees.
export function selectField({ id, label, options, value, onChange }) {
  const select = el('select', 'select select-sm w-full max-w-xs')
  select.id = id
  for (const option of options) {
    const node = el('option', '', text(option.label))
    node.value = option.value
    select.append(node)
  }
  select.value = value
  select.addEventListener('change', () => onChange(select.value))
  const caption = el('label', 'text-sm text-subtle', text(label))
  caption.htmlFor = id
  return { node: el('div', 'flex flex-col gap-1', caption, select), select }
}

// Commits on `change` (blur) by default: re-rendering a form under a keystroke
// destroys the field being typed into. `event: 'input'` is for the callers
// whose output has to track the form as it is typed rather than on blur.
export function textInput(value, onCommit, className, { event = 'change' } = {}) {
  const input = el('input', className)
  input.type = 'text'
  input.value = value ?? ''
  input.addEventListener(event, () => onCommit(input.value))
  return input
}

// daisyUI's stock size, not `checkbox-xs`: the `-xs` box paints at 16 px, and
// the rows it sits in pack tighter than the 24 px of clearance WCAG 2.5.8
// accepts in place of a 24 px target (§12).
export function checkbox(checked, onToggle) {
  const box = el('input', 'checkbox')
  box.type = 'checkbox'
  box.checked = checked === true
  box.addEventListener('change', () => onToggle(box.checked))
  return box
}

// How far a box is scrolled, and which control has focus, is state the browser
// owns and no model holds: a `replaceChildren` re-render throws both away. A
// view that re-renders in answer to a click made INSIDE it — a scenario step's
// clickable keys — therefore sends the user back to the top of the list they
// were reading, with focus dropped on `<body>`. The nodes that must survive
// name themselves with a key that is stable across renders, and anything
// unnamed (or whose key the new render did not produce) is simply not
// restored:
//   data-keep-scroll="<key>"  the scrolling box
//   data-keep-focus="<key>"   the control, or an ancestor of it
export function keepPlace(root, render) {
  // Compared as strings rather than queried back through a selector: a key
  // carries JSON pointers and other punctuation, and there is no escaping to
  // get wrong this way.
  const find = (attribute, key) =>
    [...root.querySelectorAll(`[${attribute}]`)].find(
      (node) => node.getAttribute(attribute) === key,
    )
  const scrolled = [...root.querySelectorAll('[data-keep-scroll]')]
    .filter((node) => node.scrollTop || node.scrollLeft)
    .map((node) => [node.dataset.keepScroll, node.scrollTop, node.scrollLeft])
  const focused = root.contains(document.activeElement)
    ? (document.activeElement.closest('[data-keep-focus]')?.dataset.keepFocus ?? null)
    : null
  render()
  for (const [key, top, left] of scrolled) {
    const node = find('data-keep-scroll', key)
    if (!node) continue
    node.scrollTop = top
    node.scrollLeft = left
  }
  // The scroll offsets are already back, so there is nothing left for the
  // browser to scroll to reach the control: `preventScroll` keeps it from
  // deciding otherwise and undoing the restore above.
  if (focused) find('data-keep-focus', focused)?.focus({ preventScroll: true })
}

// Scrolls to the `id` a deep link named, right after the render that created
// it. The wait for the next frame is not cosmetic: called synchronously after
// `replaceChildren`, Firefox still sees the scroll container at its pre-render
// size (`scrollHeight === clientHeight`) and the scroll is a silent no-op,
// where Chromium reflows first. Re-queried inside the frame because a second
// render may have replaced the subtree in between.
export function scrollToAnchor(root, anchor) {
  if (!anchor) return
  // Bounded retry rather than one frame, and a success only counts once it
  // HOLDS: the first render can reach this before the stylesheet has made
  // the doc column its own scroller, and a scrollIntoView on that state
  // scrolls the window instead — which looks right for exactly one frame,
  // until the settling layout clamps the window back and the anchor is lost
  // with no one left to retry. So a reading in the viewport is only trusted
  // when the NEXT frame, with no scroll of ours in between, still agrees;
  // and once it does, the loop ends — a reader who has started scrolling is
  // never yanked back by a late attempt.
  let attempts = 30
  let settled = false
  const tick = () => {
    if (!root.isConnected) return
    const target = root.querySelector(`#${CSS.escape(anchor)}`)
    if (target) {
      const box = target.getBoundingClientRect()
      if (box.bottom > 0 && box.top >= 0 && box.top < window.innerHeight) {
        if (settled) return
        settled = true
      } else {
        settled = false
        target.scrollIntoView({ block: 'start' })
      }
    }
    attempts -= 1
    if (attempts > 0) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
