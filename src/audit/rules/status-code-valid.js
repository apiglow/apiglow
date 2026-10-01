import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A Responses key that is neither `default`, nor an HTTP status code, nor a
// range with the uppercase wildcard (`2XX`) — OAS 3.x, Responses Object:
// "Any HTTP status code can be used as the property name", ranges "MAY contain
// the uppercase wildcard character X". `200 OK`, `2xx`, `20`, `600`: a
// validator rejects it, a code generator matches no response to it, and this
// documentation shows the key as written, as if it were a status. One check
// per bad key.
const STATUS = /^(default|[1-5]\d\d|[1-5]XX)$/

export const statusCodeValid = {
  id: 'status-code-valid',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Responses') continue
      for (const status of Object.keys(node)) {
        if (status.startsWith('x-') || STATUS.test(status)) continue
        const at = `${dataPath}${pointer(status)}`
        check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { status } })
      }
    }
  },
}
