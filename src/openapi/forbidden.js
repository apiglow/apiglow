// What a page's script may not put on a request, as the Fetch standard words it
// (fetch.spec.whatwg.org, "forbidden request-header" and "forbidden method").
// A browser drops such a header without a word and throws on such a method, so
// the try-it has to say it itself; the audit flags a document that relies on
// either. The lists are the standard's, not a guess at what one engine does:
// `User-Agent` left them, and Chromium dropping it anyway is not a rule.

const FORBIDDEN_METHODS = new Set(['connect', 'trace', 'track'])

const FORBIDDEN_HEADER_NAMES = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
])

const METHOD_OVERRIDE_HEADERS = new Set([
  'x-http-method',
  'x-http-method-override',
  'x-method-override',
])

export function isForbiddenMethod(method) {
  return FORBIDDEN_METHODS.has(String(method ?? '').toLowerCase())
}

// The method-override headers are forbidden only when they smuggle a forbidden
// method in, so they need the value: without one they read as allowed. The
// standard's split on commas keeps a quoted string whole; a plain split only
// differs on a method named inside quotes, which no client sends.
export function isForbiddenRequestHeader(name, value) {
  const lower = String(name ?? '').toLowerCase()
  if (FORBIDDEN_HEADER_NAMES.has(lower)) return true
  if (lower.startsWith('proxy-') || lower.startsWith('sec-')) return true
  if (!METHOD_OVERRIDE_HEADERS.has(lower) || value === undefined || value === null) return false
  return String(value)
    .split(',')
    .some((method) => isForbiddenMethod(method.trim()))
}
