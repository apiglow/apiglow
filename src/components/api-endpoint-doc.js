import { parseBodyTemplate } from '../env/json-template.js'
import { toEndpointMarkdown } from '../export/endpoint-markdown.js'
import { t } from '../i18n/index.js'
import { suggestedVariables } from '../openapi/auth.js'
import { bodyKind, isFieldsKind } from '../openapi/body-kind.js'
import { bodyPropKey, paramFieldKey, responseFieldKey, responsePropKey } from '../openapi/diff.js'
import { drivableFlows } from '../openapi/oauth.js'
import { displayableExample, exampleText, isExternalExample } from '../openapi/examples.js'
import { isMultiValue, isObjectValue } from '../openapi/params.js'
import { effectiveBaseUrl } from '../openapi/request-builder.js'
import { isXmlMedia } from '../openapi/sample-xml.js'
import { opHash } from '../router.js'
import { readHeaderMemory } from '../storage/header-memory.js'
import { linkTabPanel, wireTablist } from './a11y.js'
import { platformNotes, schemeLocation, schemeTypeLabel } from './auth-labels.js'
import { changeBadge, changeDot } from './change-badge.js'
import { confirmed, hoverCopyButton, writeClipboard } from './copy-button.js'
import { copyPageMenu } from './copy-page-menu.js'
import { el, externalLink, scrollToAnchor, text } from './dom.js'
import { externalDocsLink } from './external-docs.js'
import { pagerSection } from './pager.js'
import { ANCHOR_SVG, CHECK_SVG } from './icons.js'
import { highlightCode, markdownBlock, markdownInline } from './markdown.js'
import { methodBadgeClass, statusColorClass } from './method-colors.js'
import { fileEditor, paramField } from './schema-editors.js'
import {
  chipsLine,
  deprecatedMark,
  fieldName,
  fieldType,
  requiredMark,
  rowHead,
  schemaTree,
  typeLabel,
} from './schema-view.js'

// `querystring` (3.2): the entire query string described as a single
// parameter (JSONPath, GraphQL… — formats that don't break down into
// key/value pairs).
// Every one of them is also editable from the doc. A cookie parameter is
// edited like any other and leaves in a folded `Cookie` header; that the
// browser then drops it is stated where it bites (the panel's hint, the
// post-build alert and the cURL export, which does carry it) rather than by
// removing the field.
const PARAM_LOCATIONS = ['path', 'query', 'querystring', 'header', 'cookie']

// Doc body of an operation: method/path header, sanitized Markdown
// description, parameter tables by location, request body and responses
// by HTTP code with switcher (docs/architecture.md §5.2).
class ApiEndpointDoc extends HTMLElement {
  #op = null
  #security = null
  #baseUrl = ''
  #anchor = null
  // Async provider for llms-full.txt (whole doc), wired up by the shell —
  // the component knows neither the global model nor the config pages.
  #llmsFullExport = null
  // { prev, next }: neighboring operations in nav order, computed by
  // the shell. Setter without render: always set right before `operation`,
  // which triggers the render with both pieces of info consistent.
  #pager = null
  set pager(pager) {
    this.#pager = pager
  }
  // try-it fields of the doc, key `${in}:${name}` — filled in at render, resynced
  // from the panel state (source of truth) on every tryit-state.
  #paramInputs = {}
  // Editors for body properties, key = serialized path (cf. schema-view).
  #bodyEditors = {}
  // File pickers of the body, same keying — `[]` is the body itself (binary),
  // `["part"]` a multipart part. Kept apart from #bodyEditors: their value is
  // a File, not something a body text could ever be walked for.
  #bodyFileEditors = {}
  // { show(index) } of the request body's media type block. The panel owns the
  // selection; without this the two columns could document — and edit — two
  // different media types at once, which since body kinds is also two
  // different kinds of editor.
  #bodyMedia = {}
  // Marks the auth row of the scheme the panel will actually send, keyed by
  // scheme name. A registry rather than a re-render: the section is a
  // collapse whose open state is the reader's, and rebuilding it on every
  // state push would snap it shut under them.
  #authRows = {}
  // Widgets that decide which subtree exists (discriminated variants), same
  // keying as #bodyEditors. Applied before them: a switch rebuilds what they
  // point at.
  #bodyVariants = {}
  #tryItValues = null
  // Applying pushes values into widgets that may remount, and a remount asks
  // to be applied again. The pass is ordered so one is enough — this only
  // stops it from re-entering itself.
  #applying = false

  set operation(op) {
    this.#op = op
    this.#scheduleRender()
  }

  // Section anchor (#/op/{id}/{anchor}): scrolls once the doc has rendered.
  set anchor(anchor) {
    this.#anchor = anchor
    this.#scrollToAnchor()
  }

  // { schemes, optional } resolved by the shell via applicableSchemes() —
  // the component stays unaware of the global model.
  set security(security) {
    this.#security = security
    this.#scheduleRender()
  }

  // (scheme) => { envName } if the scheme's credentials are complete in
  // the selected environment, else null — provided by the shell, which
  // re-renders the doc on every environment change (via baseUrl).
  #credentialsResolver = null
  set credentialsResolver(resolver) {
    this.#credentialsResolver = resolver
    this.#scheduleRender()
  }

  // Base URL of the selected environment (provided by the shell), to
  // display the full URL as a reminder in front of the path.
  set baseUrl(url) {
    this.#baseUrl = url ?? ''
    this.#scheduleRender()
  }

  // { status, fields } of THIS operation in the local schema diff, or null.
  // Setter without render (like `pager`): the shell sets it right before
  // `operation`, which triggers the render with both pieces of info consistent.
  #changes = null
  set changes(changes) {
    this.#changes = changes ?? null
  }

