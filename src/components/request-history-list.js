import { envBadgeClass } from '../env/colors.js'
import { redactEntry } from '../export/redact.js'
import { t } from '../i18n/index.js'
import { modalDismiss, openModal } from './a11y.js'
import { el, text } from './dom.js'
import { exportBar } from './export-bar.js'
import { insightStrip } from './insight-strip.js'
import { highlightSource, prettyJson } from './markdown.js'
import { captureButton } from './scenario-capture.js'
import { stepRequestFromEntry } from '../scenarios/capture.js'
import { methodBadgeClass, statusColorClass } from './method-colors.js'

// Builds a row's collapse content, keyed by the row. Only `#applyFocus` needs
// it — it opens a row itself, which is not a user `change` on the checkbox.
const fillDetail = new WeakMap()

// Request history (docs/architecture.md §5.6): filterable list (endpoint, env, status
// code, free text), redaction of sensitive values on display
// (enabled by default), replay as-is / reload in the try-it, clear.
class RequestHistoryList extends HTMLElement {
  #history = null
  #envStore = null
  #dialog = null
  #body = null
  #listBox = null
  #filters = { text: '', env: '', opId: '', status: '', scenarioId: '' }
  #redact = true
  onLoadEntry = null
  // { list, add } provided by the shell: pin an entry into a scenario.
  capture = null
  // (id) => name, provided by the shell: the entry only keeps the id of the
  // scenario that produced it, and an id doesn't mean anything to anyone.
  scenarioName = null
  requestCredentials = 'same-origin'

  set history(history) {
    this.#history = history
    history.addEventListener('change', () => {
      if (this.#dialog?.open) this.#refresh()
    })
  }

  // Only used to color each entry's environment badge, by
  // name: the popin never acts on environments.
  set envStore(store) {
    this.#envStore = store
    store.addEventListener('change', () => {
      if (this.#dialog?.open) this.#renderList()
    })
  }

  // Only used to name each entry's group: the history, for its part,
  // only stores the opId (the schema may have changed since the call).
  set model(model) {
    this.#opGroups = new Map(
      model.groups.flatMap((group) =>
        group.operationIds.map((id) => [id, group.summary ?? group.tag]),
      ),
    )
    // Capturing a step needs the operation's path template to
    // re-extract the path params from the stored URL.
    this.#opsById = new Map(model.operations.map((op) => [op.id, op]))
  }

  #opGroups = new Map()
  #opsById = new Map()

  // The fallback group label is translated here, not when the
  // map is built: the language can change without the model moving.
  #groupLabel(opId) {
    if (!this.#opGroups.has(opId)) return null
    return this.#opGroups.get(opId) ?? t('nav.otherGroup')
  }

  // `opId`: opened from the try-it's run selector — the popin
  // opens already filtered on the endpoint being looked at.
  // `scenarioId`: opened from a step's report — the popin frames
  // the WHOLE scenario, all runs combined: it's the timeline we came to
  // read, not an isolated call.
  // `stepId`: with either one, that step's entry is additionally
  // expanded and brought into view.
  //
  // Filters start from scratch on every open. They used to survive
  // closing: a targeted open (a run, a scenario step) left
  // the popin filtered on that endpoint, and the next open from the
  // header — with no argument, so nothing to clear it — only showed
  // a fraction of the history. It read as "my calls weren't
  // recorded" where they were simply hidden.
  open({ opId = '', stepId = null, scenarioId = '' } = {}) {
    this.#filters = { text: '', env: '', opId, status: '', scenarioId }
    this.#focusStepId = stepId
    this.#refresh({ toolbar: true })
    openModal(this.#dialog)
  }

  // The entries of the last read, shared by the toolbar's selects, the list and
  // `#matches`. `list()` walks the whole timestamp cursor and deserializes every
  // record, bodies included — tens of milliseconds on a full store — while the
  // filters only ever narrow the ROWS. So the store is read once per open and
  // once per store change, never per keystroke.
  #entries = []

  async #refresh({ toolbar = false } = {}) {
    this.#entries = await this.#history.list()
    // The toolbar is only rebuilt on open: rebuilding it on a store change
    // (a replay, a capture) would steal focus from the search field.
    if (toolbar) this.#renderToolbar()
    this.#renderList()
    await this.#renderRetention()
  }

  #focusStepId = null

  // Only once per open: re-renders triggered by the store (a
  // replay, for example) must not steal the user's scroll.
  #applyFocus(entries) {
    const stepId = this.#focusStepId
    this.#focusStepId = null
    if (!stepId) return
    // Failing the step's entry (history purged, sent outside a run), the
    // most recent one for the endpoint — the list is already filtered and reverse-chronological.
    const target = entries.find((entry) => entry.scenario?.stepId === stepId) ?? entries[0]
    const row =
      target && this.#listBox.querySelector(`[data-entry-id="${CSS.escape(String(target.id))}"]`)
    if (!row) return
    row.querySelector('input[type="checkbox"]').checked = true
    // Checking the box from script fires no `change`: the detail this is about
    // to show has to be built by hand.
    fillDetail.get(row)?.()
    row.scrollIntoView({ block: 'nearest' })
  }

