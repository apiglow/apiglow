import { interpolate } from '../env/interpolate.js'
import { t } from '../i18n/index.js'
import { isNoCorsMethod, partitionNoCorsHeaders } from '../openapi/no-cors.js'
import { displayableExample } from '../openapi/examples.js'
import { applyProxy } from '../openapi/request-builder.js'
import { readSpecPref, writeSpecPref } from '../storage/prefs.js'
import { announce } from './a11y.js'
import { prefillBody } from './try-it/body-state.js'
import {
  STATUS_PILL,
  alertBox,
  labeledBlock,
  proxyToggle,
  responseBody,
} from './try-it/view-bits.js'
import { el, text } from './dom.js'
import { prettyJson } from './markdown.js'
import { methodBadgeClass } from './method-colors.js'

// Webhook simulator (competitive analysis, prio 1 — no competitor does this):
// sends the event's example payload to the user's receiver URL, to test
// their endpoint without waiting for a real trigger.
// Simpler than the try-it: no auth (the call isn't targeting the API), no
// history. It does read the selected environment's variables, because rule 11
// binds every send path: a receiver URL, a header or a payload written with
// {{var}} resolves here exactly as it does in the panel, and an unresolved one
// blocks the send instead of leaving the literal on the wire.
class ApiWebhookSimulator extends HTMLElement {
  #op = null
  #proxyUrl = null
  #requestCredentials = 'same-origin'
  #envStore = null
  #state = null
  #ui = {}
  #sending = false

  set context({ proxyUrl, requestCredentials, envStore }) {
    this.#proxyUrl = proxyUrl ?? null
    this.#requestCredentials = requestCredentials ?? 'same-origin'
    this.#envStore = envStore ?? null
  }

  set operation(op) {
    this.#op = op
    if (this.isConnected) this.#resetFromOp()
  }

  connectedCallback() {
    this.classList.add('block')
    if (this.#op) this.#resetFromOp()
  }

  #resetFromOp() {
    const contents = this.#op.requestBody?.contents ?? []
    this.#state = {
      // A single receiver URL, shared between webhooks: it's the same
      // integration endpoint (ngrok, webhook.site…) being tested.
      url: readSpecPref('webhookSim.url', ''),
      mediaTypeIndex: 0,
      headerRows: initialHeaderRows(this.#op, contents[0]),
      body: prefillBody(contents[0]),
      proxyOn: false,
      fireAndForget: false,
    }
    this.#render()
  }

