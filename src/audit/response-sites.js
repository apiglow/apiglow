import { placeOf } from './locate.js'
import { pointer } from './pointer.js'
import { toolOperations } from './tool-inputs.js'

// The responses the tool operations document under one status code, each
// placed where its author fixes it. A response written once under
// `components.responses` and referenced by hundreds of operations — GitHub's
// `requires_authentication` stands behind 159 of its 401s — is one thing to
// fix: it is yielded once, at the component. The dereferenced document keeps
// one object per `$ref` target, so identity tells the uses apart from inline
// copies. → { response, op, location, dataPath }, ready for `check()`.
//
// A `$ref` the loader could not resolve is `ref-resolves`'; a response that is
// not an object, `field-value-kind`'s.
export function* responsesWithStatus(ctx, status) {
  const components = componentResponses(ctx)
  const seen = new Set()
  for (const entry of toolOperations(ctx)) {
    const responses = entry.op.responses
    if (!isObject(responses)) continue
    const response = responses[status]
    if (!isObject(response) || typeof response.$ref === 'string') continue
    const name = components.get(response)
    if (name === undefined) {
      yield { response, op: entry, dataPath: `${entry.pointer}${pointer('responses', status)}` }
      continue
    }
    if (seen.has(response)) continue
    seen.add(response)
    const dataPath = pointer('components', 'responses', name)
    yield { response, ...placeOf(ctx.operations, dataPath), dataPath }
  }
}

// Header names are case-insensitive (RFC 9110 §5.1), and so are the keys of a
// `headers` map for that reason.
export function declaresHeader(response, name) {
  const headers = response.headers
  return isObject(headers) && Object.keys(headers).some((key) => key.toLowerCase() === name)
}

// Response object → its name under `components.responses`; the first name
// wins when one component is a `$ref` to another.
function componentResponses(ctx) {
  const names = new Map()
  const declared = ctx.document.components?.responses
  if (!isObject(declared)) return names
  for (const [name, response] of Object.entries(declared)) {
    if (isObject(response) && !names.has(response)) names.set(response, name)
  }
  return names
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