  close() {
    this.#dialog?.close()
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({ backdropLabel: t('env.close') })
    this.#toolbar = el('div')
    this.#retentionBox = el('p', 'text-xs text-subtle mt-2')
    this.#listBox = el('div', 'mt-3 flex flex-col gap-2')
    this.#body = el(
      'div',
      '',
      el('h3', 'text-lg font-bold mb-2', text(t('history.title'))),
      this.#toolbar,
      this.#retentionBox,
      this.#listBox,
    )
    this.#dialog = el(
      'dialog',
      'modal',
      // Nearly full screen: the history is a debugging tool, we want to see
      // URLs, headers and bodies without micro-scrolling inside a small box.
      el('div', 'modal-box w-[95vw] max-w-[100rem] h-[90vh] max-h-[90vh]', dismiss, this.#body),
      backdrop,
    )
    this.replaceChildren(this.#dialog)
  }

  #toolbar = null
  #retentionBox = null

  #renderToolbar() {
    const entries = this.#entries
    const distinct = (key) => [...new Set(entries.map((e) => e[key]).filter(Boolean))]

    const textInput = el('input', 'input input-sm w-40')
    textInput.type = 'search'
    textInput.placeholder = t('history.filter.text')
    textInput.value = this.#filters.text
    textInput.addEventListener('input', () => {
      this.#filters.text = textInput.value.trim().toLowerCase()
      this.#renderList()
    })

    const makeSelect = (allLabel, values, key) => {
      const select = el('select', 'select select-sm w-36')
      // The "all X" option doubles as the field's name: the filter row has no
      // visible labels, the selects are identified by their neutral value.
      select.setAttribute('aria-label', allLabel)
      const all = el('option', '', text(allLabel))
      all.value = ''
      select.append(all)
      for (const value of values) {
        const option = el('option', '', text(value))
        option.value = value
        option.selected = this.#filters[key] === value
        select.append(option)
      }
      select.addEventListener('change', () => {
        this.#filters[key] = select.value
        this.#renderList()
      })
      return select
    }

    const statusSelect = el('select', 'select select-sm w-32')
    statusSelect.setAttribute('aria-label', t('history.filter.allStatus'))
    for (const [value, label] of [
      ['', t('history.filter.allStatus')],
      ['2', '2xx'],
      ['3', '3xx'],
      ['4', '4xx'],
      ['5', '5xx'],
      ['error', t('history.filter.error')],
    ]) {
      const option = el('option', '', text(label))
      option.value = value
      option.selected = this.#filters.status === value
      statusSelect.append(option)
    }
    statusSelect.addEventListener('change', () => {
      this.#filters.status = statusSelect.value
      this.#renderList()
    })

    const redactToggle = el('input', 'toggle toggle-sm')
    redactToggle.type = 'checkbox'
    redactToggle.checked = this.#redact
    redactToggle.addEventListener('change', () => {
      this.#redact = redactToggle.checked
      this.#renderList()
    })

    const clearBtn = el(
      'button',
      'btn btn-sm btn-error btn-outline ms-auto',
      text(t('history.clear')),
    )
    clearBtn.type = 'button'
    clearBtn.addEventListener('click', () => {
      if (window.confirm(t('history.clearConfirm'))) this.#history.clear()
    })

