import { referencedVariables } from '../env/interpolate.js'
import { parseBodyTemplate, stringifyBodyTemplate } from '../env/json-template.js'
import { toCurl } from '../export/curl.js'
import { encodeShareState } from '../export/share.js'
import { stepRequestFromState } from '../scenarios/capture.js'
import { CURL_TARGET, SNIPPET_LANGUAGES } from '../export/snippets.js'
import { t } from '../i18n/index.js'
import {
  applicableSchemes,
  buildAuthInjection,
  credentialsStatus,
  suggestedVariables,
} from '../openapi/auth.js'
import { fileBodyLabel } from '../openapi/body-kind.js'
import { isMultiValue, isObjectValue } from '../openapi/params.js'
import { prefilledValues } from '../openapi/prefill.js'
import {
  buildRequest,
  effectiveBaseUrl,
  extractPathValues,
  extractQueryValues,
} from '../openapi/request-builder.js'
import { applyResult, historyEntry, send } from '../openapi/send.js'
import { opShareHash } from '../router.js'
import { rememberHeader } from '../storage/header-memory.js'
import { readPref, writePref } from '../storage/prefs.js'
import { announce } from './a11y.js'
import { platformNotes, schemeLocation, schemeTypeLabel } from './auth-labels.js'
import { hoverCopyButton } from './copy-button.js'
import { credentialsForm } from './credentials-form.js'
import { el, icon, text } from './dom.js'
import { oauthBlock } from './oauth-block.js'
import { exportBar } from './export-bar.js'
import { highlightSource } from './markdown.js'
import { methodBadgeClass } from './method-colors.js'
import { captureButton } from './scenario-capture.js'
import { leafField, paramField } from './schema-editors.js'
import { createSendMeter } from './send-meter.js'
import { SEND_SVG } from './icons.js'
import { acceptAttribute, bodyStateFor, buildHeaderRows } from './try-it/body-state.js'
import { createResponseView } from './try-it/response-view.js'
import { alertBox, copyIconButton, labeledBlock, proxyToggle } from './try-it/view-bits.js'

// Snippet targets of the language row, in selector order: cURL then the
// generators, each with the short mark its tile shows (SNIPPET_LANGUAGES).
const SNIPPET_TARGETS = [
  ['curl', CURL_TARGET.mark],
  ...Object.entries(SNIPPET_LANGUAGES).map(([key, { mark }]) => [key, mark]),
]

// Classes of a language tile, by state. Static strings (rule 2), and the one
// place the row's active treatment is described.
const TILE_CLASS = {
  on: 'btn btn-xs font-mono btn-primary btn-soft',
  off: 'btn btn-xs font-mono btn-ghost border border-base-300 text-subtle font-normal',
}

