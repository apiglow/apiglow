import { t } from '../i18n/index.js'
import { announce } from './a11y.js'
import { el, text } from './dom.js'
import { CHECK_SVG_SM_BOLD, COPY_SVG_SM } from './icons.js'

// Copying is one gesture with one grammar everywhere in the app: write, say so
// on the control itself, put the control back. What follows is that grammar in
// three pieces — the write that cannot lie about having happened, the
// confirmation that cannot be cut short, and the labelled button most callers
// want. The faces stay the callers': an anchor glyph, a copy glyph on a dark
// toolbar and a word are not the same control, and only the timing is shared.

const CONFIRM_MS = 1500

// → true when the text reached the clipboard. A rejected write — permission
// denied, no secure context — must never leave a control claiming it copied
// something, and must never surface as an unhandled rejection either.
export async function writeClipboard(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch (err) {
    console.error('[api-doc] clipboard write failed:', err)
    return false
  }
}

// `apply(true)` shows the confirmed face, `apply(false)` puts the resting one
// back. The returned handle is what makes a second click safe: without it the
// first click's timer fires during the second confirmation and takes it away
// early, so the control reads as idle while it has just copied.
export function confirmed(apply) {
  let restore = null
  return () => {
    apply(true)
    clearTimeout(restore)
    restore = setTimeout(() => apply(false), CONFIRM_MS)
  }
}

// Copy button revealed on hover of its container, which must carry the
// `group` class (cf. .api-hover-reveal in app.css: on fine pointers it is
// transparent at rest, elsewhere it stays visible — without hover it would be
// unguessable). Transparent rather than absent: it keeps its place, the line
// doesn't jump when the mouse approaches.
export function hoverCopyButton(getText, label = t('doc.copyUrl')) {
  const btn = el('button', 'btn btn-ghost btn-xs px-1 shrink-0 api-hover-reveal')
  btn.type = 'button'
  btn.innerHTML = COPY_SVG_SM
  btn.title = label
  btn.setAttribute('aria-label', label)
  const confirm = confirmed((done) => {
    btn.innerHTML = done ? CHECK_SVG_SM_BOLD : COPY_SVG_SM
    btn.classList.toggle('text-success', done)
  })
  btn.addEventListener('click', async () => {
    if (await writeClipboard(getText())) confirm()
  })
  return btn
}

// A button whose own label carries the confirmation: it says "Copied", then
// says again what it said before. `label` may be a function for a resting label
// that is more than a word — an icon and a word are rebuilt on restore rather
// than stashed, so nothing depends on detached nodes surviving.
//
// `announceText` is not optional decoration: the label swap is invisible to a
// screen reader focused elsewhere (rule 15). It is left to the caller because
// only the caller knows whether the button's own name already says it.
export function copyTextButton({
  classes,
  label,
  getText,
  copiedLabel = t('export.copied'),
  announceText = null,
  successClass = null,
}) {
  const idle = typeof label === 'function' ? label : () => [text(label)]
  const btn = el('button', classes, ...idle())
  btn.type = 'button'
  const confirm = confirmed((done) => {
    btn.replaceChildren(...(done ? [text(copiedLabel)] : idle()))
    if (successClass) btn.classList.toggle(successClass, done)
  })
  btn.addEventListener('click', async () => {
    if (!(await writeClipboard(await getText()))) return
    confirm()
    announce(announceText)
  })
  return btn
}

// A block the reader copies whole, with the button in its corner. The wrapper
// carries `group` because `hoverCopyButton` above depends on it — stated once
// here rather than at each call site, where forgetting it ships a copy button
// that stays transparent forever and no test catches it.
export function copyableBlock(block, getText, label) {
  return el(
    'div',
    'group relative',
    block,
    el('div', 'absolute top-2 end-2', hoverCopyButton(getText, label)),
  )
}
