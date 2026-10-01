import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A field declared with no value at all. Nowhere this rule looks does OpenAPI
// give `null` a meaning, so the field says nothing — and the usual cause is
// invisible in the file: a YAML flow mapping cut by an unquoted comma.
// `{ description: The signed mandate, as uploaded by the client }` reads as the
// description "The signed mandate" plus an empty field "as uploaded by the
// client". The description renders truncated everywhere, this documentation
// and its exports included, which is why it gets mistaken for a bug of
// whatever shows it. A bare `description:`, or an unquoted `type: null`, lands here as well.
//
// Read on the SOURCE document, where each field sits once at its declaration
// site: dereferenced, one cut component would be reported at every use.
//
// One check per empty field and none otherwise, like the version rules: the
// rule names a defect where there is one, and a document without any is not
// graded on the thousands of fields it got right.
export const fieldWithoutValue = {
  id: 'field-without-value',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const segments of emptyFields(ctx.source)) {
      const dataPath = pointer(...segments)
      check(false, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { field: segments.at(-1) },
      })
    }
  },
}

// Fields whose value is any JSON value, `null` included: payloads the API's
// author wrote, never OpenAPI structure. Their content is not walked either —
// an example is the API's data, and its nulls are the API's business.
const ANY_VALUE = new Set(['example', 'default', 'const', 'enum', 'value', 'dataValue'])

// A Link Object's `parameters` values and `requestBody` are "any or a runtime
// expression": inside a `links` map, those two are payloads too.
const LINK_ANY_VALUE = new Set(['parameters', 'requestBody'])

// Where the walk stands with respect to links: in a `links` map, whose members
// are Link Objects, or in one of them.
const LINKS = 'links'
const LINK = 'link'

// Every path whose value is `null`, in document order. Array elements are not
// fields: a `null` there is a value of something (`type`, `required`), and the
// spec says which, not this rule. The walk is bounded by the ancestors it is
// under — a YAML alias can point back at one — and by a depth budget (rule 7).
const MAX_DEPTH = 64

function emptyFields(source) {
  const found = []
  const ancestors = new Set()
  const walk = (node, segments, place) => {
    if (!node || typeof node !== 'object' || ancestors.has(node)) return
    if (segments.length > MAX_DEPTH) return
    ancestors.add(node)
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) walk(item, [...segments, index], null)
    } else {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('x-') || ANY_VALUE.has(key)) continue
        if (place === LINK && LINK_ANY_VALUE.has(key)) continue
        // A Schema Object's `examples` is a list of payloads; a Media Type's,
        // Parameter's or component section's is a map of Example Objects, whose
        // structure is walked like the rest (their `value` is skipped above).
        if (key === 'examples' && Array.isArray(value)) continue
        if (value === null) found.push([...segments, key])
        else
          walk(value, [...segments, key], key === 'links' ? LINKS : place === LINKS ? LINK : null)
      }
    }
    ancestors.delete(node)
  }
  walk(source, [], null)
  return found
}
