import {
  documentResponses,
  headerExamples,
  headerSchema,
  parseStructuredDate,
} from '../deprecation-headers.js'
import { placeOf } from '../locate.js'

// A `Deprecation` response header declared with the wrong value. RFC 9745 §2.1
// makes it "an Item Structured Header Field; its value MUST be a Date as per
// Section 3.3.7 of [RFC9651]": `@` and seconds since the epoch
// (`Deprecation: @1688169599`). Its early drafts took
// `IMF-fixdate / "true"` (draft-dalal-deprecation-header-03 §2.1), and
// documents still say so: a boolean schema, a `date-time`,
// `date` or `http-date` format, a schema whose type cannot be a string, an
// example such as `true`, `Sun, 06 Nov 1994 08:49:37 GMT` or `2024-06-30`. A
// client written from the document parses a value the API, once it follows
// the RFC, never sends — and the client that reads the header to warn its
// developers stays silent. This documentation prints the declared type next
// to the header's name (`boolean`, `string (date-time)`), so the reader takes
// the wrong shape from the page too.
//
// One check per `Deprecation` header (name without case) of a Response with a
// schema or an example to judge; a `components.headers` entry once, at the
// component. Webhook and callback responses included: the header is the same
// on any response. The date's relation to `Sunset` is
// `sunset-before-deprecation`'s; the other HTTP-date headers are
// `http-date-headers'`.
const DATE_FORMATS = new Set(['date-time', 'date', 'http-date'])

export const deprecationHeaderFormat = {
  id: 'deprecation-header-format',
  category: 'deprecation',
  severity: 'warning',
  run(ctx, check) {
    const seen = new Set()
    for (const { headers } of documentResponses(ctx)) {
      const site = headers.get('deprecation')
      if (!site || seen.has(site.dataPath)) continue
      seen.add(site.dataPath)
      const schema = headerSchema(site.header)
      const examples = headerExamples(site.header)
      if (!schema && !examples.length) continue
      const declared = schemaFault(schema) ?? exampleFault(examples)
      check(declared === null, {
        ...placeOf(ctx.operations, site.dataPath),
        dataPath: site.dataPath,
        params: declared === null ? {} : { declared },
      })
    }
  },
}

// The value is a string on the wire: a declared type that excludes it, or
// admits a boolean, describes another field.
function schemaFault(schema) {
  if (!schema) return null
  const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter(
    (type) => typeof type === 'string',
  )
  if (types.includes('boolean')) return 'type: boolean'
  if (types.length && !types.includes('string')) return `type: ${types.join(', ')}`
  if (typeof schema.format === 'string' && DATE_FORMATS.has(schema.format)) {
    return `format: ${schema.format}`
  }
  return null
}

function exampleFault(examples) {
  const wrong = examples.find((value) => parseStructuredDate(value) === null)
  if (wrong === undefined) return null
  const text = JSON.stringify(wrong) ?? String(wrong)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}
