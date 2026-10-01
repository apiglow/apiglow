import { isForbiddenMethod, isForbiddenRequestHeader } from '../../openapi/forbidden.js'
import { placeOf } from '../locate.js'
import { nodeAt } from '../ref-pointer.js'

// What a browser refuses to put on a request, by the Fetch standard: a
// forbidden request-header (`Host`, `Cookie`, `Origin`, `Content-Length`, any
// `Sec-`/`Proxy-` name, a method-override header carrying TRACE…) is dropped
// without a word, and a forbidden method (CONNECT, TRACE, TRACK) makes
// `fetch()` throw before anything leaves. The lists are the app's own
// (src/openapi/forbidden.js), so the rule and the try-it cannot disagree: the
// try-it names the headers it will not send and refuses the method, pointing
// at the cURL command instead. Any browser client — a SPA, an embedded
// console — hits the same wall.
//
// One check per `in: header` parameter (a shared one once, in components) and
// per paths operation, 3.2 `additionalOperations` included. A method-override
// header is forbidden only for a forbidden method: its declared values (`enum`,
// `const`, `default`, examples) are what is read. Webhooks and callbacks are
// requests the API sends, not a browser. Left to other rules: `in: cookie`
// parameters (the try-it already notes how it sends them), and `Accept`,
// `Content-Type`, `Authorization` — `header-parameter-ignored`'s, and not
// forbidden anyway.
export const forbiddenInBrowser = {
  id: 'forbidden-in-browser',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Parameter' || node.in !== 'header' || typeof node.name !== 'string') continue
      if (sentByTheApi(dataPath)) continue
      const place = placeOf(ctx.operations, dataPath)
      // Dereferenced, for a schema or examples behind a `$ref`.
      const param = nodeAt(ctx.document, dataPath) ?? node
      const forbidden = declaredValues(param).some((value) =>
        isForbiddenRequestHeader(node.name, value),
      )
      check(!forbidden, { ...place, dataPath, params: { name: node.name } })
    }
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      check(!isForbiddenMethod(entry.method), {
        op: entry,
        params: { name: entry.method.toUpperCase() },
      })
    }
  },
}

// Inside a webhook or a callback, Path Item level included.
function sentByTheApi(dataPath) {
  return dataPath.startsWith('/webhooks/') || dataPath.includes('/callbacks/')
}

// The values the header is documented to carry, and `undefined` for "any":
// a name forbidden whatever its value is caught by it.
function declaredValues(param) {
  const values = [undefined, param.example]
  const schema = param.schema && typeof param.schema === 'object' ? param.schema : {}
  values.push(schema.const, schema.default, schema.example)
  for (const list of [schema.enum, schema.examples]) {
    if (Array.isArray(list)) values.push(...list)
  }
  if (param.examples && typeof param.examples === 'object') {
    for (const example of Object.values(param.examples)) {
      if (example && typeof example === 'object') values.push(example.value, example.dataValue)
    }
  }
  return values.filter((value, index) => index === 0 || typeof value === 'string')
}
