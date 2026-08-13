import { pointer } from '../pointer.js'
import { operationContents } from '../schema-walk.js'
import { checkValueEnum, checkValueType, describeValue, hasComposition } from '../value-check.js'

// An example that contradicts its own schema is the most expensive kind of
// documentation bug: readers copy it, and the try-it prefills with it.
//
// Examples live in three places, and all three are checked against the schema
// they illustrate: the schema itself (`example` in 3.0, `examples` array in
// 3.1), a parameter, a media type (`example` / `examples` map).
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
  if (hasComposition(schema)) return
  const type = checkValueType(value, schema)
  const allowed = checkValueEnum(value, schema)
  // Neither a type nor an enum to compare against: nothing to check, and
  // counting a check here would hand out a free pass.
  if (type === null && allowed === null) return
  check(type !== false && allowed !== false, {
    ...target,
    params: { value: describeValue(value) },
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
