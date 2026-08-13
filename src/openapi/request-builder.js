import { interpolate } from '../env/interpolate.js'
import { bodyKind } from './body-kind.js'
import {
  encodePair,
  findParam,
  isObjectValue,
  objectPathValue,
  objectQueryPairs,
  pathValue,
  queryPairs,
  readQueryValues,
  toValueEntries,
  toValueList,
} from './params.js'

// Assembling the try-it request (docs/architecture.md §5.5) — pure function, tested.
//
// All user inputs (baseUrl, parameter values, headers,
// body) can contain {{variables}}: each piece is interpolated and
// missing ones are aggregated into `missing` — sending is blocked as long as
// missing or errors isn't empty, the literal {{var}} is never sent.

const JSON_MEDIA_RE = /json/i

// The base an operation's requests actually target. The model folds path-level
// `servers` into the operation (operation > path), so one lookup here settles
// the whole precedence chain: pinned operation server, else the caller's base
// (environment override or root server). Display surfaces use it too, so the
// URL a reader sees is the URL the send will hit.
export function effectiveBaseUrl(op, baseUrl) {
  return op?.servers?.[0]?.url ?? baseUrl ?? ''
}

export function buildRequest({
  op,
  baseUrl = '',
  pathValues = {},
  queryValues = {},
  // `in: cookie` parameters. Folded into the `Cookie` header exactly like a
  // cookie credential — and dropped by the browser exactly as well (T3).
  cookieValues = {},
  // Names of query parameters explicitly sent as `name=` (`allowEmptyValue`).
  // A blank field still means "don't send": the empty value has to be asked
  // for, it is never what an untouched field meant.
  emptyValues = [],
  // 3.2 `in: querystring`: entire query string provided as-is.
  queryString = '',
  headerRows = [],
  body = '',
  // multipart/form-data and x-www-form-urlencoded bodies: list of fields
  // { name, value, fileName } instead of a text body.
  formFields = null,
  // Binary body: the picked file's METADATA only ({ name, size, type }). The
  // File itself never reaches this function — it stays in the editor's state
  // and goes straight to `send`, so nothing here, in the history or in a
  // share link can ever hold its content.
  file = null,
  mediaType = null,
  bodySchema = null,
  // Encoding Objects of the selected media type, by property name — how each
  // field of a composite body is serialized (`model.js` → `contents[i]`).
  encodings = null,
  authInjection = null,
  variables = {},
}) {
  const missing = new Set()
  const used = new Map()
  const errors = []
  const resolve = (template) => {
    const r = interpolate(template, variables)
    for (const name of r.missing) missing.add(name)
    for (const u of r.used) used.set(u.name, u)
    return r.value
  }

  // --- URL: base + path with {param} OpenAPI substitution -------------
  // Most-specific server wins (docs/architecture.md §5.5.6): an operation that
  // pins its own `servers` keeps it — the environment baseUrl only ever
  // replaces the root server, which is what the `baseUrl` argument carries.
  const base = resolve(effectiveBaseUrl(op, baseUrl)).replace(/\/+$/, '')
  // An array or object parameter contributes several values: each is
  // interpolated on its own, then `style`/`explode` decides how they join,
  // repeat or spread.
  const buckets = { path: pathValues, query: queryValues, cookie: cookieValues }
  const rawValue = (location, name) => buckets[location]?.[name]
  const resolveValues = (location, name, param) =>
    toValueList(param, rawValue(location, name))
      .map((value) => resolve(value))
      .filter((value) => value !== '')
  const resolveEntries = (location, name, param) =>
    toValueEntries(param, rawValue(location, name)).map(([key, value]) => [key, resolve(value)])
  const path = op.path.replace(/\{([^}]+)\}/g, (raw, name) => {
    const param = findParam(op, 'path', name)
    if (isObjectValue(param)) {
      const entries = resolveEntries('path', name, param)
      if (!entries.length) {
        errors.push({ code: 'path-param-missing', name })
        return raw
      }
      return objectPathValue(name, param, entries)
    }
    const values = resolveValues('path', name, param)
    if (!values.length) {
      errors.push({ code: 'path-param-missing', name })
      return raw
    }
    return pathValue(name, param, values)
  })
  let url = base + path

  // --- query ---------------------------------------------------------------
  // Pairs are collected before being encoded: `allowReserved` is a per-value
  // decision, and URLSearchParams has no way to make it.
  const search = []
  const hasQuery = (name) => search.some(([key]) => key === name)
  // Empty-value names first: a toggle that says "send it empty" would
  // otherwise be silently outranked by nothing at all.
  for (const name of new Set([...emptyValues, ...Object.keys(queryValues)])) {
    const param = findParam(op, 'query', name)
    const pairs = isObjectValue(param)
      ? objectQueryPairs(name, param, resolveEntries('query', name, param))
      : queryPairs(name, param, resolveValues('query', name, param))
    // `allowEmptyValue`: the parameter carries its meaning in being present,
    // so it survives having nothing to say (`?verbose=`).
    if (!pairs.length && emptyValues.includes(name)) pairs.push([name, ''])
    for (const [key, value] of pairs) search.push([key, value, param?.allowReserved])
  }
  for (const [name, value] of Object.entries(authInjection?.query ?? {})) {
    if (!hasQuery(name)) search.push([name, value])
  }
  // The string of an `in: querystring` parameter goes through as-is: its format
  // (JSONPath, GraphQL…) wouldn't survive a key/value re-encoding. It
  // precedes the auto-injected pairs (auth `in: query`), which remain,
  // themselves, normal pairs.
  const rawQueryString = resolve(String(queryString ?? '')).replace(/^[?&]+/, '')
  const qs = [
    rawQueryString,
    ...search.map(([name, value, allowReserved]) => encodePair(name, value, { allowReserved })),
  ]
    .filter(Boolean)
    .join('&')
  if (qs) url += (url.includes('?') ? '&' : '?') + qs

  // --- headers -------------------------------------------------------------
  // Merge order: auth injection first, then editable rows — a
  // manual row with the same name thus overwrites the auto-injection (SPEC: the user
  // can always override). Names compared case-insensitively (HTTP semantics).
  const headers = {}
  const setHeader = (name, value) => {
    const existing = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase())
    if (existing) delete headers[existing]
    headers[name] = value
  }
  for (const [name, value] of Object.entries(authInjection?.headers ?? {})) setHeader(name, value)
  for (const u of authInjection?.used ?? []) used.set(u.name, u)
  for (const name of authInjection?.missing ?? []) missing.add(name)
  // Cookies (apiKey in: cookie, and `in: cookie` parameters) go out as a
  // Cookie header: cURL replays it faithfully; a browser fetch will silently
  // drop it (forbidden header) — the panel shows a warning. Declared
  // parameters come first, the credential last: an injection is the app's
  // doing, what the user typed is not.
  const cookies = []
  for (const name of Object.keys(cookieValues)) {
    const param = findParam(op, 'cookie', name)
    // A cookie pair is `name=value`, whatever the parameter's type: `explode`
    // would repeat the name inside a single header value, which no server
    // reads back as a list. The style's delimiter joins instead.
    const flat = { ...param, explode: false }
    const pairs = isObjectValue(param)
      ? objectQueryPairs(name, flat, resolveEntries('cookie', name, param))
      : queryPairs(name, flat, resolveValues('cookie', name, param))
    for (const [key, value] of pairs) cookies.push([key, value])
  }
  for (const [name, value] of Object.entries(authInjection?.cookies ?? {})) {
    if (!cookies.some(([key]) => key === name)) cookies.push([name, value])
  }
  if (cookies.length) setHeader('Cookie', cookies.map(([k, v]) => `${k}=${v}`).join('; '))
  for (const row of headerRows) {
    if (!row.name || row.value === '' || row.value === undefined) continue
    setHeader(resolve(String(row.name)), resolve(String(row.value)))
  }

  // --- body ----------------------------------------------------------------
  // Four shapes, told apart by the media type: a field list posted as
  // FormData, the same fields folded into a query string, a picked file, or
  // text. `bodyKind` is the only place that decides.
  const kind = bodyKind({ mediaType })
  const setContentType = () => {
    if (mediaType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = mediaType
    }
  }
  let form = null
  let resolvedBody = null
  let bodyFile = null
  if (formFields) {
    const encodingOf = (name) => encodings?.find((e) => e.property === name) ?? null
    const fields = formFields
      .map((f) => {
        const encoding = encodingOf(f.name)
        // The part's declared content type and static headers travel with it:
        // `send` gives the part that type, the cURL export writes both. A
        // header only exists here when the document gave it a value to send
        // (its `example`, failing that its schema `default`).
        const partHeaders = (encoding?.headers ?? [])
          .filter((h) => h.value !== undefined)
          .map((h) => ({ name: h.name, value: String(h.value) }))
        const extras = {
          ...(encoding?.contentType ? { contentType: encoding.contentType } : {}),
          ...(partHeaders.length ? { headers: partHeaders } : {}),
        }
        return f.fileName
          ? { name: f.name, fileName: f.fileName, ...extras }
          : { name: f.name, value: resolve(String(f.value ?? '')), ...extras }
      })
      .filter((f) => f.fileName || f.value !== '')
    for (const field of bodySchema?.required ?? []) {
      if (!fields.some((f) => f.name === field))
        errors.push({ code: 'body-missing-required', name: field })
    }
    if (kind === 'urlencoded') {
      // Serialized here rather than in `send`: the history entry, the live
      // cURL preview and every snippet then show the exact bytes that leave.
      // A urlencoded body IS a query string, so each field goes through the
      // very same style/explode machinery a query parameter does — the
      // encoding object providing what the parameter would have declared.
      const properties = bodySchema?.properties ?? []
      resolvedBody = fields
        .flatMap((f) => {
          const encoding = encodingOf(f.name)
          const as = {
            style: encoding?.style ?? 'form',
            explode: encoding?.explode ?? true,
            schema: properties.find((p) => p.name === f.name)?.schema,
          }
          const pairs = isObjectValue(as)
            ? objectQueryPairs(f.name, as, toValueEntries(as, f.value))
            : queryPairs(f.name, as, toValueList(as, f.value))
          return pairs.map(([name, value]) =>
            encodePair(name, value, { allowReserved: encoding?.allowReserved }),
          )
        })
        .join('&')
      setContentType()
    } else {
      // Multipart keeps its fields structured and gets NO Content-Type: fetch
      // generates it with the boundary, a manual one would break the request.
      form = fields
    }
  } else if (file) {
    bodyFile = { name: file.name, size: file.size, type: file.type }
    setContentType()
  } else if (body !== '' && body !== undefined && body !== null) {
    resolvedBody = resolve(String(body))
    // Deliberately minimal validation (docs/architecture.md §5.5): well-formed JSON +
    // presence of top-level required fields. No full JSON Schema
    // (future extension). Validated AFTER interpolation — before that, {{var}}
    // makes the JSON invalid by construction.
    if (JSON_MEDIA_RE.test(mediaType ?? '') && missing.size === 0) {
      try {
        const parsed = JSON.parse(resolvedBody)
        for (const field of bodySchema?.required ?? []) {
          if (parsed && typeof parsed === 'object' && !(field in parsed)) {
            errors.push({ code: 'body-missing-required', name: field })
          }
        }
      } catch {
        errors.push({ code: 'body-invalid-json' })
      }
    }
    setContentType()
  } else if (kind === 'binary' && op.requestBody?.required) {
    // Blocked only for a file body: an empty text body is a payload someone
    // may legitimately want to send, whereas here there is nothing at all.
    errors.push({ code: 'body-file-missing' })
  }

  return {
    method: op.method,
    url,
    headers,
    body: resolvedBody,
    form,
    file: bodyFile,
    hasCookies: cookies.length > 0,
    missing: [...missing],
    errors,
    used: [...used.values()],
    // Echoed back rather than left to be recognized in the finished request:
    // the caller that shows "what auth is being sent" was matching header
    // names against the scheme, which finds nothing for an `apiKey` in query
    // (it lands in the URL) and wrongly claims a plain cookie PARAMETER,
    // folded into the same `Cookie` header.
    authInjection,
  }
}

