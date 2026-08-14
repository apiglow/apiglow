import { t } from '../i18n/index.js'
import { scrollBlock } from './a11y.js'
import { copyableBlock } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadText } from './download.js'
import { DOWNLOAD_SVG } from './icons.js'

// The shell the take-away panels share (architecture.md §5.14): the MCP config
// on the home page, "Automate this scenario" on a scenario page. Both hand over
// a *file* — generated here, run on the reader's own machine — and both say the
// same thing in the same order, which is the doctrine this module now holds in
// one place instead of stating it twice in two file comments:
//
//   the file is shown, not just copied — it goes into someone's repository or
//   their machine's config, and pasting an unread blob from a documentation
//   site is exactly the habit not to encourage; what the reader's own tool
//   would ignore, or would be missing, sits above it for the same reason; and
//   the file carries names, never values (rule 12).
//
// Collapsed by default: each addresses the reader wiring a pipeline or an agent
// up, not the one reading the page.
//
// What the shell does NOT own is any panel's own judgement — its generator, its
// warning vocabulary, and its decision to render nothing at all rather than a
// file that fails on its first run.
//
// `state` / `onState`: both host views re-render whole on writes that have
// nothing to do with these panels — a run landing its results, a history read
// or a purge — and rebuild the panel with them. What the reader chose here is
// theirs and outlives that: the open state lives in the caller, and each panel
// adds its own selections to the same patch. A panel that closed under the
// reader's fingers, or snapped back to the first bridge mid-copy, is the bug
// this exists to prevent.
export function takeAwayPanel({ title, intro, state = {}, onState = () => {} }, ...body) {
  const panel = el(
    'details',
    'collapse collapse-arrow card-border border border-base-300 bg-base-200/50',
    el(
      'summary',
      'collapse-title p-4 pe-10 min-h-0',
      el(
        'div',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1',
        el('h2', 'card-title text-base', text(title)),
        el('span', 'text-sm text-subtle', text(intro)),
      ),
    ),
    el('div', 'collapse-content p-4 pt-0 flex flex-col gap-3', ...body.filter(Boolean)),
  )
  panel.open = state.open === true
  panel.addEventListener('toggle', () => onState({ open: panel.open }))
  return panel
}

// → { node, code }: the caller fills `code` on every refresh, which is the one
// thing the two panels do differently — a Text node for the YAML job, markup
// from `highlightSource` for the JSON config.
export function takeAwaySource(getText, label, codeClass) {
  const code = el('code', codeClass)
  const pre = scrollBlock(
    el('pre', 'bg-base-300/40 rounded-box p-3 text-xs overflow-x-auto', code),
    t('a11y.scrollable.code'),
  )
  return { node: copyableBlock(pre, getText, label), code }
}

// Soft variant: taking the file away is an auxiliary action next to reading it,
// and must not weigh more heavily to the eye than the block above it. The file
// is read at click time — it tracks the selector the reader has since moved.
export function takeAwayDownload(label, getFile) {
  const btn = el('button', 'btn btn-sm btn-primary btn-soft gap-1.5')
  btn.type = 'button'
  btn.append(icon(DOWNLOAD_SVG, 'shrink-0'), el('span', '', text(label)))
  btn.addEventListener('click', () => {
    const { filename, content } = getFile()
    downloadText(filename, content)
  })
  return btn
}

// The warnings, above the block. The list is shared; the vocabulary is not —
// each panel translates its own codes and hands over finished lines, because
// the two generators do not agree on a warning's shape (one emits codes, the
// other objects carrying interpolation params).
export function warningList() {
  return el('ul', 'flex flex-col gap-1 text-xs text-subtle')
}

export function setWarnings(list, messages) {
  list.replaceChildren(...messages.map((message) => el('li', '', text(`⚠ ${message}`))))
}
