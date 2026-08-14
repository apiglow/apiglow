// Network insights (docs/network-insights.md): what the browser already knows
// about a send, read back as facts — recognized response headers (§4.1), the
// Resource Timing snapshot (§5.1), and the verdict of a failure that never
// produced an HTTP response (§3).
//
// No DOM and no wording here: every parser returns data, rendering owns the
// strings (rule 9). Every browser fact enters as an argument, so the same
// functions serve a fresh response and an archived history entry — which is
// what lets header insights be recomputed at render time instead of stored
// (spec decision 3).

// ---------------------------------------------------------------------------
// §4.1 Response header registry
// ---------------------------------------------------------------------------

// One entry per family, one parser each; the order is the order insights come
// back in, and therefore the chip order of the strip. A parser returns null
// when it recognizes nothing — a malformed value yields no insight, never a
// broken one (§4.1).
const HEADER_FAMILIES = [
  { kind: 'rate-limit', parse: parseRateLimit },
  { kind: 'retry-after', parse: parseRetryAfter },
  { kind: 'deprecation', parse: parseDeprecation },
  { kind: 'pagination', parse: parsePagination },
  { kind: 'correlation', parse: parseCorrelation },
  { kind: 'validators', parse: parseValidators },
]

// Safe methods, the only ones the two §4.2 actions are offered on (decision 5).
const REPLAYABLE_METHODS = ['GET', 'HEAD']

// Rate-limit fields: IETF draft name first, legacy `X-` variant as fallback.
const RATE_LIMIT_LIMIT = ['ratelimit-limit', 'x-ratelimit-limit']
const RATE_LIMIT_REMAINING = ['ratelimit-remaining', 'x-ratelimit-remaining']
const RATE_LIMIT_RESET = ['ratelimit-reset', 'x-ratelimit-reset']

// Quota nearly exhausted — the threshold that turns the chip's tone to warning.
const RATE_LIMIT_LOW_RATIO = 0.1

// `Retry-After` is only a fact on the two statuses that define it.
const RETRY_AFTER_STATUSES = [429, 503]

// Ordered by how specific the id is: a W3C trace context beats a vendor id.
const CORRELATION_HEADERS = [
  'traceparent',
  'x-request-id',
  'x-correlation-id',
  'x-amzn-requestid',
  'cf-ray',
]

// RFC 8288 rels worth an action or a mention, in the order the strip wants
// them. `previous` is the IANA-registered spelling of `prev`; servers use both.
const PAGINATION_RELS = ['next', 'prev', 'first', 'last']
const REL_ALIASES = { previous: 'prev' }

/**
 * @param {Array<[string,string]>} headers - stored response headers, as `send()` records them.
 * @param {object} context
 * @param {number} context.status - HTTP status, gates `Retry-After`.
 * @param {string} context.method - request method, gates the §4.2 actions.
 * @param {string} context.url - request URL, the base `Link` targets resolve against.
 * @param {number} context.now - instant the deltas are relative to; pass the entry's
 *   timestamp to read an archived response as of when it arrived.
 * @returns {Array<{kind: string}>}
 */
export function analyzeResponseHeaders(
  headers,
  { status = 0, method = 'GET', url = '', now } = {},
) {
  const context = {
    get: headerReader(headers),
    status: Number(status) || 0,
    method: String(method ?? '').toUpperCase(),
    url: String(url ?? ''),
    now: Number.isFinite(now) ? now : Date.now(),
  }
  const insights = []
  for (const { kind, parse } of HEADER_FAMILIES) {
    const parsed = parse(context)
    if (parsed) insights.push({ kind, ...parsed })
  }
  return insights
}

// → get('ratelimit-reset', 'x-ratelimit-reset'), first non-empty wins.
// Duplicate names are joined the way `Headers.entries()` would have: a `Link`
// header sent twice must parse as the single list it is.
function headerReader(headers) {
  const byName = new Map()
  for (const pair of Array.isArray(headers) ? headers : []) {
    const [name, value] = Array.isArray(pair) ? pair : []
    if (typeof name !== 'string' || value == null) continue
    const key = name.trim().toLowerCase()
    const text = String(value)
    byName.set(key, byName.has(key) ? `${byName.get(key)}, ${text}` : text)
  }
  return (...names) => {
    for (const name of names) {
      const value = byName.get(name)?.trim()
      if (value) return value
    }
    return null
  }
}

function parseRateLimit({ get, now }) {
  const limit = integer(get(...RATE_LIMIT_LIMIT))
  const remaining = integer(get(...RATE_LIMIT_REMAINING))
  const resetSeconds = countdown(get(...RATE_LIMIT_RESET), now)
  if (limit === null && remaining === null && resetSeconds === null) return null
  return { limit, remaining, resetSeconds, low: isQuotaLow(limit, remaining) }
}

