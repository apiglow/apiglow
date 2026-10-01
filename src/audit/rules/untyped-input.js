import { placeInput } from '../input-shape.js'
import { pointer } from '../pointer.js'
import { toolOperations } from '../tool-inputs.js'
import { inputPayloads, judgeValues, untypedState } from '../untyped.js'

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
// Judged at the positions that hold a value (src/audit/untyped.js, shared with
// `type-missing`, which grades what the API sends): the root of a parameter, of
// a JSON body, and every property, array item and tuple item below. A JSON body
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
    const state = untypedState()
    for (const entry of toolOperations(ctx)) {
      const report = (schema, dataPath, verdicts) => {
        const place = schema ? placeInput(ctx, entry, schema, dataPath) : { op: entry, dataPath }
        for (const [segments, untyped] of verdicts) {
          check(!untyped, { ...place, dataPath: `${place.dataPath}${pointer(...segments)}` })
        }
      }
      for (const payload of inputPayloads(entry)) judgeValues(payload, 'request', state, report)
    }
  },
}