// Applies the optional CORS proxy template (docs/architecture.md §5.5):
// "https://proxy/?url={{target}}" with target = encoded target URL.
export function applyProxy(proxyUrl, targetUrl) {
  return proxyUrl.replace(/\{\{\s*target\s*\}\}/g, encodeURIComponent(targetUrl))
}

// Reverse reconstruction for "reload into try-it" (docs/architecture.md §5.6): only the
// resolved request is stored, path param values are re-extracted
// by aligning the end of the URL path against the OpenAPI template. Correct
// approximation as long as baseUrl has no parameterized segment.
export function extractPathValues(opPath, url) {
  let pathname
  try {
    pathname = new URL(url, 'http://placeholder.invalid').pathname
  } catch {
    return {}
  }
  const urlSegments = pathname.split('/').filter(Boolean)
  const templateSegments = String(opPath ?? '')
    .split('/')
    .filter(Boolean)
  const tail = urlSegments.slice(-templateSegments.length)
  const out = {}
  templateSegments.forEach((segment, i) => {
    const match = /^\{(.+)\}$/.exec(segment)
    if (match && tail[i] !== undefined) out[match[1]] = decodeURIComponent(tail[i])
  })
  return out
}

// Counterpart of `extractPathValues` for the query — reloading a resolved
// request always needs both sides. `null` = unreadable URL, up to
// the caller to decide what to keep (there's nothing to salvage from it).
// `op` (optional) is what tells an array parameter apart: without it, a
// `?tags=cat,dog` comes back as one opaque value.
export function extractQueryValues(url, op = null) {
  try {
    return readQueryValues(new URL(url, 'http://placeholder.invalid').searchParams, op)
  } catch {
    return null
  }
}

