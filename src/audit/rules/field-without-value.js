import { placeOf } from '../locate.js'
import { OBJECTS } from '../openapi-objects.js'
import { pointer } from '../pointer.js'
import { SUBSCHEMA_MAP } from '../schema-keywords.js'

// A field declared with no value at all. Nowhere this rule looks does OpenAPI
// give `null` a meaning, so the field says nothing — and the usual cause is
// invisible in the file: a YAML flow mapping cut by an unquoted comma.
// `{ description: The signed mandate, as uploaded by the client }` reads as the
// description "The signed mandate" plus an empty field "as uploaded by the
// client". The description renders truncated everywhere, this documentation
// and its exports included, which is why it gets mistaken for a bug of
// whatever shows it. A bare `description:`, or an unquoted `type: null`, lands
// here as well.
//
// Read on the typed walk of the SOURCE document (`ctx.objects`), where each
// field sits once at its declaration site: dereferenced, one cut component
// would be reported at every use. The walk tells a schema keyword from a
// property that happens to share its name (`properties: { default: … }`), and
// the table which fields take any value — `example`, an Example's `value`, a
// Link's `parameters` and `requestBody`: a payload the API's author wrote, its
// nulls the API's business, and never walked.
//
// A field is a key of an object, or a member of a map; a list member is no
// field — a `null` there is a value of something (`type`, `required`), and
// `field-value-kind`'s. One check per empty field and none otherwise, like the
// version rules: the rule names a defect where there is one, and a document
// without any is not graded on the thousands of fields it got right.
export const fieldWithoutValue = {
  id: 'field-without-value',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const report = (dataPath, field) =>
      check(false, { ...placeOf(ctx.operations, dataPath), dataPath, params: { field } })
    // From 3.1 a Schema's `$ref` is typed twice, as a Reference and a Schema.
    const done = new Set()
    for (const { type, expected, node, dataPath } of ctx.objects) {
      if (done.has(node)) continue
      done.add(node)
      const kind = type === 'Reference' ? expected : type
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('x-')) continue
        const at = `${dataPath}${pointer(key)}`
        const members = kind === 'Schema' ? schemaMembers(key) : fieldMembers(kind, key)
        if (value === null) {
          if (members !== PAYLOAD) report(at, key)
        } else if (members === MAP && typeof value === 'object' && !Array.isArray(value)) {
          for (const [name, member] of Object.entries(value)) {
            if (member === null && !name.startsWith('x-')) report(`${at}${pointer(name)}`, name)
          }
        }
      }
    }
  },
}

const PAYLOAD = 'payload'
const MAP = 'map'

// A Schema's payload keywords: any JSON value is theirs, `null` included. A
// `null` `examples` is not a list of anything.
const SCHEMA_PAYLOADS = new Set(['example', 'default', 'const', 'enum'])

// Schema keywords whose value maps names to something: subschemas, or the
// names a property depends on.
const SCHEMA_MAPS = new Set([...SUBSCHEMA_MAP, 'dependentRequired', 'dependencies'])

function schemaMembers(key) {
  if (SCHEMA_PAYLOADS.has(key)) return PAYLOAD
  return SCHEMA_MAPS.has(key) ? MAP : null
}

// A key the table does not list — a patterned object's name, an unknown field —
// is a field all the same.
function fieldMembers(type, key) {
  const fields = OBJECTS[type] ?? {}
  if (!Object.hasOwn(fields, key)) return null
  const { kind } = fields[key]
  if (kind === 'any' || kind.map === 'any') return PAYLOAD
  return kind.map ? MAP : null
}
