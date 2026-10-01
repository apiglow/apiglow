import { bodyKind } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { compositionMembers, placeInput, saysNothing } from '../input-shape.js'
import { pointer } from '../pointer.js'
import { isSchemaObject, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'

// An input an agent must fill in whose schema says nothing about its value: no
// `type`, no values, no structure, no composition — `{}`, `true`, or
// annotations only (a `description`, an `example`, a `format`). OpenAPI→MCP
// bridges copy the request schema into the tool's `inputSchema` as it is, so
// the model is handed a field and no type: it guesses, and a guessed string
// where the API wants a number is a failed call.
//
// This documentation hits the same wall: the model reads the schema as `any`
// (src/openapi/model.js), the schema view prints `any`, the try-it renders a
// bare text box and sends what is typed as a string — `coerceValue` has no type
// to convert to and returns the text unchanged (src/openapi/coerce.js), so `42`
// leaves a JSON body as `"42"` — and, short of an example, the sample it
// generates is `null` (src/openapi/sample.js `scalar`).
//
// Judged at the positions that hold a value: the root of a parameter, of a
// JSON body, and every property, array item and tuple item below. A JSON body
// declared with no schema at all is the same blank and is flagged at its media
// type. Left alone:
// - a composition member (`allOf: [{ description }, …]`): it describes the
//   value together with its siblings, and the parent says something;
// - an `additionalProperties` value: an open map's extra keys are
//   `free-form-input`'s;
// - the root of a form or text body: `multipart-schema-object` grades a form
//   with no fields, and a text media type already says text;
// - a parameter with neither `schema` nor `content`: `parameter-schema-or-content`;
// - a `$ref` the loader could not resolve: `ref-resolves`'.
export const untypedInput = {
  id: 'untyped-input',
  category: 'agent',
  severity: 'warning',
  run(ctx, check) {
    // One verdict per schema object, however many operations share it.
    const seen = new Set()
    // Schemas reached first as a member or a map value: never judged as a
    // value of their own (see above).
    const passive = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        const judgeRoot = input.kind === 'parameter' || isJson(input)
        if (input.schema === undefined) {
          if (isJson(input)) check(false, { op: entry, dataPath: input.dataPath.slice(0, -7) })
          continue
        }
        if (input.schema === true && judgeRoot)
          check(false, { op: entry, dataPath: input.dataPath })
        const visit = (schema, dataPath, depth) => {
          for (const member of compositionMembers(schema)) passive.add(member)
          if (isSchemaObject(schema.additionalProperties)) passive.add(schema.additionalProperties)
          const place = placeInput(ctx, entry, schema, dataPath)
          if (!passive.has(schema) && (depth > 0 || judgeRoot)) check(!saysNothing(schema), place)
          for (const segments of booleanTrueChildren(schema)) {
            check(false, { ...place, dataPath: `${place.dataPath}${pointer(...segments)}` })
          }
        }
        walkInputSchema(input.schema, input.dataPath, visit, seen)
      }
    }
  },
}

function isJson(input) {
  return input.kind === 'body' && bodyKind({ mediaType: input.mediaType }) === 'json'
}

// `true` where a value goes: the walk only visits schema objects, and a boolean
// has no identity to deduplicate on — its position is reported with its parent.
function* booleanTrueChildren(schema) {
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, sub] of Object.entries(schema.properties)) {
      if (sub === true) yield ['properties', name]
    }
  }
  if (schema.items === true) yield ['items']
  for (const [index, sub] of listOf(schema.prefixItems).entries()) {
    if (sub === true) yield ['prefixItems', index]
  }
}
