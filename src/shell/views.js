// The shell's static views: the home page, the header and footer bars, and the
// loading / error / not-found placeholders. Each takes its values as
// parameters — app.js remains the only module that reads the host config, and
// hands these the branding and the resolved model (rule 10).
import { downloadAction, downloadsBar } from '../components/download-action.js'
import { el, externalLink, text } from '../components/dom.js'
import { setupBuilderCard } from '../components/env-setup-builder.js'
import { externalDocsLink } from '../components/external-docs.js'
import { CLOCK_SVG } from '../components/icons.js'
import { markdownBlock } from '../components/markdown.js'
import { mcpCard } from '../components/mcp-card.js'
import { mostUsedCard } from '../components/most-used-card.js'
import { securitySchemesCard } from '../components/auth-overview.js'
import { pinnedScenariosCard } from '../components/scenario-pinned.js'
import { specStats } from '../components/spec-stats.js'
import { searchTrigger } from '../components/search-palette.js'
import { t } from '../i18n/index.js'
import { homeHash } from '../router.js'

export function loadingView() {
  return el(
    'div',
    'min-h-[60vh] flex items-center justify-center gap-3',
    el('span', 'loading loading-spinner loading-lg'),
    el('span', '', text(t('app.loading'))),
  )
}

export function errorView(message) {
  const alert = el('div', 'alert alert-error', el('span', '', text(message)))
  alert.setAttribute('role', 'alert')
  return el('div', 'max-w-2xl mx-auto mt-16 px-4', alert)
}

// Home view (no operation selected): general schema info,
// quick stats, explicit empty state for a schema with no operations.
export function welcomeView(
  model,
  {
    llmsFullExport = null,
    llmsTextExport = null,
    mcp = null,
    specDownload = null,
    notify = null,
    logoUrl = null,
    scenarios = [],
    scenariosResolved = null,
    ops = new Map(),
    mostUsed = [],
    onBuildSetupLink = null,
    mcpState = {},
    onMcpState = () => {},
  } = {},
) {
  const wrap = el('div', 'max-w-3xl')
  // The logo isn't decorative here: on the home page it identifies the API, next to
  // its name. Bigger than in the header, which is just a permanent reminder.
  let logo = null
  if (logoUrl) {
    logo = el('img', 'h-14 w-14 object-contain shrink-0')
    logo.src = logoUrl
    logo.alt = ''
  }
  wrap.append(
    el(
      'div',
      'flex items-center gap-4',
      logo,
      el(
        'div',
        'min-w-0',
        el('h1', 'text-3xl font-bold', text(model.info.title)),
        el(
          'p',
          'text-sm text-subtle mt-1 font-mono',
          text(`${model.info.version} — OpenAPI ${model.sourceVersion}`),
        ),
        // `summary` (3.1): one sentence, and the only part of `info` short
        // enough to sit in the title block — the description follows further
        // down, after the actions.
        model.info.summary ? el('p', 'text-base text-subtle mt-2', text(model.info.summary)) : null,
      ),
    ),
  )
  const meta = apiMetaLine(model.info, model.externalDocs)
  if (meta) wrap.append(meta)
  const stats = specStats([
    ['operations', model.operations.length],
    ['groups', model.groups.length],
    // A document with no webhook gets no webhook stat: an empty count says
    // nothing here, unlike on the audit page where it is part of the perimeter.
    ['webhooks', model.webhooks.length || null],
    ['securitySchemes', model.securitySchemes.length],
  ])
  stats.classList.add('mt-4')
  wrap.append(stats)
  const actions = []
  // The schema is public by nature (the browser has already downloaded it): making
  // it retrievable in one click avoids having to fetch it elsewhere.
  if (specDownload) {
    actions.push(
      downloadAction({
        help: t('welcome.specHelp'),
        helpText: t('welcome.specText'),
        label: t('welcome.specDownload'),
        filename: specDownload.filename,
        load: specDownload.load,
        notes: specDownload.notes,
        onError: () => notify?.('error', t('welcome.specError')),
      }),
    )
  }
  // Index before territory: llms.txt is what an agent fetches first, and it is
  // the file a host is expected to serve at its site root — llms-full.txt is
  // the expansion it follows.
  if (llmsTextExport) {
    actions.push(
      downloadAction({
        help: t('welcome.llmsTxtHelp'),
        helpText: t('welcome.llmsTxtText'),
        label: t('welcome.llmsTxtDownload'),
        filename: 'llms.txt',
        load: llmsTextExport,
      }),
    )
  }
  if (llmsFullExport) {
    actions.push(
      downloadAction({
        help: t('welcome.llmsHelp'),
        helpText: t('welcome.llmsText'),
        label: t('welcome.llmsDownload'),
        filename: 'llms-full.txt',
        load: llmsFullExport,
      }),
    )
  }
  const downloads = downloadsBar(actions)
  if (downloads) wrap.append(downloads)
  // Before the auth card: a pinned scenario is often the flow that implements
  // it — the executable version of what the card describes.
  const pinned = pinnedScenariosCard(scenarios, { ops, resolved: scenariosResolved })
  if (pinned) wrap.append(el('div', 'mt-4', pinned))
  // After what the API's editor chose to put forward, before the reference
  // material: on a return visit this is the shortcut back to your own work,
  // but it never outranks the doc's own pitch.
  const used = mostUsedCard(mostUsed, ops)
  if (used) wrap.append(el('div', 'mt-4', used))
  // Before the description and the servers: knowing how to authenticate
  // conditions everything else, and the detail of each scheme stays collapsed.
  const auth = securitySchemesCard(model.securitySchemes)
  if (auth) wrap.append(el('div', 'mt-4', auth))
  // After the auth card: the config it generates carries placeholders for the
  // very schemes that card describes.
  // The card's own state is the caller's to hold: this view is rebuilt whole on
  // writes that have nothing to do with it (§5.14).
  const mcpBlock = mcp ? mcpCard({ ...mcp, state: mcpState, onState: onMcpState }) : null
  if (mcpBlock) wrap.append(el('div', 'mt-4', mcpBlock))
  // Last of the take-away cards, and absent unless the shell hands over a
  // callback — under `environmentsLocked` there is nothing a link could
  // configure (docs/env-setup-link.md §3.5, decision 3).
  if (onBuildSetupLink) wrap.append(el('div', 'mt-4', setupBuilderCard(onBuildSetupLink)))
  if (!model.operations.length && !model.webhooks.length) {
    const empty = el('div', 'alert alert-info mt-4', el('span', '', text(t('welcome.empty'))))
    empty.setAttribute('role', 'note')
    wrap.append(empty)
  }
  const description = markdownBlock(model.info.description)
  if (description) wrap.append(el('div', 'mt-6', description))
  if (model.servers.length) {
    wrap.append(el('h2', 'text-xl font-bold mt-8 mb-3', text(t('welcome.servers'))))
    for (const server of model.servers) {
      wrap.append(
        el(
          'div',
          'flex flex-wrap items-center gap-2 py-1',
          el('code', 'font-mono text-sm bg-base-200 rounded px-2 py-0.5', text(server.url)),
          server.description ? el('span', 'text-sm text-subtle', text(server.description)) : null,
        ),
      )
    }
  }
  return wrap
}