    this.#toolbar.replaceChildren(
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        textInput,
        makeSelect(t('history.filter.allOps'), distinct('opId'), 'opId'),
        makeSelect(t('history.filter.allEnvs'), distinct('envName'), 'env'),
        this.#scenarioSelect(entries),
        statusSelect,
        el('label', 'label text-xs gap-1 cursor-pointer', redactToggle, text(t('history.redact'))),
        clearBtn,
      ),
    )
  }

  // Retention is enforced silently on every write; saying so is what keeps "my
  // old requests vanished" from reading as data loss. Reads the WHOLE store,
  // not the list — neither the filters nor the multi-spec scoping of `list()`
  // narrows the bound being described, and a count taken from the visible
  // entries would disagree with the settings panel over the same dataset.
  async #renderRetention() {
    const { count, oldest } = await this.#history.stats()
    if (!count) {
      this.#retentionBox.replaceChildren()
      return
    }
    const { maxEntries, maxAgeDays } = this.#history.retention
    this.#retentionBox.replaceChildren(
      text(
        t('history.retention', {
          count,
          max: maxEntries,
          days: maxAgeDays,
          date: oldest ? new Date(oldest).toLocaleString() : '—',
        }),
      ),
    )
  }

  // The scenario filter only exists if the history carries at least one —
  // on an installation that doesn't use them, it would be a selector with a
  // single line. Visible and clearable: a targeted open from a report
  // must read as a filter, not as a truncated history.
  #scenarioSelect(entries) {
    const ids = [...new Set(entries.map((entry) => entry.scenario?.id).filter(Boolean))]
    if (!ids.length) return null
    const select = el('select', 'select select-sm w-40')
    const all = el('option', '', text(t('history.filter.allScenarios')))
    all.value = ''
    select.append(all)
    for (const id of ids) {
      const option = el('option', '', text(this.scenarioName?.(id) ?? id))
      option.value = id
      option.selected = this.#filters.scenarioId === id
      select.append(option)
    }
    select.dataset.scenarioFilter = ''
    select.setAttribute('aria-label', t('history.filter.allScenarios'))
    select.addEventListener('change', () => {
      this.#filters.scenarioId = select.value
      this.#renderList()
    })
    return select
  }

  #matches(entry) {
    const f = this.#filters
    if (f.opId && entry.opId !== f.opId) return false
    if (f.scenarioId && entry.scenario?.id !== f.scenarioId) return false
    if (f.env && entry.envName !== f.env) return false
    if (f.status === 'error' && !entry.error) return false
    if (f.status && f.status !== 'error' && String(entry.response?.status ?? '')[0] !== f.status)
      return false
    if (f.text) {
      const haystack = [
        entry.opId,
        entry.method,
        entry.path,
        entry.request?.url,
        entry.envName,
        String(entry.response?.status ?? ''),
        entry.request?.body,
        entry.response?.body,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(f.text)) return false
    }
    return true
  }

  #renderList() {
    const entries = this.#entries.filter((e) => this.#matches(e))
    if (entries.length) {
      this.#listBox.replaceChildren(...entries.map((entry) => this.#entryRow(entry)))
      this.#applyFocus(entries)
    } else {
      this.#listBox.replaceChildren(
        el('p', 'text-sm text-subtle py-6 text-center', text(t('history.empty'))),
      )
    }
  }

  #entryRow(entry) {
    const statusLabel = entry.error
      ? t('history.filter.error')
      : String(entry.response?.status ?? '—')
    const statusClass = entry.error ? 'text-error' : statusColorClass(entry.response?.status ?? 0)
    const groupLabel = this.#groupLabel(entry.opId)

    const title = el(
      'div',
      'collapse-title py-2 min-h-0 flex flex-wrap items-center gap-2 text-sm',
      el('span', 'text-xs text-subtle font-mono', text(new Date(entry.timestamp).toLocaleString())),
      // Group between the date and the verb: we scan the list by endpoint
      // family before reading the path.
      groupLabel
        ? el('span', 'text-xs font-semibold text-subtle truncate max-w-40', text(groupLabel))
        : null,
      el('span', methodBadgeClass(entry.method), text(entry.method)),
      el('code', 'font-mono text-xs', text(entry.path ?? entry.opId)),
      el('span', `font-mono text-xs font-bold ${statusClass}`, text(statusLabel)),
      el('span', 'text-xs text-subtle', text(`${entry.durationMs} ms`)),
      entry.envName
        ? el(
            'span',
            `badge badge-xs ${envBadgeClass(this.#envStore?.colorOfName(entry.envName))}`,
            text(entry.envName),
          )
        : null,
      entry.truncatedRequest || entry.truncatedResponse
        ? el('span', 'badge badge-warning badge-outline badge-xs', text(t('history.truncated')))
        : null,
      // Send coming from a scenario run, not a click in the try-it (§4).
      entry.scenario ? this.#scenarioBadge(entry.scenario) : null,
    )

    const detail = el('div', 'collapse-content flex flex-col gap-2 text-xs')

    // daisyUI's collapse control is a bare checkbox: without a name it is
    // announced as "checkbox, unchecked" on every row of the list.
    const toggle = el('input')
    toggle.type = 'checkbox'
    toggle.setAttribute('aria-label', t('history.toggleEntry'))
    // A closed row costs its title line and nothing else. Its detail redacts
    // the entry, builds an export bar and re-highlights the response body
    // (hljs → DOMPurify → innerHTML, milliseconds each), and the whole list is
    // rebuilt on every keystroke in the free-text filter — for content the
    // browser never even lays out. Same lazy shape as audit-report's
    // occurrence groups.
    const fill = () => {
      if (detail.childElementCount) return
      detail.append(...this.#entryDetail(entry, statusClass))
    }
    toggle.addEventListener('change', () => toggle.checked && fill())

    const row = el(
      'div',
      'collapse collapse-arrow border border-base-300 bg-base-100',
      toggle,
      title,
      detail,
    )
    row.dataset.entryId = String(entry.id)
    fillDetail.set(row, fill)
    return row
  }

  // Children of the collapse, built on first open.
  #entryDetail(entry, statusClass) {
    const shown = this.#redact ? redactEntry(entry) : entry
    // el() filters out null children; native append() would turn them into
    // "null", hence the explicit filter on the way out.
    return [
      el(
        'div',
        'flex flex-wrap gap-2',
        this.#replayBtn(entry),
        this.#loadBtn(entry),
        this.#captureBtn(entry),
      ),
      el('div', 'border-t border-base-200 pt-2', exportBar(() => entry).element),
      el('h4', 'font-bold uppercase text-subtle mt-1', text(t('history.request'))),
      el('code', 'font-mono break-all', text(`${entry.method.toUpperCase()} ${shown.request.url}`)),
      headersBlock(shown.request.headers),
      shown.request.body ? pre(shown.request.body) : null,
      el('h4', 'font-bold uppercase text-subtle mt-1', text(t('history.response'))),
      entry.response
        ? el(
            'div',
            'flex flex-col gap-1',
            el(
              'span',
              `font-mono font-bold ${statusClass}`,
              text(`${entry.response.status} ${entry.response.statusText ?? ''}`),
            ),
            // Same reading as the try-it panel's, on the page's own surface:
            // an archive's deadlines render as the clock time they pointed at,
            // and the two actions belong to the panel that can show their
            // response (docs/network-insights.md §4.2/§4.3).
            insightStrip(shown, { surface: 'page' }),
            headersBlock(shown.response.headers),
            shown.response.body ? responseBody(shown.response.body) : null,
          )
        : el(
            'p',
            'text-subtle',
            text(t('history.noResponse')),
            // Historical entries from before the real message was stored ('network').
            entry.error && entry.error !== 'network'
              ? el('code', 'font-mono break-all block', text(entry.error))
              : null,
          ),
    ].filter(Boolean)
  }

  // "scenario" badge: marked so nothing confuses it with the
  // "Add to a scenario" button on the same card. The name as a tooltip rather than
  // spelled out — in an already-crowded row (date, group, verb, path,
  // status, duration, env), it would dictate the width of the whole list for
  // a piece of information only looked up entry by entry. Scenario deleted
  // since, or unreadable base: the badge stays, silent, rather than displaying
  // a uuid.
  #scenarioBadge(scenario) {
    const badge = el('span', 'badge badge-info badge-outline badge-xs', text(t('scenario.badge')))
    badge.dataset.scenarioBadge = ''
    const name = this.scenarioName?.(scenario.id)
    if (name) badge.title = name
    return badge
  }

  #replayBtn(entry) {
    const btn = el('button', 'btn btn-xs', text(t('history.replay')))
    btn.type = 'button'
    // A body made of files can't be replayed: only their names were stored,
    // and `request.body` holds a display line, not a payload. Replaying it
    // would post that line as if it were the file. "Reload into the try-it"
    // stays available — it's where the file gets picked again.
    const carriesFile =
      !!entry.request?.bodyFile || (entry.request?.form ?? []).some((f) => f.fileName !== undefined)
    if (carriesFile) {
      btn.disabled = true
      btn.title = t('history.replayNeedsFile')
      return btn
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true
      try {
        await this.#replay(entry)
      } finally {
        btn.disabled = false
      }
    })
    return btn
  }

  // Replays the stored request as-is (resolved) and logs the result
  // as a new entry.
  async #replay(entry) {
    const method = entry.method.toUpperCase()
    const canHaveBody = !['GET', 'HEAD'].includes(method)
    const copy = {
      ...entry,
      timestamp: Date.now(),
      response: null,
      error: null,
      durationMs: 0,
      headersMs: 0,
    }
    delete copy.id
    const startedAt = performance.now()
    try {
      const response = await fetch(entry.request.url, {
        method,
        headers: entry.request.headers,
        body: canHaveBody && entry.request.body != null ? entry.request.body : undefined,
        credentials: this.requestCredentials,
      })
      // Like in the try-it: `durationMs` is the full round-trip, body read
      // included — not just the time to headers, which `headersMs` keeps
      // separately for the HAR export.
      copy.headersMs = Math.round(performance.now() - startedAt)
      const body = await response.text()
      copy.durationMs = Math.round(performance.now() - startedAt)
      copy.response = {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body,
      }
    } catch (err) {
      copy.durationMs = Math.round(performance.now() - startedAt)
      copy.error = `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`
      console.error('[api-doc] replay failed:', err)
    }
    await this.#history.add(copy)
  }

  // Pin into a scenario (§5.4): the stored request is resolved, it
  // goes back to template form via the same path as "reload in the
  // try-it". Without the operation (schema changed since), nothing to capture.
  #captureBtn(entry) {
    const op = this.#opsById.get(entry.opId)
    if (!this.capture || !op) return null
    // In primary: it's the only action on the card that capitalizes on the call
    // rather than replaying it one more time, and it used to get lost between two
    // neutral buttons.
    return captureButton(
      this.capture,
      () => ({ opId: entry.opId, request: stepRequestFromEntry(entry, op) }),
      {
        classes: 'btn btn-xs btn-primary gap-1',
        dropdownClasses: 'dropdown-bottom',
      },
    )
  }

  #loadBtn(entry) {
    const btn = el('button', 'btn btn-xs', text(t('history.loadInTryIt')))
    btn.type = 'button'
    btn.addEventListener('click', () => {
      this.close()
      this.onLoadEntry?.(entry)
    })
    return btn
  }
}

