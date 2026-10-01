import { componentNames, placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { forbidsContent } from '../response-sites.js'
import { isObject } from '../value-check.js'

// A response declaring content where HTTP allows none. RFC 9110: "All 1xx
// (Informational), 204 (No Content), and 304 (Not Modified) responses do not
// include content" (§6.4.1, restated at §15.2, §15.3.5, §15.4.5); a server
// "MUST NOT generate content in a 205 response" (§15.3.6); and the server
// "MUST NOT send content in the response" to a HEAD request (§9.3.2) —
// whatever its status. The schema then describes a body no client ever reads:
// a generated client types the call's return value from it and parses an
// empty stream, and this documentation shows the body and its sample under
// that status like any other.
//
// One check per such response: a `1XX` range or 1xx code, 204, 205, 304, and
// every response of a HEAD operation, all operation kinds. A response written
// once under `components.responses` and used under one of these codes is one
// thing to fix: checked once, at the component. Under HEAD it is not — a HEAD
// operation usually reuses its GET's response, whose content is right for
// GET — so a HEAD response is checked where the operation lists it. An empty
// `content` map declares nothing and passes.

export const bodylessStatus = {
  id: 'bodyless-status',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const components = componentNames(ctx.document, 'responses')
    const seen = new Set()
    for (const entry of ctx.operations) {
      const responses = entry.op.responses
      if (!isObject(responses)) continue
      const head = entry.method === 'head'
      for (const [status, response] of Object.entries(responses)) {
        if (!isObject(response) || typeof response.$ref === 'string') continue
        if (!forbidsContent(status, entry.method)) continue
        const name = components.get(response)
        let site
        if (name === undefined || head) {
          // A component's `content` is not under the operation's pointer: the
          // `$ref` that brings it in is.
          const at = name === undefined ? ['responses', status, 'content'] : ['responses', status]
          site = { op: entry, dataPath: `${entry.pointer}${pointer(...at)}` }
        } else {
          if (seen.has(response)) continue
          seen.add(response)
          const dataPath = pointer('components', 'responses', name, 'content')
          site = { ...placeOf(ctx.operations, dataPath), dataPath }
        }
        const content = response.content
        const declares = isObject(content) && Object.keys(content).length > 0
        check(!declares, { ...site, params: { status } })
      }
    }
  },
}