// Who publishes this API, under what terms, and where to read more: the rest of
// the `info` block, on one line under the title. Each item is absent when the
// document says nothing rather than shown empty — this is what the schema
// declares, not a form to fill (`info-metadata` is the audit rule that asks for
// the missing ones).
function apiMetaLine(info, externalDocs) {
  const items = []
  const item = (label, value) => items.push(el('span', 'flex items-center gap-1', label, value))
  const dim = (label) => el('span', 'text-subtle', text(label))

  if (info.license) {
    // Newest-wins already dropped the `url` when an SPDX `identifier` is
    // declared: the identifier names the licence unambiguously, a URL only
    // points at one copy of it.
    const label = info.license.name ?? info.license.identifier
    const value = info.license.url
      ? externalLink('link link-hover', info.license.url, text(label))
      : el('span', '', text(label))
    if (info.license.identifier && info.license.identifier !== label) {
      value.append(el('span', 'font-mono text-subtle ms-1', text(info.license.identifier)))
    }
    item(dim(t('welcome.license')), value)
  }
  if (info.contact) {
    const href = info.contact.email ? `mailto:${info.contact.email}` : info.contact.url
    const label = info.contact.name ?? info.contact.email ?? info.contact.url
    item(
      dim(t('welcome.contact')),
      href ? externalLink('link link-hover', href, text(label)) : el('span', '', text(label)),
    )
  }
  if (info.termsOfService) {
    items.push(externalLink('link link-hover', info.termsOfService, text(t('welcome.terms'))))
  }
  const docs = externalDocsLink(externalDocs, 'link link-primary gap-1')
  if (docs) items.push(docs)
  if (!items.length) return null
  return el('div', 'flex flex-wrap items-center gap-x-5 gap-y-1 text-sm mt-4', ...items)
}