  set llmsFullExport(provider) {
    this.#llmsFullExport = provider
    this.#scheduleRender()
  }

  // Provider of the API-wide MCP context for the hand-off items — the very one
  // the home card and the prose pages are given. A provider, not a value: its
  // base URL follows the selected environment (§5.14.1).
  #mcp = null
  set mcp(provider) {
    this.#mcp = provider ?? null
    this.#scheduleRender()
  }

  // Every navigation sets several of the setters above in a row (`operation`
  // then `security`, and an environment change adds `baseUrl`): rendering on
  // each one throws away a whole doc build — parameter tables, body editors,
  // responses — to build it again a line later. One microtask is enough for the
  // batch to have landed, and a setter that arrives alone still gets its render
  // from the same queue. `#render` clears the flag, so the synchronous render
  // of a first mount is not doubled by a pending one.
  #renderQueued = false
  #scheduleRender() {
    if (this.#renderQueued) return
    this.#renderQueued = true
    queueMicrotask(() => {
      if (!this.#renderQueued) return
      this.#renderQueued = false
      if (this.isConnected && this.#op) this.#render()
    })
  }

  connectedCallback() {
    // Same prose measure as the Markdown pages: past ~75 characters the
    // description lines stop being scannable, and the stacked parameter rows
    // read better narrow. The try-it rail lives outside this element and
    // keeps its own width.
    this.classList.add('block', 'max-w-3xl')
    if (this.#op) this.#render()
  }

  // Current state of the try-it panel, pushed by the shell: both views
  // (central doc and panel) always show the same values.
  syncTryItValues(values) {
    this.#tryItValues = values
    this.#applyTryItValues()
  }

  // The mirror contract, in order: every widget here derives from the panel's
  // state, and the ones that decide what the widgets BELOW them are go first
  // (media type → variant → fields). Getting that order wrong is not a
  // cosmetic bug: it fills editors that are about to be thrown away, and
  // leaves the survivors empty.
  #applyTryItValues() {
    const values = this.#tryItValues
    if (!values || this.#applying) return
    this.#applying = true
    try {
      this.#applyValues(values)
    } finally {
      this.#applying = false
    }
  }

  #applyValues(values) {
    // Before the fields: it decides nothing they hold, but it is the one row
    // the reader looks at to know whose credential travels.
    for (const [name, mark] of Object.entries(this.#authRows)) {
      mark(values.authSchemeName === name)
    }
    for (const [key, field] of Object.entries(this.#paramInputs)) {
      // Input in progress in THIS field (any of its rows for a multi-value one).
      if (field.element.contains(document.activeElement)) continue
      const location = key.slice(0, key.indexOf(':'))
      const name = key.slice(key.indexOf(':') + 1)
      let next
      if (location === 'header') {
        next = values.headers.find((r) => r.name.toLowerCase() === name.toLowerCase())?.value ?? ''
      } else if (location === 'querystring') {
        next = values.queryString ?? ''
      } else {
        // path / query / cookie: three buckets, one shape.
        next = values[location]?.[name] ?? ''
      }
      field.setValue(next)
    }
    // Before the fields: switching media type rebuilds them, so pushing values
    // first would fill editors that are about to be thrown away.
    if (values.mediaTypeIndex !== undefined) this.#bodyMedia.show?.(values.mediaTypeIndex)
    this.#applyBodyFiles(values)
    this.#applyBodyValues(values)
  }

  // File pickers, which no body text can carry: the panel hands over the File
  // objects themselves. Only their label follows — see `fileEditor`.
  #applyBodyFiles(values) {
    for (const [key, editor] of Object.entries(this.#bodyFileEditors)) {
      const path = JSON.parse(key)
      editor.setValue(
        path.length
          ? (values.formFields?.find((f) => f.name === path[0])?.file ?? null)
          : (values.bodyFile ?? null),
      )
    }
  }

  // A JSON body travels as text (that's what the panel edits): values are only
  // pushed into the fields if it's parsable — during an ongoing JSON input,
  // the intermediate state isn't representable, so we keep what's displayed.
  // A `{{var}}` used as a bare value (scenario step) doesn't make the body
  // unreadable: the field then shows the template, like a path parameter does.
  // A field-based body (multipart, urlencoded) skips all that: it arrives
  // already structured, one entry per top-level name.
  #applyBodyValues(values) {
    let body
    if (values.formFields) {
      body = Object.fromEntries(values.formFields.map((f) => [f.name, f.value]))
    } else if (values.body) {
      const parsed = parseBodyTemplate(values.body)
      if (!parsed) return
      body = parsed.value
    }
    const at = (key) => {
      let value = body
      for (const step of JSON.parse(key)) value = value?.[step]
      return value
    }
    // Variants first, and unconditionally on focus: the choice belongs to the
    // body, not to whoever happens to have the caret in the picker. Switching
    // rebuilds #bodyEditors, which is why it cannot wait for the next pass.
    for (const [key, picker] of Object.entries(this.#bodyVariants)) picker.setValue(at(key))
    for (const [key, editor] of Object.entries(this.#bodyEditors)) {
      if (editor.element.contains(document.activeElement)) continue // input in progress here
      editor.setValue(at(key))
    }
  }

  // Programmatic selection of a response status (sync from the try-it
  // example mockup) — without re-emitting an event.
  #responseSelect = null
  showResponseStatus(status) {
    this.#responseSelect?.(status)
  }

  // This browser's own last calls of this operation, pushed by the shell on
  // every history change. A send has to appear in the strip without the user
  // navigating away and back — hence a slot held at its place in the render,
  // filled and emptied here. Empty history fills nothing: no heading, no
  // "0 calls", nothing in the accessibility tree.
  #recentCalls = []
  #recentSlot = null
  set recentCalls(calls) {
    this.#recentCalls = calls ?? []
    this.#fillRecentSlot()
  }

  // Opens the history dialog on this operation. Wired by the shell.
  onOpenHistory = null

  #fillRecentSlot() {
    if (!this.#recentSlot || !this.#op) return
    const section =
      this.#recentCalls.length && this.onOpenHistory
        ? recentCallsSection(this.#op, this.#recentCalls, this.onOpenHistory)
        : null
    this.#recentSlot.replaceChildren(...(section ? [section] : []))
  }

  #render() {
    this.#renderQueued = false
    const op = this.#op
    this.#paramInputs = {}
    this.#bodyEditors = {}
    this.#bodyFileEditors = {}
    this.#bodyMedia = {}
    this.#authRows = {}
    this.#bodyVariants = {}
    this.#responseSelect = null
    this.#recentSlot = el('div')
    // Webhook: purely documentary render — no try-it fields (the right-hand
    // panel is the simulator, it doesn't listen to tryit-edit).
    const registry = op.kind === 'webhook' ? null : this.#paramInputs
    // Status of a field in the local schema diff — undefined when there's
    // no diff, or the element hasn't changed.
    const fieldStatus = (key) => this.#changes?.fields?.[key]
    // replaceChildren converts null into a "null" text node: filtering required.
    const sections = [
      headerSection(op, this.#baseUrl, {
        llmsFullExport: this.#llmsFullExport,
        mcp: this.#mcp,
        changeStatus: this.#changes?.status,
      }),
      authSection(this.#security, this.#credentialsResolver, this.#authRows),
      markdownBlock(op.description),
      ...parameterSections(op, registry, fieldStatus),
      requestBodySection(op, {
        editable: registry !== null,
        fieldStatus,
        bodyEditors: this.#bodyEditors,
        bodyFileEditors: this.#bodyFileEditors,
        bodyVariants: this.#bodyVariants,
        mediaRegistry: registry === null ? null : this.#bodyMedia,
        onEditorsChanged: () => this.#applyTryItValues(),
      }),
      responsesSection(
        op,
        (select) => {
          this.#responseSelect = select
        },
        fieldStatus,
      ),
      callbacksSection(op),
      this.#recentSlot,
      operationPager(this.#pager),
    ].filter(Boolean)
    this.replaceChildren(...sections)
    this.#fillRecentSlot()
    this.#applyTryItValues()
    this.#scrollToAnchor()
  }

  #scrollToAnchor() {
    if (!this.isConnected) return
    scrollToAnchor(this, this.#anchor)
  }
}

// Auth schemes applicable to the operation: type, location, conventional
// env variable (docs/architecture.md §5.4).
function authSection(security, credentialsResolver, authRows = {}) {
  if (!security?.schemes?.length) return null
  const statuses = security.schemes.map((scheme) => credentialsResolver?.(scheme) ?? null)
  const rows = security.schemes.map((scheme, index) => {
    const configured = statuses[index]
    const row = el(
      'div',
      'flex flex-wrap items-center gap-2 text-sm py-1',
      el('span', 'badge badge-neutral badge-sm', text(schemeTypeLabel(scheme))),
      scheme.bearerFormat
        ? el('span', 'badge badge-ghost badge-sm', text(scheme.bearerFormat))
        : null,
      // 3.2: a scheme can be marked deprecated (auth migration in progress).
      scheme.deprecated
        ? el('span', 'badge badge-warning badge-outline badge-sm', text(t('doc.deprecated')))
        : null,
      el('span', 'text-subtle', text(schemeLocation(scheme))),
      ...suggestedVariables(scheme).map((name) =>
        el('code', 'font-mono text-xs bg-base-200 rounded px-1', text(`{{${name}}}`)),
      ),
      configured ? configuredBadge(configured) : null,
    )
    const box = el('div', '', row)
    // Filled by the panel's state, never decided here: until the first push
    // no row is marked, which is exactly what the doc knows on its own.
    const active = el('span', 'badge badge-primary badge-soft badge-sm hidden')
    active.dataset.authActive = scheme.name
    active.append(text(t('auth.sent')))
    row.append(active)
    authRows[scheme.name] = (on) => active.classList.toggle('hidden', !on)
    if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
      // With an executable flow, the token is obtained from the try-it
      // Credentials cartouche; otherwise it still has to be pasted in by hand.
      const key = drivableFlows(scheme).length ? 'auth.oauthFlowNote' : 'auth.oauthNote'
      box.append(el('p', 'text-xs text-faint', text(t(key))))
    }
    for (const note of platformNotes(scheme)) {
      box.append(el('p', 'text-xs text-faint', text(note)))
    }
    const description = markdownInline(scheme.description)
    if (description) box.append(el('div', 'text-xs text-subtle', description))
    return box
  })
  // One configured scheme is enough to call the API (requirements are
  // alternatives): the panel then collapses onto the summary's green badge.
  const configured = statuses.find(Boolean) ?? null
  const details = el(
    'details',
    'group collapse collapse-arrow border border-base-300 bg-base-200/40 mb-block',
    el(
      'summary',
      'collapse-title p-4 pe-10 min-h-0 flex items-center gap-2',
      el('h2', 'text-label uppercase text-subtle', text(t('auth.title'))),
      security.optional ? el('span', 'badge badge-ghost badge-sm', text(t('auth.optional'))) : null,
      // Expanded, each scheme already carries its own badge: the summary's
      // is only used collapsed — never two badges visible at once.
      configured ? configuredBadge(configured, 'group-open:hidden') : null,
    ),
    el('div', 'collapse-content p-4 pt-0 flex flex-col', ...rows),
  )
  details.open = !configured
  return details
}

function configuredBadge(configured, extra = '') {
  return el(
    'span',
    `badge badge-success badge-soft badge-sm gap-1.5 whitespace-nowrap ${extra}`.trim(),
    el('span', 'status status-success'),
    text(t('auth.configured', { env: configured.envName })),
  )
}

// Title first, then verb + full URL: the env's base URL
// is only a dimmed reminder, the path stays the highlighted information.
// Webhook: no base URL (the call goes out to the integrator's server) —
// event name, dedicated badge and direction note.
function headerSection(op, baseUrl, { llmsFullExport = null, mcp = null, changeStatus = null }) {
  const isWebhook = op.kind === 'webhook'
  const base = isWebhook ? '' : String(effectiveBaseUrl(op, baseUrl)).replace(/\/+$/, '')
  // One derivation of the page's name, for the h1 and for the hand-off menu
  // alike: the raw view's header would otherwise drift from the `# …` of the
  // very Markdown it is displaying.
  const heading = op.summary || (isWebhook ? op.name : op.path)
  // Method + URL as one composed lockup: the pill and the address share a
  // quiet bordered field, so the line reads as a single object — the doc-side
  // echo of the try-it's URL bar.
  // The tight end padding is for the copy button's own hit area; a webhook has
  // no button (nothing to copy) and gets symmetric padding instead.
  const lockup = el(
    'div',
    `group inline-flex items-center gap-2 min-w-0 max-w-full rounded-field border border-base-300 bg-base-200/60 py-1.5 ${isWebhook ? 'px-2' : 'ps-2 pe-1'}`,
    el('span', methodBadgeClass(op.method, ''), text(op.method)),
    // The path is the information: if space is tight, the base URL (mere
    // reminder) truncates first (huge shrink factor + ellipsis),
    // the path keeps its place and falls back to break-all as a last resort.
    el(
      'code',
      'text-sm font-mono flex items-baseline min-w-0 max-w-full',
      base ? el('span', 'text-faint truncate shrink-[9999] min-w-10', text(base)) : null,
      el('span', 'font-semibold break-all min-w-0', text(isWebhook ? op.name : op.path)),
    ),
    // Webhook: no URL to copy (the call goes out to the integrator's
    // server), the event name isn't one.
    isWebhook ? null : hoverCopyButton(() => `${base}${op.path}`),
  )
  const header = el(
    'header',
    'mb-block',
    el(
      'div',
      'flex items-start justify-between gap-3',
      el('h1', 'font-display text-display', text(heading)),
      // The MCP context carries the environment's base URL, never `base`: an
      // operation-level server override belongs to that operation, and what is
      // being registered is the API.
      copyPageMenu({
        markdown: () => toEndpointMarkdown(op, { baseUrl: base }),
        title: heading,
        filename: `${op.id}.md`,
        promptKey: 'doc.llmPrompt',
        llmsFullExport,
        mcp,
      }),
    ),
    el(
      'div',
      'flex flex-wrap items-center gap-2 mt-3',
      lockup,
      isWebhook ? el('span', 'badge badge-info badge-outline', text(t('doc.webhook'))) : null,
      op.deprecated
        ? el('span', 'badge badge-warning badge-outline', text(t('doc.deprecated')))
        : null,
      changeBadge(changeStatus),
    ),
  )
  if (isWebhook) header.append(el('p', 'text-sm text-subtle mt-3', text(t('doc.webhookNote'))))
  const externalDocs = externalDocsLink(op.externalDocs, 'link link-primary text-sm gap-1')
  if (externalDocs) header.append(el('div', 'mt-3', externalDocs))
  return header
}

// Anchor icon to the left of the section title: copies the deep link
// #/op/{id}/{anchor}. Always visible (otherwise the feature is unguessable) but
// dimmed; full opacity on title hover. The -ms-1.5 offsets the button's padding
// to keep the title nearly aligned with the rest.
function anchorButton(op, anchorId) {
  const btn = el(
    'button',
    'btn btn-ghost btn-xs px-1 -ms-1.5 text-base-content/30 group-hover:text-base-content/60 hover:text-base-content! focus-visible:text-base-content transition-colors',
  )
  btn.type = 'button'
  btn.innerHTML = ANCHOR_SVG
  btn.title = t('doc.copyLink')
  btn.setAttribute('aria-label', t('doc.copyLink'))
  const confirm = confirmed((done) => {
    btn.innerHTML = done ? CHECK_SVG : ANCHOR_SVG
    btn.classList.toggle('text-success', done)
  })
  btn.addEventListener('click', async () => {
    const url = new URL(window.location.href)
    url.hash = opHash(op.id, anchorId)
    if (await writeClipboard(url.href)) confirm()
  })
  return btn
}

// Major content section (parameters by location, body, responses):
// separated by a thin rule, title + copyable anchor. titleExtras: badges
// displayed between the title and the anchor.
function docSection(op, anchorId, title, titleExtras, ...children) {
  const section = el(
    'section',
    'mt-section pt-block border-t border-base-300/70',
    el(
      'div',
      'group flex items-center gap-2 mb-row',
      anchorButton(op, anchorId),
      el('h2', 'font-display text-heading', text(title)),
      ...titleExtras,
    ),
    ...children,
  )
  section.id = anchorId
  return section
}

function parameterSections(op, inputRegistry, fieldStatus = () => undefined) {
  const sections = []
  for (const location of PARAM_LOCATIONS) {
    const params = op.parameters.filter((p) => p.in === location)
    if (!params.length) continue
    const list = el('ul')
    for (const param of params)
      list.append(parameterRow(param, inputRegistry, fieldStatus(paramFieldKey(param))))
    sections.push(docSection(op, `params-${location}`, t(`doc.params.${location}`), [], list))
  }
  return sections
}

// One stacked row per parameter: name, type and required on the head line,
// description, constraint chips and the mirror-editable field underneath —
// stacked rows (docs/architecture.md §5.2), which stay readable at any column
// width where the old 3-column table fought for it.
function parameterRow(param, inputRegistry, changeStatus) {
  const schema = param.schema
  const head = rowHead(
    fieldName(param.name),
    fieldType(schema),
    param.required ? requiredMark() : null,
    param.deprecated ? deprecatedMark() : null,
    // How the value is serialized, when the parameter says something the
    // defaults don't: both change what leaves the browser, and both are
    // invisible in the field itself.
    param.allowReserved
      ? el('span', 'badge badge-ghost badge-xs', text(t('doc.allowReserved')))
      : null,
    param.allowEmptyValue
      ? el('span', 'badge badge-ghost badge-xs', text(t('doc.allowEmptyValue')))
      : null,
    changeBadge(changeStatus),
  )
  const row = el('li', 'api-param-row py-row api-row', head)
  const description = markdownInline(param.description)
  if (description) row.append(el('div', 'text-sm mt-1', description))
  if (param.in === 'cookie') {
    row.append(el('div', 'text-xs text-faint mt-1', text(t('tryit.cookieParamNote'))))
  }
  // Field built before the chips: clickable enum values fill it,
  // but it displays after them (same logic as the body).
  // inputRegistry null = read-only doc (webhooks, callbacks).
  let field = null
  if (inputRegistry) {
    field = paramField(
      schema,
      t('doc.tryItField', { name: param.name }),
      () => {
        field.element.dispatchEvent(
          new CustomEvent('tryit-edit', {
            bubbles: true,
            detail: {
              kind: 'param',
              location: param.in,
              name: param.name,
              value: field.getValue(),
            },
          }),
        )
      },
      // Only path, query and cookie hold a structure in the panel state; a
      // header row is one string.
      {
        structured:
          param.in !== 'header' &&
          param.in !== 'querystring' &&
          (isMultiValue(param) || isObjectValue(param)),
        param,
      },
    )
  }
  const chips = chipsLine(schema, {
    // Enum chips only exist on a scalar schema (an array's enum sits on its
    // items): the pick always targets a single field.
    onEnumPick:
      field && !field.multi
        ? (value) => {
            field.element.value = String(value)
            // Replays the native event that leafField listens for: same path as
            // manual input (tryit-edit → panel → tryit-state).
            field.element.dispatchEvent(
              new Event(field.element.tagName === 'SELECT' ? 'change' : 'input'),
            )
          }
        : undefined,
  })
  if (chips) row.append(chips)
  const shownExample = displayableExample(param.examples)
  if (shownExample) {
    row.append(
      el(
        'div',
        'mt-1 text-xs text-subtle font-mono',
        text(`${t('doc.example')}: ${JSON.stringify(shownExample.value)}`),
      ),
    )
  }
  // try-it input directly from the doc: the value flows up to the panel via
  // the tryit-edit event (wired up by the shell).
  if (field) {
    field.element.classList.add('max-w-60', 'mt-2')
    inputRegistry[`${param.in}:${param.name}`] = field
    // Remembered headers (try-it session context) also pre-fill
    // the doc's field — same source as the right-hand panel, pending
    // the first tryit-state, which is authoritative.
    if (param.in === 'header') {
      field.setValue(readHeaderMemory()[param.name.toLowerCase()]?.value ?? '')
    }
    // The example declared at the parameter level takes precedence over the schema's.
    const example = shownExample?.value
    if (field.element.tagName === 'INPUT' && example !== undefined) {
      field.element.placeholder = typeof example === 'string' ? example : JSON.stringify(example)
    }
    row.append(field.element)
  }
  return row
}

function requestBodySection(
  op,
  {
    editable = true,
    fieldStatus = () => undefined,
    bodyEditors = null,
    bodyFileEditors = null,
    bodyVariants = null,
    mediaRegistry = null,
    onEditorsChanged = null,
  } = {},
) {
  const body = op.requestBody
  if (!body) return null
  const extras = body.required ? [requiredMark()] : []
  const section = docSection(op, 'body', t('doc.requestBody'), extras)
  const description = markdownInline(body.description)
  if (description) section.append(el('p', 'text-sm mb-2', description))
  section.append(
    mediaTypeBlock(body.contents, {
      editable,
      bodyEditors,
      bodyFileEditors,
      bodyVariants,
      mediaRegistry,
      onEditorsChanged,
      propStatus: (mediaType, name) => fieldStatus(bodyPropKey(mediaType, name)),
    }),
  )
  return section
}

// Content area per media type: select if several, schema + examples.
// editable: try-it input fields, on request bodies only — never on a
// response schema. Every body kind gets them, each in the shape it takes:
// fields on a JSON, multipart or urlencoded body, a picker on a file part or
// on a binary body. Only `text` (XML, plain) has nothing structured to offer
// and stays documentary.
function mediaTypeBlock(
  contents,
  {
    editable = false,
    propStatus = null,
    bodyEditors = null,
    bodyFileEditors = null,
    bodyVariants = null,
    mediaRegistry = null,
    onEditorsChanged = null,
  } = {},
) {
  const box = el('div')
  if (!contents.length) return box
  const content = el('div')
  const renderContent = (mt) => {
    const kind = bodyKind(mt)
    // The XML Object describes an XML document and nothing else: shown under
    // `application/json`, `<pet>` and "wrapped" describe a body the reader will
    // never send — and, the two variants of a body sharing one schema, they made
    // the selector look inert (the tree is otherwise identical).
    const xml = isXmlMedia(mt.mediaType)
    const options =
      editable && (kind === 'json' || isFieldsKind(kind))
        ? {
            xml,
            editable: true,
            editors: bodyEditors,
            variantPickers: bodyVariants,
            onEditorsChanged,
            // Only multipart can carry a file part; urlencoded degrades its
            // binary properties to text fields, like the try-it panel.
            ...(kind === 'multipart' ? { fileEditors: bodyFileEditors } : {}),
          }
        : { xml }
    // Media type change: the previous editors are detached, the
    // registry must start empty again (it's cleared, not replaced — the reference
    // is the component's).
    if (bodyEditors) for (const key of Object.keys(bodyEditors)) delete bodyEditors[key]
    if (bodyFileEditors) for (const key of Object.keys(bodyFileEditors)) delete bodyFileEditors[key]
    if (bodyVariants) for (const key of Object.keys(bodyVariants)) delete bodyVariants[key]
    // Marking of top-level properties (local changelog): the fingerprint
    // keys are per media type, so the function is bound to the one rendered.
    if (propStatus) options.changes = (name) => propStatus(mt.mediaType, name)
    // No card around the tree: the stacked rows carry their own separators,
    // and boxing them re-creates the boxes-in-boxes look the doc column is
    // built to avoid.
    content.replaceChildren()
    // Sequential media type (3.2): `itemSchema` describes one element of the stream.
    // Displayed first — it's the useful information; the `schema` of the whole
    // body, when it also exists, comes second.
    if (mt.itemSchema) {
      content.append(
        el('div', 'text-label uppercase text-subtle mb-1', text(t('doc.streamItem'))),
        schemaTree(mt.itemSchema, 0, options.changes ? { xml, changes: options.changes } : { xml }),
      )
    }
    if (!mt.itemSchema || mt.schema?.kind !== 'any')
      content.append(schemaTree(mt.schema, 0, options))
    // Binary body: the file IS the body, so the picker hangs off the block
    // itself — there is no property row to attach it to.
    if (editable && kind === 'binary' && bodyFileEditors) {
      content.append(fileEditor([], bodyFileEditors).element)
    }
    const encoding = encodingBlock(mt)
    if (encoding) content.append(encoding)
    for (const example of mt.examples ?? []) {
      const block = exampleBlock(example)
      if (block) content.append(block)
    }
  }
  let shownIndex = 0
  const show = (index) => {
    if (!contents[index] || index === shownIndex) return
    shownIndex = index
    if (select) select.value = String(index)
    renderContent(contents[index])
  }
  let select = null
  if (contents.length > 1) {
    select = el('select', 'select select-sm w-auto font-mono mb-2')
    select.setAttribute('aria-label', t('tryit.mediaType'))
    contents.forEach((mt, i) => {
      const option = el('option', '', text(mt.mediaType))
      option.value = String(i)
      select.append(option)
    })
    select.addEventListener('change', () => {
      const index = Number(select.value)
      // The panel stays the source of truth: it decides, re-renders its own
      // editor, and hands the index back through tryit-state — which is what
      // actually calls `show`. Picking here without telling it would leave
      // the two views editing two different bodies (and, since the media type
      // decides the editor, a file dropped into the wrong one).
      if (mediaRegistry) {
        select.dispatchEvent(
          new CustomEvent('tryit-edit', {
            bubbles: true,
            detail: { kind: 'body-media-type', index },
          }),
        )
      } else {
        show(index)
      }
    })
    box.append(select)
  } else {
    box.append(el('div', 'text-xs font-mono text-faint mb-2', text(contents[0].mediaType)))
  }
  box.append(content)
  renderContent(contents[0])
  if (mediaRegistry) mediaRegistry.show = show
  return box
}

// How each piece of a composite body is serialized. Invisible in the schema —
// two identical `string[]` properties can leave as `a,b` or as two repeated
// pairs depending on nothing but this object — so it gets its own block rather
// than a chip lost in a property row.
//
// The 3.2 positional forms are listed too, and only listed: `prefixEncoding`
// and `itemEncoding` address the items of an array-shaped body, which has no
// field editor to drive (see openapi-coverage.md). What they say is still what
// the endpoint expects, and a reader writing a client needs it.
function encodingBlock(mt) {
  const rows = [
    ...(mt.encodings ?? []).map((e) => [el('code', 'font-mono', text(e.property)), e]),
    ...(mt.prefixEncoding ?? []).map((e, i) => [el('code', 'font-mono', text(`[${i}]`)), e]),
    ...(mt.itemEncoding ? [[el('code', 'font-mono', text('[…]')), mt.itemEncoding]] : []),
  ]
  if (!rows.length) return null
  return el(
    'div',
    'mt-2',
    el('div', 'text-label uppercase text-subtle mb-1', text(t('doc.encoding'))),
    el(
      'ul',
      'text-xs flex flex-col gap-1',
      ...rows.map(([label, encoding]) =>
        el('li', 'flex flex-wrap items-center gap-2', label, ...encodingChips(encoding)),
      ),
    ),
  )
}

function encodingChips(encoding) {
  const chip = (label) => el('span', 'badge badge-ghost badge-xs', text(label))
  return [
    encoding.contentType ? chip(encoding.contentType) : null,
    chip(`${encoding.style}${encoding.explode ? ' · explode' : ''}`),
    encoding.allowReserved ? chip(t('doc.allowReserved')) : null,
    ...(encoding.headers ?? []).map((h) =>
      chip(h.value === undefined ? h.name : `${h.name}: ${h.value}`),
    ),
  ].filter(Boolean)
}

function exampleBlock(example) {
  const shown = exampleText(example)
  const url = isExternalExample(example) ? example.value : null
  if (!shown && !url) return null
  const label = example.name
    ? `${t('doc.example')} — ${example.name}${example.summary ? ` (${example.summary})` : ''}`
    : t('doc.example')
  const heading = el('div', 'text-xs font-semibold text-subtle mb-1', text(label))
  // An `externalValue` names a file on someone else's server. We do not fetch
  // it — a documentation page that retrieves whatever a schema points at is a
  // request-forgery surface — so it degrades to the link it is (rule 19),
  // rather than printing the URL where the reader expects the payload.
  if (!shown) {
    return el(
      'div',
      'mt-2',
      heading,
      el(
        'p',
        'text-xs text-subtle',
        text(`${t('doc.exampleExternal')} `),
        externalLink('link link-hover font-mono break-all', url, text(url)),
      ),
    )
  }
  // Highlighting only when we KNOW it's JSON — hljs auto-detection
  // on arbitrary strings colors things haphazardly.
  const code = el('code', shown.json ? 'language-json' : '', text(shown.text))
  // Not the uppercase micro-label: the example's own name rides in the line,
  // and case-folding data is not labeling it.
  const block = el(
    'div',
    'mt-2',
    heading,
    el('pre', 'bg-base-200 rounded-box p-3 text-xs overflow-x-auto', code),
  )
  if (shown.json) highlightCode(block)
  return block
}

// One declared chaining: the operation this response lets you call next, and
// the runtime expressions that feed it. The expressions are DOCUMENTATION —
// nothing here evaluates `$response.body#/id` against a real response, that is
// what a scenario does. A target we resolved gets a real link into the doc; one
// we cannot follow (external document, hidden operation, typo) shows what the
// schema declared, which is all we honestly know.
function linkRow(link) {
  const head = el(
    'div',
    'flex flex-wrap items-center gap-2',
    el('code', 'font-mono font-semibold text-sm', text(link.name)),
  )
  if (link.targetId) {
    const target = el('a', 'link link-primary text-xs', text(t('doc.linkTarget')))
    target.href = opHash(link.targetId)
    head.append(target)
  } else {
    const declared = link.operationId ?? link.operationRef
    if (declared) head.append(el('code', 'font-mono text-xs text-faint', text(declared)))
  }
  const row = el('div', 'py-1.5 api-row', head)
  const description = markdownInline(link.description)
  if (description) row.append(el('div', 'text-sm text-subtle mt-0.5', description))

  const expressions = [
    ...(link.parameters ?? []).map((p) => [p.name, p.expression]),
    ...(link.requestBody !== undefined ? [[t('doc.requestBody'), link.requestBody]] : []),
    ...(link.server ? [[t('doc.linkServer'), link.server.url]] : []),
  ]
  if (expressions.length) {
    row.append(
      el(
        'div',
        'flex flex-wrap gap-1 mt-1',
        ...expressions.map(([name, value]) =>
          el('span', 'badge badge-ghost badge-sm font-mono', text(`${name} = ${value}`)),
        ),
      ),
    )
  }
  return row
}

// Responses by HTTP code with switcher (tabs) — docs/architecture.md §5.2. registerSelect
// receives the programmatic selection function (sync with the try-it
// example mockup, without re-emitting — the loop is cut there).
function responsesSection(op, registerSelect = () => {}, fieldStatus = () => undefined) {
  if (!op.responses.length) return null
  const section = docSection(op, 'responses', t('doc.responses'), [])
  const tablist = el('div', 'tabs tabs-border')
  tablist.setAttribute('role', 'tablist')
  const panel = el('div', 'mt-3')

  const renderResponse = (response) => {
    panel.replaceChildren()
    // `summary` (3.2): short sentence, highlighted ahead of the description.
    if (response.summary)
      panel.append(el('p', 'text-sm font-semibold mb-1', text(response.summary)))
    const description = markdownInline(response.description)
    if (description) panel.append(el('p', 'text-sm mb-2', description))
    if (response.headers?.length) {
      panel.append(el('h4', 'text-label uppercase text-subtle mt-3 mb-1', text(t('doc.headers'))))
      for (const header of response.headers) {
        panel.append(
          el(
            'div',
            'flex flex-wrap items-center gap-2 text-sm py-1.5 api-row',
            el('code', 'font-mono font-semibold', text(header.name)),
            el('span', 'text-xs font-mono text-subtle', text(typeLabel(header.schema))),
            header.description
              ? el('span', 'text-subtle', markdownInline(header.description))
              : null,
          ),
        )
      }
    }
    if (response.links?.length) {
      panel.append(el('h4', 'text-label uppercase text-subtle mt-3 mb-1', text(t('doc.links'))))
      for (const link of response.links) panel.append(linkRow(link))
    }
    if (response.contents.length) {
      panel.append(
        el(
          'div',
          'mt-2',
          mediaTypeBlock(response.contents, {
            propStatus: (mediaType, name) =>
              fieldStatus(responsePropKey(response.status, mediaType, name)),
          }),
        ),
      )
    }
  }

  const indexByStatus = new Map()
  const tabs = op.responses.map((response, i) => {
    const tab = el(
      'button',
      `tab font-mono gap-1.5 ${statusColorClass(response.status)}`,
      text(response.status),
      // Dot rather than a text badge: the tab is narrow and its label (the
      // HTTP code) must stay readable at a glance.
      changeDot(fieldStatus(responseFieldKey(response.status))),
    )
    tab.type = 'button'
    indexByStatus.set(String(response.status), i)
    tablist.append(tab)
    return tab
  })

  const show = (index) => {
    for (const sibling of tabs) sibling.classList.remove('tab-active')
    tabs[index].classList.add('tab-active')
    activate(index)
    renderResponse(op.responses[index])
  }
  // Programmatic selection (sync with the try-it example mockup): same path
  // as a click minus the event, so the tab order and ARIA state stay in step.
  const select = (status, { emit = false } = {}) => {
    const index = indexByStatus.get(String(status))
    if (index === undefined) return
    show(index)
    if (emit) {
      section.dispatchEvent(
        new CustomEvent('tryit-response-status', {
          bubbles: true,
          detail: { status: String(status) },
        }),
      )
    }
  }
  const activate = wireTablist(tablist, tabs, (index) =>
    select(op.responses[index].status, { emit: true }),
  )
  linkTabPanel(tabs, panel)
  registerSelect(select)

  section.append(tablist, panel)
  show(0)
  return section
}

// OpenAPI callbacks of the operation: the API calls back the URL provided by the
// client (runtime expression) — purely documentary render, no try-it. The
// listed responses are the ones expected FROM the integrator's server: status
// + description are enough, their schemas hold no interest doc-side.
function callbacksSection(op) {
  if (!op.callbacks?.length) return null
  const section = docSection(op, 'callbacks', t('doc.callbacks'), [])
  section.append(el('p', 'text-sm text-subtle mb-2', text(t('doc.callbackNote'))))
  for (const callback of op.callbacks) {
    const body = el(
      'div',
      'card-body p-4 gap-2',
      el('h3', 'text-base font-bold font-mono', text(callback.name)),
    )
    for (const { expression, operations } of callback.expressions) {
      for (const cbOp of operations) {
        body.append(
          el(
            'div',
            'flex flex-wrap items-center gap-2',
            el('span', methodBadgeClass(cbOp.method, 'badge-sm'), text(cbOp.method)),
            el('code', 'text-sm font-mono break-all', text(expression)),
            cbOp.summary ? el('span', 'text-sm text-subtle', text(cbOp.summary)) : null,
          ),
        )
        const description = markdownInline(cbOp.description)
        if (description) body.append(el('div', 'text-sm', description))
        if (cbOp.requestBody?.contents?.length) {
          body.append(
            el('h4', 'text-sm font-semibold mt-1', text(t('doc.requestBody'))),
            mediaTypeBlock(cbOp.requestBody.contents),
          )
        }
        if (cbOp.responses.length) {
          body.append(el('h4', 'text-sm font-semibold mt-1', text(t('doc.callbackResponses'))))
          for (const response of cbOp.responses) {
            body.append(
              el(
                'div',
                'flex flex-wrap items-center gap-2 text-sm py-0.5',
                el(
                  'code',
                  `font-mono text-xs font-bold ${statusColorClass(response.status)}`,
                  text(response.status),
                ),
                response.description
                  ? el('span', 'text-subtle', markdownInline(response.description))
                  : null,
              ),
            )
          }
        }
      }
    }
    section.append(el('div', 'card card-border border-base-300 bg-base-200/30 mt-3', body))
  }
  return section
}

// Sequential footer navigation: previous operation on the left, next on the
// right, in nav order. Label = the operation's summary; falls back to the
// Previous/Next words when it has no name (path only). The bar itself is the
// shared one — docs pages render the same contract (components/pager.js).
const PAGER_LABELS = { prev: 'doc.prevOp', next: 'doc.nextOp', section: 'doc.pager' }

// This browser's last calls of the endpoint (docs/architecture.md §5.6). The
// local scope is stated in the label rather than implied: a hosted tool shows
// the same strip from server-side telemetry across every reader, and a visitor who read
// theirs would otherwise take ours for the same thing.
function recentCallsSection(op, calls, onOpenHistory) {
  const open = el('button', 'btn btn-ghost btn-xs', text(t('doc.recentOpen')))
  open.type = 'button'
  open.dataset.openHistory = ''
  open.addEventListener('click', () => onOpenHistory(op.id))
  const section = docSection(op, 'recent', t('doc.recent'), [])
  section.append(
    el('p', 'text-sm text-subtle mb-row', text(t('doc.recentNote'))),
    el(
      'ul',
      'text-sm',
      ...calls.map((call) =>
        el(
          'li',
          'flex flex-wrap items-baseline gap-x-3 py-1.5 api-row',
          el(
            'span',
            'font-mono text-xs text-subtle tabular-nums',
            text(new Date(call.timestamp).toLocaleString()),
          ),
          el(
            'span',
            `font-mono font-semibold ${statusColorClass(call.response?.status)}`,
            // No response at all: the send failed at network level, and an
            // empty cell would read as a status we forgot to store.
            text(call.response?.status ? String(call.response.status) : t('doc.recentFailed')),
          ),
          call.durationMs != null
            ? el('span', 'text-xs text-faint tabular-nums', text(`${call.durationMs} ms`))
            : null,
          call.envName ? el('span', 'text-xs text-faint truncate', text(call.envName)) : null,
        ),
      ),
    ),
    el('div', 'mt-row', open),
  )
  return section
}

function operationPager(pager) {
  const slot = (op, directionKey) =>
    op && {
      href: opHash(op.id),
      label: op.summary || t(directionKey),
      title: `${op.method.toUpperCase()} ${op.path}`,
    }
  return pagerSection(
    { prev: slot(pager?.prev, PAGER_LABELS.prev), next: slot(pager?.next, PAGER_LABELS.next) },
    PAGER_LABELS,
  )
}

if (!customElements.get('api-endpoint-doc'))
  customElements.define('api-endpoint-doc', ApiEndpointDoc)
