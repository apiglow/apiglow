// Shell (docs/architecture.md §7): the only module allowed to read the host config and the
// branding. The core (openapi/, components/, storage/, export/, i18n/) receives
// everything by parameter and never knows about the host page.
// First import on purpose — zero dependencies, so it evaluates before every
// library's module init and gets the schema transfer going under them.
import { prefetchedSchema } from './boot-prefetch.js'
import './styles/app.css'
import './components/api-nav.js'
import './components/api-endpoint-doc.js'
import './components/env-switcher.js'
import './components/env-manager.js'
import './components/env-setup-dialog.js'
import './components/env-setup-builder.js'
import './components/env-share-dialog.js'
import './components/api-try-it-panel.js'
import './components/api-webhook-simulator.js'
import './components/request-history-list.js'
import './components/md-page.js'
import './components/api-scenario-view.js'
import './components/audit-report.js'
import './components/scenario-stepper.js'
import './components/scenario-edit-bar.js'
import './components/schema-changelog.js'
import './components/search-palette.js'
import './components/about-dialog.js'
import './components/import-dialog.js'
import './components/settings-panel.js'
import './components/spec-switcher.js'
import './components/theme-switcher.js'
import { followSystemTheme, resolveInitialTheme } from './components/theme-switcher.js'
import './components/lang-switcher.js'
import { resolveInitialLanguage } from './components/lang-switcher.js'
import { hostConfig } from './config.js'
import { EnvStore } from './env/store.js'
import { HostCredentials, voidCredentials } from './env/host-credentials.js'
import { VariableSource } from './env/variables.js'
import { StorageLimitError } from './storage/errors.js'
import { HistoryStore } from './storage/history.js'
import { recentCalls, topOperations } from './storage/metrics.js'
import { ScenarioStore } from './storage/scenarios.js'
import { createScenario, createStep, decodeScenarioFile } from './scenarios/model.js'
import { decodeScenarioLink } from './export/scenario-share.js'
import { readPref, setSpecScope, writePref } from './storage/prefs.js'
import { currentLanguage, setLanguage, t } from './i18n/index.js'
import { decodeShareState } from './export/share.js'
import { oauthErrorMessage } from './components/oauth-block.js'
import { attachVariableAutocomplete } from './components/variable-autocomplete.js'
import {
  applicableSchemes,
  buildAuthInjection,
  credentialsStatus,
  suggestedVariables,
} from './openapi/auth.js'
import { pickFirstCallOperation } from './openapi/first-call.js'
import { applyResult, historyEntry, send } from './openapi/send.js'
import { loadConfigScenarios } from './scenarios/loader.js'
import { runScenario } from './scenarios/runner.js'
import { createStepController } from './scenarios/step-controller.js'
import { fetchTextCached } from './components/remote-text.js'
import { oauthSuggestedVariables } from './openapi/oauth.js'
import { pendingOAuthSpecId, resumeAuthorizationLogin } from './openapi/oauth-flow.js'
import {
  loadApiModel,
  loadInlineApiModel,
  parseDocumentText,
  SchemaLoadError,
} from './openapi/loader.js'
import { isArazzoDocument, parseArazzo } from './import/arazzo.js'
import { auditRun } from './audit/engine.js'
import {
  emptyRoute,
  homeHash,
  opHash,
  parseHash,
  parseSetupLink,
  scenarioHash,
  setRouteSpecId,
  startRouter,
} from './router.js'
import {
  normalizeSpecsConfig,
  resolveActiveSpecId,
  resolveSpecConfig,
  SpecConfigError,
} from './specs.js'
import { buildOperationIndex, setOperationIndex } from './docs/operations.js'
import { flattenDocsOutline, mergeDocsPages, resolveDocsOutline } from './docs/pages.js'
import { loadDocsPageSource } from './components/docs-source.js'
import { el } from './components/dom.js'
import { envForWrite } from './components/env-write.js'
import { loadDocsSources } from './shell/docs.js'
import { applyHead, applyNoIndex, headFor } from './shell/head.js'
import { createPanels } from './shell/panels.js'
import { createToolbar } from './shell/toolbar.js'
import { injectCustomThemes } from './shell/themes.js'
import { createSetupLinks } from './shell/setup-links.js'
import { createSpecExports } from './shell/spec-exports.js'
import { createSearchPalette } from './shell/search.js'
import { createToaster } from './shell/toasts.js'
import { header, headerSearchButton, headerSearchField } from './shell/header.js'
import {
  MAIN_ID,
  errorView,
  firstCallIntro,
  loadingView,
  notFoundView,
  skipToContentLink,
  specDownloadNotes,
  welcomeView,
} from './shell/views.js'

// In lib build, Vite extracts the CSS into app.css without injecting it: we add
// the <link> ourselves, resolved via import.meta.url — document.currentScript is
// null in an ESM module and cannot serve as a base.
let cssLink = null
if (import.meta.env.PROD) {
  cssLink = document.createElement('link')
  cssLink.rel = 'stylesheet'
  cssLink.href = new URL(/* @vite-ignore */ './app.css', import.meta.url).href
  document.head.append(cssLink)
}

// The display font, requested as soon as its @font-face exists instead of on
// the first styled heading — which is mid-first-render, so the swap arrives
// as a relayout of everything already painted. Loaded here, it lands before
// the first paint on anything but a cold slow connection, where `swap` keeps
// today's behavior. After the stylesheet: `fonts.load` matches against
// registered faces, and before app.css parses there is nothing to match.
function preloadDisplayFont() {
  document.fonts?.load('1em "Source Serif 4 Variable"').catch(() => {})
}
if (cssLink) cssLink.addEventListener('load', preloadDisplayFont)
else preloadDisplayFont()

// <script id="api-doc-config" type="application/json"> takes priority, falls
// back to window.API_DOC_CONFIG (docs/architecture.md §3). No manual init step.
// The shape and the defaults live in src/config.js, which the bake CLI reads
// too — one semantics for the app and for what it publishes.
function readHostConfig() {
  let raw = null
  const configEl = document.getElementById('api-doc-config')
  if (configEl) {
    try {
      raw = JSON.parse(configEl.textContent)
    } catch (err) {
      console.error('[api-doc] Invalid JSON in #api-doc-config:', err)
    }
  }
  if (!raw && typeof window.API_DOC_CONFIG === 'object') raw = window.API_DOC_CONFIG
  return hostConfig(raw)
}

// Defers non-essential work off the critical path. `timeout` guarantees
// it eventually runs even if the page stays busy; the fallback covers
// browsers without requestIdleCallback (Safari < 16.4).
function whenIdle(fn) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 2000 })
  else setTimeout(fn, 150)
}

function loadErrorMessage(err) {
  if (!(err instanceof SchemaLoadError)) return t('error.load.unexpected')
  switch (err.code) {
    case 'network':
      return t('error.load.network')
    case 'http':
      return t('error.load.http', { status: err.detail.status })
    case 'malformed':
      return t('error.load.malformed')
    case 'unsupported-version':
      return t('error.load.unsupportedVersion', { found: err.detail.found ?? '?' })
    default:
      return t('error.load.invalidSchema')
  }
}