// Filename proposed for the schema download: the last segment of
// the URL, provided it looks like a file (the query is ignored, an
// endpoint like "/api/v3/openapi" has no usable name).
function schemaFilename(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
    return /\.(json|ya?ml)$/i.test(last) ? last : 'openapi.json'
  } catch {
    return 'openapi.json'
  }
}

// The gap between the page and the file it hands out (docs/user-overlay.md
// decision 10): everything on screen is the overlaid document, the download is
// the published one. "Exactly as published" is true of the file and says
// nothing about that gap, so the note is what closes it — and it stays out of
// the collapsed help text, which a reader opens after deciding to download,
// not before.
//
// Two independent ways the page and the file disagree, so two lines rather than
// one sentence: an overlay makes the file say LESS than the page, hiding makes
// it say MORE, and a reader deciding what to do with the download needs both
// facts separately.
//
// `audit` swaps the framing for the page that grades the patched document — and
// drops the hiding line entirely: the audit spans hidden operations (§ audit
// perimeter), so on that page the file and the grade cover the same operations
// and there is nothing to warn about.
export function specDownloadNotes(model, overlays, { audit = false } = {}) {
  const notes = []
  // Gated on `actions`, not on `count`: overlays that matched nothing left the
  // document identical to the file, and there is no divergence to announce.
  if (overlays?.actions) {
    const key = overlays.user
      ? audit
        ? 'audit.specOverlaidUser'
        : 'welcome.specOverlaidUser'
      : audit
        ? 'audit.specOverlaid'
        : 'welcome.specOverlaid'
    notes.push(t(key, { count: overlays.count }))
  }
  // Stated as a property of the file, not as a confession about the page: what
  // the reader is about to hand to a client generator declares operations this
  // documentation never showed them. Both sources of hiding count — the host's
  // `hide` patterns and the schema's own `x-apiglow-hide` — because the gap
  // they open is the same one.
  if (!audit && model.hiddenOperations) {
    notes.push(t('welcome.specHidden', { count: model.hiddenOperations }))
  }
  return notes
}

