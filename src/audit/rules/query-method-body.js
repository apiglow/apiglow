import { pointer } from '../pointer.js'

// A QUERY operation with nothing to query by. QUERY (RFC 10008, which OpenAPI
// 3.2's `query` field points to) is GET with content: "The content of the
// request and its media type define the query" (§2), and servers "MUST fail
// the request if the Content-Type request field … is missing or is
// inconsistent with the request content". An operation declared QUERY with no
// request body — or a request body with no `content` map, so no media type —
// describes a request every conforming server refuses; a generated client
// sends it bare, and this documentation's try-it has no body editor to offer.
// Usually a GET renamed, or the body left for later.
//
// 3.2 only: `query` is a fixed field from 3.2 — before, a `query` key is
// `unknown-field`'s. An `additionalOperations` key spelled QUERY in any case
// is dropped by the model (`pathItemOperations`) and reported by
// `additional-operation-method`. One check per QUERY operation, webhooks and
// callbacks included.
export const queryMethodBody = {
  id: 'query-method-body',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    if (ctx.version.major !== 3 || ctx.version.minor < 2) return
    for (const entry of ctx.operations) {
      if (entry.method !== 'query') continue
      const body = entry.op.requestBody
      const declared = isObject(body)
      const content = declared ? body.content : undefined
      check(isObject(content) && Object.keys(content).length > 0, {
        op: entry,
        dataPath: `${entry.pointer}${declared ? pointer('requestBody') : ''}`,
      })
    }
  },
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