// App layout: header + side nav + content + try-it, each with its own scroll.
// specsConfig/activeSpec: output of
// normalizeSpecsConfig + active entry — in mono-spec, a "default" pseudo-spec
// with no declarations of its own, strictly neutral.
function appLayout(
  loaded,
  config,
  specsConfig,
  activeSpec,
  { docsError = null, setupPayload = null } = {},
) {
  // `loaded` is what the loader returns: the normalized model everything renders
  // from, plus the two raw documents only the audit reads (docs/audit.md §5).
  const { model } = loaded
  const nav = document.createElement('api-nav')
  // pb-24 below lg: the "Try it" FAB floats above the bottom of the page.
  const main = el('main', 'flex-1 min-w-0 lg:overflow-y-auto p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8')
  main.id = MAIN_ID
  // The skip link's landing point. A <main> without it takes the focus() and
  // hands it straight back, so the next Tab restarts from the top of the
  // document and the skip has skipped nothing.
  main.tabIndex = -1
  const doc = document.createElement('api-endpoint-doc')
  const mdPage = document.createElement('md-page')
  const scenarioView = document.createElement('api-scenario-view')
  // Every edit of a scenario re-enters its route (store change → refresh), and
  // `replaceChildren` with the element already in place still detaches and
  // reattaches it: the browser drops the scroll offsets and the focus of
  // everything underneath, so clicking a key in a step's response threw the
  // reader back to the top of the page. Same reason as `showDocsPage` below,
  // where the cost was a second parse instead.
  const mountScenarioView = () => {
    if (main.firstChild !== scenarioView || main.childNodes.length > 1)
      main.replaceChildren(scenarioView)
  }
  // Webhooks share the #/op/{id} route and the dispatch map with the
  // operations (collision-free ids guaranteed by normalization).
  const byId = new Map([...model.operations, ...model.webhooks].map((op) => [op.id, op]))
  // Both execution modes resolve operations from the same list as
  // the view and the nav (byId): a mismatch here would cause the auto run and the
  // step-by-step to diverge on the same step. The exports read it too, so a
  // published scenario names the operations the reader was shown.
  const scenarioOps = [...byId.values()]
  // Traversal order of the prev/next buttons = nav order (groups
  // then operations, then webhooks), deduplicated: a multi-tag operation
  // appears in several groups but has only one position (the first
  // one encountered).
  const navOrder = []
  {
    const seen = new Set()
    for (const group of model.groups) {
      for (const id of group.operationIds) {
        if (!seen.has(id) && byId.has(id)) {
          seen.add(id)
          navOrder.push(id)
        }
      }
    }
    for (const webhook of model.webhooks) {
      if (!seen.has(webhook.id)) {
        seen.add(webhook.id)
        navOrder.push(webhook.id)
      }
    }
  }
  // `config` is already the EFFECTIVE config of the active spec (resolveSpecConfig):
  // nothing here needs to know whether a value comes from the root or an override.
  // Docs pages (docs/docs-pages.md §2). One resolved arrangement, three
  // consumers: the nav renders it, the llms.txt index sections it, and the
  // flat list below (prev/next, routing, search, llms-full) derives from it.
  const docsOutline = resolveDocsOutline(config.docsPages, currentLanguage())
  const pages = flattenDocsOutline(docsOutline)
  // The page component never sees the host config (rule 10): it gets the one
  // resolved value it needs, or null — and null is the default product.
  mdPage.feedback =
    typeof config.feedback?.url === 'string' && config.feedback.url.trim()
      ? { url: config.feedback.url }
      : null
  const pageBySlug = new Map(pages.map((p) => [p.slug, p]))
  // At most one, guaranteed by the merge (§2.4).
  const homePage = pages.find((page) => page.home) ?? null
  // What `apidoc:` references in prose resolve against (§4.4). Locked here for
  // the page's lifetime, like the router's spec prefix: no cross-spec
  // references, and switching spec reloads.
  setOperationIndex(buildOperationIndex(model))
  const tryItConfig = config.tryIt
  const branding = config.branding

  // The shell instantiates the stores and passes them to the components: the core never
  // touches the host config directly (docs/architecture.md §7).
  const envStore = new EnvStore(config.environments, { locked: config.environmentsLocked === true })
  // The overlay learns which spec it serves and which credentials that spec
  // asks for; the public API has existed since module evaluation, and any
  // registration made before this point simply had nothing to expand yet.
  hostCredentials.context = { specId: activeSpec.id, schemes: model.securitySchemes }
  // Everything that resolves a `{{var}}` — here and in the components — reads
  // this one source, rather than each re-composing the environment and the
  // host overlay itself (docs/host-credentials.md §4).
  const variables = new VariableSource({ envStore, host: hostCredentials })
  const variablesFor = (env = envStore.selected()) => variables.for(env)
  // A `{{var}}` in prose resolves from the very same composition (§12): a
  // guide's snippet shows the reader's own base URL, and a secret shows as a
  // mask rather than as itself.
  mdPage.variables = variables
  // Boot fill, off the critical path: ask the host only if some conventional
  // credential is actually void. Bound to the `provider` event as well, so a
  // registration arriving after boot gets the same pass — registration order
  // never matters (§5).
  const fillFromHost = () => {
    // Tested before scheduling, not inside the callback: an installation with
    // no provider — every one of them by default — then costs boot nothing at
    // all, not even a retained idle callback.
    if (!hostCredentials.hasProvider) return
    whenIdle(() => {
      if (!voidCredentials(model.securitySchemes, envStore.variablesOf()).length) return
      hostCredentials.request('initial')
    })
  }
  hostCredentials.addEventListener('provider', fillFromHost)
  fillFromHost()
  const historyStore = new HistoryStore(config.history, {
    specId: activeSpec.id,
    scoped: specsConfig.multi,
  })
  // Whole feature can be disabled by the host config: a doc may not want to
  // expose executable sequences at all. Read here and propagated as a single
  // flag — every entry point (nav, capture, routes, search, home) checks
  // it rather than being removed by a build variant.
  const scenariosEnabled = config.features.scenarios !== false
  // The CI hand-off panel (docs/scenario-handoff.md §4): a switch on that one
  // surface, not on the publication — the recipes an agent reads are governed
  // by what the config declares, never by a key that hides a panel.
  const ciEnabled = config.features.ci !== false
  // Schema audit: same all-or-nothing switch. Off, the audit holds nothing —
  // nothing is computed, and no document is retained on its behalf. The parsed
  // source outlives it either way, for the user overlay's dry run below.
  const auditEnabled = config.features.audit !== false
  // `source` stays a getter down to the audit run: materializing it here would
  // put the lazy rebuild the loader just deferred right back on the boot path.
  const auditInput = auditEnabled
    ? {
        get source() {
          return loaded.source
        },
        document: loaded.document,
        model,
      }
    : null
  // Generated onboarding page: opt-in, and only if the schema declares a read
  // simple enough to be pressed sight unseen. Without one there is no page and
  // no nav entry — an onboarding pointing at nothing is worse than none.
  const firstCallOp = config.features.onboarding === true ? pickFirstCallOperation(model) : null
  // Scenarios declared by the doc (§3). What the entry says is known at boot;
  // what it declares is not — an Arazzo document holds as many scenarios as it
  // has workflows, and their ids are its own. So each entry starts as a
  // placeholder carrying its declared label, and the loader below replaces the
  // list once the documents are in.
  const configScenarios = scenariosEnabled ? config.scenarios : []
  let configRecords = configScenarios.map((entry) => ({
    id: entry.id,
    title: entry.title,
    pinned: entry.pinned,
    entryId: entry.id,
    url: entry.url,
    scenario: null,
    warnings: [],
    error: null,
  }))
  const scenarioStore = new ScenarioStore({ specId: activeSpec.id, scoped: specsConfig.multi })
  // Local scenarios, read once at boot then on every write. The list lives
  // in the shell (not in the nav): the route and the Cmd+K index need it
  // too.
  let localScenarios = []
  const envSwitcher = document.createElement('env-switcher')
  envSwitcher.store = envStore
  envSwitcher.variables = variables
  // Credential variables expected by the schema: the switcher flags
  // environments where none is set. OAuth variables (clientId…)
  // are excluded — their absence doesn't mean "no credentials".
  const authVariables = model.securitySchemes.flatMap((s) => suggestedVariables(s))
  envSwitcher.authVariables = authVariables
  // OpenAPI `servers` can be relative ("/api/v3"): resolved against
  // the schema's absolute URL (OpenAPI semantics), itself resolved against the
  // host page — openapi.url can legitimately be relative (schema hosted
  // at the same place as the doc). Inline schema: no document URL, the
  // host page acts as the base.
  const pageUrl = `${window.location.origin}${window.location.pathname}`
  const schemaUrl = activeSpec.url ? new URL(activeSpec.url, window.location.href).href : pageUrl
  // Changelog snapshot key: the schema URL, or the page + spec id
  // when it's inline (two inline specs share the same page).
  const snapshotKey = activeSpec.url ? schemaUrl : `${pageUrl}#spec=${activeSpec.id}`
  // Locked environments: the manager isn't instantiated at all —
  // no UI entry point to the CRUD (switcher and try-it don't show
  // their "manage" button when onManage is absent).
  let envManager = null
  if (!envStore.locked) {
    envManager = document.createElement('env-manager')
    envManager.store = envStore
    envManager.servers = model.servers.map((server) => ({
      ...server,
      url: new URL(server.url, schemaUrl).href,
    }))
    envManager.suggestedVariables = model.securitySchemes.flatMap((s) => [
      ...suggestedVariables(s),
      ...oauthSuggestedVariables(s),
    ])
    envSwitcher.onManage = () => envManager.open()
    // The missing-variable chip of a docs page: "define it" is its only next
    // step, and this is where it happens.
    mdPage.onManageEnv = () => envManager.open()
  }

  const { node: toasts, show: showToast } = createToaster()

  // `mount` rather than `layout`: the layout element is built further down, and
  // every one of these dialogs is created on its first gesture, long after.
  const { previewSetupLink, openSetupBuilder, openShareDialog } = createSetupLinks({
    envStore,
    specId: activeSpec.id,
    multiSpec: specsConfig.multi,
    mount: (node) => layout.appendChild(node),
    notify: showToast,
  })

  if (envManager) {
    envManager.onShare = openShareDialog
    envManager.onBuild = openSetupBuilder
  }

  // Without an environment, falls back to the schema's first `servers`, resolved
  // against the schema's own base (3.2 `$self` when it declares one, else the
  // URL it was fetched from) — relative servers like "/api/v3" require it.
  const fallbackBaseUrl = model.servers[0]
    ? new URL(model.servers[0].url, model.baseUri ?? schemaUrl).href
    : ''

  const tryIt = document.createElement('api-try-it-panel')
  tryIt.context = {
    model,
    envStore,
    variables,
    history: historyStore,
    proxyUrl: tryItConfig.proxyUrl,
    requestCredentials: tryItConfig.requestCredentials,
    fallbackBaseUrl,
    onManageEnv: envManager ? () => envManager.open() : null,
    oauthClientIds: Object.fromEntries(
      Object.entries(config.oauth ?? {}).map(([name, entry]) => [name, entry?.clientId ?? null]),
    ),
    notify: showToast,
    // `historyList` is declared further down: the reference is only read on click.
    onOpenHistory: (opId) => historyList.open({ opId }),
  }

  // Webhook simulator: occupies the right column instead of the try-it
  // on webhook routes — the call goes out to the user's receiver, not to the
  // API, so no auth is injected; the environment is passed for its variables
  // alone (rule 11 binds this send path too).
  const webhookSim = document.createElement('api-webhook-simulator')
  webhookSim.context = {
    proxyUrl: tryItConfig.proxyUrl,
    requestCredentials: tryItConfig.requestCredentials,
    // Variables only — the simulator still injects no credentials: the call
    // targets the user's receiver, not the API (rule 11 vs auth, §5.1).
    envStore,
  }

  // OAuth redirect return (Authorization Code + PKCE): exchange the code
  // for a token, stored in auth.X of the originating environment, then restore
  // the route left behind — the hash doesn't survive the authorization round
  // trip. That environment can be gone (deleted while the login was away): the
  // token cost a full redirect, so it falls back to the selected one, or to
  // one provisioned for it, rather than being dropped on arrival.
  resumeAuthorizationLogin().then((result) => {
    if (!result) return
    if (result.returnHash && result.returnHash !== window.location.hash) {
      window.location.hash = result.returnHash
    }
    if (result.error) {
      showToast('error', oauthErrorMessage(result.error))
      return
    }
    const env = envStore.get(result.envId) ?? envForWrite(envStore)
    if (!env) {
      showToast('error', t('env.lockedNone'))
      return
    }
    envStore.setVariable(env.id, `auth.${result.schemeName}`, result.token, { sensitive: true })
    showToast('success', t('oauth.tokenSaved', { env: env.name }))
  })

  // Resolved at call time, not at build time: the selected environment can
  // change between the moment an export button appears and the moment it is
  // pressed.
  const { llmsFullExport, llmsTextExport, mcpContext, specDownload } = createSpecExports({
    model,
    pages,
    outline: docsOutline,
    scenarios: configScenarios,
    ops: scenarioOps,
    fetchText: fetchTextCached,
    envStore,
    fallbackBaseUrl,
    activeSpec,
    schemaUrl,
    pageUrl,
    overlays: loaded.overlays,
    specOverlays: config.openapi.overlays ?? [],
  })
  doc.llmsFullExport = llmsFullExport
  doc.mcp = mcpContext

  mdPage.llmsFullExport = llmsFullExport
  mdPage.mcp = mcpContext

  // "Configured" badge of the auth card: reads the environment at render
  // time — the re-render on env change goes through syncDocBaseUrl.
  // A host-covered credential counts as configured: the badge answers "can
  // this call be made", and it can. Which environment is named stays the
  // selected one — the cartouche is where the host source is spelled out
  // (docs/host-credentials.md §6).
  doc.credentialsResolver = (scheme) => {
    const env = envStore.selected()
    if (!env) return null
    const rows = credentialsStatus(scheme, variablesFor(env))
    return rows.length && rows.every((row) => row.set) ? { envName: env.name } : null
  }

  // Full URL displayed at the top of the doc: base of the selected env, otherwise
  // falls back to servers — follows environment changes.
  const syncDocBaseUrl = () => {
    doc.baseUrl = envStore.selected()?.baseUrl || fallbackBaseUrl
  }
  syncDocBaseUrl()
  envStore.addEventListener('change', syncDocBaseUrl)
  // Variables proposed when editing a step follow the active
  // environment: changing it must refresh the list, not freeze it at opening time.
  envStore.addEventListener('change', () => showEditBar())
  // Step-by-step banner: above the panel, so it lands in the bottom sheet on
  // mobile with no special handling (docs/scenarios.md §5.3).
  const stepper = document.createElement('scenario-stepper')
  // Step edit banner: same location as the step-by-step banner, and mutually
  // exclusive with it (starting a run closes the edit).
  const editBar = document.createElement('scenario-edit-bar')
  const {
    navAside,
    navResizer,
    tryItAside,
    tryItResizer,
    scrim,
    navToggle,
    tryItFab,
    setOpenPanel,
    closePanels,
    syncPanels,
  } = createPanels({
    nav,
    tryIt,
    webhookSim,
    banners: [editBar, stepper],
    // Answered by the scenario machinery, built further down: asked on every
    // call, never captured.
    scenarioActive: () => stepController.active,
    scenarioOwned: () => stepController.active || editingContext() !== null,
  })

  // The panel load a cold navigation deferred behind the first frame (see
  // showOperation). Any doc→panel message flushes it first: the panel is the
  // source of truth (rule 20), and an edit sent into a panel that does not
  // hold the operation yet would be silently lost — the deferral must never
  // be observable, only cheaper.
  let pendingPanelLoad = null
  const flushPanelLoad = () => {
    const load = pendingPanelLoad
    pendingPanelLoad = null
    load?.()
  }

  // Two-way sync between central doc and panel: the doc's inputs
  // send tryit-edit up to the panel (source of truth), which sends its full
  // state back down via tryit-state — both views show the same values,
  // pre-filled defaults included.
  doc.addEventListener('tryit-edit', (event) => {
    flushPanelLoad()
    tryIt.applyDocEdit(event.detail)
  })
  tryIt.addEventListener('tryit-state', (event) => doc.syncTryItValues(event.detail))
  // Clicking an HTTP code on one side shows the same status on the other
  // (doc tabs ↔ panel's example mockup badges).
  doc.addEventListener('tryit-response-status', (event) => {
    flushPanelLoad()
    tryIt.showResponseExample(event.detail.status)
  })
  tryIt.addEventListener('tryit-response-status', (event) =>
    doc.showResponseStatus(event.detail.status),
  )

  // The palette indexes the scenarios of both origins: those declared in the
  // config pass through as-is, the local ones are projected onto the same
  // shape here — `byId` is what turns a step's opId into a readable title.
  const {
    node: searchPalette,
    rebuild: rebuildSearchIndex,
    open: openSearchPalette,
  } = createSearchPalette({
    model,
    pages,
    scenarios: () => [
      ...configRecords.map((record) => ({
        id: record.id,
        title: record.title,
        description: record.scenario?.description,
        stepTitles: (record.scenario?.steps ?? []).map(
          (step) => byId.get(step.opId)?.summary || step.opId,
        ),
      })),
      ...localScenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.name,
        description: scenario.description,
        stepTitles: scenario.steps.map((step) => byId.get(step.opId)?.summary || step.opId),
      })),
    ],
  })

  // Local metrics (docs/architecture.md §5.6): the endpoint's recent-calls
  // strip and the overview's most-used card both read THIS list, so the two
  // surfaces cost one IndexedDB read between them. Refreshed on every history
  // change — a send must appear in the strip under it, without a navigation.
  let historyEntries = []
  const metricsOf = (opId) => recentCalls(historyEntries, opId, { specId: historyStore.specId })
  const applyLocalMetrics = () => {
    doc.recentCalls = metricsOf(currentOpId)
    // The overview reads the same list when it renders. If it is what's on
    // screen when a read lands (first visit, or a purge from the settings
    // panel), it has to render again — same reason the schema diff re-renders
    // the displayed operation.
    const route = parseHash(window.location.hash)
    if (route.type === 'overview' || (route.type === null && !homePage)) showWelcome()
  }
  const refreshLocalMetrics = async () => {
    try {
      historyEntries = await historyStore.list()
    } catch (err) {
      console.error('[api-doc] history read failed:', err)
      return
    }
    applyLocalMetrics()
  }
  historyStore.addEventListener('change', refreshLocalMetrics)
  // Off the boot path: nothing on the first paint depends on it (rule 14).
  whenIdle(refreshLocalMetrics)
  doc.onOpenHistory = (opId) => historyList.open({ opId })

  // Every dead end — unknown operation, missing page, feature disabled, route
  // the schema cannot satisfy — renders the same view with the same way out.
  // Bound once so the next one cannot ship without it.
  const showNotFound = (message) =>
    main.replaceChildren(notFoundView(message, () => openSearchPalette()))

  // `currentOpId` is written by the router below, so it stays here and is read
  // through this callback; the diff is written inside the toolbar and reaches
  // the router through `changesFor`.
  let currentOpId = null
  const {
    changelog,
    changelogBtn,
    changesFor,
    historyList,
    historyBtn,
    menu,
    settingsPanel,
    userOverlayBtn,
    importDialog,
    importBtn,
    aboutDialog,
  } = createToolbar({
    model,
    nav,
    doc,
    byId,
    snapshotKey,
    currentOpId: () => currentOpId,
    whenIdle,
    historyStore,
    scenarioStore,
    envStore,
    requestCredentials: tryItConfig.requestCredentials,
    themes: config.theme.available,
    themeDefault: config.theme.default,
    languages: config.language.available,
    languageDefault: config.language.default,
    diagnostics: {
      // Substituted by Vite's `define` from package.json (vite.config.js).
      appVersion: __APP_VERSION__,
      apiVersion: model.info.version,
      openapiVersion: model.sourceVersion,
      // Only set for a converted document (today: Swagger 2.0) — the version the
      // app reports everywhere else is the conversion's target, and a bug report
      // has to be able to name the file the integrator actually serves.
      convertedFrom: model.convertedFrom,
      schemaUrl,
      specId: specsConfig.multi ? activeSpec.id : null,
      // Overlays: what was applied to the schema before it was read, and what
      // could not be. An overlay that silently matched nothing is exactly the
      // kind of thing a bug report has to be able to name.
      overlays: loaded.overlays,
    },
    auditEnabled,
    // Kept whatever `features.audit` says: a user overlay has no host veto
    // (docs/user-overlay.md decision 9), and its dry run checks against the
    // parsed schema. A thunk, not the value: the dry run is the only reader,
    // and resolving it here would defeat the loader's lazy `source`.
    schemaSource: () => loaded.source,
    overlayWarnings: loaded.overlays?.warnings ?? [],
    importBaseUrls: [...envStore.list().map((env) => env.baseUrl), fallbackBaseUrl].filter(Boolean),
    build: {
      // Same `define` substitution as the diagnostics above: package.json is read
      // at build time, never bundled.
      name: __APP_NAME__,
      version: __APP_VERSION__,
      homepage: __APP_HOMEPAGE__,
      bugs: __APP_BUGS__,
    },
  })
  // "Reload in try-it": navigate to the operation then inject
  // the values once the route has rendered (hashchange is asynchronous).
  let pendingHistoryEntry = null
  historyList.onLoadEntry = (entry) => {
    if (parseHash(window.location.hash).id === entry.opId) {
      tryIt.loadEntry(entry)
    } else {
      pendingHistoryEntry = entry
      window.location.hash = opHash(entry.opId)
    }
  }

  // Spec selector (multi-spec §4.3): icon button attached to the brand, which
  // remains the sole element naming the active API and carrying its version — the trigger
  // repeated them word for word. Switching = global preference + home of the
  // new spec as a replacement (no browser history entry), then
  // reload — same mechanism as the language selector: appLayout wires
  // everything with no teardown, a hot re-render would force a risky refactor.
  let specSwitcher = null
  if (specsConfig.multi && specsConfig.specs.length > 1) {
    specSwitcher = document.createElement('spec-switcher')
    specSwitcher.specs = {
      specs: specsConfig.specs,
      activeId: activeSpec.id,
    }
    specSwitcher.onSelect = (specId) => {
      if (specId === activeSpec.id) return
      writePref('spec.selected', specId)
      window.history.replaceState(null, '', `#/s/${specId}/`)
      window.location.reload()
    }
  }

  // The row of three columns. Above lg each column scrolls on its own; below
  // it they stack and the row is the one scroller (panels.js reads it the same
  // way, to slide the FAB out of the reader's way). Held rather than inlined
  // into the layout: a navigation has to put the reader back at the top, and on
  // a phone `main` is not what carries the offset.
  const columns = el(
    'div',
    'flex flex-1 min-h-0 flex-col lg:flex-row overflow-y-auto lg:overflow-visible',
    navAside,
    navResizer,
    main,
    tryItResizer,
    tryItAside,
  )

  const layout = el(
    'div',
    'h-screen flex flex-col bg-base-100 text-base-content',
    // First tab stop of the document, by tree order.
    skipToContentLink(),
    header({
      branding,
      apiVersion: model.info.version,
      navToggle,
      specSwitcher,
      // Both say something about the schema itself rather than offering a
      // tool: they qualify what the page below is showing, so they travel
      // with the brand that names it.
      status: [changelogBtn, userOverlayBtn],
      searchField: headerSearchField(() => openSearchPalette()),
      searchButton: headerSearchButton(() => openSearchPalette()),
      tools: [envSwitcher, historyBtn, importBtn],
      appMenu: menu,
    }),
    columns,
    scrim,
    tryItFab,
    envManager,
    historyList,
    searchPalette,
    changelog,
    settingsPanel,
    importDialog,
    aboutDialog,
    toasts,
  )
  nav.model = model

  nav.docs = docsOutline
  nav.docsError = docsError
  nav.llmsText = llmsTextExport
  // A takeover moves the welcome view to its own entry and makes the docs
  // page the one `#/` renders; the nav needs both facts to point and to
  // highlight correctly.
  nav.homeSlug = homePage?.slug ?? null
  nav.scenariosEnabled = scenariosEnabled
  nav.firstCall = Boolean(firstCallOp)

  // Every scenario write fails the same way (database unavailable:
  // private mode, quota) and is reported the same way: a single wrapper
  // rather than a try/catch per action.
  const writeScenario = async (what, run) => {
    try {
      return await run()
    } catch (err) {
      console.error(`[api-doc] scenario ${what} failed:`, err)
      // A reached cap is a user-actionable state, not a broken database: it
      // gets its own message telling what to do about it.
      const limit = err instanceof StorageLimitError
      showToast(
        'error',
        limit ? t('scenario.limitReached', { limit: err.limit }) : t('scenario.saveError'),
      )
      return null
    }
  }

  // Step capture (§5.4): the same contract for the try-it and
  // the history — the list of targets, and the write.
  const captureTargets = {
    list: () => localScenarios.map((scenario) => ({ id: scenario.id, name: scenario.name })),
    add: (scenarioId, { opId, request }) =>
      writeScenario('capture', async () => {
        const step = createStep({ opId, request })
        const target = scenarioId ? localScenarios.find((s) => s.id === scenarioId) : null
        let id = scenarioId
        if (target) {
          await scenarioStore.update({ ...target, steps: [...target.steps, step] })
        } else {
          id = await scenarioStore.add({
            ...createScenario({ name: t('scenario.newName') }),
            steps: [step],
          })
        }
        showToast(
          'success',
          t('scenario.stepAdded', { name: target?.name ?? t('scenario.newName') }),
        )
        // A capture isn't an end point: what's left to do (chaining,
        // checking, ordering) is on the scenario page. We take the user there, on
        // the step just added — expanded, the others collapsed.
        historyList.close()
        scenarioView.focusStep = step.id
        window.location.hash = scenarioHash(id)
      }),
  }
  // Feature disabled: no capture target, so no button — neither in the
  // panel nor in the history.
  tryIt.capture = scenariosEnabled ? captureTargets : null
  historyList.capture = scenariosEnabled ? captureTargets : null
  // The history only stores the id of the scenario that produced an entry (§4).
  // The name is looked up here, where both sources coexist — and since `localScenarios`
  // is reassigned on every write, it's read at call time, not now.
  historyList.scenarioName = scenariosEnabled
    ? (id) =>
        configRecords.find((record) => record.id === id)?.title ??
        localScenarios.find((s) => s.id === id)?.name ??
        null
    : null

  // Same auth as the try-it: first applicable scheme of the operation, resolved
  // against the supplied variables (env + run scope during an execution).
  const authInjectionFor = (op, variables) => {
    const scheme = applicableSchemes(model, op).schemes[0]
    return scheme ? buildAuthInjection(scheme, variables) : null
  }

  // A step is edited in the real try-it: "open" loads its request there,
  // "update" reads back the panel's state (§5.2).
  let pendingStep = null
  // Panel draft set aside by a step-by-step run, restored the next time
  // its operation is visited (§5.3).
  let pendingDraft = null
  scenarioView.context = {
    model,
    // `sourceDescriptions` of the Arazzo export: the public URL of the active schema.
    schemaUrl,
    ci: ciEnabled,
    actions: {
      update: (scenario) => writeScenario('update', () => scenarioStore.update(scenario)),
      remove: async (scenario) => {
        const done = await writeScenario('delete', () =>
          scenarioStore.remove(scenario.id).then(() => true),
        )
        if (done) window.location.hash = homeHash()
      },
      duplicate: async (scenario) => {
        const copy = await writeScenario('duplicate', () =>
          scenarioStore.duplicate(scenario, {
            name: t('scenario.copyOf', { name: scenario.name }),
          }),
        )
        if (copy) window.location.hash = scenarioHash(copy.id)
      },
      openStep: (step, scenario) => startStepEditing(scenario, step),
      // Null = the panel isn't on this operation: the view says so rather
      // than recording another endpoint's request.
      recaptureStep: (step) => (tryIt.operationId === step.opId ? tryIt.captureRequest() : null),
      // Auto run (§6): the runner's generator wired to the real sending
      // pipeline. Every step sent leaves its history entry, tagged with the
      // run — the reports themselves aren't persisted.
      run: async (scenario, { proxy = false, onStep } = {}) => {
        const env = envStore.selected()
        const variables = variablesFor(env)
        const runId = crypto.randomUUID()
        const sender = async (built, { step, index, op }) => {
          const entry = historyEntry({ op, env, built, proxied: !!(proxy && tryItConfig.proxyUrl) })
          entry.scenario = { id: scenario.id, runId, stepId: step.id, stepIndex: index }
          const result = await send(built, {
            proxyUrl: tryItConfig.proxyUrl,
            proxyEnabled: proxy,
            credentials: tryItConfig.requestCredentials,
            // Only the auto run: in step-by-step the human drives the panel's
            // Send button, and cutting their request off at a deadline the
            // document set would abort a send they made themselves.
            ...(step.timeout ? { signal: AbortSignal.timeout(step.timeout) } : {}),
          })
          applyResult(entry, result)
          historyStore
            .add(entry)
            .catch((err) => console.error('[api-doc] history write failed:', err))
          return result
        }
        for await (const result of runScenario(scenario, {
          ops: scenarioOps,
          baseUrl: env?.baseUrl || fallbackBaseUrl,
          variables,
          authInjectionFor,
          sender,
        })) {
          onStep?.(result)
        }
      },
      // Step-by-step (§5.3): driven by the shell, the view only starts it.
      // A run takes back control of the panel: step editing stops.
      runStepByStep: (scenario) => {
        endStepEditing()
        stepController.start(scenario)
      },
      // "This scenario configures your token": extractions marked persist
      // join the active environment, locked or not (runtime value,
      // same status as an OAuth token — docs/architecture.md §5.3), and
      // provision one when the host declared none.
      persist: async (extracts) => {
        const env = envForWrite(envStore)
        if (!env) {
          showToast('error', t('env.lockedNone'))
          return
        }
        for (const extract of extracts) {
          envStore.setVariable(env.id, extract.name, extract.value, {
            sensitive: extract.sensitive,
          })
        }
        showToast('success', t('scenario.persisted', { count: extracts.length, env: env.name }))
      },
      // Last known response for each step (§5.4): the history entry
      // tagged with this step, failing that the last call to the same operation —
      // typically the one just captured from the try-it.
      stepResponses: async (scenario) => {
        const responses = new Map()
        // Only the scenario's operations matter: the history can
        // carry hundreds of others, no need to index them all.
        const wanted = new Set(scenario.steps.map((step) => step.opId))
        const byOp = new Map()
        for (const entry of await historyStore.list()) {
          if (!entry.response) continue
          const stepId = entry.scenario?.stepId
          if (stepId && !responses.has(stepId)) responses.set(stepId, entry.response)
          if (wanted.has(entry.opId) && !byOp.has(entry.opId)) byOp.set(entry.opId, entry.response)
        }
        for (const step of scenario.steps) {
          if (!responses.has(step.id) && byOp.has(step.opId))
            responses.set(step.id, byOp.get(step.opId))
        }
        return responses
      },
      env: () => {
        const env = envStore.selected()
        return {
          id: env?.id ?? null,
          name: env?.name ?? null,
          variables: variablesFor(env),
        }
      },
      manageEnv: envManager ? () => envManager.open() : null,
      openHistory: (options) => historyList.open(options),
      proxyAvailable: !!tryItConfig.proxyUrl,
      notify: showToast,
      // `filePicker` is declared further down: the reference is only read on click.
      importFile: () => filePicker.click(),
      // Import preview (§8.2): nothing is written before this click.
      acceptImport: (scenario) => importScenario(scenario),
      cancelImport: () => {
        window.location.hash = homeHash()
      },
    },
  }

  // Import of a scenario, by file or by link: a single write, a single
  // landing point (the imported scenario's view).
  const importScenario = async (scenario) => {
    const id = await writeScenario('import', () => scenarioStore.add(scenario))
    if (!id) return
    showToast('success', t('scenario.import.done', { name: scenario.name }))
    window.location.hash = scenarioHash(id)
  }

  // File picker: a hidden <input> rather than a visible field in the
  // nav — importing is an action, not a form.
  const filePicker = el('input', 'hidden')
  filePicker.type = 'file'
  filePicker.accept = 'application/json,.json,.yaml,.yml'
  filePicker.addEventListener('change', async () => {
    const file = filePicker.files?.[0]
    // Reset right away: re-importing the same file must re-trigger
    // the `change` event.
    filePicker.value = ''
    if (!file) return
    const text = await file.text()
    // One picker, two formats, and the file says which it is: our own envelope,
    // or an Arazzo workflow document (which the ecosystem writes in YAML as
    // often as in JSON — hence parsing the text before dispatching).
    let document = null
    try {
      document = await parseDocumentText(text)
    } catch {
      document = null
    }
    if (isArazzoDocument(document)) {
      importArazzoDocument(document)
      return
    }
    const { scenario, errors } = decodeScenarioFile(document ?? text)
    if (!scenario) {
      console.error('[api-doc] scenario file rejected:', errors)
      showToast('error', t('scenario.import.invalid'))
      return
    }
    importScenario(scenario)
  })

  // An Arazzo document holds several workflows; each becomes a scenario of its
  // own. What the mapping could not carry goes to the console — the same
  // channel a config scenario's issues already use, and the only one that can
  // hold a list.
  const importArazzoDocument = async (document) => {
    const { scenarios, warnings, errors } = parseArazzo(document, { ops: scenarioOps })
    if (!scenarios.length) {
      console.error('[api-doc] Arazzo import rejected:', errors, warnings)
      showToast('error', t('scenario.import.invalid'))
      return
    }
    if (warnings.length) console.warn('[api-doc] Arazzo import:', warnings)
    let firstId = null
    for (const scenario of scenarios) {
      const id = await writeScenario('import', () => scenarioStore.add(scenario))
      if (!id) return
      firstId ??= id
    }
    showToast('success', t('scenario.import.arazzoDone', { count: scenarios.length }))
    if (warnings.length) {
      showToast('warning', t('scenario.import.arazzoIssues', { count: warnings.length }))
    }
    window.location.hash = scenarioHash(firstId)
  }
  layout.append(filePicker)

  // Received share link (§8.2): preview, never execution nor writing
  // before the user's explicit action.
  const showImport = (data) => {
    const { scenario, errors } = decodeScenarioLink(data)
    if (!scenario) {
      console.error('[api-doc] shared scenario rejected:', errors)
      showNotFound(t('scenario.import.invalid'))
      return
    }
    scenarioView.source = { kind: 'import', scenario }
    mountScenarioView()
  }
  // --- guided step-by-step (docs/scenarios.md §5.3) ----------------------------
  //
  // All the mechanics live in `scenarios/step-controller.js` (testable without
  // a browser); the shell only provides its plugs: the execution
  // context, the panel, the banner, the report, the navigation.
  const stepController = createStepController({
    context: () => {
      const env = envStore.selected()
      return {
        ops: scenarioOps,
        baseUrl: env?.baseUrl || fallbackBaseUrl,
        variables: variablesFor(env),
        authInjectionFor,
      }
    },
    panel: {
      snapshot: () => tryIt.snapshotDraft(),
      setVariables: (variables) => {
        tryIt.runVariables = variables
      },
      load: ({ step, variables }) => openStepInPanel(step, { variables }),
    },
    stepper: {
      show: (state) => {
        stepper.state = state
        syncPanels()
        revealStepper()
      },
    },
    report: {
      push: (result) => scenarioView.pushStepResult(result),
      end: () => scenarioView.endRun(),
    },
    // Back to the scenario: the full report can be read there, with the button to
    // persist the extracted variables. The draft set aside at
    // launch time waits for the endpoint it came from.
    onFinish: ({ scenario, draft, wrapUp }) => {
      pendingDraft = draft
      syncPanels()
      if (wrapUp) window.location.hash = scenarioHash(scenario.id)
    },
    onError: (err) => {
      console.error('[api-doc] scenario step run failed:', err)
      showToast('error', t('scenario.runError'))
    },
  })
  // Variables entered in the banner: the controller takes them for the run,
  // the environment only sees them if the user asked for it — writing
  // to the env on every step unblock would pollute it with test values.
  stepper.onDecision = (kind, payload) => {
    if (kind === 'provide' && payload?.persist) {
      const env = envForWrite(envStore)
      if (env) {
        for (const [name, entry] of Object.entries(payload.variables)) {
          envStore.setVariable(env.id, name, entry.value, { sensitive: false })
        }
      } else {
        showToast('error', t('env.lockedNone'))
      }
    }
    stepController.decide(kind, payload)
  }
  tryIt.entryDecorator = (_entry, op) => stepController.decorateEntry(op.id)
  tryIt.addEventListener('tryit-response', (event) =>
    stepController.onResponse(event.detail.entry.opId, event.detail.result),
  )

  // --- editing a step in the panel (§5.2) -----------------------------------
  //
  // The panel remains the only request editor, but it now says it's
  // editing one: without this banner, nothing distinguished "I'm preparing step 2"
  // from a free-form try, and saving had to be hunted for in another
  // view's menu — an input lost on plain navigation.
  //
  // Only the ids are kept: the scenario object itself may have been rewritten
  // in the meantime (another step edited, a run persisted).
  let editingStep = null

  const editingContext = () => {
    if (!editingStep) return null
    const scenario = localScenarios.find((s) => s.id === editingStep.scenarioId)
    const index = scenario?.steps.findIndex((s) => s.id === editingStep.stepId) ?? -1
    return index >= 0 ? { scenario, index, step: scenario.steps[index] } : null
  }

  const startStepEditing = (scenario, step) => {
    // Config scenarios aren't editable: the view only offers the menu
    // on local ones, but the action is public — might as well guarantee it here.
    if (scenario?.source !== 'local') {
      openStepInPanel(step)
      return
    }
    editingStep = { scenarioId: scenario.id, stepId: step.id, opId: step.opId }
    showEditBar()
    openStepInPanel(step)
  }

  // What's resolvable as `{{…}}` in the fields, here and now: the
  // extractions from earlier steps when a step is being edited,
  // the scope of an ongoing step-by-step, then the active environment. The order
  // matches resolution order — an extraction hides the env variable of the same
  // name, as at run time (§2). Used by both the edit banner AND autocompletion:
  // both must offer exactly the same thing.
  const templateVariables = () => {
    const variables = []
    const seen = new Set()
    const add = (name, from) => {
      if (seen.has(name)) return
      seen.add(name)
      variables.push({ name, from })
    }
    const context = editingContext()
    if (context) {
      context.scenario.steps.slice(0, context.index).forEach((previous, i) => {
        for (const extract of previous.extract ?? []) add(extract.name, i + 1)
      })
    }
    for (const name of Object.keys(tryIt.runVariables ?? {})) add(name, 'run')
    // `variablesFor` and not the store: a credential the host provides IS
    // resolvable in a field, so it belongs in what autocompletion offers.
    for (const name of Object.keys(variablesFor())) add(name, null)
    return variables
  }

  attachVariableAutocomplete(tryIt, templateVariables)
  // The central doc carries the same fields, synced with the panel: typing
  // {{ there must offer the same thing.
  attachVariableAutocomplete(doc, templateVariables)

  const showEditBar = () => {
    const context = editingContext()
    if (!context) {
      editBar.state = null
      syncPanels()
      return
    }
    editBar.state = {
      index: context.index,
      total: context.scenario.steps.length,
      scenarioName: context.scenario.name,
      variables: templateVariables(),
    }
    syncPanels()
  }

  const endStepEditing = () => {
    editingStep = null
    editBar.state = null
    syncPanels()
  }

  // Panel request as it would be saved, or null if the panel
  // changed operation in the meantime.
  const editedRequest = (step) => (tryIt.operationId === step.opId ? tryIt.captureRequest() : null)

  editBar.onSave = () => {
    const context = editingContext()
    if (!context) {
      endStepEditing()
      return
    }
    const request = editedRequest(context.step)
    if (!request) {
      showToast('error', t('scenario.recaptureNeedsPanel'))
      return
    }
    const next = { ...context.scenario, steps: [...context.scenario.steps] }
    next.steps[context.index] = { ...context.step, request }
    writeScenario('update', () => scenarioStore.update(next))
    showToast('success', t('scenario.stepUpdated'))
  }

  editBar.onClose = () => {
    const context = editingContext()
    const request = context ? editedRequest(context.step) : null
    // Unsaved changes: the question only comes up here and nowhere
    // else — this is the only voluntary exit from the mode.
    const dirty = request && JSON.stringify(request) !== JSON.stringify(context.step.request)
    if (dirty && !window.confirm(t('scenario.edit.discardConfirm'))) return
    const scenarioId = editingStep?.scenarioId
    endStepEditing()
    if (scenarioId) window.location.hash = scenarioHash(scenarioId)
  }

  // Loads a step into the panel. The panel starts fresh: the step describes
  // THIS request, not a delta on whatever was lingering in the fields.
  const openStepInPanel = (step, { variables } = {}) => {
    const op = byId.get(step.opId)
    if (!op) return
    if (parseHash(window.location.hash).id === op.id) {
      tryIt.loadRequest({ op, request: step.request, variables })
      return
    }
    // The route isn't there yet: loading will happen on landing, in
    // a single render as well.
    if (variables !== undefined) tryIt.runVariables = variables
    pendingStep = step
    window.location.hash = opHash(op.id)
  }

  // An imported request lands exactly like a scenario step: same panel entry
  // point, same single render on arrival. Its credentials travel as run-scope
  // variables — a value pasted from someone else's terminal has no business
  // being written into the reader's stored environment.
  importDialog.onOpen = ({ opId, request, variables }) => {
    openStepInPanel({ opId, request }, { variables: variables ?? {} })
  }

  // Below lg the banners live in the bottom sheet: without opening it, a
  // step-by-step (or a step edit) started on mobile would show nothing.
  const revealStepper = () => {
    const active = stepController.active || editingStep !== null
    if (active && !window.matchMedia('(min-width: 1024px)').matches) setOpenPanel('tryit')
  }

  // The two origins land in the same lists, and both arrive late: the local
  // ones from IndexedDB, the declared ones from their documents.
  const refreshScenarioLists = () => {
    nav.scenarios = [
      ...configRecords.map((record) => ({
        id: record.id,
        title: record.title,
        source: 'config',
      })),
      ...localScenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.name,
        source: 'local',
      })),
    ]
    rebuildSearchIndex()
  }

  let scenariosReady = Promise.resolve()
  const syncScenarios = () => {
    if (!scenariosEnabled) return scenariosReady
    scenariosReady = scenarioStore
      .list()
      .then((scenarios) => {
        localScenarios = scenarios
      })
      // Database unavailable (private mode, quota): the doc and the config
      // scenarios remain usable, only the local ones are missing.
      .catch((err) => console.error('[api-doc] scenario store read failed:', err))
      .then(refreshScenarioLists)
    return scenariosReady
  }
  syncScenarios()

  // Declared scenarios, resolved once and off the boot critical path: a
  // `document` carried by the config needs nothing, a `url` is fetched. The
  // nav shows the declared labels until this lands; the routes wait for it,
  // since an Arazzo entry's ids are in its file and nowhere else.
  //
  // No human is watching at boot, so there is no toast: what a declared
  // document says and this app cannot run goes to the console — and, for the
  // reader who opens the scenario, onto the page (docs/scenarios.md §3).
  const configScenariosReady = configScenarios.length
    ? loadConfigScenarios(configScenarios, { ops: scenarioOps, fetchText: fetchTextCached }).then(
        (records) => {
          configRecords = records
          for (const record of records) {
            if (record.error)
              console.error('[api-doc] scenario load failed:', record.entryId, record.error)
            else if (record.warnings.length)
              console.warn('[api-doc] scenario issues:', record.id, record.warnings)
          }
          refreshScenarioLists()
          return records
        },
      )
    : Promise.resolve(configRecords)
  scenarioStore.addEventListener('change', () => syncScenarios().then(() => refreshScenarioRoute()))
  nav.onNewScenario = async () => {
    const scenario = createScenario({ name: t('scenario.newName') })
    const id = await writeScenario('creation', () => scenarioStore.add(scenario))
    if (id) window.location.hash = scenarioHash(id)
  }

  // Displaying a scenario: both origins may still be loading — hence the two
  // waits, bounded by the current route id (a navigation in the meantime
  // wins). Declared first, as they are the doc's own.
  let currentScenarioId = null
  const showScenario = async (id) => {
    currentScenarioId = id
    await configScenariosReady
    if (currentScenarioId !== id) return
    const record = configRecords.find((candidate) => candidate.id === id)
    if (record?.scenario) {
      scenarioView.source = {
        kind: 'config',
        scenario: record.scenario,
        warnings: record.warnings,
        // The authored document and the address it was declared at: what the CI
        // panel hands over as it stands, rather than a recipe regenerated from
        // our reading of it (docs/scenario-handoff.md §4).
        arazzo: record.arazzo,
        url: record.url,
      }
      mountScenarioView()
      // The route's own head, once the document that names it is in hand: the
      // synchronous pass at navigation time only had the section to go on, like
      // a docs page before its body lands.
      applyHead(
        headFor({ type: 'scenario', scenario: record.scenario, title: record.title }, model),
      )
      return
    }
    // A declared entry that produced nothing keeps its place: the config
    // promised this scenario, so the route says what became of it rather than
    // "does not exist".
    if (record) {
      showNotFound(t('scenario.loadError', { url: record.url || record.entryId }))
      return
    }
    await scenariosReady
    if (currentScenarioId !== id) return
    const local = localScenarios.find((s) => s.id === id)
    if (!local) {
      showNotFound(t('scenario.notFound'))
      return
    }
    scenarioView.source = { kind: 'local', scenario: local }
    mountScenarioView()
    applyHead(headFor({ type: 'scenario', scenario: local }, model))
  }
  // The displayed scenario was just modified elsewhere (creation, capture): the
  // view restarts from the up-to-date record.
  const refreshScenarioRoute = () => {
    if (currentScenarioId) showScenario(currentScenarioId)
  }

  // Schema audit: computed on the first visit to #/audit and never at boot —
  // the perf budget is a contract (rule 14) and the audit walks the whole raw
  // document. One report per page load, since switching spec reloads.
  const auditView = document.createElement('audit-report')
  // Same schema, same descriptor as the home page: someone auditing a document
  // is one step away from wanting the file itself.
  // Same descriptor, one word apart: the home page says what the reader is
  // looking at, this page says what the grade was computed on.
  auditView.download = {
    ...specDownload,
    notes: specDownloadNotes(model, loaded.overlays, { audit: true }),
    onError: () => showToast('error', t('welcome.specError')),
  }
  let auditReport = null
  let auditPending = null
  let auditVisible = false
  // Sliced rather than run in one go: on a schema the size of the demo's GitHub
  // one the audit is half a second of work, and half a second in a single task
  // is a frozen page — no frame, no click handled (rule 14, and the blocking
  // cap in tests/e2e/perf.spec.js). One rule per frame, the report at the end.
  const computeAudit = async () => {
    const run = auditRun(auditInput)
    let step = run.next()
    while (!step.done) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      step = run.next()
    }
    return step.value
  }
  const showAudit = async () => {
    if (!auditReport) {
      auditPending ??= computeAudit()
      auditReport = await auditPending
      // The reader may have navigated away while the slices ran: the report is
      // kept, the view is not forced back on them.
      if (!auditVisible) return
    }
    auditView.report = auditReport
    main.replaceChildren(auditView)
  }

  const showDocsPage = (page, anchor) => {
    // Prev/next from the flattened nav order (§5): the pager is set before the
    // page, which is what triggers the render.
    const index = pages.indexOf(page)
    mdPage.pager =
      index < 0 ? null : { prev: pages[index - 1] ?? null, next: pages[index + 1] ?? null }
    mdPage.page = page
    mdPage.anchor = anchor
    // Only when it is not already there: `replaceChildren` with the element it
    // already holds still detaches and reattaches it, and a reattached custom
    // element re-runs connectedCallback — a second full parse, sanitize and
    // highlight of the page we just rendered.
    if (main.firstChild !== mdPage) main.replaceChildren(mdPage)
  }

  // The head follows the route (docs/seo.md §3). A docs page's description
  // comes from its body, which may still be in flight: the title lands with the
  // navigation and the description catches up — unless the reader has moved on
  // by then, which the sequence number is there to notice. The body itself
  // costs nothing extra, the page component having asked for the same cached
  // fetch.
  let headSeq = 0
  const updateHead = (route) => {
    const seq = ++headSeq
    const op = route.type === 'op' ? (byId.get(route.id) ?? null) : null
    const page = route.type === 'page' ? (pageBySlug.get(route.id) ?? null) : null
    applyHead(headFor({ type: route.type, op, page }, model))
    if (!page) return
    loadDocsPageSource(page)
      .then(({ text, format }) => {
        if (seq === headSeq) applyHead(headFor({ type: 'page', page, text, format }, model))
      })
      .catch(() => {
        // An unreachable page shows an error where its prose would be; the
        // title-only head it already has is the honest description of that.
      })
  }

  // The technical welcome view. Rendered at `#/` by default and at #/overview
  // always — the route exists whether or not a page took the landing spot, so
  // a link to it never depends on the host's choice.
  //
  // Outside `showWelcome` on purpose: a history read landing on this route
  // rebuilds the view, and the MCP card's open state and bridge choice are the
  // reader's, not the render's.
  const mcpState = {}
  const showWelcome = () => {
    main.replaceChildren(
      welcomeView(model, {
        llmsFullExport,
        llmsTextExport,
        // Read at render time: the base URL follows the selected environment.
        mcp: mcpContext(),
        specDownload,
        notify: showToast,
        logoUrl: branding.logoUrl,
        scenarios: configScenarios,
        // The pinned card needs what only the loader knows (how many scenarios
        // an entry declares, and what they say); the card itself exists as soon
        // as one entry is pinned.
        scenariosResolved: configScenariosReady,
        ops: byId,
        mostUsed: topOperations(historyEntries, { specId: historyStore.specId }),
        onBuildSetupLink: envStore.locked ? null : openSetupBuilder,
        mcpState,
        onMcpState: (patch) => Object.assign(mcpState, patch),
      }),
    )
  }

  // The operation view, from wherever it is reached: the reference route and
  // the generated onboarding page, which shows the same view under a preamble.
  // One place wires `doc` and the panel — a property added to this sequence
  // must reach every route that shows an operation, and a second hand-written
  // copy would silently stop at the first one.
  //   pager  — reference neighbors, absent when the page is not a position in it
  //   req    — share payload from the route (#/op/{id}?req=…)
  //   intro  — node rendered above the doc
  // Whether the try-it rail has ever shown an operation this session — the
  // one case its render may leave the navigation task (see below).
  let panelHasOp = false
  const showOperation = (op, { pager = null, req = null, anchor = null, intro = null } = {}) => {
    const isWebhook = op.kind === 'webhook'
    doc.pager = pager ?? { prev: null, next: null }
    currentOpId = op.id
    // Visibility set BEFORE loading the panel: it's what decides
    // whether the panel bothers rereading its past calls.
    syncPanels(isWebhook ? 'webhook' : 'tryit')
    doc.changes = changesFor(op.id)
    doc.recentCalls = metricsOf(op.id)
    doc.operation = op
    // The document's global `security` describes calls TO the API: it doesn't
    // apply to webhooks — only their own `security` counts.
    doc.security = isWebhook
      ? applicableSchemes({ securitySchemes: model.securitySchemes, security: [] }, op)
      : applicableSchemes(model, op)
    if (isWebhook) {
      webhookSim.operation = op
    } else {
      // A step pending landing, or a share link
      // (#/op/{id}?req=…): the request arrives with the operation, in a single
      // render. An unreadable share payload is ignored (the doc displays
      // anyway).
      let request = null
      if (pendingStep?.opId === op.id) {
        request = pendingStep.request
        pendingStep = null
      } else if (req) {
        request = decodeShareState(req)
      }
      const carriesState =
        request !== null ||
        pendingHistoryEntry?.opId === op.id ||
        (!stepController.active && pendingDraft?.opId === op.id)
      // Cold panel and nothing to carry over: the panel build (and its share
      // of the layout) leaves the navigation's own task, so the doc — the
      // thing the reader clicked for — paints one task sooner. Only when the
      // rail held no operation: it renders into an empty aside, so nothing
      // stale can show. Any carried state keeps the single-render guarantee
      // of the comment above; the doc's mirror needs no ordering here — it
      // syncs on the panel's `tryit-state` push whenever that render lands.
      // An anchor route stays synchronous too: the doc scrolls to its section
      // at render, and the panel's later push can still resize what sits
      // above that section — scrolling first and shifting after loses the
      // anchor.
      if (!carriesState && !panelHasOp && !anchor) {
        let loaded = false
        const load = () => {
          if (loaded) return
          loaded = true
          pendingPanelLoad = null
          if (currentOpId === op.id) tryIt.loadRequest({ op, request: null })
        }
        // Exposed for the doc→panel listeners above: an interaction inside
        // the deferral window loads the panel before the message reaches it.
        pendingPanelLoad = load
        // After a produced frame, so the doc paints before the panel's build
        // joins the queue — with a plain timer as the backstop, because rAF
        // starves in a hidden tab and the panel must load there too.
        requestAnimationFrame(() => setTimeout(load, 0))
        setTimeout(load, 150)
      } else {
        tryIt.loadRequest({ op, request })
        if (pendingHistoryEntry?.opId === op.id) {
          tryIt.loadEntry(pendingHistoryEntry)
          pendingHistoryEntry = null
        }
        // Draft set aside by a step-by-step: given back when returning to its
        // endpoint, only once, and never during an ongoing run.
        if (!stepController.active && pendingDraft?.opId === op.id) {
          tryIt.restoreDraft(pendingDraft)
          pendingDraft = null
        }
      }
      panelHasOp = true
    }
    // Only when it is not already in place: `replaceChildren` with the element
    // it already holds still detaches and reattaches it, and a reattached
    // custom element re-runs connectedCallback — a second full build of the doc
    // we just rendered. Same pitfall as `showDocsPage` and `mountScenarioView`.
    // An intro is rebuilt on every visit, so that branch always replaces.
    if (intro) main.replaceChildren(intro, doc)
    else if (main.firstChild !== doc || main.childNodes.length > 1) main.replaceChildren(doc)
    doc.anchor = anchor
  }

  // The generated onboarding page: that same view, under a preamble. The three
  // steps it narrates are the try-it rail's own controls, so the reader ends up
  // on the panel they will use everywhere else. No prev/next: this page is a
  // way in, not a position in the reference.
  const showFirstCall = () =>
    showOperation(firstCallOp, {
      intro: firstCallIntro(firstCallOp, {
        hasAuth: applicableSchemes(model, firstCallOp).schemes.length > 0,
      }),
    })

  startRouter((route) => {
    // A setup link can also arrive without a boot: pasted into the address bar
    // of a tab already on this page, a hash-only change navigates the same
    // document. Same scrub, same preview — decision 3 is about the URL, not
    // about how the app happened to start. The initial emit never sees one,
    // `boot()` having scrubbed it before the router existed.
    const arriving = takeSetupLink()
    if (arriving) previewSetupLink(arriving)
    if (specsConfig.multi) {
      if (route.specId && route.specId !== activeSpec.id) {
        if (specsConfig.specs.some((s) => s.id === route.specId)) {
          // Navigation to another spec (deep-link pasted mid-
          // session): switch via reload while preserving the target hash —
          // resolution rule 2 (§4.2) will land it in the right place.
          writePref('spec.selected', route.specId)
          window.location.reload()
          return
        }
        // Unknown specId: silent fallback to the active spec's home.
        window.history.replaceState(null, '', homeHash())
        route = emptyRoute(activeSpec.id)
      }
    }
    nav.route = route
    // Leaving the edited step's operation exits editing: saving
    // from another endpoint would write that other endpoint's request.
    if (editingStep && !(route.type === 'op' && route.id === editingStep.opId)) endStepEditing()
    // A navigation closes the mobile panels (typically: clicking a
    // drawer link) and scrolls the sheet back to the top — the panel is re-rendered
    // for the new operation. Every scroll reset happens HERE, before the view
    // swap: a `scrollTop` write flushes layout, and flushing the outgoing
    // tree is free while flushing the one the swap just dirtied re-lays the
    // whole page out inside the navigation.
    closePanels()
    tryItAside.scrollTop = 0
    // A deep-link with an anchor sets its own scroll position during the
    // render below; the reset would be overwritten either way, but skipping
    // it keeps the anchor jump from racing a scroll that was never wanted.
    // Both scrollers, unconditionally: whichever one the breakpoint has left
    // flowing sits at 0 already, so the write it does not need costs nothing
    // and no media query has to be re-stated in JS.
    if (!route.anchor) {
      main.scrollTop = 0
      columns.scrollTop = 0
    }
    currentOpId = null
    currentScenarioId = null
    auditVisible = route.type === 'audit'
    if (route.type === 'op') {
      const op = byId.get(route.id)
      if (op) {
        const navIndex = navOrder.indexOf(op.id)
        showOperation(op, {
          pager: {
            prev: navIndex > 0 ? byId.get(navOrder[navIndex - 1]) : null,
            next: navIndex >= 0 ? (byId.get(navOrder[navIndex + 1]) ?? null) : null,
          },
          req: route.req,
          anchor: route.anchor,
        })
      } else {
        syncPanels('none')
        showNotFound(t('doc.opNotFound'))
      }
    } else if (route.type === 'scenario' || route.type === 'scenario-import') {
      syncPanels('none')
      // Feature disabled: a deep-link (bookmark, received share link) must neither
      // display nor import anything.
      if (!scenariosEnabled) showNotFound(t('scenario.notFound'))
      else if (route.type === 'scenario') showScenario(route.id)
      else showImport(route.data)
    } else if (route.type === 'audit') {
      syncPanels('none')
      // Feature disabled: a deep-link must not resolve either — the route is
      // gone, not merely unadvertised.
      if (auditEnabled) showAudit()
      else showNotFound(t('audit.disabled'))
    } else if (route.type === 'page') {
      syncPanels('none')
      const page = pageBySlug.get(route.id)
      if (page) showDocsPage(page, route.anchor)
      else showNotFound(t('doc.pageNotFound'))
    } else if (route.type === 'first-call') {
      // Deep-link to a page the host never enabled, or to one whose schema
      // offers no read: the route resolves to nothing rather than to an empty
      // onboarding.
      if (firstCallOp) showFirstCall()
      else {
        syncPanels('none')
        showNotFound(t('firstCall.unavailable'))
      }
    } else if (route.type === 'overview') {
      syncPanels('none')
      showWelcome()
    } else {
      syncPanels('none')
      // Home takeover (§2.4): a page claimed `#/`, so the technical welcome
      // view it displaced lives at #/overview and nowhere else.
      if (homePage) showDocsPage(homePage, route.anchor)
      else showWelcome()
    }
    // A navigation closes the panels: the step-by-step banner must reopen
    // the sheet, otherwise the next step would display into the void on mobile.
    revealStepper()
    updateHead(route)
  })

  if (setupPayload) previewSetupLink(setupPayload)

  return layout
}