  #render() {
    const op = this.#op
    // Kept as references: the send path refills them in place rather than
    // re-rendering the whole simulator.
    this.#ui.alerts = el('div', 'flex flex-col gap-2')
    this.#ui.response = el('div')
    this.#ui.noCorsNote = null
    const sections = [
      el(
        'div',
        'flex items-center gap-2',
        el('span', methodBadgeClass(op.method, 'badge-sm'), text(op.method)),
        el('code', 'text-xs font-mono break-all', text(op.name)),
        el('span', 'badge badge-info badge-outline badge-xs', text(t('doc.webhook'))),
      ),
      el('p', 'text-xs text-subtle', text(t('webhook.simNote'))),
      this.#urlSection(),
      this.#headersSection(),
      this.#bodySection(),
      this.#proxySection(),
      this.#fireAndForgetSection(),
      this.#sendRow(),
      this.#ui.alerts,
      this.#ui.response,
    ].filter(Boolean)
    this.replaceChildren(el('div', 'flex flex-col gap-3 text-sm', ...sections))
  }

  #urlSection() {
    const input = el('input', 'input input-sm w-full font-mono')
    input.type = 'url'
    input.placeholder = 'https://example.com/hooks/…'
    input.value = this.#state.url
    input.addEventListener('input', () => {
      this.#state.url = input.value
      writeSpecPref('webhookSim.url', input.value)
    })
    this.#ui.urlInput = input
    return labeledBlock(t('webhook.targetUrl'), input)
  }

  #headersSection() {
    const rowsBox = el('div', 'flex flex-col gap-1')
    const renderRows = () => {
      rowsBox.replaceChildren(
        ...this.#state.headerRows.map((row, index) => {
          const name = el('input', 'input input-xs font-mono w-36')
          name.type = 'text'
          name.value = row.name
          name.placeholder = t('tryit.headerName')
          name.setAttribute('aria-label', t('tryit.headerName'))
          name.addEventListener('input', () => {
            row.name = name.value
            this.#refreshNoCorsNote()
          })
          const value = el('input', 'input input-xs font-mono grow')
          value.type = 'text'
          value.setAttribute('aria-label', t('tryit.headerValue'))
          value.value = row.value
          value.addEventListener('input', () => {
            row.value = value.value
            this.#refreshNoCorsNote()
          })
          const remove = el('button', 'btn btn-ghost btn-xs px-1', text('✕'))
          remove.type = 'button'
          remove.addEventListener('click', () => {
            this.#state.headerRows.splice(index, 1)
            renderRows()
            this.#refreshNoCorsNote()
          })
          return el('div', 'flex items-center gap-1', name, value, remove)
        }),
      )
    }
    renderRows()
    const add = el(
      'button',
      'btn btn-soft btn-primary btn-xs self-start',
      text(`+ ${t('tryit.addHeader')}`),
    )
    add.type = 'button'
    add.addEventListener('click', () => {
      this.#state.headerRows.push({ name: '', value: '' })
      renderRows()
      this.#refreshNoCorsNote()
    })
    return labeledBlock(t('tryit.headers'), el('div', 'flex flex-col gap-1', rowsBox, add))
  }

  #bodySection() {
    const contents = this.#op.requestBody?.contents ?? []
    if (!contents.length) return null
    const box = el('div')
    const title = el(
      'div',
      'flex items-center gap-2 mb-1',
      el('div', 'text-xs font-bold uppercase text-subtle', text(t('tryit.body'))),
    )
    if (contents.length > 1) {
      const select = el('select', 'select select-xs w-auto font-mono')
      contents.forEach((content, i) => {
        const option = el('option', '', text(content.mediaType))
        option.value = String(i)
        option.selected = i === this.#state.mediaTypeIndex
        select.append(option)
      })
      select.addEventListener('change', () => {
        this.#state.mediaTypeIndex = Number(select.value)
        const content = contents[this.#state.mediaTypeIndex]
        this.#state.body = prefillBody(content)
        const row = this.#state.headerRows.find((r) => r.name.toLowerCase() === 'content-type')
        if (row) row.value = content.mediaType
        this.#render()
      })
      title.append(select)
    } else {
      title.append(
        // `text-subtle`, not the `text-white/60` its twin in the try-it panel
        // uses: that one sits inside the dark `api-code-panel`, this row is an
        // ordinary section on base-100, where white ink is invisible.
        el('span', 'text-[11px] font-mono text-subtle truncate', text(contents[0].mediaType)),
      )
    }
    const ta = el('textarea', 'textarea textarea-sm w-full font-mono text-xs min-h-40')
    ta.setAttribute('aria-label', t('tryit.body'))
    ta.value = this.#state.body
    ta.spellcheck = false
    ta.addEventListener('input', () => {
      this.#state.body = ta.value
    })
    box.append(title, ta)
    return box
  }

  #proxySection() {
    if (!this.#proxyUrl) return null
    return proxyToggle((on) => {
      this.#state.proxyOn = on
    })
  }

  // Escape hatch for a receiver that answers no CORS header at all: the event
  // is delivered, nothing comes back. Off by default and never remembered —
  // a degraded send has to be chosen each time, not inherited from a past one.
  #fireAndForgetSection() {
    if (!isNoCorsMethod(this.#op.method)) return null
    const toggle = el('input', 'toggle toggle-sm')
    toggle.type = 'checkbox'
    toggle.checked = this.#state.fireAndForget
    toggle.dataset.fireAndForget = ''
    toggle.addEventListener('change', () => {
      this.#state.fireAndForget = toggle.checked
      this.#refreshNoCorsNote()
    })
    this.#ui.noCorsNote = el('div', 'flex flex-col gap-2')
    const section = el(
      'div',
      'flex flex-col gap-2',
      el(
        'label',
        'flex items-center gap-2 cursor-pointer',
        toggle,
        el('span', '', text(t('webhook.fireAndForget'))),
      ),
      this.#ui.noCorsNote,
    )
    this.#refreshNoCorsNote()
    return section
  }

  // Recomputed on every header edit: which headers survive depends on their
  // current name AND value (a Content-Type of text/plain passes, application/json
  // doesn't), so a note computed once at toggle time would lie.
  #refreshNoCorsNote() {
    const box = this.#ui.noCorsNote
    if (!box) return
    if (!this.#state.fireAndForget) return box.replaceChildren()
    const messages = [alertBox('alert-info', t('webhook.fireAndForgetHelp'))]
    const { dropped } = partitionNoCorsHeaders(this.#currentHeaders())
    if (dropped.length)
      messages.push(
        alertBox(
          'alert-warning',
          t('webhook.fireAndForgetDropped', { headers: dropped.join(', ') }),
        ),
      )
    box.replaceChildren(...messages)
  }

  #currentHeaders() {
    return Object.fromEntries(
      this.#state.headerRows
        .filter((row) => row.name.trim())
        .map((row) => [row.name.trim(), row.value]),
    )
  }

  #sendRow() {
    const send = el('button', 'btn btn-primary btn-sm', text(t('webhook.send')))
    send.type = 'button'
    send.addEventListener('click', () => this.#send())
    this.#ui.status = el('span', 'text-xs text-subtle')
    return el('div', 'flex items-center gap-3', send, this.#ui.status)
  }

  // Environment only, deliberately: host-provided credentials
  // (docs/host-credentials.md) never reach this send. The call goes to the
  // user's own receiver, not to the API — the same reason no auth is injected
  // here (§5.1) forbids handing the host's token to that address.
  #variables() {
    return this.#envStore ? this.#envStore.variablesOf(this.#envStore.selected()) : {}
  }

  // Every template of the request in one pass, so the message names all the
  // missing variables at once rather than the first one to be hit.
  #resolveAll() {
    const variables = this.#variables()
    const state = this.#state
    const missing = new Set()
    const resolve = (template) => {
      const r = interpolate(template, variables)
      for (const name of r.missing) missing.add(name)
      return r.value
    }
    const headers = Object.fromEntries(
      state.headerRows
        .filter((row) => row.name.trim())
        .map((row) => [resolve(row.name.trim()), resolve(row.value)]),
    )
    return {
      url: resolve(state.url),
      headers,
      body: resolve(state.body ?? ''),
      missing: [...missing],
    }
  }

  async #send() {
    // The Send button is never disabled during the flight, unlike the try-it's:
    // there is no Cancel here to hand the keyboard to, and a disabled button
    // cannot hold focus — the reader would be dropped on <body> for the whole
    // send, and that document-level focus change swallows the polite
    // announcement of the outcome. This guard is what `disabled` was buying.
    if (this.#sending) return
    const state = this.#state
    this.#ui.alerts.replaceChildren()
    this.#ui.response.replaceChildren()

    // Rule 11, before anything else: an unresolved {{var}} never reaches the
    // URL parsing, let alone the wire.
    const resolved = this.#resolveAll()
    if (resolved.missing.length) {
      const message = t('tryit.missingVars', { names: resolved.missing.join(', ') })
      this.#ui.alerts.append(alertBox('alert-error', message))
      announce(message)
      this.#ui.urlInput.focus()
      return
    }

    let target
    try {
      target = new URL(resolved.url)
      if (!/^https?:$/.test(target.protocol)) throw new Error('protocol')
    } catch {
      this.#ui.alerts.append(alertBox('alert-error', t('webhook.urlInvalid')))
      this.#ui.urlInput.classList.add('input-error')
      announce(t('webhook.urlInvalid'))
      this.#ui.urlInput.focus()
      return
    }
    this.#ui.urlInput.classList.remove('input-error')

    const method = this.#op.method.toUpperCase()
    // Filtered ourselves rather than left to the Headers guard: same result on
    // the wire, but the dropped names are the ones the note already showed.
    const headers = state.fireAndForget
      ? partitionNoCorsHeaders(resolved.headers).kept
      : resolved.headers
    const url =
      state.proxyOn && this.#proxyUrl ? applyProxy(this.#proxyUrl, target.href) : target.href
    const body = !['GET', 'HEAD'].includes(method) && resolved.body ? resolved.body : undefined

    this.#sending = true
    this.#ui.status.replaceChildren(
      el('span', 'loading loading-spinner loading-xs'),
      text(` ${t('tryit.sending')}`),
    )
    announce(t('tryit.sending'))
    const startedAt = performance.now()
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: this.#requestCredentials,
        ...(state.fireAndForget ? { mode: 'no-cors' } : {}),
      })
      const durationMs = Math.round(performance.now() - startedAt)
      // An opaque response carries status 0 and an unreadable body: reaching
      // here is the only proof of delivery the browser will ever give us.
      if (response.type === 'opaque') {
        this.#renderOpaqueDelivery(target.href, durationMs)
        announce(t('webhook.sentOpaque'))
      } else {
        this.#renderResponse(
          response.status,
          response.statusText,
          await response.text(),
          durationMs,
        )
        announce(
          t('tryit.responseAnnounce', {
            status: [response.status, response.statusText].filter(Boolean).join(' '),
            ms: durationMs,
          }),
        )
      }
    } catch (err) {
      const durationMs = Math.round(performance.now() - startedAt)
      console.error('[api-doc] webhook simulator fetch failed:', err)
      this.#renderNetworkError(
        `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
        target.href,
        durationMs,
      )
      announce(t('tryit.networkFail'))
    } finally {
      this.#sending = false
      this.#ui.status.replaceChildren()
    }
  }

  // Same presentation as the try-it: the facts first (raw error, request,
  // duration), then the help. A receiver without CORS is the nominal case here — the
  // proxy hint is therefore shown as soon as a proxy is configured.
  #renderNetworkError(error, requestedUrl, durationMs) {
    const facts = el(
      'div',
      'flex flex-col gap-1',
      el('span', 'font-bold', text(t('tryit.networkFail'))),
      el('code', 'font-mono break-all', text(error)),
      el(
        'code',
        'font-mono break-all text-quiet',
        text(`${this.#op.method.toUpperCase()} ${requestedUrl} — ${durationMs} ms`),
      ),
    )
    const factsBox = el('div', 'alert alert-error text-xs py-2 items-start', facts)
    factsBox.setAttribute('role', 'alert')
    const messages = [factsBox, alertBox('alert-info', t('tryit.networkFailHelp'))]
    if (this.#proxyUrl && !this.#state.proxyOn)
      messages.push(alertBox('alert-info', t('tryit.corsProxyHint')))
    if (!this.#state.fireAndForget && isNoCorsMethod(this.#op.method))
      messages.push(alertBox('alert-info', t('webhook.fireAndForgetHint')))
    this.#ui.response.replaceChildren(...messages)
  }

  #renderOpaqueDelivery(requestedUrl, durationMs) {
    const box = el(
      'div',
      'alert alert-success text-xs py-2 items-start',
      el(
        'div',
        'flex flex-col gap-1',
        el('span', 'font-bold', text(t('webhook.sentOpaque'))),
        el(
          'code',
          'font-mono break-all text-quiet',
          text(`${this.#op.method.toUpperCase()} ${requestedUrl} — ${durationMs} ms`),
        ),
        el('span', 'text-quiet', text(t('webhook.sentOpaqueHelp'))),
      ),
    )
    box.setAttribute('role', 'status')
    this.#ui.response.replaceChildren(box)
  }

  #renderResponse(status, statusText, bodyText, durationMs) {
    const pill = STATUS_PILL[String(status)[0]] ?? STATUS_PILL.default
    const header = el(
      'div',
      'flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-white/10',
      el(
        'span',
        'text-[11px] font-semibold uppercase tracking-wide text-white/70',
        text(t('tryit.response')),
      ),
      el(
        'span',
        `rounded-full px-2 py-0.5 text-[11px] font-mono font-bold ${pill}`,
        text(`${status} ${statusText ?? ''}`.trim()),
      ),
      el('span', 'text-[11px] text-white/60', text(t('tryit.duration', { ms: durationMs }))),
    )
    const pretty = prettyJson(bodyText)
    const panel = responseBody(pretty ?? bodyText, pretty !== null)
    this.#ui.response.replaceChildren(
      el('div', 'api-code-panel overflow-hidden mt-1', header, panel),
    )
  }
}

// Content-Type inferred from the media type, then the headers declared by the webhook
// (signature, etc.), pre-filled with their example if it exists.
function initialHeaderRows(op, content) {
  const rows = []
  if (content?.mediaType) rows.push({ name: 'Content-Type', value: content.mediaType })
  for (const param of op.parameters.filter((p) => p.in === 'header')) {
    const example = displayableExample(param.examples)?.value
    rows.push({ name: param.name, value: example !== undefined ? String(example) : '' })
  }
  return rows
}

// Same fixed pills as the try-it panel (off-theme navy background, rule 2).
if (!customElements.get('api-webhook-simulator'))
  customElements.define('api-webhook-simulator', ApiWebhookSimulator)