// --- replaying a stored request (docs/network-insights.md §4.2) --------------

// The insight strip's two actions replay the STORED request, never the panel's
// current form — which may have moved on since, and whose divergence would
// silently change what "replay" means. They live here, next to `buildRequest`,
// because what they produce is the same `built` shape: it goes through the
// ordinary `send()` + history pipeline and lands as an ordinary entry.
// `hasCookies` is deliberately absent — it drives the pre-send cookie warning,
// which belongs to the form path and to nothing else.

/** The URL the server itself built, followed literally (§4.2). */
export function followRequest(entry, url) {
  return storedRequest(entry, { url })
}

/** The stored request plus the validator the response carried. */
export function conditionalRequest(entry, { etag, lastModified }) {
  const [name, value] = etag ? ['If-None-Match', etag] : ['If-Modified-Since', lastModified]
  return storedRequest(entry, {
    headers: { ...withoutHeader(entry.request?.headers, name), [name]: value },
  })
}

function storedRequest(entry, over) {
  return {
    method: entry.request?.method ?? entry.method,
    url: entry.request?.url ?? '',
    headers: entry.request?.headers ?? {},
    // Safe methods only (decision 5), and `send()` drops a body on those.
    body: null,
    form: null,
    file: null,
    // Nothing left to interpolate: a stored request holds resolved values. The
    // variables travel along so the new entry redacts what the first one did.
    missing: [],
    errors: [],
    used: entry.usedVariables ?? [],
    ...over,
  }
}

// A stored `if-none-match` must not survive next to the one being set — header
// names are case-insensitive, the object's keys are not.
function withoutHeader(headers, name) {
  const dropped = name.toLowerCase()
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => key.toLowerCase() !== dropped),
  )
}
