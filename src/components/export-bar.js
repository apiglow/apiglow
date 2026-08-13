import { curlFromEntry } from '../export/curl.js'
import { toDebugReport } from '../export/debug.js'
import { toHar } from '../export/har.js'
import { toMarkdownReport } from '../export/markdown.js'
import { toPostmanCollection } from '../export/postman.js'
import { CURL_TARGET, SNIPPET_LANGUAGES, snippetFromEntry } from '../export/snippets.js'
import { t } from '../i18n/index.js'
import { copyTextButton } from './copy-button.js'
import { el, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import { captureButton } from './scenario-capture.js'

// Export formats (docs/architecture.md §5.7): pure generators from src/export/, redaction
// enabled by default. Static map format → generation.
const EXPORT_FORMATS = {
  curl: {
    generate: (entry, opts) => curlFromEntry(entry, opts),
  },
  ...Object.fromEntries(
    Object.keys(SNIPPET_LANGUAGES).map((lang) => [
      lang,
      { generate: (entry, opts) => snippetFromEntry(lang, entry, opts) },
    ]),
  ),
  postman: {
    generate: (entry, opts) => JSON.stringify(toPostmanCollection(entry, opts), null, 2),
  },
  markdown: {
    generate: (entry, opts) => toMarkdownReport(entry, opts),
  },
  har: {
    generate: (entry, opts) => JSON.stringify(toHar(entry, opts), null, 2),
  },
  debug: {
    generate: (entry, opts) => toDebugReport(entry, opts),
  },
}

// Emojis rather than an icon set: zero dependency. The dependency rule
// (architecture.md §14.2) opened runtime
// dependencies for spec and format work only — an icon set is neither.
// The snippet languages bring their own from the registry: a new language is
// one entry there, and never a format silently rendered without its icon.
const FORMAT_ICONS = {
  curl: CURL_TARGET.icon,
  ...Object.fromEntries(Object.entries(SNIPPET_LANGUAGES).map(([lang, { icon }]) => [lang, icon])),
  postman: '📮',
  markdown: '📝',
  har: '🌐',
  debug: '🧰',
}

// Format offered by default: the Debug report embeds everything (request, response,
// context) — the most useful to paste into a ticket or give to an LLM.
const DEFAULT_FORMAT = 'debug'

// Export bar: format selector (icon dropdown) + options
// (redaction by default, {{var}} template for snippets) + clipboard copy —
// all formats paste directly wherever needed, no
// file download. Shared between history (locked entry) and the
// try-it (entry rebuilt on every use — hence the getter). refresh()
// recomputes whatever depends on the current entry. getShareUrl (optional,
// try-it only): adds a button copying a pre-filled request link.
// capture (optional): { list, add, getStep } — "Add to a
// scenario" button, the counterpart of sharing for a sequence of requests.
export function exportBar(getEntry, { getShareUrl = null, capture = null } = {}) {
  let current = DEFAULT_FORMAT

  const triggerIcon = el('span', '', text(FORMAT_ICONS[current]))
  const triggerLabel = el('span', 'truncate', text(t(`export.format.${current}`)))
  const summary = el(
    'summary',
    'btn btn-xs gap-1.5 font-normal',
    triggerIcon,
    triggerLabel,
    el('span', 'text-subtle', text('▾')),
  )
  const menu = el(
    'ul',
    'dropdown-content menu menu-sm bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-56 p-1',
  )
  // The bar lives at the bottom of the try-it panel / history detail: opens
  // upward so the menu stays in the visible area.
  const dropdown = detailsDropdown('dropdown-top', summary, menu)
  // Two dropdowns coexist in the bar (format, capture): each one
  // identifies itself unambiguously.
  dropdown.details.dataset.formatPicker = ''

  const itemButtons = {}
  for (const key of Object.keys(EXPORT_FORMATS)) {
    const btn = el(
      'button',
      'gap-2',
      el('span', '', text(FORMAT_ICONS[key])),
      text(t(`export.format.${key}`)),
    )
    btn.type = 'button'
    btn.dataset.format = key
    btn.addEventListener('click', () => setFormat(key))
    itemButtons[key] = btn
    menu.append(el('li', '', btn))
  }

  const redactToggle = el('input', 'checkbox checkbox-xs')
  redactToggle.type = 'checkbox'
  redactToggle.checked = true

  const templateToggle = el('input', 'checkbox checkbox-xs')
  templateToggle.type = 'checkbox'
  const templateLabel = el(
    'label',
    'label text-xs gap-1 cursor-pointer',
    templateToggle,
    text(t('export.template')),
  )
  templateLabel.title = t('export.templateHelp')

  const refresh = () => {
    // Template mode only makes sense if the entry has memorized its variables.
    templateToggle.disabled = !getEntry()?.usedVariables?.length
    // Template mode applies to all snippet formats (plain text where
    // {{var}} keeps its meaning), not to structured formats (Postman, HAR…).
    templateLabel.classList.toggle('hidden', current !== 'curl' && !SNIPPET_LANGUAGES[current])
  }

  const setFormat = (key) => {
    current = key
    triggerIcon.replaceChildren(text(FORMAT_ICONS[key]))
    triggerLabel.replaceChildren(text(t(`export.format.${key}`)))
    for (const [k, btn] of Object.entries(itemButtons))
      btn.classList.toggle('menu-active', k === key)
    dropdown.close()
    refresh()
  }
  setFormat(current)

  const generate = () => {
    const format = EXPORT_FORMATS[current]
    const options = { redact: redactToggle.checked, substitute: !templateToggle.checked }
    return format.generate(getEntry(), options)
  }

  const copyBtn = copyTextButton({
    classes: 'btn btn-xs',
    label: t('export.copy'),
    getText: generate,
  })

  let shareBtn = null
  if (getShareUrl) {
    shareBtn = copyTextButton({
      classes: 'btn btn-xs gap-1',
      label: () => [el('span', '', text('🔗')), text(t('export.share'))],
      getText: getShareUrl,
    })
    shareBtn.title = t('export.shareHelp')
  }

  const element = el(
    'div',
    'flex flex-wrap items-center gap-2',
    el('span', 'text-xs font-bold uppercase text-subtle', text(t('export.title'))),
    dropdown.details,
    el('label', 'label text-xs gap-1 cursor-pointer', redactToggle, text(t('export.redact'))),
    templateLabel,
    copyBtn,
    shareBtn,
    capture ? captureButton(capture, capture.getStep) : null,
  )
  element.dataset.exportBar = ''
  return { element, refresh }
}
