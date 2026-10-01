import { listOf } from '../openapi/model.js'
import { pointer } from './pointer.js'
import { internalTarget, nodeAt } from './ref-pointer.js'

// The headers that carry a deprecation on the wire — RFC 9745 `Deprecation`,
// RFC 8594 `Sunset` — read off the document's Response Objects for the
// deprecation rules (docs/audit.md §4.3).

// Every Response Object of the document, each once (a `components.responses`
// entry at the component, webhooks and callbacks included), with its headers
// dereferenced and keyed by lower-case name — header names are
// case-insensitive (RFC 9110 §5.1). A header is placed where its author fixes
// it: under the response, or at the `components.headers` entry an internal
// `$ref` points to. → { response, dataPath, headers: Map(name → { key, header,
// dataPath }) }.
export function* documentResponses(ctx) {
  for (const { type, node, dataPath } of ctx.objects) {
    if (type !== 'Response') continue
    const response = nodeAt(ctx.document, dataPath)
    if (!isObject(response)) continue
    const headers = new Map()
    const declared = isObject(response.headers) ? response.headers : {}
    for (const [key, header] of Object.entries(declared)) {
      if (!isObject(header)) continue
      const written = isObject(node.headers) ? node.headers[key] : undefined
      const target = isObject(written) ? internalTarget(written.$ref) : null
      const name = key.toLowerCase()
      if (headers.has(name)) continue
      headers.set(name, {
        key,
        header,
        dataPath: target ?? `${dataPath}${pointer('headers', key)}`,
      })
    }
    yield { response, dataPath, headers }
  }
}

// The schema a Header describes its value with: `schema`, or the one of its
// single `content` entry.
export function headerSchema(header) {
  if (isObject(header.schema)) return header.schema
  for (const media of Object.values(isObject(header.content) ? header.content : {})) {
    if (isObject(media) && isObject(media.schema)) return media.schema
  }
  return null
}

// Every example value a Header gives, wherever it writes one: its own
// `example` / `examples`, its `content` entry's, its schema's `example` /
// `examples` list. An Example Object counts by its `value`, 3.2 `dataValue` or
// `serializedValue` — for a header the last two are the same text.
export function headerExamples(header) {
  const values = []
  const fromHolder = (holder) => {
    if (!isObject(holder)) return
    if (holder.example !== undefined) values.push(holder.example)
    for (const example of Object.values(isObject(holder.examples) ? holder.examples : {})) {
      if (!isObject(example)) continue
      for (const field of ['value', 'dataValue', 'serializedValue']) {
        if (example[field] !== undefined) values.push(example[field])
      }
    }
  }
  fromHolder(header)
  for (const media of Object.values(isObject(header.content) ? header.content : {})) {
    fromHolder(media)
  }
  const schema = headerSchema(header)
  if (schema) {
    if (schema.example !== undefined) values.push(schema.example)
    values.push(...listOf(schema.examples))
  }
  return values
}

// RFC 9651 §3.3.7 Date: `@` and an integer of at most 15 digits, seconds since
// the epoch. → milliseconds, or null.
export function parseStructuredDate(value) {
  if (typeof value !== 'string') return null
  const match = /^@(-?\d{1,15})$/.exec(value)
  return match ? Number(match[1]) * 1000 : null
}

// RFC 9110 §5.6.7 IMF-fixdate, the only form a sender may generate
// (`Sun, 06 Nov 1994 08:49:37 GMT`, case-sensitive). The weekday is not
// cross-checked: an ordering only needs the instant. → milliseconds, or null.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IMF_FIXDATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/

export function parseImfFixdate(value) {
  if (typeof value !== 'string') return null
  const match = IMF_FIXDATE.exec(value)
  if (!match) return null
  const [day, month, year, hour, minute, second] = [
    Number(match[1]),
    MONTHS.indexOf(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ]
  if (month < 0 || hour > 23 || minute > 59 || second > 60) return null
  const time = Date.UTC(year, month, day, hour, minute, Math.min(second, 59))
  return new Date(time).getUTCDate() === day ? time : null
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
