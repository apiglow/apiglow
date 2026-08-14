// Small DOM builders shared by the try-it panel and its response view.
// Several of them carry fixed Tailwind colors rather than theme tokens:
// they sit on the navy `api-code-panel` background, which is outside the
// theme (colors skill rule 11).

import { currentLanguage, t } from '../../i18n/index.js'
import { scrollBlock } from '../a11y.js'
import { confirmed, writeClipboard } from '../copy-button.js'
import { el, text } from '../dom.js'
import { CHECK_SVG_SM, COPY_SVG_SM } from '../icons.js'
import { highlightSource } from '../markdown.js'

export function labeledBlock(title, content) {
  return el('div', '', el('div', 'text-label uppercase text-subtle mb-1', text(title)), content)
}

// Copy button for the dark panels (cURL, response): clipboard icon, fixed
// colors matched to the navy background, ephemeral green checkmark after copy.
export function copyIconButton(getText) {
  const btn = el(
    'button',
    'btn btn-ghost btn-xs px-1.5 text-white/60 hover:text-white hover:bg-white/10 border-0 shrink-0',
  )
  btn.type = 'button'
  btn.innerHTML = COPY_SVG_SM
  btn.title = t('export.copy')
  btn.setAttribute('aria-label', t('export.copy'))
  const confirm = confirmed((done) => {
    btn.innerHTML = done ? CHECK_SVG_SM : COPY_SVG_SM
    btn.classList.toggle('text-white/60', !done)
    btn.classList.toggle('text-emerald-300', done)
  })
  btn.addEventListener('click', async () => {
    if (await writeClipboard(getText())) confirm()
  })
  return btn
}

// A run's label: relative within the elapsed hour (that's when we look
// for "the call from two minutes ago"), absolute time beyond that. The
// full date stays in the title.
export function runTime(timestamp) {
  const elapsed = Date.now() - timestamp
  if (elapsed < 60_000) return t('tryit.runJustNow')
  if (elapsed < 3_600_000) {
    return new Intl.RelativeTimeFormat(currentLanguage(), { numeric: 'auto' }).format(
      -Math.round(elapsed / 60_000),
      'minute',
    )
  }
  return new Date(timestamp).toLocaleTimeString()
}

// Every button sitting on a dark panel wears this: fixed colors matched to the
// navy background, like the neighboring tabs. Shared so the two places that
// need it (the example toggle below, the insight strip's actions) cannot drift.
export const PANEL_BUTTON =
  'btn btn-ghost btn-xs text-white/70 hover:text-white hover:bg-white/10 border-0'

// Display toggle for the dark panels (example ↔ real response).
export function panelToggleButton(label, onClick) {
  const btn = el('button', PANEL_BUTTON, text(label))
  btn.type = 'button'
  btn.addEventListener('click', onClick)
  return btn
}

// Transfer sizes, as the send meter has always shown them — shared so the
// insight strip's compression chip speaks the same units in the same panel.
// (The settings panel's storage inventory keeps its own: it floors at 1 KB,
// which is right for an inventory and wrong for a payload.)
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The proxy switch, identical in the try-it panel and the webhook simulator:
// both send from the page and both offer the same way out of CORS. `onToggle`
// is the only thing that differs, so it is the only thing passed in.
export function proxyToggle(onToggle) {
  const toggle = el('input', 'toggle toggle-sm')
  toggle.type = 'checkbox'
  toggle.addEventListener('change', () => onToggle(toggle.checked))
  return el(
    'label',
    'flex items-center gap-2 cursor-pointer',
    toggle,
    el('span', '', text(t('tryit.proxy'))),
  )
}

export function alertBox(colorClass, message) {
  const box = el('div', `alert ${colorClass} text-xs py-2`, el('span', '', text(message)))
  box.setAttribute('role', 'alert')
  return box
}

// Status badge tints, static map (rule 2). `muted` is the unselected state of
// the example picker's chips: a neutral tint rather than a dimmed color one,
// so an unselected status code stays as readable as the selected one.
export const STATUS_PILL = {
  1: 'bg-sky-400/15 text-sky-300',
  2: 'bg-emerald-400/15 text-emerald-300',
  3: 'bg-sky-400/15 text-sky-300',
  4: 'bg-amber-400/15 text-amber-300',
  5: 'bg-red-400/15 text-red-300',
  default: 'bg-white/10 text-white/70',
  muted: 'bg-white/5 text-white/75',
}

// The status dot inside the example picker's chips: denser than the tint it
// sits on, so the chip reads as a status light before any call is made.
export const STATUS_DOT = {
  1: 'bg-sky-400',
  2: 'bg-emerald-400',
  3: 'bg-sky-400',
  4: 'bg-amber-400',
  5: 'bg-red-400',
  default: 'bg-white/40',
}

export function responseBody(content, isJson) {
  const code = el(
    'code',
    isJson ? 'hljs language-json text-xs whitespace-pre' : 'text-xs whitespace-pre',
  )
  if (isJson) code.innerHTML = highlightSource(content ?? '', 'json')
  else code.textContent = content ?? ''
  return scrollBlock(
    el('pre', 'p-3 text-xs overflow-x-auto max-h-80 overflow-y-auto', code),
    t('a11y.scrollable.code'),
  )
}

// All received headers, with no filtering on the tool's side: what's
// missing here was hidden by the browser itself (CORS without
// Access-Control-Expose-Headers, Set-Cookie never readable by script) —
// the note spells this out.
export function headersView(headerEntries) {
  const count = el(
    'div',
    'text-[11px] font-mono text-white/60',
    text(t('tryit.headerCount', { n: headerEntries.length })),
  )
  const note = el('p', 'text-[11px] text-white/50 italic', text(t('tryit.exposeNote')))
  const rows = headerEntries.map(([name, value]) =>
    el(
      'div',
      'py-0.5 break-all font-mono',
      el('span', 'text-emerald-300', text(name)),
      el('span', 'text-white/80', text(`: ${value}`)),
    ),
  )
  return scrollBlock(
    el('div', 'p-3 text-xs flex flex-col gap-1 max-h-80 overflow-y-auto', count, ...rows, note),
    t('a11y.scrollable.headers'),
  )
}
