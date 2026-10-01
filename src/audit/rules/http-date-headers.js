import { parseImfFixdate } from '../deprecation-headers.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { internalTarget, nodeAt } from '../ref-pointer.js'

// A response header whose value HTTP makes a date, declared as some other
// kind of date or as a number. `Retry-After` (RFC 9110 §10.2.3),
// `Last-Modified` (§8.8.2), `Expires` (RFC 9111 §5.3) and `Sunset` (RFC 8594
// §3) are HTTP-dates, and a sender MUST generate them in the IMF-fixdate form
// — `Sun, 06 Nov 1994 08:49:37 GMT` (RFC 9110 §5.6.7). `format: date-time` or
// `date` describes RFC 3339 (`1994-11-06T08:49:37Z`), which no HTTP date
// parser is required to read; a number is no HTTP-date at all — RFC 9111
// tells a cache to treat `Expires: 0` as an invalid date. A client generated
// from the declaration parses the header as RFC 3339 and fails on every real
// response; one written by hand sends the wrong form back in
// `If-Modified-Since`. `Retry-After` alone may also be a delay: a
// non-negative integer of seconds.
//
// Fails on the first of: a schema `format` of `date-time` or `date`; a
// numeric `type` (every declared type numeric — `Retry-After` excepted); an
// example — the Header's `example` and `examples`, the schema's `example` and
// `examples` — that is a string but no IMF-fixdate (nor, for `Retry-After`,
// digits), or a number (an integer of seconds is fine for `Retry-After`).
// Other kinds of example are `example-type-mismatch`'s. `format: http-date`
// (OpenAPI Format Registry) with no example passes: nothing contradicts it.
//
// One check per Header Object with a schema under one of these names: in a
// response's `headers` map (names compared without case), and a
// `components.headers` entry once — named after the key a response
// references it under, or its own key when that already is one of these
// names. Part headers of a multipart `encoding` are not response headers.
// `Deprecation` is a Structured Field date, not an HTTP-date:
// `deprecation-header-format`'s.
const DATE_HEADERS = new Set(['retry-after', 'last-modified', 'expires', 'sunset'])
const RESPONSE_HEADER = /\/responses\/[^/]+\/headers\/[^/]+$/
const COMPONENT_HEADER = /^\/components\/headers\/[^/]+$/
const RFC3339_FORMATS = new Set(['date-time', 'date'])
const NUMERIC = new Set(['integer', 'number'])

export const httpDateHeaders = {
  id: 'http-date-headers',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const referencedAs = componentHeaderNames(ctx)
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Header') continue
      const key = lastToken(dataPath)
      let header = null
      if (RESPONSE_HEADER.test(dataPath)) header = key
      else if (COMPONENT_HEADER.test(dataPath)) header = referencedAs.get(dataPath) ?? key
      if (header === null || !DATE_HEADERS.has(header.toLowerCase())) continue
      const resolved = nodeAt(ctx.document, dataPath) ?? node
      if (!isObject(resolved) || !isObject(resolved.schema)) continue
      const delay = header.toLowerCase() === 'retry-after'
      const at = offence(node, resolved, dataPath, delay)
      const target = at ?? dataPath
      check(at === null, {
        ...placeOf(ctx.operations, target),
        dataPath: target,
        params: { header },
      })
    }
  },
}

// `components.headers` pointer → the header name a response's `headers` map
// gives it, for the date headers only; the first use wins.
function componentHeaderNames(ctx) {
  const names = new Map()
  for (const { type, expected, node, dataPath } of ctx.objects) {
    if (type !== 'Reference' || expected !== 'Header' || !RESPONSE_HEADER.test(dataPath)) continue
    const name = lastToken(dataPath)
    if (!DATE_HEADERS.has(name.toLowerCase())) continue
    const target = internalTarget(node.$ref)
    if (target !== null && COMPONENT_HEADER.test(target) && !names.has(target)) {
      names.set(target, name)
    }
  }
  return names
}

// → the pointer of the first thing declaring another kind of value, or null.
// Pointers stop at a `$ref`: what lies behind one is not written here.
function offence(source, header, dataPath, delay) {
  const schema = header.schema
  const inlineSchema = isObject(source.schema) && typeof source.schema.$ref !== 'string'
  const inSchema = (...at) => `${dataPath}${pointer('schema', ...(inlineSchema ? at : []))}`
  if (RFC3339_FORMATS.has(schema.format)) return inSchema('format')
  if (!delay && isNumericType(schema.type)) return inSchema('type')
  for (const [value, at] of examples(source, header, dataPath, inSchema)) {
    if (!isHttpDateValue(value, delay)) return at
  }
  return null
}

function* examples(source, header, dataPath, inSchema) {
  if (header.example !== undefined) yield [header.example, `${dataPath}${pointer('example')}`]
  if (isObject(header.examples)) {
    for (const [name, example] of Object.entries(header.examples)) {
      if (!isObject(example)) continue
      const written = source.examples?.[name]
      const inline = isObject(written) && typeof written.$ref !== 'string'
      for (const field of ['value', 'dataValue', 'serializedValue']) {
        if (example[field] === undefined) continue
        const at = pointer('examples', name, ...(inline ? [field] : []))
        yield [example[field], `${dataPath}${at}`]
      }
    }
  }
  const schema = header.schema
  if (schema.example !== undefined) yield [schema.example, inSchema('example')]
  if (Array.isArray(schema.examples)) {
    for (const [index, value] of schema.examples.entries()) {
      yield [value, inSchema('examples', index)]
    }
  }
}

// Strings and numbers only: an example of another kind is no verdict here.
function isHttpDateValue(value, delay) {
  if (typeof value === 'number') return delay && Number.isInteger(value) && value >= 0
  if (typeof value !== 'string') return true
  return parseImfFixdate(value) !== null || (delay && /^\d+$/.test(value))
}

function isNumericType(type) {
  const types = (Array.isArray(type) ? type : [type]).filter((t) => t !== 'null')
  return types.length > 0 && types.every((t) => NUMERIC.has(t))
}

function lastToken(dataPath) {
  return dataPath
    .slice(dataPath.lastIndexOf('/') + 1)
    .replaceAll('~1', '/')
    .replaceAll('~0', '~')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
