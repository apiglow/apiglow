import { t } from '../i18n/index.js'
import { parseImport } from '../import/index.js'
import { isAmbiguous, matchOperation } from '../import/match.js'
import { announce, modalDismiss, openModal } from './a11y.js'
import { el, text } from './dom.js'
import { METHOD_BADGE } from './method-colors.js'

// "Import a request": paste a cURL command, or drop a Postman collection or a
// HAR, and land in the try-it of the operation it designates.
//
// The dialog never sends and never stores: it hands the shell an operation id
// and a pre-filled request. Everything it shows about what it could NOT do
// (dropped cookies, an unmatched credential, an ignored flag) is shown before
// the reader commits, because after the jump the panel looks like any other.

const NEUTRAL_BADGE = 'badge badge-soft badge-neutral'

class ImportDialog extends HTMLElement {
  #dialog = null
  #body = null
  #textarea = null
  #results = null
  #model = null
  #baseUrls = []
  #parsed = null
  #draftIndex = 0
  #matches = null
  #candidateIndex = 0
  #timer = 0

  set model(model) {
    this.#model = model
  }

  // Base URLs of the environments: a pasted command targets the host the reader
  // actually calls, which the document's `servers` need not mention.
  set baseUrls(urls) {
    this.#baseUrls = (urls ?? []).filter(Boolean)
  }

  // `({ opId, request, variables })` — the shell routes and pre-fills.
  onOpen = null