// "Try it" panel (docs/architecture.md §5.5): parameters/headers/body editing, env + auth
// injection, live cURL preview, real fetch send, auto-write to history.
//
// Focus anti-pitfall (cf. env-manager): the skeleton is built once per
// operation; inputs update the state and refresh only the derived areas
// (cURL preview, highlighting, response), never the fields themselves.
class ApiTryItPanel extends HTMLElement {
  #op = null
  #model = null
  #envStore = null
  // Resolvable variables: the environment merged with the host overlay
  // (src/env/variables.js), set by the shell.
  #vars = null
  #history = null
  #proxyUrl = null
  #requestCredentials = 'same-origin'
  #fallbackBaseUrl = ''
  #onManageEnv = null
  #oauthClientIds = {}
  #notify = null
  #onOpenHistory = null
  // { list, add } provided by the shell: capture of the current step in a
  // scenario (docs/scenarios.md §5.4).
  #capture = null
  // Run scope overlay during a step-by-step (§2): values extracted at
  // previous steps overlay the environment variables. Fields still
  // display {{var}} — only the resolution changes.
  #runVariables = {}
  // Optional decoration of the history entry, set by the shell:
  // (entry, op) => fields to merge (or null). This is how the step-by-step
  // tags its sends — the panel doesn't need to know what a scenario is.
  #entryDecorator = null
  #state = null
  #ui = {}
  // Credential write coming from the cartouche itself: the store's change
  // event must not reset to a blank panel, the request being prepared
  // (body, params) would be lost on every field filled in.
  #writingCredential = false
  // Everything below the send button (runs bar, example mockup, response,
  // network failure) and the state of what is being looked at. Built here
  // rather than in `set context` so nothing depends on construction order:
  // every dependency it takes is a callback.
  #responseView = createResponseView({
    host: this,
    op: () => this.#op,
    history: () => this.#history,
    envStore: () => this.#envStore,
    proxyUrl: () => this.#proxyUrl,
    proxyOn: () => this.#state.proxyOn,
    container: () => this.#ui.response,
    onOpenHistory: () => this.#onOpenHistory,
    snapshotDraft: () => this.snapshotDraft(),
    loadEntry: (entry) => this.loadEntry(entry),
    restoreDraft: (draft) => this.restoreDraft(draft),
    sendStored: (built) => this.#dispatch(built),
  })
  // Live snippet language (competitive analysis, prio 1): global
  // preference, not per operation — the docs are read in a single language.
  #snippetLang = readPref('snippetLang', 'curl')

  // Set after the context (the shell needs the stores to build it) but
  // before the first render, triggered by the route.
  set capture(capture) {
    this.#capture = capture ?? null
  }

  // A scenario holds the panel (step-by-step or step editing): the banner
  // placed just above already names this scenario and states the current
  // step. "Add to a scenario" offered to pick another one — a question
  // nobody asks at this point, and whose most likely answer would have
  // been a duplicate. Both buttons disappear, and come back when leaving
  // the mode.
  set scenarioOwned(owned) {
    this.#scenarioOwned = !!owned
    this.#applyScenarioOwned()
  }

  #scenarioOwned = false

  // Hiding rather than rebuilding: a step-by-step changes state at every
  // step, and a full panel re-render on each one would carry away the focus.
  #applyScenarioOwned() {
    for (const details of this.querySelectorAll('[data-scenario-capture]')) {
      if (this.#scenarioOwned) details.open = false
      details.classList.toggle('hidden', this.#scenarioOwned)
    }
  }

  // --- control by the step-by-step controller (§5.3) ----------------------

  set runVariables(variables) {
    this.#runVariables = variables ?? {}
    if (this.#state && this.isConnected) this.#refresh()
  }

  // Read by autocompletion: what an ongoing step-by-step has already
  // extracted is resolvable in the fields, on the same footing as the
  // environment.
  get runVariables() {
    return this.#runVariables
  }

  set entryDecorator(decorate) {
    this.#entryDecorator = decorate ?? null
  }

  // Snapshot of what the user has entered, with the operation it describes.
  // A single list of fields for both uses of the draft: viewing an archived
  // call (internal) and the step-by-step (shell), which must survive an
  // operation change — hence the public export.
  snapshotDraft() {
    const s = this.#state
    if (!s || !this.#op) return null
    return {
      opId: this.#op.id,
      pathValues: { ...s.pathValues },
      queryValues: { ...s.queryValues },
      queryString: s.queryString,
      headerRows: s.headerRows.map((row) => ({ ...row })),
      body: s.body,
      mediaTypeIndex: s.mediaTypeIndex,
    }
  }

  // Only restores on the original operation: elsewhere, the values would
  // not describe the same request.
  restoreDraft(draft) {
    if (!draft || !this.#state || draft.opId !== this.#op?.id) return false
    const { opId, ...values } = draft
    Object.assign(this.#state, values)
    this.#render()
    return true
  }

  set context({
    model,
    envStore,
    variables,
    history,
    proxyUrl,
    requestCredentials,
    fallbackBaseUrl,
    onManageEnv,
    oauthClientIds,
    notify,
    onOpenHistory,
  }) {
    this.#model = model
    this.#envStore = envStore
    this.#vars = variables
    this.#history = history
    this.#proxyUrl = proxyUrl ?? null
    this.#requestCredentials = requestCredentials ?? 'same-origin'
    this.#fallbackBaseUrl = fallbackBaseUrl ?? ''
    this.#onManageEnv = onManageEnv ?? null
    this.#oauthClientIds = oauthClientIds ?? {}
    this.#notify = notify ?? null
    this.#onOpenHistory = onOpenHistory ?? null
    variables.addEventListener('change', (event) => {
      // A host fill changes no request the user is preparing: only the
      // cartouche and the derived areas follow. Resetting the panel here would
      // throw away a body typed while a boot fill was in flight.
      if (event.detail.origin === 'host') {
        if (!this.#state || !this.isConnected) return
        this.#ui.renderAuth?.()
        this.#refresh()
        return
      }
      // An environment change is a different environment: variables and
      // defaultHeaders both change, we start again from a clean panel (MVP
      // decision).
      if (this.#writingCredential) return
      if (this.#op && this.isConnected) this.#resetFromOp()
    })
    // The send writes to history after the response renders: this event is
    // what makes the run we just did appear in the list.
    history?.addEventListener('change', () => this.#responseView.refreshRuns())
  }

  get operationId() {
    return this.#op?.id ?? null
  }

  connectedCallback() {
    this.classList.add('block')
    if (this.#op && this.#model) this.#resetFromOp()
  }

  // Reloads a history entry for editing (docs/architecture.md §5.6). The stored request is
  // resolved: path params are re-extracted from the URL, the rest is taken
  // as-is — headers become manual rows, which override the auth injection
  // of the same name.
  loadEntry(entry) {
    if (!this.#op || !this.#state) return
    const url = entry.request?.url ?? ''
    this.#state.pathValues = extractPathValues(this.#op.path, url)
    this.#state.queryValues = extractQueryValues(url, this.#op) ?? this.#state.queryValues
    const headers = entry.request?.headers ?? {}
    this.#state.headerRows = (Array.isArray(headers) ? headers : Object.entries(headers)).map(
      ([name, value]) => ({ name, value }),
    )
    this.#loadEntryBody(entry.request)
    this.#render()
  }

  // A stored body is only reloadable when it IS the payload. A file body and
  // multipart parts leave a display line behind, not content: the editor
  // comes back empty on that side and the user re-picks. An urlencoded body
  // is text, but its editor is a field list — the pairs go back where they
  // came from rather than into a textarea nothing would read.
  #loadEntryBody(request) {
    if (request?.bodyFile || request?.form) return
    if (request?.body == null) return
    if (this.#state.bodyKind === 'urlencoded') {
      const params = new URLSearchParams(request.body)
      for (const field of this.#state.formFields ?? []) field.value = params.get(field.name) ?? ''
      return
    }
    this.#state.body = request.body
    this.#state.bodySource = 'text'
  }

  // --- request sharing via URL ------------------------------------------

  // Link encoding the editor's current state (#/op/{id}?req=…). Sensitive
  // environment values are re-templated back to {{var}} by
  // encodeShareState: never a secret in the link.
  shareUrl() {
    const s = this.#state
    const env = this.#envStore.selected()
    const encoded = encodeShareState(
      {
        path: s.pathValues,
        query: s.queryValues,
        headers: s.headerRows,
        // Bodies that are files (multipart parts, binary body) are not
        // shareable: the content only ever existed in this tab's memory.
        body: s.formFields || s.bodySource === 'file' ? null : s.body,
        mediaTypeIndex: s.mediaTypeIndex,
      },
      (env?.variables ?? []).filter((v) => v.sensitive),
    )
    const url = new URL(window.location.href)
    url.hash = opShareHash(this.#op.id, encoded)
    return url.href
  }

  // Template form of the request being prepared, ready to become a
  // scenario step. Same guarantee as `shareUrl()`: sensitive environment
  // variable values, if they were pasted in plain text, go back to
  // {{var}}.
  captureRequest() {
    const s = this.#state
    const env = this.#envStore.selected()
    return stepRequestFromState(
      {
        path: s.pathValues,
        query: s.queryValues,
        cookie: s.cookieValues,
        queryString: s.queryString,
        headers: s.headerRows,
        body: s.formFields || s.bodySource === 'file' ? null : s.body,
        mediaTypeIndex: s.mediaTypeIndex,
        // A file's content is never stored: only its name, which is enough
        // to mark the step "requires step-by-step".
        formFields: s.formFields?.map((f) => ({
          name: f.name,
          value: f.value,
          fileName: f.file?.name,
        })),
        bodyFileName: s.bodySource === 'file' ? s.bodyFile?.name : undefined,
      },
      (env?.variables ?? []).filter((v) => v.sensitive),
    )
  }

  // Deferred application: on first load the route is emitted before the
  // panel is mounted (state not yet built) — the payload waits for the
  // #resetFromOp triggered by connectedCallback.
  #pendingRequest = null

  // Single entry point for "load this request into the panel": share link,
  // scenario step, opening a step from its card. Operation and request
  // arrive together, for a single render — and the panel starts fresh: the
  // supplied request describes THIS request, not a delta on the previous
  // one. `variables` = run scope overlay (§2), unchanged if omitted.
  loadRequest({ op = null, request = null, variables = undefined } = {}) {
    if (variables !== undefined) this.#runVariables = variables ?? {}
    if (request) this.#pendingRequest = request
    if (op) this.#op = op
    if (this.#op && this.#model && this.isConnected) this.#resetFromOp()
  }

  #applyPendingRequest() {
    const shared = this.#pendingRequest
    if (!shared) return
    this.#pendingRequest = null
    const s = this.#state
    const contents = this.#op.requestBody?.contents ?? []
    if (contents[shared.mediaTypeIndex]) {
      s.mediaTypeIndex = shared.mediaTypeIndex
      Object.assign(s, bodyStateFor(contents[s.mediaTypeIndex]))
    }
    // An imported request names the scheme its credential belongs to. Without
    // it the panel would keep injecting the first applicable one and send the
    // token under a header the document never meant for it.
    if (shared.authSchemeName && s.security.schemes.some((x) => x.name === shared.authSchemeName)) {
      s.authSchemeName = shared.authSchemeName
    }
    // Pre-filled defaults (path) survive if the link doesn't cover them;
    // query and headers are replaced wholesale — the link describes THIS
    // request, same semantics as reloading a history entry.
    s.pathValues = { ...s.pathValues, ...shared.path }
    s.queryValues = { ...shared.query }
    // A scenario step also carries the raw query string (3.2); a v1 share
    // link does not — hence the presence check.
    if (typeof shared.queryString === 'string') s.queryString = shared.queryString
    if (shared.headers.length) s.headerRows = shared.headers.map((r) => ({ ...r }))
    if (shared.body != null && !s.formFields) {
      s.body = shared.body
      // A shared or captured body is text by definition — a file never
      // travels. Showing the picker instead would hide what just arrived.
      s.bodySource = 'text'
    }
    // Form fields: only text values are reloaded — a file's content is never
    // stored, and that's what reserves the step for the step-by-step
    // (docs/scenarios.md §2).
    for (const field of s.formFields ?? []) {
      const incoming = shared.formFields?.find((f) => f.name === field.name)
      if (incoming) field.value = incoming.value
    }
  }

  // --- state ----------------------------------------------------------------

  #resetFromOp() {
    const op = this.#op
    const env = this.#envStore.selected()
    const security = applicableSchemes(this.#model, op)
    const contents = op.requestBody?.contents ?? []
    this.#state = {
      security,
      authSchemeName: security.schemes[0]?.name ?? null,
      // Required parameters start on the value the schema declares for them
      // (prefill.js), so the first Send works without typing. Optional ones
      // are untouched: sending an explicit default ≠ leaving it to the server.
      pathValues: prefilledValues(op, 'path'),
      queryValues: prefilledValues(op, 'query'),
      // `in: cookie` parameters, kept in their own bucket: they leave as one
      // folded `Cookie` header, not as a query pair (T3 — the browser then
      // drops it, the cURL export does not).
      cookieValues: prefilledValues(op, 'cookie'),
      // Query parameters the user explicitly asked to send empty
      // (`allowEmptyValue`), by name. A separate set on purpose: the bucket
      // above stores values, and "" there has always meant "nothing to send".
      emptyValues: [],
      // 3.2 `in: querystring`: a single value for the whole string,
      // alongside (not instead of) classic query params — a schema can
      // legally declare both.
      queryString: '',
      headerRows: buildHeaderRows(env, op),
      mediaTypeIndex: 0,
      // Body editor shape (`bodyKind`, `formFields`, `bodyFile`,
      // `bodySource`, `body`): the media type decides, nothing below
      // re-derives it.
      ...bodyStateFor(contents[0]),
      proxyOn: false,
      sending: false,
      // Last sent entry (with response): the export applies to it; before
      // any send, it applies to the request being prepared.
      lastEntry: null,
    }
    this.#applyPendingRequest()
    this.#responseView.resetForOp()
    this.#render()
    this.#responseView.refreshRuns()
  }

  // The one place the run scope joins the shared source: both the build and
  // the credential status go through it — two divergent merges here would mean
  // a green cartouche over a request that can't send.
  #variables(env = this.#envStore.selected()) {
    return this.#vars.for(env, this.#runVariables)
  }

  // The scheme whose credentials the send injects. Read in four places — the
  // build, the auth summary, its detail and the missing-credential problem —
  // and every one of them means "whatever is selected right now".
  #scheme() {
    return this.#state.security.schemes.find((s) => s.name === this.#state.authSchemeName) ?? null
  }

  #build() {
    const op = this.#op
    const state = this.#state
    const env = this.#envStore.selected()
    // The run scope wins over the environment (§2): during a step-by-step,
    // the value just extracted takes priority over whatever was lingering
    // in the env.
    const variables = this.#variables(env)
    const scheme = this.#scheme()
    const content = op.requestBody?.contents?.[state.mediaTypeIndex]
    return buildRequest({
      op,
      baseUrl: env?.baseUrl || this.#fallbackBaseUrl,
      pathValues: state.pathValues,
      queryValues: state.queryValues,
      cookieValues: state.cookieValues,
      emptyValues: state.emptyValues,
      queryString: state.queryString,
      headerRows: state.headerRows,
      body: state.bodySource === 'file' ? '' : state.body,
      formFields:
        state.formFields?.map((f) => ({ name: f.name, value: f.value, fileName: f.file?.name })) ??
        null,
      // Metadata only: the File itself goes straight from here to `send`.
      file: state.bodySource === 'file' && state.bodyFile ? state.bodyFile : null,
      mediaType: content?.mediaType ?? null,
      bodySchema: content?.schema ?? null,
      encodings: content?.encodings ?? null,
      authInjection: scheme ? buildAuthInjection(scheme, variables) : null,
      variables,
    })
  }

  // --- editing from the central doc --------------------------------------

  // Mirror for the central doc: the panel is the source of truth, the doc
  // is just another view of the same editor. Pushed via the tryit-state
  // event on every refresh (pre-filled defaults included, e.g. _locale).
  currentValues() {
    const s = this.#state
    if (!s) return { path: {}, query: {}, cookie: {}, queryString: '', headers: [] }
    return {
      path: { ...s.pathValues },
      query: { ...s.queryValues },
      cookie: { ...s.cookieValues },
      queryString: s.queryString,
      headers: s.headerRows.map((r) => ({ ...r })),
      // Raw body: the doc extracts the value of each of its fields from it.
      // Without it, reloading a request (history, shared link) or editing
      // the snippet's JSON left the body fields on the previous values.
      body: s.formFields || s.bodySource === 'file' ? null : s.body,
      // A field-based or file body doesn't fit in that string: it mirrors by
      // value. A File in particular is an object no serialization could carry
      // — both views live in the same page and share the very same one.
      formFields:
        s.formFields?.map((f) => ({ name: f.name, value: f.value, file: f.file })) ?? null,
      bodyFile: s.bodySource === 'file' ? s.bodyFile : null,
      // The doc follows this: the media type decides which editor both views
      // show, so the two columns must never sit on different ones.
      mediaTypeIndex: s.mediaTypeIndex,
      // Which scheme the send will actually inject. A real choice of the
      // panel's, so it belongs in the mirror (rule 20): without it the doc
      // painted the same "configured" badge on every applicable scheme, and
      // the reader could not tell which credential was going to travel.
      authSchemeName: s.authSchemeName,
    }
  }

  // The doc pushes values via tryit-edit, the panel returns its state via
  // tryit-state: bidirectional sync, wired by the shell.
  applyDocEdit({ kind, location, name, path, value, file, index }) {
    if (!this.#state) return
    if (kind === 'body-media-type') {
      this.#setMediaType(index)
      return
    }
    if (kind === 'body-file') {
      this.#setBodyFile(name ?? null, file ?? null)
      return
    }
    if (kind === 'body') {
      const target = path ?? [name]
      // A field-based body has no JSON text to patch: the doc edits the very
      // same field list, addressed by its top-level name.
      const field = this.#state.formFields?.find((f) => f.name === target[0])
      if (field) {
        field.value = value == null ? '' : String(value)
        if (field.input) field.input.value = field.value
        this.#refresh()
        return
      }
      this.#setBodyPath(target, value)
      return
    }
    if (location === 'header') {
      this.#setHeader(name, value ?? '')
      return
    }
    if (location === 'querystring') {
      this.#state.queryString = value ?? ''
      this.#ui.paramInputs?.[`querystring:${name}`]?.setValue(this.#state.queryString)
      this.#refresh()
      return
    }
    const bucket =
      location === 'path'
        ? this.#state.pathValues
        : location === 'cookie'
          ? this.#state.cookieValues
          : this.#state.queryValues
    bucket[name] = value ?? ''
    this.#ui.paramInputs?.[`${location}:${name}`]?.setValue(bucket[name])
    this.#refresh()
  }

  // A file picked from the central doc. `name` = multipart part, `null` = the
  // whole binary body. The panel's own input can't be assigned (a file input
  // is read-only by design), so only its chip follows.
  #setBodyFile(name, file) {
    if (name === null) {
      // Guarded rather than trusted: a doc block still showing the previous
      // media type would otherwise push a whole-body file into a body made of
      // parts, where the builder gives the parts priority — the file would
      // then vanish without a word.
      if (this.#state.bodyKind !== 'binary') return
      const wasText = this.#state.bodySource !== 'file'
      this.#state.bodyFile = file
      this.#state.bodySource = 'file'
      // Coming back from the text editor is structural (the cURL mockup
      // loses its embedded textarea), hence a render rather than a refresh.
      if (wasText) {
        this.#render()
        return
      }
      this.#ui.syncBodyFileChip?.()
    } else {
      const field = this.#state.formFields?.find((f) => f.name === name)
      if (!field?.binary) return
      field.file = file
      field.syncFile?.()
    }
    this.#refresh()
  }

  // Single entry point for changing media type — the panel's own selector and
  // the central doc's both land here. The editor's whole shape changes with it
  // (JSON ↔ fields ↔ file), hence a render and not a refresh.
  #setMediaType(index) {
    const contents = this.#op.requestBody?.contents ?? []
    if (!contents[index] || index === this.#state.mediaTypeIndex) return
    this.#state.mediaTypeIndex = index
    Object.assign(this.#state, bodyStateFor(contents[index]))
    this.#render()
  }

  #setHeader(name, value) {
    const row = this.#state.headerRows.find((r) => r.name.toLowerCase() === name.toLowerCase())
    if (row) row.value = value
    else this.#state.headerRows.push({ name, value })
    rememberHeader(name, value)
    this.#ui.renderHeaderRows?.()
    this.#refresh()
  }

  // Writes a value at a key path of the JSON body (arrays always arrive as
  // a whole: never an index in the path). Empty path = whole body (body
  // schema whose root is an array).
  #setBodyPath(path, value) {
    if (!path.length) {
      this.#setBodyValue(value === undefined ? '' : JSON.stringify(value, null, 2))
      this.#refresh()
      return
    }
    const parsed = parseBodyTemplate(this.#state.body)
    // Invalid JSON body: don't destroy the manual input. A bare `{{var}}`
    // isn't one — it comes back out unquoted, as the author wrote it.
    if (!parsed && this.#state.body.trim()) return
    const obj = parsed?.value ?? {}
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return
    let node = obj
    for (const key of path.slice(0, -1)) {
      if (typeof node[key] !== 'object' || node[key] === null || Array.isArray(node[key])) {
        if (value === undefined) return // nothing to remove under an absent path
        node[key] = {}
      }
      node = node[key]
    }
    const leaf = path[path.length - 1]
    if (value === undefined) delete node[leaf]
    else node[leaf] = value
    this.#setBodyValue(stringifyBodyTemplate(obj, parsed?.bare))
    this.#refresh()
  }

  // --- rendering ---------------------------------------------------------------

  #render() {
    const op = this.#op
    this.#ui = { paramInputs: {} }
    // Starts fresh on every render: without this, fields from previous
    // operations pile up and the highlighting works on dead nodes.
    this.#varInputs = []
    this.#responseView.forgetLastRendered()

    const base = String(
      effectiveBaseUrl(op, this.#envStore.selected()?.baseUrl || this.#fallbackBaseUrl),
    ).replace(/\/+$/, '')
    // Kept as references: the send path refills them in place rather than
    // re-rendering the whole panel.
    this.#ui.alerts = el('div', 'flex flex-col gap-2')
    this.#ui.response = el('div', 'api-response-view')

    // The rail's order (docs/architecture.md §5.5): language row, then
    // credentials, then everything that edits the request, then the navy
    // request panel with the Send right under it — the response follows.
    const sections = [
      el(
        'div',
        'group flex flex-wrap items-center gap-2',
        el('span', methodBadgeClass(op.method, 'badge-sm'), text(op.method)),
        // Same hierarchy as the central doc (base URL as a dimmed reminder,
        // path emphasized) but in inline flow: the panel is too narrow to
        // truncate the base URL without reducing it to "htt…".
        el(
          'code',
          'text-xs font-mono min-w-0 grow break-all',
          base ? el('span', 'text-faint', text(base)) : null,
          el('span', 'font-semibold', text(op.path)),
        ),
        // Copies the URL actually sent: interpolated path params and query
        // string of the current state, not the displayed template.
        hoverCopyButton(() => this.#build().url),
        // "Add to a scenario" at the top of the column: at the bottom of
        // the panel, buried in the export bar, it was only visible after
        // scrolling through the whole response — i.e. after giving up
        // looking for it. The bottom keeps its own: it's the natural
        // gesture right after reading a satisfying response.
        this.#captureButton(),
      ),
      this.#languageRow(),
      this.#authSection(),
      this.#paramsSection('path', t('tryit.pathParams')),
      this.#paramsSection('query', t('tryit.queryParams')),
      this.#paramsSection('querystring', t('tryit.queryString')),
      this.#headersSection(),
      // After the headers, because that is where they end up: a cookie
      // parameter is folded into the `Cookie` header — and dropped by the
      // browser from there, which the section says out loud.
      this.#paramsSection('cookie', t('doc.params.cookie')),
      this.#formSection(),
      this.#binarySection(),
      this.#proxySection(),
      this.#curlSection(),
      this.#sendRow(),
      this.#ui.alerts,
      this.#ui.response,
      this.#exportSection(),
    ].filter(Boolean)

    this.replaceChildren(el('div', 'flex flex-col gap-3 text-sm', ...sections))
    // The mode survives the operation change: it's the panel that gets
    // rebuilt, not the run.
    this.#applyScenarioOwned()
    this.#refresh()
    this.#responseView.renderExample()
  }

  // Credentials cartouche: makes the effective auth
  // visible without opening the environments popup — chosen scheme,
  // resolved variables (sensitive values hidden), source environment,
  // access to management. The popup remains the full technical view
  // (editing, sensitive, reveal).
  //
  // Collapsible: complete credentials ⇒ collapsed onto a green status. The
  // state is derived from the variables, not from a success event — the
  // collapse after "Get a token" comes from the rebuild on env change
  // (including on return from a PKCE redirect, where the page was
  // reloaded).
  #authSection() {
    const { security } = this.#state
    if (!security.schemes.length) return null

    const select = el('select', 'select select-sm w-full')
    select.setAttribute('aria-label', t('tryit.auth'))
    if (security.optional) {
      const none = el('option', '', text(t('tryit.authNone')))
      none.value = ''
      select.append(none)
    }
    for (const scheme of security.schemes) {
      const option = el('option', '', text(scheme.name))
      option.value = scheme.name
      option.selected = scheme.name === this.#state.authSchemeName
      select.append(option)
    }

    const detail = el('div', 'flex flex-col gap-1')
    const status = el('span', '')
    // Status of the selected scheme in the summary (visible when
    // collapsed). Returns "ready" to decide the collapse's initial state.
    const renderStatus = () => {
      const scheme = this.#scheme()
      if (!scheme) {
        status.className = 'badge badge-ghost badge-sm'
        status.replaceChildren(text(t('tryit.authNone')))
        return true
      }
      const rows = credentialsStatus(scheme, this.#variables())
      const ready = rows.length > 0 && rows.every((row) => row.set)
      status.className = `badge ${ready ? 'badge-success' : 'badge-warning'} badge-soft badge-sm gap-1.5 whitespace-nowrap`
      status.replaceChildren(
        el('span', `status ${ready ? 'status-success' : 'status-warning'}`),
        text(t(ready ? 'tryit.authReady' : 'tryit.authIncomplete')),
      )
      return ready
    }
    const renderDetail = () => {
      const scheme = this.#scheme()
      if (!scheme) {
        detail.replaceChildren()
        return
      }
      const location = schemeLocation(scheme)
      detail.replaceChildren(
        el(
          'div',
          'flex flex-wrap items-center gap-2',
          el('span', 'badge badge-neutral badge-sm', text(schemeTypeLabel(scheme))),
          location ? el('span', 'text-xs text-subtle', text(location)) : null,
        ),
        // A construct the browser cannot execute (T3) says so where the
        // credential is entered, not only in the doc: this is the cartouche
        // whose green badge would otherwise promise a send that cannot happen.
        ...platformNotes(scheme).map((note) => el('p', 'text-xs text-subtle', text(note))),
        credentialsForm({
          scheme,
          envStore: this.#envStore,
          variables: this.#vars,
          save: (name, value, options) => {
            this.#writeCredential(name, value, options)
            renderStatus()
          },
        }),
      )
      // Executable OAuth flow: "Get a token" button under the credentials
      // status, the token arrives in auth.X as if it had been pasted by hand.
      const oauth = oauthBlock({
        scheme,
        model: this.#model,
        op: this.#op,
        envStore: this.#envStore,
        configClientId: this.#oauthClientIds[scheme.name] ?? null,
        notify: this.#notify,
      })
      if (oauth) detail.append(oauth)
    }
    select.addEventListener('change', () => {
      this.#state.authSchemeName = select.value || null
      renderDetail()
      renderStatus()
      this.#refresh()
    })
    renderDetail()
    // Host fills land here rather than in a full #render(): only this cartouche
    // reads the overlay, and rebuilding the whole panel would drop the request
    // being prepared. The collapse's open state is deliberately left alone —
    // it was the user's since the first render.
    this.#ui.renderAuth = () => {
      renderDetail()
      renderStatus()
    }

    const summary = el(
      'summary',
      'collapse-title p-3 pe-10 min-h-0 flex items-center gap-2',
      el('span', 'text-label uppercase text-subtle', text(t('tryit.auth'))),
      status,
    )
    // "Environments" is laid out on the summary row but lives OUTSIDE the
    // <summary>: a focusable control nested in a disclosure widget gets
    // swallowed into that widget's accessible name, and its own activation
    // fights the toggle. Absolutely positioned instead, with the summary's
    // end padding reserving the room it used to take as a flex child.
    let manage = null
    if (this.#onManageEnv) {
      manage = el(
        'button',
        'btn btn-ghost btn-xs absolute end-10 top-1/2 -translate-y-1/2',
        text(t('env.manage')),
      )
      manage.type = 'button'
      manage.addEventListener('click', () => this.#onManageEnv())
      summary.classList.remove('pe-10')
      summary.classList.add('pe-40')
    }

    const env = this.#envStore.selected()
    const envLine = el(
      'div',
      'text-[11px] text-faint',
      text(env ? t('tryit.credEnv', { name: env.name }) : t('tryit.credNoEnv')),
    )

    // The select is only justified if there's a choice to make.
    const hasChoice = security.schemes.length > 1 || security.optional
    const details = el(
      'details',
      'collapse collapse-arrow border border-base-300 bg-base-200/40',
      summary,
      el(
        'div',
        'collapse-content p-3 pt-0 flex flex-col gap-2',
        hasChoice ? select : null,
        detail,
        envLine,
      ),
    )
    details.open = !renderStatus()
    // A blocked send reopens it: the collapse is the user's to close, but a
    // field inside a closed <details> cannot take focus.
    this.#ui.authDetails = details
    return manage ? el('div', 'relative', details, manage) : details
  }

  // Writing a credential entered in the cartouche: the rebuild on
  // environment change is neutralized, only the derived areas (status,
  // preview, missing-variable warning) are refreshed — the field itself is
  // not rebuilt, the user can keep typing without interruption.
  #writeCredential(name, value, options) {
    const env = this.#envStore.selected()
    if (!env) return
    this.#writingCredential = true
    try {
      this.#envStore.setVariable(env.id, name, value, options)
    } finally {
      this.#writingCredential = false
    }
    this.#refresh()
  }

  #paramsSection(location, title) {
    const params = this.#op.parameters.filter((p) => p.in === location)
    if (!params.length) return null
    // `querystring` has no per-name bucket: the parameter IS the whole
    // string. A schema declaring several of them is invalid; the last
    // edited field wins, with no special handling.
    const isQueryString = location === 'querystring'
    const bucket =
      location === 'path'
        ? this.#state.pathValues
        : location === 'cookie'
          ? this.#state.cookieValues
          : this.#state.queryValues
    const read = (name) => (isQueryString ? this.#state.queryString : (bucket[name] ?? ''))
    const rows = params.map((param) => {
      // Select for enum or boolean params (e.g. `_locale`), rows for an
      // array, one field per property for an object, input otherwise.
      const structured = !isQueryString && (isMultiValue(param) || isObjectValue(param))
      const field = paramField(
        param.schema,
        param.name,
        () => {
          if (isQueryString) this.#state.queryString = field.getValue()
          else bucket[param.name] = field.getValue()
          this.#refresh()
        },
        { structured, param },
      )
      field.setValue(read(param.name))
      this.#trackVarField(field)
      this.#ui.paramInputs[`${location}:${param.name}`] = field
      const caption = el(
        'span',
        'flex items-center gap-1 text-xs',
        el('code', 'font-mono font-semibold', text(param.name)),
        param.required ? el('span', 'text-error', text('*')) : null,
        param.allowReserved
          ? el('span', 'badge badge-ghost badge-xs', text(t('doc.allowReserved')))
          : null,
      )
      // A <label> may only caption ONE control: a structured field gets a
      // plain container, its rows carry their own aria-label. `api-param` is
      // what keeps the shapes addressable as one — and the empty-value toggle
      // stays outside it, being a second control with a caption of its own.
      const row = el(
        field.multi ? 'div' : 'label',
        'api-param flex flex-col gap-1',
        caption,
        field.element,
      )
      if (!param.allowEmptyValue) return row
      return el('div', 'flex flex-col gap-1', row, this.#emptyValueToggle(param))
    })
    return labeledBlock(
      title,
      el(
        'div',
        'flex flex-col gap-2',
        // T3: a script cannot set `Cookie`. Said here, next to the fields it
        // applies to, and not only in the alert that follows a build — the
        // user is typing a value now.
        location === 'cookie'
          ? el('p', 'text-xs text-faint', text(t('tryit.cookieParamNote')))
          : null,
        ...rows,
      ),
    )
  }

  // `allowEmptyValue`: sending `?flag=` has to be asked for. An untouched
  // field means "don't send" and always will — the two are different requests,
  // and only the user knows which one they mean.
  #emptyValueToggle(param) {
    const box = el('input', 'checkbox checkbox-xs')
    box.type = 'checkbox'
    box.checked = this.#state.emptyValues.includes(param.name)
    box.addEventListener('change', () => {
      const kept = this.#state.emptyValues.filter((name) => name !== param.name)
      this.#state.emptyValues = box.checked ? [...kept, param.name] : kept
      this.#refresh()
    })
    return el(
      'label',
      'flex items-center gap-2 text-xs text-subtle cursor-pointer',
      box,
      el('span', '', text(t('tryit.sendEmpty'))),
    )
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
            // Renaming: the remembered entry follows the new name.
            rememberHeader(row.name, '')
            row.name = name.value
            rememberHeader(row.name, row.value)
            this.#refresh()
          })
          const value = el('input', 'input input-xs font-mono grow')
          value.type = 'text'
          value.setAttribute('aria-label', t('tryit.headerValue'))
          value.value = row.value
          value.addEventListener('input', () => {
            row.value = value.value
            rememberHeader(row.name, row.value)
            this.#refresh()
          })
          this.#trackVarInput(value, () => value.value)
          const remove = el('button', 'btn btn-ghost btn-xs px-1', text('✕'))
          remove.type = 'button'
          remove.addEventListener('click', () => {
            rememberHeader(row.name, '')
            this.#state.headerRows.splice(index, 1)
            renderRows()
            this.#refresh()
          })
          return el('div', 'flex items-center gap-1', name, value, remove)
        }),
      )
    }
    renderRows()
    this.#ui.renderHeaderRows = renderRows
    const add = el(
      'button',
      'btn btn-soft btn-primary btn-xs self-start',
      text(`+ ${t('tryit.addHeader')}`),
    )
    add.type = 'button'
    add.addEventListener('click', () => {
      this.#state.headerRows.push({ name: '', value: '' })
      renderRows()
    })
    // The auth injection is summarized read-only here (line updated in
    // #refresh) — a manual header of the same name overrides it.
    this.#ui.authSummary = el('div', 'text-xs font-mono text-faint break-all')
    return labeledBlock(
      t('tryit.headers'),
      el('div', 'flex flex-col gap-1', this.#ui.authSummary, rowsBox, add),
    )
  }

  // multipart/form-data and x-www-form-urlencoded bodies: one field per
  // schema property — file input for a multipart `format: binary`,
  // select/input otherwise. A file stays in memory (state), only its name
  // goes into the built request (cURL preview).
  #formSection() {
    const fields = this.#state.formFields
    if (!fields?.length) return null
    const rows = fields.map((field) =>
      el(
        'label',
        'flex flex-col gap-1',
        el(
          'span',
          'flex items-center gap-1 text-xs',
          el('code', 'font-mono font-semibold', text(field.name)),
          field.required ? el('span', 'text-error', text('*')) : null,
        ),
        field.binary ? this.#filePartControl(field) : this.#textPartControl(field),
      ),
    )
    return labeledBlock(t('doc.requestBody'), el('div', 'flex flex-col gap-2', ...rows))
  }

  #textPartControl(field) {
    const input = leafField(field.schema, field.name, () => {
      field.value = input.value
      this.#refresh()
    })
    input.value = field.value
    this.#trackVarInput(input, () => input.value)
    // Kept on the field so an edit coming from the central doc lands on the
    // visible input too, not just in the state.
    field.input = input
    return input
  }

  // A multipart file part. The chip is not decoration: a file input cannot be
  // assigned by script, so a part picked from the central doc could otherwise
  // only appear here as "no file chosen" — which reads as a broken sync.
  #filePartControl(field) {
    const input = el('input', 'file-input file-input-sm w-full')
    input.type = 'file'
    const chip = el('span', 'font-mono text-xs text-subtle break-all')
    field.syncFile = () => {
      chip.textContent = field.file ? fileBodyLabel(field.file) : t('tryit.bodyFileNone')
    }
    input.addEventListener('change', () => {
      field.file = input.files[0] ?? null
      field.syncFile()
      this.#refresh()
    })
    field.syncFile()
    return el('div', 'flex flex-col gap-1', input, chip)
  }

  // Binary body (`application/octet-stream`, `image/*`, or any schema saying
  // `format: binary`): a picker, because a file is what the endpoint takes.
  // Before this section such an endpoint offered a textarea and nothing else
  // — there was no way to send it anything at all.
  #binarySection() {
    const state = this.#state
    if (state.bodyKind !== 'binary') return null
    const content = this.#op.requestBody?.contents?.[state.mediaTypeIndex]

    const input = el('input', 'file-input file-input-sm w-full')
    input.type = 'file'
    const accept = acceptAttribute(content?.mediaType)
    if (accept) input.accept = accept
    input.setAttribute('aria-label', t('tryit.bodyFilePick'))

    const chip = el('span', 'font-mono text-xs text-subtle break-all min-w-0 grow')
    const clear = el('button', 'btn btn-ghost btn-xs shrink-0', text(t('tryit.bodyFileClear')))
    clear.type = 'button'
    const syncChip = () => {
      chip.textContent = state.bodyFile ? fileBodyLabel(state.bodyFile) : t('tryit.bodyFileNone')
      clear.classList.toggle('hidden', !state.bodyFile)
    }
    input.addEventListener('change', () => {
      state.bodyFile = input.files[0] ?? null
      syncChip()
      this.#refresh()
    })
    clear.addEventListener('click', () => {
      state.bodyFile = null
      // Resetting the value is what re-arms the change event: re-picking the
      // same file after clearing wouldn't fire one otherwise.
      input.value = ''
      syncChip()
      this.#refresh()
    })
    syncChip()
    this.#ui.bodyFileInput = input
    this.#ui.syncBodyFileChip = syncChip

    const filePane = el(
      'div',
      'flex flex-col gap-1',
      input,
      el('div', 'flex items-center gap-2', chip, clear),
    )
    return labeledBlock(
      t('doc.requestBody'),
      el(
        'div',
        'flex flex-col gap-2',
        this.#binarySourceToggle(),
        state.bodySource === 'file'
          ? filePane
          : // In text mode the editor is the one embedded in the cURL mockup
            // (same as a JSON body): repeating it here would give the same
            // state two carets.
            el('div', 'text-xs text-faint', text(t('tryit.bodyTextHint'))),
      ),
    )
  }

  // File ⇄ Text. A full re-render, not a refresh: the cURL mockup gains or
  // loses its embedded textarea, which is a structural change.
  #binarySourceToggle() {
    const group = el('div', 'join')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', t('tryit.bodySource'))
    for (const source of ['file', 'text']) {
      const active = this.#state.bodySource === source
      const label = source === 'file' ? t('tryit.bodySourceFile') : t('tryit.bodySourceText')
      const btn = el('button', `btn btn-xs join-item ${active ? 'btn-active' : ''}`, text(label))
      btn.type = 'button'
      btn.setAttribute('aria-pressed', String(active))
      btn.addEventListener('click', () => {
        if (this.#state.bodySource === source) return
        this.#state.bodySource = source
        this.#render()
      })
      group.append(btn)
    }
    return group
  }

  #captureTargets() {
    if (!this.#capture) return null
    return {
      ...this.#capture,
      getStep: () => ({ opId: this.#op.id, request: this.captureRequest() }),
    }
  }

  #captureButton() {
    const capture = this.#captureTargets()
    if (!capture) return null
    return captureButton(capture, capture.getStep, {
      classes: 'btn btn-xs btn-primary btn-soft gap-1',
      // Alignment carried by the <details> (the actual child of the flex
      // row), not by the <summary>: in a 384px column the path almost
      // always wraps, the button ends up alone on its own line — ms-auto
      // sticks it to the right instead of letting it drift under the method.
      dropdownClasses: 'dropdown-end dropdown-bottom shrink-0 ms-auto',
    })
  }

  // Export from the column: same formats as the history popup, plus the
  // share link (specific to try-it — it encodes the editor's state).
  #exportSection() {
    const bar = exportBar(() => this.#exportEntry(), {
      getShareUrl: () => this.shareUrl(),
      capture: this.#captureTargets(),
    })
    this.#ui.exportBar = bar
    return el('div', 'border-t border-base-300 pt-2', bar.element)
  }

  // Exportable entry: the last sent entry (request + response) if it
  // exists, otherwise an ephemeral entry built from the current state
  // (request only, never persisted).
  #exportEntry() {
    if (this.#state.lastEntry) return this.#state.lastEntry
    return historyEntry({ op: this.#op, env: this.#envStore.selected(), built: this.#build() })
  }

  #proxySection() {
    if (!this.#proxyUrl) return null
    return proxyToggle((on) => {
      this.#state.proxyOn = on
    })
  }

  #sendRow() {
    const sendIcon = icon(SEND_SVG, 'inline-flex')
    // Full-size primary CTA (the one big action of the rail); min-width so the
    // meter's growth never squeezes it into a chip mid-flight.
    const send = el('button', 'btn btn-primary min-w-32 gap-2', text(t('tryit.send')), sendIcon)
    send.type = 'button'
    send.addEventListener('click', () => this.#send())
    this.#ui.sendBtn = send
    // Revealed only while a request is in flight. Aborting through the send's
    // own AbortController: the sender already knows an abort is not a network
    // failure, so cancel costs no new pipeline.
    const cancel = el('button', 'btn btn-ghost', text(t('tryit.cancel')))
    cancel.type = 'button'
    cancel.hidden = true
    cancel.addEventListener('click', () => this.#ui.abort?.abort())
    this.#ui.cancelBtn = cancel
    this.#ui.meter = createSendMeter({ onSettled: () => this.#responseView.flashFreshStatus() })
    // `items-stretch`: the box takes exactly the button's height, without
    // having to hardcode `btn-sm`'s metrics.
    return el('div', 'flex items-stretch gap-3', send, cancel, this.#ui.meter.node)
  }

  // Language icon row (ReadMe grammar): one tile per snippet target, at the
  // top of the rail — the persisted choice (`snippetLang`) is unchanged, the
  // row replaces the select the navy header used to carry. The visible marks
  // are proper names (cURL, JS…), not UI strings: the accessible name is the
  // full export.format catalog label.
  #languageRow() {
    const row = el('div', 'flex flex-wrap gap-1.5')
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', t('tryit.language'))
    for (const [key, mark] of SNIPPET_TARGETS) {
      const btn = el('button', TILE_CLASS.off, text(mark))
      btn.type = 'button'
      btn.dataset.snippetLang = key
      btn.title = t(`export.format.${key}`)
      btn.setAttribute('aria-label', t(`export.format.${key}`))
      btn.addEventListener('click', () => this.#pickLanguage(key))
      row.append(btn)
    }
    this.#ui.languageRow = row
    this.#syncLanguageTiles()
    return labeledBlock(t('tryit.language'), row)
  }

  #syncLanguageTiles() {
    for (const btn of this.#ui.languageRow.children) {
      const active = btn.dataset.snippetLang === this.#snippetLang
      btn.className = active ? TILE_CLASS.on : TILE_CLASS.off
      btn.setAttribute('aria-pressed', String(active))
    }
  }

  // Only the cURL boundary changes the panel's STRUCTURE (cURL embeds the body
  // editor in the mockup, the others are read-only). Every other switch is a
  // regenerated snippet: a full #render() there would rebuild every editor and
  // drop the response the user just got, to change one code block.
  #pickLanguage(key) {
    if (this.#snippetLang === key) return
    const wasCurl = this.#snippetLang === 'curl'
    this.#snippetLang = key
    writePref('snippetLang', key)
    if (wasCurl || key === 'curl') {
      this.#render()
      return
    }
    this.#syncLanguageTiles()
    this.#refresh()
  }

  // Request mockup: in cURL, the body is edited directly in the panel
  // (the textarea lives INSIDE the mockup, prefix regenerated on every
  // refresh); in other languages the full snippet is read-only
  // (copy/edit the body by switching back to cURL).
  #curlSection() {
    const contents = this.#op.requestBody?.contents ?? []
    if (!SNIPPET_LANGUAGES[this.#snippetLang] && this.#snippetLang !== 'curl')
      this.#snippetLang = 'curl'
    this.#ui.curlPrefix = el('code', 'hljs text-xs whitespace-pre-wrap break-all block')

    const headerLeft = el(
      'div',
      'flex items-center gap-2 min-w-0',
      el('span', 'text-label uppercase text-white/60', text(t('tryit.request'))),
    )
    if (contents.length > 1) {
      const select = el(
        'select',
        'select select-xs w-auto font-mono bg-transparent! border-white/20',
      )
      select.setAttribute('aria-label', t('tryit.mediaType'))
      contents.forEach((content, i) => {
        const option = el('option', '', text(content.mediaType))
        option.value = String(i)
        option.selected = i === this.#state.mediaTypeIndex
        select.append(option)
      })
      select.addEventListener('change', () => this.#setMediaType(Number(select.value)))
      headerLeft.append(select)
    } else if (contents.length === 1) {
      headerLeft.append(
        el('span', 'text-[11px] font-mono text-white/60 truncate', text(contents[0].mediaType)),
      )
    }

    const copy = copyIconButton(() => this.#snippetSource(this.#build()))

    // No embedded editor when the body isn't text: the fields (multipart,
    // urlencoded) or the picker (binary) live in their own section, and the
    // mockup shows the full cURL read-only.
    const hasBodyEditor =
      contents.length > 0 &&
      !this.#state.formFields &&
      this.#state.bodySource === 'text' &&
      this.#snippetLang === 'curl'
    const box = el(
      'div',
      'api-code-panel overflow-hidden',
      el(
        'div',
        'flex items-center justify-between gap-2 px-3 py-1 border-b border-white/10',
        headerLeft,
        copy,
      ),
      el('pre', `px-3 pt-3 ${hasBodyEditor ? '' : 'pb-3'}`, this.#ui.curlPrefix),
    )
    if (hasBodyEditor) {
      box.append(
        this.#bodyEditor(),
        el('div', 'px-3 pb-3 text-xs font-mono text-white/70', text("'")),
      )
    }
    return box
  }

  // Body editor embedded in the mockup: transparent-text textarea
  // overlaid on the highlighted code (same font metrics) — the static
  // <pre> gives the block its height, the caret and input stay native.
  #bodyEditor() {
    this.#ui.bodyHighlight = el(
      'code',
      'hljs language-json text-xs whitespace-pre-wrap break-all block',
    )
    const ta = el(
      'textarea',
      'absolute inset-0 w-full h-full px-3 resize-none bg-transparent text-transparent font-mono text-xs whitespace-pre-wrap break-all outline-none',
    )
    ta.value = this.#state.body
    ta.spellcheck = false
    ta.addEventListener('input', () => {
      this.#state.body = ta.value
      this.#syncBodyHighlight()
      this.#refresh()
    })
    this.#trackVarInput(ta, () => ta.value)
    this.#ui.bodyTextarea = ta
    const wrap = el('div', 'relative', el('pre', 'px-3', this.#ui.bodyHighlight), ta)
    this.#syncBodyHighlight()
    return wrap
  }

  #syncBodyHighlight() {
    if (!this.#ui.bodyHighlight) return
    const body = this.#state.body ?? ''
    const mediaType = this.#op.requestBody?.contents?.[this.#state.mediaTypeIndex]?.mediaType ?? ''
    // Trailing \n: reserves the last empty line that <pre> wouldn't
    // render, otherwise the overlaid textarea overflows its background.
    if (/json/i.test(mediaType))
      this.#ui.bodyHighlight.innerHTML = highlightSource(`${body}\n`, 'json')
    else this.#ui.bodyHighlight.textContent = `${body}\n`
  }

  // Single entry point to change the body programmatically (doc editing,
  // media type, history): state + textarea + highlighting.
  #setBodyValue(value) {
    this.#state.body = value
    if (this.#ui.bodyTextarea) this.#ui.bodyTextarea.value = value
    this.#syncBodyHighlight()
  }

  // --- derived refresh (preview, highlighting) ------------------------

  // Fields whose value can reference a {{variable}}. Stored as providers,
  // not as inputs: a multi-value parameter field gains and loses rows
  // between two renders, and each row is a field of its own.
  #varInputs = []
  #trackVarInput(input, getValue) {
    this.#varInputs.push(() => [{ input, getValue }])
  }

  #trackVarField(field) {
    this.#varInputs.push(() => field.varInputs())
  }

  #varEntries() {
    return this.#varInputs.flatMap((provider) => provider())
  }

  // Full snippet in the selected language (copy + read-only display).
  #snippetSource(built) {
    if (this.#snippetLang === 'curl') return toCurl(built)
    return SNIPPET_LANGUAGES[this.#snippetLang].generate(built)
  }

  #refresh() {
    const built = this.#build()
    if (this.#ui.bodyTextarea) {
      // With the embedded body editor (cURL only), only the prefix
      // (method/URL/headers) is regenerated — the displayed body IS the editor.
      const prefix = toCurl({
        method: built.method,
        url: built.url,
        headers: built.headers,
        body: null,
      })
      this.#ui.curlPrefix.innerHTML = highlightSource(`${prefix} \\\n  --data '`, 'bash')
    } else {
      const hljsLang =
        this.#snippetLang === 'curl' ? 'bash' : SNIPPET_LANGUAGES[this.#snippetLang].hljs
      this.#ui.curlPrefix.innerHTML = highlightSource(this.#snippetSource(built), hljsLang)
    }
    const missing = new Set(built.missing)
    // Red highlighting: field whose value references a missing variable.
    for (const { input, getValue } of this.#varEntries()) {
      const refs = referencedVariables(getValue())
      input.classList.toggle(
        'input-error',
        refs.some((name) => missing.has(name)),
      )
    }
    // What auth actually injected, as the injection itself reports it — not
    // recognized back out of the finished request. Name-matching the headers
    // missed an `apiKey` in query entirely (it lands in the URL, so the
    // cartouche stayed empty while a credential was travelling) and claimed a
    // plain cookie parameter, which is folded into the very same `Cookie`
    // header the schemes use.
    if (this.#ui.authSummary) {
      const injected = built.authInjection
      const lines = [
        ...Object.entries(injected?.headers ?? {}).map(([n, v]) => `${n}: ${v}`),
        ...Object.entries(injected?.query ?? {}).map(([n, v]) => `?${n}=${v}`),
        ...Object.entries(injected?.cookies ?? {}).map(([n, v]) => `Cookie: ${n}=${v}`),
      ]
      this.#ui.authSummary.textContent = lines.join('\n')
    }
    this.#ui.exportBar?.refresh()
    this.dispatchEvent(new CustomEvent('tryit-state', { detail: this.currentValues() }))
    return built
  }

  // --- sending ---------------------------------------------------------------

  async #send() {
    const built = this.#refresh()
    this.#ui.alerts.replaceChildren()

    // Blocking: missing variable or validation error ⇒ no send, explicit
    // message (docs/architecture.md §5.3/§5.5 — never a literal {{var}} sent).
    const problems = []
    // A missing credential is a missing variable like any other, but naming
    // `auth.petstore` at someone about to make their first call explains
    // nothing: the cartouche is what they have to fill, so the message names
    // that and the focus goes there first.
    const credMissing = this.#missingCredentials(built)
    const varMissing = built.missing.filter((name) => !credMissing.includes(name))
    if (credMissing.length)
      problems.push(t('tryit.credentialsMissing', { scheme: this.#state.authSchemeName }))
    if (varMissing.length) problems.push(t('tryit.missingVars', { names: varMissing.join(', ') }))
    for (const error of built.errors) {
      if (error.code === 'path-param-missing')
        problems.push(t('tryit.pathParamMissing', { name: error.name }))
      if (error.code === 'body-invalid-json') problems.push(t('tryit.bodyInvalidJson'))
      if (error.code === 'body-file-missing') problems.push(t('tryit.bodyFileMissing'))
      if (error.code === 'body-missing-required')
        problems.push(t('tryit.bodyMissingRequired', { name: error.name }))
    }
    if (problems.length) {
      this.#ui.alerts.append(...problems.map((message) => alertBox('alert-error', message)))
      announce(problems.join(' — '))
      this.#focusFirstProblem(built, credMissing)
      return
    }
    if (built.hasCookies) this.#ui.alerts.append(alertBox('alert-warning', t('tryit.cookieNote')))

    // `rebuild` is what makes the 401 refresh-replay possible: only a send that
    // came from the form can be re-derived from the form after the overlay
    // changed. A send replayed from a stored entry has no such source.
    await this.#dispatch(built, {
      files: Object.fromEntries(
        (this.#state.formFields ?? []).filter((f) => f.file).map((f) => [f.name, f.file]),
      ),
      file: this.#state.bodySource === 'file' ? this.#state.bodyFile : null,
      rebuild: () => this.#build(),
    })
  }

  // Everything a send does once the request exists. The Send button builds that
  // request from the form; the response panel's insight actions build it from a
  // stored entry instead (docs/network-insights.md §4.2) — same pipeline, so
  // they leave ordinary history entries and render exactly like a manual send.
  // `note` prefixes this send's spoken outcome instead of being announced on
  // its own: the live region collapses two announcements made within its debounce
  // into one, and on a fast API the replay's response would silently erase the
  // sentence explaining why a second request went out.
  async #dispatch(built, { files = {}, file = null, rebuild = null, note = null } = {}) {
    this.#responseView.clearDraft()

    const env = this.#envStore.selected()
    const proxied = !!(this.#state.proxyOn && this.#proxyUrl)

    // Captured now: changing operation during a send rebuilds the panel,
    // and the driven box would otherwise be the new form's.
    const meter = this.#ui.meter
    // Disabling the button under the finger that just pressed it drops focus
    // on <body>: the keyboard restarts at the top of the document, and Orca
    // reads the whole page rather than the outcome. Cancel takes its place for
    // the flight and hands focus back when it disappears (below).
    const sendHadFocus = document.activeElement === this.#ui.sendBtn
    this.#ui.sendBtn.disabled = true
    const controller = new AbortController()
    this.#ui.abort = controller
    const cancelBtn = this.#ui.cancelBtn
    if (cancelBtn) {
      cancelBtn.hidden = false
      if (sendHadFocus) cancelBtn.focus()
    }

    const entry = historyEntry({ op: this.#op, env, built, proxied })
    Object.assign(entry, this.#entryDecorator?.(entry, this.#op) ?? {})
    // The object is mutated in place afterward: the export sees the
    // response as soon as it arrives.
    this.#state.lastEntry = entry
    this.#ui.exportBar?.refresh()

    const result = await send(built, {
      proxyUrl: this.#proxyUrl,
      proxyEnabled: this.#state.proxyOn,
      credentials: this.#requestCredentials,
      files,
      file,
      meter,
      signal: controller.signal,
    })
    applyResult(entry, result)
    // Re-enabled before the focus hand-back below, not at the end of the
    // method: focus() on a disabled button is a no-op, and the reader would
    // land on <body> — the very drop this whole round trip exists to avoid.
    this.#ui.sendBtn.disabled = false
    if (cancelBtn) {
      // The control disappears under the keyboard user who just pressed it:
      // hand focus back to Send instead of dropping it on the body.
      const hadFocus = document.activeElement === cancelBtn
      cancelBtn.hidden = true
      if (hadFocus) this.#ui.sendBtn.focus()
    }
    this.#ui.abort = null

    const spoken = (message) => announce([note, message].filter(Boolean).join(' — '))
    if (result.aborted) {
      // The user's own gesture, not an outcome: no response to render, no
      // network error to explain, and no history entry — nothing was received
      // and the reader asked for exactly that.
      this.#ui.alerts.append(alertBox('alert-info', t('tryit.canceled')))
      spoken(t('tryit.canceled'))
      return
    }
    if (result.error) {
      console.error('[api-doc] try-it fetch failed:', result.cause ?? result.error)
      this.#responseView.renderNetworkError(entry, result.url)
      spoken(this.#responseView.networkFailAnnouncement(entry))
    } else {
      this.#responseView.renderResponse(entry, { fresh: true })
      // The status pill and the meter are both visual: without this, a
      // screen reader user knows the send ended and nothing about how.
      spoken(
        t('tryit.responseAnnounce', {
          status: [entry.response.status, entry.response.statusText].filter(Boolean).join(' '),
          ms: entry.durationMs,
        }),
      )
    }

    // Auto-write to history (docs/architecture.md §5.5), including network failures.
    this.#history?.add(entry).catch((err) => console.error('[api-doc] history write failed:', err))

    // A host-credentials replay takes the event over: it dispatches from its
    // own send, which is the one that concluded (below).
    const replayed =
      rebuild && (await this.#retryExpiredHostCredentials(entry, built, rebuild, { files, file }))

    // The real Send button is also the step-by-step's clock: the scenario
    // controller waits for this event to apply extractions and verdict
    // (§5.3). Emitted after the history write, on `send.js`'s raw result —
    // exactly what the runner consumes. Exactly ONCE per Send: firing it for a
    // 401 the app is about to replay would have the controller judge the step
    // on an answer it deliberately did not accept.
    if (!replayed)
      this.dispatchEvent(new CustomEvent('tryit-response', { detail: { result, entry } }))
  }

  // 401 refresh + replay (host-credentials.md §5). Every condition is required,
  // and the order below is the cheap-first order: the overwhelming majority of
  // sends leave on the first test. Returns whether it replayed.
  //
  // The 401 has already rendered, been announced and been written to history
  // when we get here — the user sees the real answer first, and the replay is
  // an addition to it, never a substitution. The hard ×1 cap is `rebuild`: the
  // replay below dispatches without one, so it cannot reach here again.
  async #retryExpiredHostCredentials(entry, built, rebuild, { files, file }) {
    const host = this.#vars.host
    if (!host.hasProvider) return false
    // Exactly 401 — a 403 is an authorization verdict on valid credentials, and
    // refreshing a token would not change it. A network failure has no status
    // at all and is not one either.
    if (entry.response?.status !== 401) return false
    // A 401 on credentials the user typed is the user's business: only a
    // request the overlay actually fed is ours to refresh.
    if (!host.supplied(built.used)) return false

    if (!(await host.request('expired', this.#state.authSchemeName ?? undefined))) return false
    // The overlay moved: the same request, rebuilt, now carries the new
    // credentials. An ordinary send — its own history entry, its own response —
    // whose announcement carries the explanation with it.
    this.#ui.alerts.append(alertBox('alert-info', t('tryit.credHostRetried')))
    // No `rebuild`: that omission is the ×1 cap, not a missing capability.
    await this.#dispatch(rebuild(), { files, file, note: t('tryit.credHostRetried') })
    return true
  }

  // Credential variables of the selected scheme that the environment doesn't
  // resolve — the subset of `built.missing` the cartouche can fix.
  #missingCredentials(built) {
    const scheme = this.#scheme()
    if (!scheme) return []
    const names = new Set(suggestedVariables(scheme))
    return built.missing.filter((name) => names.has(name))
  }

  // A blocked send is only actionable if the user lands on what blocked it:
  // the alerts render at the bottom of the panel, the offending field can be
  // several screens above. Priority follows the order the problems are
  // reported in: credential, then missing variable, then path parameter, then
  // body.
  #focusFirstProblem(built, credMissing = []) {
    const credInput = credMissing.length
      ? this.#ui.authDetails?.querySelector(`[data-cred-var="${CSS.escape(credMissing[0])}"]`)
      : null
    if (credInput) {
      this.#ui.authDetails.open = true
      credInput.focus()
      return
    }
    const missing = new Set(built.missing)
    const withMissingVar = this.#varEntries().find(({ getValue }) =>
      referencedVariables(getValue()).some((name) => missing.has(name)),
    )?.input
    const fromError = built.errors
      .map((error) => {
        if (error.code === 'path-param-missing') return this.#ui.paramInputs[`path:${error.name}`]
        if (error.code === 'body-file-missing') return this.#ui.bodyFileInput
        return this.#ui.bodyTextarea
      })
      .find(Boolean)
    ;(withMissingVar ?? fromError)?.focus()
  }

  // Selects a status badge in the example mockup, from the central doc's
  // status tabs (wired by the shell).
  showResponseExample(status) {
    this.#responseView.showExample(status)
  }
}

if (!customElements.get('api-try-it-panel'))
  customElements.define('api-try-it-panel', ApiTryItPanel)
