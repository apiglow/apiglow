import { componentNames, placeOf } from './locate.js'
import { pointer } from './pointer.js'
import { toolOperations } from './tool-inputs.js'
import { isObject } from './value-check.js'

// The responses the tool operations document under the status codes `matches`
// accepts, each placed where its author fixes it. A response written once under
// `components.responses` and referenced by hundreds of operations — GitHub's
// `requires_authentication` stands behind 159 of its 401s — is one thing to
// fix: it is yielded once, at the component, under the first matching status it
// is met with. The dereferenced document keeps one object per `$ref` target, so
// identity tells the uses apart from inline copies. → { response, status, site },
// `site` ready for `check()`.
//
// A `$ref` the loader could not resolve is `ref-resolves`'; a response that is
// not an object, `field-value-kind`'s.
export function* responsesWhere(ctx, matches) {
  const components = componentNames(ctx.document, 'responses')
  const seen = new Set()
  for (const entry of toolOperations(ctx)) {
    const responses = entry.op.responses
    if (!isObject(responses)) continue
    for (const [status, response] of Object.entries(responses)) {
      if (!matches(status) || !isObject(response) || typeof response.$ref === 'string') continue
      const name = components.get(response)
      if (name === undefined) {
        const dataPath = `${entry.pointer}${pointer('responses', status)}`
        yield { response, status, site: { op: entry, dataPath } }
        continue
      }
      if (seen.has(response)) continue
      seen.add(response)
      const dataPath = pointer('components', 'responses', name)
      yield { response, status, site: { ...placeOf(ctx.operations, dataPath), dataPath } }
    }
  }
}

// A response HTTP gives no content: a 1xx (or `1XX`), 204, 205 or 304, and
// any response to HEAD (RFC 9110 §6.4.1, §9.3.2, §15.3.6). One that declares
// content anyway is `bodyless-status`'s; the rules asking what that content
// says leave it alone rather than ask for the opposite fix.
const BODYLESS = /^(1\d\d|1XX|204|205|304)$/i

export function forbidsContent(status, method) {
  return method === 'head' || BODYLESS.test(status)
}

// Header names are case-insensitive (RFC 9110 §5.1), and so are the keys of a
// `headers` map for that reason.
export function declaresHeader(response, name) {
  const headers = response.headers
  return isObject(headers) && Object.keys(headers).some((key) => key.toLowerCase() === name)
}
