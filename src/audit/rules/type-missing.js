import { bodyKind } from '../../openapi/body-kind.js'
import { componentNames } from '../locate.js'
import { pointer } from '../pointer.js'
import { forbidsContent } from '../response-sites.js'
import { carriesFile, operationContents } from '../schema-walk.js'
import { toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'
import { inputPayloads, judgeUntyped } from '../untyped.js'

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
// at all is `response-content-schema`'s; a file has no type to give; a status
// or a method that allows no content (204, a HEAD response) is
// `bodyless-status`', which asks for the content to go. A response written
// once under `components.responses` is judged once, at the component.
export const typeMissing = {
  id: 'type-missing',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const inputs = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        walkInputSchema(input.schema, input.dataPath, () => {}, inputs)
      }
    }
    const components = componentNames(ctx.document, 'responses')
    const done = new Set()
    const payloads = []
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') payloads.push(...inputPayloads(entry))
      payloads.push(...responsePayloads(entry, components, done))
    }
    judgeUntyped(ctx, payloads, check, inputs)
  },
}

// `done`: the media types of shared response components already yielded.
function* responsePayloads(entry, components, done) {
  for (const { kind, status, mediaType, content, dataPath } of operationContents(entry)) {
    if (kind !== 'response' || done.has(content) || forbidsContent(status, entry.method)) continue
    if (carriesFile({ mediaType, content })) continue
    const name = components.get(entry.op.responses[status])
    if (name !== undefined) done.add(content)
    const base =
      name === undefined ? dataPath : pointer('components', 'responses', name, 'content', mediaType)
    const judgeRoot = bodyKind({ mediaType }) === 'json'
    for (const key of ['schema', 'itemSchema']) {
      if (content[key] === undefined) continue
      yield {
        entry: name === undefined ? entry : null,
        side: 'response',
        schema: content[key],
        dataPath: `${base}/${key}`,
        judgeRoot,
        blankAt: null,
      }
    }
  }
}