// Host-provided credentials (docs/host-credentials.md §2). Created and
// published SYNCHRONOUSLY at module evaluation, before `boot()` starts
// awaiting anything: a `<script type="module">` placed after the app's own tag
// then finds `window.apidoc` already there, with no readiness dance. Classic
// scripts run before every module and cannot — the `apidoc:ready` event is
// their way in.
//
// `apidoc` is name-neutral on purpose: it is host-facing contract surface that
// outlives releases, exactly like the storage keys (architecture.md §14.11).
const hostCredentials = new HostCredentials()
installHostApi(hostCredentials)

function installHostApi(host) {
  if (window.apidoc) {
    // Double script include: the other copy may already hold a live provider
    // registration, and clobbering it would silently unregister the host.
    console.warn('[api-doc] window.apidoc already exists — keeping the existing object')
    return
  }
  const api = {
    registerCredentialsProvider: (fn) => host.registerProvider(fn),
    setCredentials: (map) => host.set(map),
    clearCredentials: () => host.clear(),
  }
  window.apidoc = api
  document.dispatchEvent(new CustomEvent('apidoc:ready', { detail: api }))
}

// Setup link (docs/env-setup-link.md §4.1): the payload moves to memory and
// `replaceState` rewrites the current history entry, so the credential-bearing
// URL is neither in the address bar nor in session history. The scrub is
// textual, so a `#/s/{id}/` prefix survives it and spec resolution is
// unaffected. Returns the payload, or null when the hash carried none.
function takeSetupLink() {
  const { payload, scrubbedHash } = parseSetupLink(window.location.hash)
  if (payload) window.history.replaceState(null, '', scrubbedHash)
  return payload
}

