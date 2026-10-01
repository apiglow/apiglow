import { bodyKind } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { valueTypes } from '../input-shape.js'
import { isSchemaObject, toolInputs, toolOperations } from '../tool-inputs.js'

// A JSON request body whose root is not an object: an array, a scalar, or a
// choice (`oneOf` / `anyOf`, even of objects). A tool's input is an object of
// named arguments, and the consumers bend a body that is not one:
// - GPT Actions logs "request body schema is not an object schema; skipping"
//   and leaves the operation out;
// - `@ivotoby/openapi-mcp-server`, one of the two bridges this documentation's
//   MCP export wires up, wraps an array or a scalar under a `body` property the
//   document never named, and makes a union the tool's root schema;
// - Anthropic's SDK types a tool's `input_schema.type` as the literal
//   `"object"`, and OpenAI's strict mode requires an object root, not `anyOf`:
//   a union made the root is refused.
// `@tyk-technologies/api-to-mcp` always nests the body under `requestBody`, so
// it is the one consumer that takes any root unchanged.
//
// An `allOf` whose members are objects is an object. A root that says nothing
// gets no verdict here — it is `untyped-input`'s — and a form or text body is
// not JSON: its fields or its text are the input. Often the API cannot change;
// the finding is then one to accept knowingly, through the configuration.
const MAX_MEMBER_DEPTH = 3

export const inputRootShape = {
  id: 'input-root-shape',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        if (input.kind !== 'body' || bodyKind(input) !== 'json') continue
        const shape = rootShape(input.schema, 0)
        if (shape === null) continue
        check(shape === 'object', {
          op: entry,
          dataPath: input.dataPath,
          params: { shape, mediaType: input.mediaType },
        })
      }
    }
  },
}

// 'object', the JSON Schema word for what it is instead (`array`, `string`,
// `oneOf`…), or null when the schema does not say.
function rootShape(schema, depth) {
  if (!isSchemaObject(schema)) return null
  // A choice inside an `allOf` member is not the tool's root: only the body's
  // own `oneOf` / `anyOf` becomes it.
  for (const keyword of depth === 0 ? ['oneOf', 'anyOf'] : []) {
    if (listOf(schema[keyword]).length) return keyword
  }
  const types = valueTypes(schema)
  if (types.length) return types.includes('object') ? 'object' : types[0]
  if (depth >= MAX_MEMBER_DEPTH) return null
  const shapes = listOf(schema.allOf)
    .map((member) => rootShape(member, depth + 1))
    .filter((shape) => shape !== null)
  if (!shapes.length) return null
  return shapes.find((shape) => shape !== 'object') ?? 'object'
}