function isQuotaLow(limit, remaining) {
  if (remaining === null) return false
  if (limit === null || limit === 0) return remaining === 0
  return remaining / limit <= RATE_LIMIT_LOW_RATIO
}

function parseRetryAfter({ get, status, now }) {
  if (!RETRY_AFTER_STATUSES.includes(status)) return null
  const seconds = delaySeconds(get('retry-after'), now)
  return seconds === null ? null : { seconds }
}

function parseDeprecation({ get }) {
  const { deprecated, deprecatedDate } = parseDeprecationHeader(get('deprecation'))
  const sunsetDate = httpDate(get('sunset'))
  if (!deprecated && sunsetDate === null) return null
  return { deprecated, deprecatedDate, sunsetDate }
}

// Three forms in the wild: the RFC 9745 structured Date (`@1735689600`), the
// boolean of the earlier drafts, and the HTTP-date of the drafts in between.
function parseDeprecationHeader(raw) {
  const none = { deprecated: false, deprecatedDate: null }
  if (!raw) return none
  const value = raw.trim()
  if (/^true$/i.test(value)) return { deprecated: true, deprecatedDate: null }
  if (/^false$/i.test(value)) return none
  const stamp = /^@(-?\d+)$/.exec(value)
  if (stamp) return { deprecated: true, deprecatedDate: Number(stamp[1]) * 1000 }
  const date = httpDate(value)
  return date === null ? none : { deprecated: true, deprecatedDate: date }
}

function parsePagination({ get, url, method }) {
  const links = parseLinkHeader(get('link'), url)
  if (!links.length) return null
  return { links, followable: REPLAYABLE_METHODS.includes(method) }
}

// Bounded by the angle brackets rather than split on commas: a cursor URL may
// well contain one. Everything between a `>` and the next `<` is that link's
// parameter list.
const LINK_VALUE = /<([^>]*)>([^<]*)/g
const LINK_REL = /;\s*rel\s*=\s*(?:"([^"]*)"|([^";,\s]+))/i

function parseLinkHeader(raw, base) {
  if (!raw) return []
  const found = new Map()
  for (const [, target, params] of raw.matchAll(LINK_VALUE)) {
    const rels = LINK_REL.exec(params)
    if (!rels) continue
    const resolved = absoluteHttpUrl(target, base)
    if (!resolved) continue
    // A link-value may carry several rels; only the recognized ones interest us.
    for (const token of (rels[1] ?? rels[2]).trim().toLowerCase().split(/\s+/)) {
      const rel = REL_ALIASES[token] ?? token
      if (PAGINATION_RELS.includes(rel) && !found.has(rel)) found.set(rel, resolved)
    }
  }
  return PAGINATION_RELS.filter((rel) => found.has(rel)).map((rel) => ({
    rel,
    url: found.get(rel),
  }))
}

