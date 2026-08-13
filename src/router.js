// Hash routing (docs/architecture.md §5.2): #/op/{id}[/{anchor}][?req=…] and
// #/page/{slug}[/{anchor}], prefixed with #/s/{specId}/ in multi-spec
// (docs/multi-spec.md §4). Parsing/building functions are pure
// (tested), only startRouter touches window.

// Active spec for the builders, locked once at boot by the shell: a
// spec change reloads the page, so the prefix never varies during the
// application's lifetime — builders remain referentially transparent after
// boot. null = mono-spec, bare routes (unchanged historical forms).
let routeSpecId = null

export function setRouteSpecId(specId) {
  routeSpecId = specId || null
}

function prefix() {
  return routeSpecId ? `#/s/${encodeURIComponent(routeSpecId)}` : '#'
}

// Import route for a shared scenario (docs/scenarios.md §8.2): it doesn't designate
// anything in the doc, all its content is in the payload.
const IMPORT_ROUTE = '/scenario-import'

// Schema audit (docs/audit.md §6): a single page per spec, so no id segment —
// the route designates the whole document.
const AUDIT_ROUTE = '/audit'

// Technical welcome view (docs/docs-pages.md §2.4). Always exists: without a
// home takeover it simply shows what `#/` already shows, so a link to it never
// depends on how the host chose to arrange its landing page.
const OVERVIEW_ROUTE = '/overview'

// Generated onboarding page (docs/architecture.md §5.5.7), gated by
// `features.onboarding`. Like the audit, it designates the whole document —
// the endpoint it walks through is picked from the schema, not from the URL,
// so the link keeps working when the schema changes.
const FIRST_CALL_ROUTE = '/first-call'

// Shape of a route with no target: defined here, so that fallbacks (unknown
// specId) don't recopy a literal that would age with every new field.
export function emptyRoute(specId = null) {
  return { specId, type: null, id: null, anchor: null, req: null, data: null }
}

export function parseHash(hash) {
  // The query part of the hash carries opaque payloads (pre-filled
  // request sharing, shared scenario): separated before route parsing.
  // Encoded segments never contain a literal `?`
  // (encodeURIComponent).
  const [route, queryString] = String(hash ?? '').split('?')
  const params = queryString ? new URLSearchParams(queryString) : null
  const req = params?.get('req') ?? null
  const data = params?.get('d') ?? null
  // Optional spec segment (#/s/{id}/…): detached before the route
  // is parsed, which keeps its historical shape. Present alone (#/s/{id}/), it gives
  // the spec's home (type null).
  let specId = null
  let rest = route
  const specMatch = /^#\/s\/([a-z0-9-]+)(?:\/(.*))?$/.exec(route)
  if (specMatch) {
    specId = specMatch[1]
    rest = `#/${specMatch[2] ?? ''}`
  }
  if (rest === `#${IMPORT_ROUTE}` || rest === `#${IMPORT_ROUTE}/`) {
    return { ...emptyRoute(specId), type: 'scenario-import', data: data || null }
  }
  if (rest === `#${AUDIT_ROUTE}` || rest === `#${AUDIT_ROUTE}/`) {
    return { ...emptyRoute(specId), type: 'audit' }
  }
  if (rest === `#${OVERVIEW_ROUTE}` || rest === `#${OVERVIEW_ROUTE}/`) {
    return { ...emptyRoute(specId), type: 'overview' }
  }
  if (rest === `#${FIRST_CALL_ROUTE}` || rest === `#${FIRST_CALL_ROUTE}/`) {
    return { ...emptyRoute(specId), type: 'first-call' }
  }
  const match = /^#\/(op|page|scenario)\/(.+)$/.exec(rest)
  if (!match) return emptyRoute(specId)
  // The segment after the id is an anchor: title in a page, section of an
  // endpoint. Encoded ids (opHash/pageHash) never contain a `/`.
  const [id, ...segments] = match[2].split('/')
  if (!id) return emptyRoute(specId)
  return {
    specId,
    type: match[1],
    id: decodeURIComponent(id),
    anchor: segments.length ? decodeURIComponent(segments.join('/')) : null,
    req: req || null,
    data: null,
  }
}

