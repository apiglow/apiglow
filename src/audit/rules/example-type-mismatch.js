import { pointer } from '../pointer.js'
import { operationContents } from '../schema-walk.js'
import { describeValue, isObject } from '../value-check.js'
import { sideOf, validateValue } from '../value-validate.js'

// An example that contradicts its own schema is the most expensive kind of
// documentation bug: readers copy it, and the try-it prefills with it.
//
// Examples live in four places, and all are checked against the schema they
// illustrate: the schema itself (`example` in 3.0, `examples` array in 3.1), a
// parameter, a response header, a media type (`example` / `examples` map) —
// a parameter or header serialized by media type (`content`, 3.2's
// `querystring`) included, its own examples then illustrating its one media
// type's schema. The value is
// validated in depth (`value-validate.js`: types, enums, lengths, patterns,
// bounds, sizes, required members, closed objects, compositions, the common
// formats), and the finding names the first keyword it breaks and where, as a
// JSONPath into the example. A broken `format` alone is a `warning` (JSON
// Schema makes format an annotation by default); anything else an `error`.
//
// `required` follows the example's direction: a request example owes no
// `readOnly` member, a response example no `writeOnly` one, and a component's
// own example — used both ways — owes neither, nor does a webhook's or a
// callback's, sent by the API itself. One check per example the validator has
// something to say about.
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
      const valued = entry.parameters.map(({ param, dataPath }) => [param, dataPath])
      for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
        if (!isObject(response) || !isObject(response.headers)) continue
        for (const [name, header] of Object.entries(response.headers)) {
          valued.push([header, `${entry.pointer}${pointer('responses', status, 'headers', name)}`])
        }
      }
      for (const [node, dataPath] of valued) {
        for (const [value, path, schema] of valueExamples(node, dataPath)) {
          checkValue(check, value, schema, { op: entry, dataPath: path })
        }
      }
      for (const { content, dataPath } of operationContents(entry)) {
        const schema = schemaOf(content)
        if (!schema) continue
        for (const [value, path] of containerExamples(content, dataPath)) {
          checkValue(check, value, schema, { op: entry, dataPath: path })
        }
      }
    }
  },
}

// A Parameter or Header Object: its own examples against its schema — or,
// serialized by media type, against the schema of its one media type — and
// that media type's own examples.
function* valueExamples(node, dataPath) {
  if (!isObject(node)) return
  const media = isObject(node.content) ? Object.entries(node.content) : []
  const schema =
    schemaOf(node) ?? (media.length === 1 && isObject(media[0][1]) ? schemaOf(media[0][1]) : null)
  if (schema) {
    for (const [value, path] of containerExamples(node, dataPath)) yield [value, path, schema]
  }
  for (const [mediaType, content] of media) {
    const own = isObject(content) ? schemaOf(content) : null
    if (!own) continue
    const base = `${dataPath}${pointer('content', mediaType)}`
    for (const [value, path] of containerExamples(content, base)) yield [value, path, own]
  }
}

function schemaOf(node) {
  const schema = node.schema ?? node.itemSchema
  return isObject(schema) ? schema : null
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
    const field = example.value !== undefined ? 'value' : 'dataValue'
    if (example[field] === undefined) continue
    yield [example[field], `${dataPath}${pointer('examples', name, field)}`]
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
