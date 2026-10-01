import {
  headerExampleSites,
  headerSchemaSite,
  parseImfFixdate,
  writtenPointer,
} from '../deprecation-headers.js'
import { placeOf } from '../locate.js'
import { internalTarget, lastToken, nodeAt } from '../ref-pointer.js'
import { isObject } from '../value-check.js'

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
// example — the Header's `example` and `examples`, its `content` entry's, the
// schema's `example` and `examples` — that is a string but no IMF-fixdate
// (nor, for `Retry-After`, digits), or a number (an integer of seconds is
// fine for `Retry-After`). The schema is `schema`, or the one of the Header's
// `content` entry.
// Other kinds of example are `example-type-mismatch`'s. `format: http-date`
// (OpenAPI Format Registry) with no example passes: nothing contradicts it.
//
// One check per Header Object with a schema or an example under one of these
// names: in a response's `headers` map (names compared without case), and a
// `components.headers` entry once — named after the first of these names a
// response references it under, or after its own key when no response
// references it. Part headers of a multipart `encoding` are not response headers.
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
      let names = []
      if (RESPONSE_HEADER.test(dataPath)) names = [lastToken(dataPath)]
      else if (COMPONENT_HEADER.test(dataPath)) {
        names = referencedAs.get(dataPath) ?? [lastToken(dataPath)]
      }
      const header = names.find((name) => DATE_HEADERS.has(name.toLowerCase()))
      if (header === undefined) continue
      const resolved = nodeAt(ctx.document, dataPath) ?? node
      if (!isObject(resolved)) continue
      const schema = headerSchemaSite(resolved)
      const examples = headerExampleSites(resolved)
      if (!schema && !examples.length) continue
      const delay = header.toLowerCase() === 'retry-after'
      const at = offence(schema, examples, delay)
      const target = at === null ? dataPath : writtenPointer(node, dataPath, at)
      check(at === null, {
        ...placeOf(ctx.operations, target),
        dataPath: target,
        params: { header },
      })
    }
  },
}

// `components.headers` pointer → every name a response's `headers` map gives
// it, in document order.
function componentHeaderNames(ctx) {
  const names = new Map()
  for (const { type, expected, node, dataPath } of ctx.objects) {
    if (type !== 'Reference' || expected !== 'Header' || !RESPONSE_HEADER.test(dataPath)) continue
    const target = internalTarget(node.$ref)
    if (target === null || !COMPONENT_HEADER.test(target)) continue
    const known = names.get(target)
    if (known) known.push(lastToken(dataPath))
    else names.set(target, [lastToken(dataPath)])
  }
  return names
}

// → the path, within the Header, of the first thing declaring another kind
// of value, or null.
function offence(site, examples, delay) {
  if (site) {
    if (RFC3339_FORMATS.has(site.schema.format)) return [...site.at, 'format']
    if (!delay && isNumericType(site.schema.type)) return [...site.at, 'type']
  }
  return examples.find(({ value }) => !isHttpDateValue(value, delay))?.at ?? null
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