// Environment setup link (docs/env-setup-link.md §4.1): the payload
// rides as a `setup` pseudo-query, so the link keeps its destination. Read
// once at boot and stripped before the router ever runs — hence a separate
// function, and hence a purely textual scrub: what is left must be
// byte-identical to what was there, so that `replaceState` rewrites the URL
// without disturbing the route (or another payload) it carries.
export function parseSetupLink(hash) {
  const raw = String(hash ?? '')
  const cut = raw.indexOf('?')
  if (cut < 0) return { payload: null, scrubbedHash: raw }
  const route = raw.slice(0, cut)
  const kept = []
  let payload = null
  let found = false
  for (const part of raw.slice(cut + 1).split('&')) {
    if (part !== 'setup' && !part.startsWith('setup=')) {
      kept.push(part)
      continue
    }
    // A repeated parameter is stripped whole and only the first is read.
    if (found) continue
    found = true
    const value = part.slice('setup='.length)
    try {
      payload = decodeURIComponent(value) || null
    } catch {
      // Malformed percent-encoding: still scrubbed, and left to the decoder
      // to refuse like any other corrupt payload.
      payload = value || null
    }
  }
  if (!found) return { payload: null, scrubbedHash: raw }
  const rest = kept.join('&')
  const scrubbed = rest ? `${route}?${rest}` : route
  // A hash reduced to nothing by the scrub would leave the address bar
  // showing the host page's own URL: back to the app's home instead.
  return { payload, scrubbedHash: scrubbed === '' || scrubbed === '#' ? '#/' : scrubbed }
}

export function opHash(id, anchor = null) {
  return `${prefix()}/op/${encodeURIComponent(id)}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`
}

// Share link: the payload (base64url, so URL-safe as-is) travels as a
// pseudo-query of the hash, never in the real query string — the host page
// must not reload.
export function opShareHash(id, req) {
  return `${prefix()}/op/${encodeURIComponent(id)}?req=${req}`
}

// Scenario (docs/scenarios.md §5.1): no anchor, the view is a single block.
export function scenarioHash(id) {
  return `${prefix()}/scenario/${encodeURIComponent(id)}`
}

// Share link for a scenario: base64url payload (URL-safe as-is), as a
// pseudo-query of the hash like request sharing.
export function scenarioImportHash(encoded) {
  return `${prefix()}${IMPORT_ROUTE}?d=${encoded}`
}

// Setup link produced by the environment manager: the payload is a
// pseudo-query of the hash, like every other share link, and the generator has
// no way to build anything else — decision 2 (never the query string, which
// travels to the server and into its logs) holds by construction rather than
// by discipline. The destination is the active spec's home: a shared
// environment designates an API, not an endpoint.
export function setupLinkHash(encoded) {
  return `${prefix()}/?setup=${encoded}`
}

export function auditHash() {
  return `${prefix()}${AUDIT_ROUTE}`
}

export function overviewHash() {
  return `${prefix()}${OVERVIEW_ROUTE}`
}

export function firstCallHash() {
  return `${prefix()}${FIRST_CALL_ROUTE}`
}

export function pageHash(slug, anchor = null) {
  return `${prefix()}/page/${encodeURIComponent(slug)}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`
}

// Active spec's home: target of the brand and of route fallbacks.
export function homeHash() {
  return routeSpecId ? `${prefix()}/` : '#/'
}

// Immediately emits the current route: this is what restores the view on
// load for a deep link.
export function startRouter(onChange) {
  const emit = () => onChange(parseHash(window.location.hash))
  window.addEventListener('hashchange', emit)
  emit()
  return () => window.removeEventListener('hashchange', emit)
}