// Public source of the schema, as served (YAML stays YAML, external $refs
// unresolved): it's the API editor's file, not our normalized
// model. Inline schema: the config itself acts as the source.
export function specSourceDownload(activeSpec, schemaUrl) {
  const inline = activeSpec.spec
  if (inline != null) {
    return {
      filename: 'openapi.json',
      load: async () => (typeof inline === 'string' ? inline : JSON.stringify(inline, null, 2)),
    }
  }
  return {
    filename: schemaFilename(schemaUrl),
    // Second download of the same document: served by the browser cache
    // in the general case (same request as the loader's).
    load: async () => {
      const response = await fetch(schemaUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${schemaUrl}`)
      return response.text()
    },
  }
}

// Dead-end routes (unknown operation/page/scenario, disabled feature). The
// message keeps role=alert — it is the part that says WHAT failed — but the
// view's job is to offer the two ways out: home, and the palette when the
// shell can hand one over.
// `onSearch` is required, not an option: every dead end offers the same way
// out, and an optional one was silently omitted by nothing but forgetfulness.
export function notFoundView(message, onSearch) {
  const msg = el('p', 'text-subtle', text(message))
  msg.setAttribute('role', 'alert')
  const home = el('a', 'btn btn-primary btn-sm', text(t('notFound.home')))
  home.href = homeHash()
  const search = searchTrigger(onSearch, 'btn btn-ghost btn-sm gap-2')
  return el(
    'div',
    'max-w-2xl mx-auto mt-16 px-4 flex flex-col items-center text-center gap-3',
    el('h1', 'font-display text-heading', text(t('notFound.title'))),
    msg,
    el('div', 'flex flex-wrap items-center justify-center gap-2 mt-2', home, search),
  )
}

// Preamble of the generated "First call" page (docs/architecture.md §5.5.7),
// rendered above the ordinary view of the picked operation. It deliberately
// adds no control of its own: the three steps it numbers all happen in the
// try-it rail, which already holds the language row, the credentials cartouche
// and the Send button. A second set of them here would be a second source of
// truth (rule 20).
export function firstCallIntro(op, { hasAuth = false } = {}) {
  const steps = [
    t('firstCall.stepLanguage'),
    hasAuth ? t('firstCall.stepCredentials') : null,
    t('firstCall.stepSend'),
  ].filter(Boolean)
  const list = el('ol', 'flex flex-col gap-row mt-block')
  steps.forEach((step, i) => {
    list.append(
      el(
        'li',
        'flex items-baseline gap-inline',
        el(
          'span',
          'shrink-0 badge badge-primary badge-soft badge-sm font-mono tabular-nums',
          text(String(i + 1)),
        ),
        el('span', 'text-sm', text(step)),
      ),
    )
  })
  return el(
    'div',
    'max-w-3xl mb-section',
    el('h1', 'font-display text-display', text(t('firstCall.title'))),
    el('p', 'text-subtle mt-2', text(t('firstCall.intro'))),
    list,
    el(
      'p',
      'text-sm text-faint mt-block',
      text(t('firstCall.picked', { method: op.method.toUpperCase(), path: op.path })),
    ),
  )
}

// The search trigger the header centers from lg up (the drawer keeps its own
// below). A button dressed as a field: the real input lives in the palette.
export function headerSearchField(onOpen) {
  return searchTrigger(
    onOpen,
    'input input-sm w-72 xl:w-96 cursor-pointer items-center gap-2 bg-base-200/40 text-base-content/70 transition-colors hover:bg-base-200',
  )
}

export function header(
  branding,
  tools = [],
  apiVersion = null,
  leading = null,
  brandExtra = null,
  search = null,
) {
  // The branding block leads back to the home (of the active spec in multi-spec).
  const brand = el(
    'a',
    'flex items-center gap-3 px-2 rounded-box hover:bg-base-200 transition-colors',
  )
  brand.href = homeHash()
  if (branding.logoUrl) {
    const logo = el('img', 'h-8 w-8 object-contain')
    logo.src = branding.logoUrl
    logo.alt = ''
    brand.append(logo)
  }
  brand.append(
    el('span', 'font-display text-lg font-semibold tracking-tight', text(branding.productName)),
  )
  if (apiVersion)
    brand.append(el('span', 'badge badge-ghost badge-sm font-mono', text(String(apiVersion))))
  // Below md, the tools (env, history, theme, language) don't fit on the
  // same line as the branding: navbar-start/end each go full
  // width and the toolbar takes a second line, scrollable as a last
  // resort on very small screens. The threshold is md, not sm: the tools
  // aren't shrinkable (btn = flex-shrink 0) and, between 640 and 768,
  // overflowed navbar-end from the left, over the branding.
  // The centered search only exists from lg up — below, the drawer's own
  // trigger covers it, and one visible trigger at a time is what keeps the
  // palette's accessible name unambiguous.
  return el(
    'header',
    'navbar bg-base-100 border-b border-base-300 min-h-14 gap-1 flex-wrap gap-y-1 md:flex-nowrap',
    el('div', 'navbar-start min-w-0 gap-1 max-md:w-full', leading, brand, brandExtra),
    search ? el('div', 'navbar-center hidden lg:flex', search) : null,
    el(
      'div',
      // No overflow-x below md: a scrollable container would clip the
      // tools' dropdowns (the env selector first). The
      // tools wrap to a new line if they don't fit.
      'navbar-end gap-1 sm:gap-2 pe-2 max-md:w-full max-md:flex-wrap max-md:justify-start max-md:pb-1',
      ...tools,
    ),
  )
}

// Product footer: one thin line at the bottom of the app, always there. It
// names the TOOL (never the documented API — that is the header's job) and
// carries the only entry point to the license and third-party notices, which a
// CDN install ships no file for. Hence no switch to hide it; a host that needs
// its own legal links puts them here through `branding.footerLinks`.
//
// Below lg, everything stays left-aligned behind a reserved end padding: the
// "Try it" FAB floats at the bottom right, over this bar, and a credit link the
// thumb cannot reach is not a credit.
export function footer(links, onAbout) {
  const aboutBtn = el('button', 'link link-hover shrink-0', text(t('about.open')))
  aboutBtn.type = 'button'
  aboutBtn.dataset.aboutOpen = ''
  aboutBtn.addEventListener('click', onAbout)
  const hostLinks = links.map((link) => {
    const anchor = el('a', 'link link-hover shrink-0', text(link.label))
    anchor.href = link.url
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
    return anchor
  })
  return el(
    'footer',
    'flex items-center gap-x-3 border-t border-base-300 bg-base-100 px-3 py-1 text-xs text-subtle justify-start lg:justify-between max-lg:pe-40',
    el(
      'span',
      'truncate',
      text(t('about.poweredBy', { name: __APP_NAME__, version: __APP_VERSION__ })),
    ),
    el('div', 'flex items-center gap-3 shrink-0', ...hostLinks, aboutBtn),
  )
}

export function historyIcon() {
  // Inline icon (no icon dependency) — decorative only.
  const span = el('span', 'text-subtle')
  span.innerHTML = CLOCK_SVG
  span.setAttribute('aria-hidden', 'true')
  return span
}
