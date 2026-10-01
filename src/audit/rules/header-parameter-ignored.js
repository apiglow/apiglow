import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// Headers the specification takes out of the document's hands (OAS 3.x,
// Parameter Object `name`, and Response Object `headers`, SHALL be ignored):
// an `in: header` parameter named `Accept`, `Content-Type` or `Authorization`
// — the media types and the security schemes already say what goes there —
// and a response header named `Content-Type`, which the `content` map says.
// Code generators drop them; this documentation does not: it shows such a
// parameter as a header field of the try-it and sends what is typed in it,
// over the body's own Content-Type and over the credential it injects.
//
// One finding per such declaration, at its definition (a shared parameter is
// reported once, in components).
const IGNORED_PARAMETERS = new Set(['accept', 'content-type', 'authorization'])

export const headerParameterIgnored = {
  id: 'header-parameter-ignored',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const report = (at, name) =>
      check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { name } })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Parameter') {
        if (node.in !== 'header' || typeof node.name !== 'string') continue
        if (IGNORED_PARAMETERS.has(node.name.toLowerCase())) report(dataPath, node.name)
      } else if (type === 'Response') {
        const headers = node.headers
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) continue
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'content-type')
            report(`${dataPath}${pointer('headers', name)}`, name)
        }
      }
    }
  },
}