  open() {
    this.#buildBody()
    openModal(this.#dialog, { focus: this.#textarea })
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({
      backdropLabel: t('import.close'),
      closeLabel: t('import.close'),
    })

    this.#body = el('div', 'flex flex-col gap-3')
    this.#dialog = el(
      'dialog',
      'modal',
      el('div', 'modal-box max-w-2xl', dismiss, this.#body),
      backdrop,
    )
    // Emptied on close, and rebuilt on open: a closed dialog leaves no file
    // input and no pasted command behind. The next import starts clean, and
    // nothing of it is reachable from the page in between.
    this.#dialog.addEventListener('close', () => {
      clearTimeout(this.#timer)
      this.#body.replaceChildren()
      this.#parsed = null
      this.#matches = null
    })
    this.replaceChildren(this.#dialog)
  }

  #buildBody() {
    this.#textarea = el('textarea', 'textarea textarea-bordered w-full font-mono text-xs h-32')
    this.#textarea.placeholder = t('import.placeholder')
    this.#textarea.spellcheck = false
    this.#textarea.setAttribute('aria-label', t('import.paste'))
    this.#textarea.addEventListener('input', () => this.#scheduleAnalyze())

    const file = el('input', 'file-input file-input-sm file-input-bordered w-full sm:w-auto')
    file.type = 'file'
    file.accept = '.json,.har,.txt,.sh,application/json,text/plain'
    file.setAttribute('aria-label', t('import.file'))
    file.addEventListener('change', async () => {
      const picked = file.files?.[0]
      if (!picked) return
      this.#textarea.value = await picked.text()
      this.#analyze()
    })

    this.#results = el('div', 'flex flex-col gap-3')
    this.#body.replaceChildren(
      el(
        'div',
        'flex flex-col gap-1 pe-8',
        el('h3', 'text-lg font-bold', text(t('import.title'))),
        el('p', 'text-xs text-subtle', text(t('import.intro'))),
      ),
      this.#textarea,
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        el('span', 'text-xs text-subtle', text(t('import.orFile'))),
        file,
      ),
      this.#results,
    )
  }

  // Debounced: a HAR pasted into the textarea is re-parsed on every keystroke
  // otherwise, and a browser's HAR is measured in megabytes.
  #scheduleAnalyze() {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.#analyze(), 200)
  }

  #analyze() {
    const source = this.#textarea.value
    this.#parsed = source.trim() ? parseImport(source) : null
    this.#draftIndex = 0
    this.#selectDraft(0)
  }

  #selectDraft(index) {
    this.#draftIndex = index
    const draft = this.#parsed?.requests?.[index]
    this.#matches = draft ? matchOperation(this.#model, draft, { baseUrls: this.#baseUrls }) : null
    this.#candidateIndex = 0
    this.#render()
    if (this.#matches) {
      announce(
        this.#matches.candidates.length
          ? t('import.matched', { count: this.#matches.candidates.length })
          : t('import.noMatch'),
      )
    }
  }

  #render() {
    const parsed = this.#parsed
    if (!parsed) {
      this.#results.replaceChildren()
      return
    }
    const children = []
    for (const error of parsed.errors ?? []) {
      children.push(
        el('div', 'alert alert-error alert-soft text-sm py-2', text(codeMessage(error))),
      )
    }
    if (parsed.requests?.length) {
      if (parsed.requests.length > 1) children.push(this.#draftList(parsed.requests))
      children.push(...this.#candidateSection())
    }
    const warnings = [...(parsed.warnings ?? []), ...(this.#currentWarnings() ?? [])]
    if (warnings.length) children.push(warningList(warnings))
    this.#results.replaceChildren(...children)
  }

  #currentWarnings() {
    return this.#matches?.candidates?.[this.#candidateIndex]?.warnings ?? this.#matches?.warnings
  }

  // A collection or a HAR holds many requests: pick which one before picking
  // which operation it is.
  #draftList(requests) {
    const select = el('select', 'select select-sm select-bordered w-full font-mono text-xs')
    select.setAttribute('aria-label', t('import.request'))
    requests.forEach((draft, index) => {
      const option = el('option', '', text(draft.name || `${draft.method} ${draft.url}`))
      option.value = String(index)
      if (index === this.#draftIndex) option.selected = true
      select.append(option)
    })
    select.addEventListener('change', () => this.#selectDraft(Number(select.value)))
    return el(
      'label',
      'flex flex-col gap-1',
      el('span', 'text-xs text-subtle', text(t('import.requestCount', { count: requests.length }))),
      select,
    )
  }

  #candidateSection() {
    const candidates = this.#matches?.candidates ?? []
    if (!candidates.length) {
      return [el('div', 'alert alert-warning alert-soft text-sm py-2', text(t('import.noMatch')))]
    }
    const out = []
    if (isAmbiguous(candidates)) {
      out.push(el('p', 'text-xs text-subtle', text(t('import.ambiguous'))))
    }
    const list = el('div', 'flex flex-col gap-1 max-h-52 overflow-y-auto')
    list.setAttribute('role', 'radiogroup')
    list.setAttribute('aria-label', t('import.candidates'))
    list.append(...candidates.map((candidate, index) => this.#candidateRow(candidate, index)))
    out.push(list)

    const open = el('button', 'btn btn-sm btn-primary self-start', text(t('import.openInTryIt')))
    open.type = 'button'
    open.addEventListener('click', () => {
      const chosen = candidates[this.#candidateIndex]
      if (!chosen) return
      this.#dialog.close()
      this.onOpen?.({ opId: chosen.op.id, request: chosen.request, variables: chosen.variables })
    })
    out.push(open)
    return out
  }

  #candidateRow(candidate, index) {
    const method = String(candidate.op.method ?? '').toLowerCase()
    const input = el('input', 'radio radio-xs')
    input.type = 'radio'
    input.name = 'apidoc-import-candidate'
    input.checked = index === this.#candidateIndex
    input.addEventListener('change', () => {
      this.#candidateIndex = index
      this.#render()
    })
    return el(
      'label',
      'flex items-center gap-2 rounded-box border border-base-300 px-2 py-1.5 cursor-pointer text-xs',
      input,
      el(
        'span',
        `${METHOD_BADGE[method] ?? NEUTRAL_BADGE} badge-sm font-mono`,
        text(method.toUpperCase()),
      ),
      el('code', 'font-mono truncate', text(candidate.op.path)),
      candidate.op.summary
        ? el('span', 'text-subtle truncate hidden sm:inline', text(candidate.op.summary))
        : null,
    )
  }
}

function warningList(warnings) {
  return el(
    'section',
    'flex flex-col gap-1',
    el('h4', 'text-xs font-bold text-subtle', text(t('import.warnings'))),
    el(
      'ul',
      'flex flex-col gap-0.5 text-xs text-subtle list-disc ps-4',
      ...warnings.map((warning) => el('li', '', text(codeMessage(warning)))),
    ),
  )
}

// Every code the parsers and the matcher emit has its own string; the code
// itself is the fallback, so a new one never renders as nothing.
function codeMessage(entry) {
  return t(`import.code.${entry.code}`, entry)
}

if (!customElements.get('import-dialog')) customElements.define('import-dialog', ImportDialog)