async function boot() {
  // Before anything else reads the hash, and long before anything renders.
  const setupPayload = takeSetupLink()

  const rootConfig = readHostConfig()

  // Before anything renders, and before the first await: a `noindex` that
  // lands after the schema round trip is a `noindex` a crawler can miss, and
  // the error views below are as indexable as the app itself.
  if (rootConfig.seo.index === false) applyNoIndex()

  // The active spec is resolved BEFORE the theme and the language: both are
  // overridable per spec, and we need to know which one is active to read
  // the right values. Resolution is purely local (hash, preference,
  // pending OAuth) — no network, nothing to wait for.
  let specsConfig = null
  let specsError = null
  try {
    specsConfig = normalizeSpecsConfig(rootConfig.openapi)
  } catch (err) {
    specsError = err
  }

  // Active spec (§4.2), then states locked for the page's lifetime: route
  // prefix, storage namespace. In mono-spec, everything stays bare.
  let activeSpec = specsConfig?.specs[0] ?? null
  if (specsConfig?.multi) {
    const activeId = resolveActiveSpecId(specsConfig, [
      pendingOAuthSpecId(),
      parseHash(window.location.hash).specId,
      readPref('spec.selected'),
    ])
    activeSpec = specsConfig.specs.find((s) => s.id === activeId)
    setRouteSpecId(activeId)
    setSpecScope(activeId)
  }

  // Manifest form of `docsPages` (docs-pages.md §2.2): the only config value
  // that can require the network. Started here and awaited next to the schema
  // load, never before it — nothing between here and the first paint reads
  // `docsPages`, and blocking on it would leave a themeless blank page for a
  // whole round trip. Null when no manifest is named, which is the inline
  // form: it went through `resolveSpecConfig` below like every other key.
  const docsSources = loadDocsSources({
    root: rootConfig.docsPages,
    spec: activeSpec?.docsPages,
  })

  // Effective config of the active spec. Broken specs config: fall back to
  // the root, solely so the error message displays in the installation's theme
  // and language rather than defaulting to English.
  let config = rootConfig
  if (activeSpec) {
    const resolved = resolveSpecConfig(rootConfig, activeSpec, { multi: specsConfig.multi })
    config = resolved.config
    for (const warning of [...specsConfig.warnings, ...resolved.warnings])
      console.warn('[api-doc]', warning)
  }

  // The schema load starts here, before the theme/language/loading-view
  // preamble below: its first stages are transfer and parse, and every
  // millisecond of chrome work they overlap is one off the first paint of the
  // doc (rule 14). Guarded by the same conditions the error paths below
  // check, so a boot that returns before the await never leaves an abandoned
  // rejection behind — and the no-op catch covers the window up to the await,
  // where the real handling stays.
  let loadPromise = null
  if (!specsError && activeSpec && (activeSpec.spec || activeSpec.url)) {
    const options = {
      hide: config.openapi.hide,
      overlays: config.openapi.overlays,
      userOverlay: config.openapi.userOverlay,
    }
    // The transfer that module evaluation already started, handed over only
    // when it is for the exact URL this boot resolved — anything else falls
    // through to the loader's own fetch.
    if (!activeSpec.spec && prefetchedSchema?.url === activeSpec.url) {
      options.response = prefetchedSchema.response
      options.body = prefetchedSchema.body
    }
    loadPromise = activeSpec.spec
      ? loadInlineApiModel(activeSpec.spec, options)
      : loadApiModel(activeSpec.url, options)
    loadPromise.catch(() => {})
  }

  // Read from the root config, not the effective one: branding the chrome is an
  // installation-wide concern (decision 7), so a per-spec `theme` override
  // narrows what is selectable but never redefines a theme. `available` is the
  // effective one — that is the list the switcher will actually offer.
  injectCustomThemes(rootConfig.theme.custom, config.theme.available, cssLink)

  const themeConfig = { available: config.theme.available, fallback: config.theme.default }
  document.documentElement.dataset.theme = resolveInitialTheme(themeConfig)
  followSystemTheme(themeConfig)

  // Active language BEFORE any render: even the loading state is translated.
  // setLanguage falls back to the bundled English on network failure.
  const language = resolveInitialLanguage({
    available: config.language.available,
    fallback: config.language.default,
  })
  if (language !== 'en') await setLanguage(language)
  document.documentElement.lang = currentLanguage()

  const root = el('div')
  document.body.append(root)

  if (specsError) {
    // Config error (invalid/duplicate id, inconsistent url or default):
    // the actionable detail is in the console, intended for the integrator.
    console.error(
      '[api-doc]',
      specsError instanceof SpecConfigError ? specsError.message : specsError,
    )
    root.replaceChildren(errorView(t('app.invalidSpecs')))
    return
  }

  if (!activeSpec.url && !activeSpec.spec) {
    root.replaceChildren(errorView(t('app.noSchemaUrl')))
    return
  }
  root.replaceChildren(loadingView())
  try {
    const [loaded, docs] = await Promise.all([loadPromise, docsSources])
    // A manifest was named: its entries replace the string the first merge saw
    // and go through the same rule. `null` means the inline form, already
    // merged above.
    if (docs) {
      const warnings = []
      config = { ...config, docsPages: mergeDocsPages(docs.root, docs.spec, warnings) }
      for (const warning of warnings) console.warn('[api-doc]', warning)
    }
    root.replaceChildren(
      appLayout(loaded, config, specsConfig, activeSpec, {
        docsError: docs?.error ?? null,
        setupPayload,
      }),
    )
  } catch (err) {
    console.error('[api-doc]', err, err?.detail?.cause ?? '')
    root.replaceChildren(errorView(loadErrorMessage(err)))
  }
}

boot()
