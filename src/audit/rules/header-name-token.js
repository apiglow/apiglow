import { isToken } from '../http-token.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A header name that is not an HTTP token (RFC 9110 §5.1, §5.6.2): a space, a
// colon, an accented letter. No such header can exist on the wire. Code
// generators emit a client that throws on its first call; here, the try-it
// prefills the header field with that name and the browser's `fetch` refuses
// the request before sending anything — the try-it reports a failed send.
//
// Read where a name becomes a header: an `in: header` parameter's `name`, the
// keys of a Response's and of an Encoding's `headers` map. Keys of
// `components.headers` are component names, not header names. One finding per
// invalid name.
export const headerNameToken = {
  id: 'header-name-token',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const report = (at, name) =>
      check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { name } })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Parameter') {
        if (node.in === 'header' && typeof node.name === 'string' && !isToken(node.name)) {
          report(`${dataPath}/name`, node.name)
        }
      } else if (type === 'Response' || type === 'Encoding') {
        const headers = node.headers
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) continue
        for (const name of Object.keys(headers)) {
          if (!isToken(name)) report(`${dataPath}${pointer('headers', name)}`, name)
        }
      }
    }
  },
}
