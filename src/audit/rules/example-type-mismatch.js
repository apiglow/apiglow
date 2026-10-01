import { pointer } from '../pointer.js'
import { operationContents } from '../schema-walk.js'
import { describeValue } from '../value-check.js'
import { sideOf, validateValue } from '../value-validate.js'

// An example that contradicts its own schema is the most expensive kind of
// documentation bug: readers copy it, and the try-it prefills with it.
//
// Examples live in three places, and all three are checked against the schema
// they illustrate: the schema itself (`example` in 3.0, `examples` array in
// 3.1), a parameter, a media type (`example` / `examples` map). The value is
// validated in depth (`value-validate.js`: types, enums, lengths, patterns,
// bounds, sizes, required members, closed objects, compositions, the common
// formats), and the finding names the first keyword it breaks and where, as a
// JSONPath into the example. A broken `format` alone is a `warning` (JSON
// Schema makes format an annotation by default); anything else an `error`.
//
// `required` follows the example's direction: a request example owes no
// `readOnly` member, a response example no `writeOnly` one, and a component's
// own example — used both ways — owes neither. One check per example the
// validator has something to say about.
export const exampleTypeMismatch = {
  id: 'example-type-mismatch',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      for (const [value, path] of schemaExamples(schema, dataPath)) {
        checkValue(check, value, schema, { op, location, dataPath: path })
      }
    }
    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        if (!param.schema) continue
        for (const [value, path] of containerExamples(param, dataPath)) {
          checkValue(check, value, param.schema, { op: entry, dataPath: path })
        }
      }
      for (const { content, dataPath } of operationContents(entry)) {
        const schema = content.schema ?? content.itemSchema
        if (!schema || typeof schema !== 'object') continue
        for (const [value, path] of containerExamples(content, dataPath)) {
          checkValue(check, value, schema, { op: entry, dataPath: path })
        }
      }
    }
  },
}

function checkValue(check, value, schema, target) {
  // A lone `{ "$ref": … }` is `example-has-ref`'s: the author meant a
  // reference, not this value.
  if (isLoneRef(value)) return
  const { checked, failure } = validateValue(value, schema, { side: sideOf(target) })
  // Nothing the validator could judge: counting a check here would hand out
  // a free pass.
  if (!checked) return
  check(!failure, {
    ...target,
    severity: failure?.severity,
    params: { value: describeValue(value), keyword: failure?.keyword, at: failure?.at },
  })
}

// Schema level: 3.0 single `example`, 3.1 `examples` array (a JSON Schema
// annotation, not the Example Object map — hence the two separate readers).
function* schemaExamples(schema, dataPath) {
  if (Array.isArray(schema.examples)) {
    for (const [index, value] of schema.examples.entries()) {
      yield [value, `${dataPath}/examples/${index}`]
    }
  }
  if (schema.example !== undefined) yield [schema.example, `${dataPath}/example`]
}

// Parameter / media type level: single `example`, or an `examples` map of
// Example Objects. `externalValue` entries carry no inline value to check.
function* containerExamples(container, dataPath) {
  if (container.example !== undefined) yield [container.example, `${dataPath}/example`]
  if (!container.examples || typeof container.examples !== 'object') return
  if (Array.isArray(container.examples)) return
  for (const [name, example] of Object.entries(container.examples)) {
    if (!example || typeof example !== 'object') continue
    // 3.2 renames `value` to `dataValue`; `serializedValue` is a string by
    // definition and would mismatch every non-string schema.
    const value = example.value !== undefined ? example.value : example.dataValue
    if (value === undefined) continue
    yield [value, `${dataPath}${pointer('examples', name, 'value')}`]
  }
}

function isLoneRef(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.$ref === 'string' &&
    Object.keys(value).length === 1
  )
}