// The server built these URLs, so they are followed literally — but a `Link`
// pointing at `javascript:` or `data:` never becomes a button (rule 5).
function absoluteHttpUrl(target, base) {
  try {
    const url = new URL(target.trim(), base || undefined)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function parseCorrelation({ get }) {
  for (const name of CORRELATION_HEADERS) {
    const value = get(name)
    if (value) return { name, value }
  }
  return null
}

function parseValidators({ get, method }) {
  const etag = get('etag')
  const raw = get('last-modified')
  // Kept only when it parses: an unusable date would offer an
  // `If-Modified-Since` the server can only reject.
  const lastModified = httpDate(raw) === null ? null : raw
  if (!etag && !lastModified) return null
  // Precedence, and what the conditional replay sends: `If-None-Match` when an
  // ETag exists, `If-Modified-Since` otherwise (§4.2).
  return { etag: etag ?? null, lastModified, replayable: REPLAYABLE_METHODS.includes(method) }
}

// A leading integer, tolerating the IETF quota-policy tail (`100, 100;w=60`).
const LEADING_INTEGER = /^\s*(\d+)\s*(?:[,;][\s\S]*)?$/

function integer(raw) {
  const match = raw === null ? null : LEADING_INTEGER.exec(raw)
  return match ? Number(match[1]) : null
}

// `RateLimit-Reset` is delta-seconds in the IETF draft, but the legacy
// `X-RateLimit-Reset` is a Unix timestamp at most large APIs. No delta is
// decades long, so the magnitude tells the two apart unambiguously.
const EPOCH_SECONDS_FLOOR = 1e9
const EPOCH_MILLIS_FLOOR = 1e12

function countdown(raw, now) {
  const value = integer(raw)
  if (value === null) return null
  if (value >= EPOCH_MILLIS_FLOOR) return fromNow(value, now)
  if (value >= EPOCH_SECONDS_FLOOR) return fromNow(value * 1000, now)
  return value
}

// `Retry-After`: delta-seconds or HTTP-date (RFC 9110).
function delaySeconds(raw, now) {
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)
  return fromNow(httpDate(raw), now)
}

function httpDate(raw) {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isNaN(parsed) ? null : parsed
}

// Never negative: a target already past is "now", not a countdown running
// backwards.
function fromNow(instant, now) {
  return instant === null ? null : Math.max(0, Math.round((instant - now) / 1000))
}

// ---------------------------------------------------------------------------
// §5.1 Transfer snapshot
// ---------------------------------------------------------------------------

/**
 * Reads a PerformanceResourceTiming entry into a storable snapshot.
 * @returns {{protocol: string, transferSize?: number, encodedBodySize?: number,
 *   decodedBodySize?: number, fromCache?: boolean}|null}
 */
export function extractTransfer(entry) {
  if (!entry) return null
  const protocol = typeof entry.nextHopProtocol === 'string' ? entry.nextHopProtocol.trim() : ''
  const transferSize = byteCount(entry.transferSize)
  const encodedBodySize = byteCount(entry.encodedBodySize)
  const decodedBodySize = byteCount(entry.decodedBodySize)
  // Cross-origin without `Timing-Allow-Origin`, every size reads 0 — which is
  // indistinguishable from "no data", so it is treated as none (decision 2).
  // `nextHopProtocol` survives some of those cases and is kept alone.
  if (encodedBodySize === 0 && transferSize === 0) return protocol ? { protocol } : null
  return {
    protocol,
    transferSize,
    encodedBodySize,
    decodedBodySize,
    fromCache: isFromCache(entry, transferSize, encodedBodySize),
  }
}

// `deliveryType` states it outright where it exists; elsewhere, a body that
// arrived without crossing the wire is the signature of a cache hit.
function isFromCache(entry, transferSize, encodedBodySize) {
  if ('deliveryType' in entry) return entry.deliveryType === 'cache'
  return transferSize === 0 && encodedBodySize > 0
}

function byteCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

// ---------------------------------------------------------------------------
// §3 Failure diagnosis
// ---------------------------------------------------------------------------

// Long enough for a cold TLS handshake, short enough that the verdict arrives
// while the user is still looking at the error (§3.1).
const PROBE_TIMEOUT_MS = 5000

/**
 * Explains a fetch that died before any HTTP response. The checks of the §3.1
 * table run in order and the first verdict wins.
 *
 * @param {object} context
 * @param {string} context.url - the URL actually fetched: the proxied one when the
 *   proxy is on, because that is then what failed.
 * @param {boolean} context.proxied - re-words the `cors` verdict: a proxy answering
 *   without CORS headers is a proxy misconfiguration, not an API one.
 * @param {boolean} context.online - `navigator.onLine` at failure time (decision 7).
 * @param {string} context.pageProtocol - the page's own scheme, for the mixed-content check.
 * @param {(url: string, init: {signal: AbortSignal}) => Promise<unknown>} context.probe
 *   - injected like `fetchImpl` in `send()`.
 * @returns {Promise<{verdict: 'offline'|'mixed-content'|'cors'|'unreachable', proxied: boolean}>}
 */
export async function diagnoseFailure({
  url,
  proxied = false,
  online = globalThis.navigator?.onLine !== false,
  pageProtocol = globalThis.location?.protocol ?? '',
  probe = noCorsProbe,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  const verdict = (name) => ({ verdict: name, proxied: !!proxied })

  if (!online) return verdict('offline')
  if (pageProtocol === 'https:' && schemeOf(url) === 'http:') return verdict('mixed-content')
  return verdict((await isReachable(url, probe, timeoutMs)) ? 'cors' : 'unreachable')
}

// The timeout lives here rather than in the probe: an injected probe that never
// settles must time out like a real one, and the caller only has to say how long.
async function isReachable(url, probe, timeoutMs) {
  const controller = new AbortController()
  let timer
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(false)
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      Promise.resolve(probe(url, { signal: controller.signal })).then(
        () => true,
        () => false,
      ),
      timedOut,
    ])
  } finally {
    clearTimeout(timer)
  }
}

// Safe by construction (decision 4): one GET, no headers, no body, no
// credentials, and `no-cors` so the opaque response only ever proves that
// something answered. `no-store` because a cached answer would prove nothing
// about reachability now.
function noCorsProbe(url, { signal }) {
  return globalThis.fetch(url, {
    method: 'GET',
    mode: 'no-cors',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    signal,
  })
}

function schemeOf(url) {
  try {
    return new URL(url).protocol
  } catch {
    return null
  }
}
