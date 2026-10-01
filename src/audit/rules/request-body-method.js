import { pointer } from '../pointer.js'

// A request body on a method that gives content no meaning. RFC 9110 says
// content in a GET, HEAD or DELETE request "has no generally defined
// semantics" and "might lead some implementations to reject the request"
// (§9.3.1, §9.3.2, §9.3.5): a client SHOULD NOT send it unless the origin
// server said it has a purpose. With TRACE it is a MUST NOT (§9.3.8). OpenAPI
// 3.0 makes consumers ignore such a `requestBody` (SHALL); 3.1 and 3.2 permit
// it and say to avoid it. Proxies and caches are free to drop it, and a
// generated client may not even emit it.
//
// Graded per method: GET and HEAD are a `warning` — a browser cannot send them
// at all (the Fetch standard throws on a body with either), so this
// documentation's try-it keeps the body editor, says the request leaves
// without it, and sends it bodiless (`canHaveBody`, `src/openapi/methods.js`);
// the cURL command keeps it. DELETE is an `info`: real APIs read a DELETE body
// on purpose (a batch of ids), the SHOULD NOT allows it when the server says
// so, and the try-it sends it. TRACE is an `error`, and the rule's own
// severity: the request cannot carry it, and a browser refuses to send a TRACE
// request at all (`forbidden-in-browser` reports the method).
//
// One check per operation with one of these methods — webhooks and callbacks
// included, the request is just as meaningless whoever sends it. Fixed fields
// only: a 3.2 `additionalOperations` key naming one of them, in any case, is
// dropped by the model (`pathItemOperations`) and reported by
// `additional-operation-method`.
const SEVERITY = new Map([
  ['get', 'warning'],
  ['head', 'warning'],
  ['delete', 'info'],
  ['trace', 'error'],
])

export const requestBodyMethod = {
  id: 'request-body-method',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      const severity = SEVERITY.get(entry.method)
      if (!severity) continue
      const body = entry.op.requestBody
      check(!body || typeof body !== 'object' || Array.isArray(body), {
        op: entry,
        dataPath: `${entry.pointer}${pointer('requestBody')}`,
        params: { method: entry.method.toUpperCase() },
        severity,
      })
    }
  },
}
