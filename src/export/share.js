import { normalizeParamValue } from '../openapi/params.js'

// Pre-filled request sharing via URL (competitive analysis, prio 2): the
// try-it state travels as base64url in the hash (#/op/{id}?req=…). Pure,
// tested functions.
//
// Non-leak guarantee: no sensitive value leaves in the link. try-it fields
// normally contain unresolved {{var}} templates; if the user pasted a
// sensitive value in plain text, every literal occurrence is re-templated
// back to {{name}} — the link stays functional for a recipient who has their
// own values.

function sanitizer(sensitiveVariables) {
  const vars = (sensitiveVariables ?? []).filter((v) => v.name && v.value)
  const cleanOne = (value) =>
    vars.reduce((acc, v) => acc.split(v.value).join(`{{${v.name}}}`), String(value ?? ''))
  // A structured parameter (style/explode) travels as a list or a map:
  // cleaned value by value, and it keeps its shape — flattening it would lose
  // the multiplicity, or the property names.
  return (value) => {
    if (Array.isArray(value)) return value.map(cleanOne)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanOne(v)]))
    }
    return cleanOne(value)
  }
}

// btoa/atob only speak latin-1: routed through TextEncoder to survive UTF-8
// bodies. base64url variant (-_ without padding): nothing left to re-encode
// in a URL.
export function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(encoded) {
  const bin = atob(String(encoded).replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

// Same cleanup as the share link, but without encoding: the state stays an
// object, re-templated. This is the capture of a scenario step
// (docs/scenarios.md §5.4) — the non-leak guarantee is the same, and it has to
// be: a scenario travels too (file, link).
export function templatizeState(state, sensitiveVariables = []) {
  const clean = sanitizer(sensitiveVariables)
  const cleanValues = (obj) =>
    Object.fromEntries(Object.entries(obj ?? {}).map(([name, value]) => [name, clean(value)]))
  return {
    path: cleanValues(state.path),
    query: cleanValues(state.query),
    cookie: cleanValues(state.cookie),
    queryString: clean(state.queryString ?? ''),
    headers: (state.headers ?? [])
      .filter((r) => r.name)
      .map((r) => ({ name: r.name, value: clean(r.value) })),
    body: state.body != null ? clean(state.body) : null,
    mediaTypeIndex: state.mediaTypeIndex || 0,
    formFields: state.formFields?.length
      ? state.formFields.map((f) => ({ name: f.name, value: clean(f.value), fileName: f.fileName }))
      : null,
  }
}

// state: { path: {name: value}, query: {…}, headers: [{name, value}],
// body: string|null, mediaTypeIndex } — the direct mirror of the panel's state.
export function encodeShareState(state, sensitiveVariables = []) {
  const clean = sanitizer(sensitiveVariables)
  const cleanValues = (obj) =>
    Object.fromEntries(Object.entries(obj ?? {}).map(([name, value]) => [name, clean(value)]))
  const payload = {
    v: 1,
    path: cleanValues(state.path),
    query: cleanValues(state.query),
    headers: (state.headers ?? []).filter((r) => r.name).map((r) => [r.name, clean(r.value)]),
    body: state.body != null && state.body !== '' ? clean(state.body) : undefined,
    mediaTypeIndex: state.mediaTypeIndex || undefined,
  }
  if (payload.mediaTypeIndex === undefined) delete payload.mediaTypeIndex
  if (payload.body === undefined) delete payload.body
  return toBase64Url(JSON.stringify(payload))
}

// Payload coming from a URL = untrusted input: any shape deviation (unknown
// version, invalid base64/JSON, unexpected types) returns null, never throws.
export function decodeShareState(encoded) {
  let payload
  try {
    payload = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || payload.v !== 1) return null
  // A parameter value is a string, a list of strings (array parameter) or a
  // flat map of strings (object parameter). Anything else is dropped: the
  // payload comes from a URL.
  const stringValues = (obj) =>
    Object.fromEntries(
      Object.entries(obj && typeof obj === 'object' ? obj : {})
        .map(([name, value]) => [name, normalizeParamValue(value)])
        .filter(([, value]) => value !== undefined),
    )
  return {
    path: stringValues(payload.path),
    query: stringValues(payload.query),
    headers: (Array.isArray(payload.headers) ? payload.headers : [])
      .filter((row) => Array.isArray(row) && row[0])
      .map(([name, value]) => ({ name: String(name), value: String(value ?? '') })),
    body: typeof payload.body === 'string' ? payload.body : null,
    mediaTypeIndex:
      Number.isInteger(payload.mediaTypeIndex) && payload.mediaTypeIndex >= 0
        ? payload.mediaTypeIndex
        : 0,
  }
}
