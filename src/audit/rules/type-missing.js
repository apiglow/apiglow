import { bodyKind } from '../../openapi/body-kind.js'
import { placeInput } from '../input-shape.js'
import { pointer } from '../pointer.js'
import { carriesFile } from '../schema-walk.js'
import { inputPayloads, judgeValues, toolInputSchemas, untypedState } from '../untyped.js'

// `untyped-input`'s question asked of what the API sends: a value whose schema
// says nothing about it — `{}`, `true`, annotations only — in a response body
// of any operation, or in the request body or a parameter of a webhook or a
// callback (requests the API makes). The reader of the reference learns the
// field exists and nothing of its kind; a generated client gets no type for
// it. This documentation prints it as `any`, and the example it
// generates holds `null` in its place (src/openapi/sample.js `scalar`).
//
// Same predicate, same positions (src/audit/untyped.js): the root of a
// parameter and of a JSON body, every property, array item and tuple item
// below — a response's `readOnly` properties included, its `writeOnly` ones
// left out (they are never sent). 3.2's `itemSchema` is judged like a body
// root. A schema `untyped-input` walks — any tool input, a component shared by
// a request and a response included — is that rule's, and only its children
// that are not inputs get a verdict here. A response media type with no schema
// at all is `response-content-schema`'s; a file has no type to give.
export const typeMissing = {
  id: 'type-missing',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const state = untypedState(toolInputSchemas(ctx))
    for (const entry of ctx.operations) {
      const report = (schema, dataPath, verdicts) => {
        const place = schema ? placeInput(ctx, entry, schema, dataPath) : { op: entry, dataPath }
        for (const [segments, untyped] of verdicts) {
          check(!untyped, { ...place, dataPath: `${place.dataPath}${pointer(...segments)}` })
        }
      }
      if (entry.kind !== 'operation') {
        for (const payload of inputPayloads(entry)) judgeValues(payload, 'request', state, report)
      }
      for (const payload of responsePayloads(entry)) judgeValues(payload, 'response', state, report)
    }
  },
}

function* responsePayloads(entry) {
  const responses = entry.op.responses
  if (!isObject(responses)) return
  for (const [status, response] of Object.entries(responses)) {
    if (!isObject(response) || !isObject(response.content)) continue
    for (const [mediaType, media] of Object.entries(response.content)) {
      if (!isObject(media) || carriesFile({ mediaType, content: media })) continue
      const judgeRoot = bodyKind({ mediaType }) === 'json'
      const base = `${entry.pointer}${pointer('responses', status, 'content', mediaType)}`
      for (const key of ['schema', 'itemSchema']) {
        if (media[key] === undefined) continue
        yield { schema: media[key], dataPath: `${base}/${key}`, judgeRoot, blankAt: null }
      }
    }
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