function headersBlock(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  if (!entries.length) return null
  return el(
    'div',
    'flex flex-col',
    ...entries.map(([name, value]) =>
      el(
        'div',
        'break-all',
        el('span', 'font-mono font-semibold', text(name)),
        el('span', 'font-mono text-subtle', text(`: ${value}`)),
      ),
    ),
  )
}

function pre(content) {
  return el(
    'pre',
    'bg-base-200 rounded-box p-2 overflow-x-auto max-h-60 overflow-y-auto',
    el('code', '', text(content)),
  )
}

// Beyond that, the body starts collapsed: a response with several hundred lines
// pushed the following entries off screen, in a popin whose whole
// point is to scan through the history.
const BODY_COLLAPSE_LINES = 14

// Response body: re-indented and colorized when it's JSON (APIs
// respond minified), collapsed to a few lines with a button to expand it.
function responseBody(raw) {
  const pretty = prettyJson(raw)
  const source = pretty ?? String(raw)
  const code = el('code', pretty === null ? '' : 'hljs language-json')
  if (pretty === null) code.textContent = source
  else code.innerHTML = highlightSource(source, 'json')
  const block = el(
    'pre',
    'bg-base-200 rounded-box p-2 overflow-x-auto overflow-y-auto max-h-60',
    code,
  )
  if (source.split('\n').length <= BODY_COLLAPSE_LINES) return block

  block.classList.replace('max-h-60', 'max-h-40')
  const toggle = el('button', 'btn btn-xs btn-ghost self-start', text(t('history.showMore')))
  toggle.type = 'button'
  toggle.dataset.bodyToggle = ''
  toggle.addEventListener('click', () => {
    const expanded = block.classList.contains('max-h-40')
    // Expanded, the body stays bounded and scrollable: "show more" must not
    // make the next entry's buttons unreachable.
    block.classList.replace(
      expanded ? 'max-h-40' : 'max-h-[60vh]',
      expanded ? 'max-h-[60vh]' : 'max-h-40',
    )
    toggle.replaceChildren(text(t(expanded ? 'history.showLess' : 'history.showMore')))
  })
  return el('div', 'flex flex-col gap-1', block, toggle)
}

if (!customElements.get('request-history-list'))
  customElements.define('request-history-list', RequestHistoryList)
