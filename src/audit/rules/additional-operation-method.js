import { isToken } from '../http-token.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A 3.2 `additionalOperations` key that is not a method this map may hold
// (OAS 3.2, Path Item Object, MUST NOT): a method the Path Item already has a
// field for — `POST` belongs under `post`, whatever its case — or a string no
// HTTP request can carry as its method, which must be a token (RFC 9110 §9.1).
// This documentation drops an entry redeclaring a fixed method — the
// operation written there never appears — and a key that is no token makes
// the browser's `fetch` refuse every request the try-it builds for it.
//
// One finding per such key.
const FIXED = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
])

export const additionalOperationMethod = {
  id: 'additional-operation-method',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'PathItem') continue
      const map = node.additionalOperations
      if (!map || typeof map !== 'object' || Array.isArray(map)) continue
      for (const method of Object.keys(map)) {
        if (method.startsWith('x-')) continue
        if (isToken(method) && !FIXED.has(method.toLowerCase())) continue
        const at = `${dataPath}${pointer('additionalOperations', method)}`
        check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { method } })
      }
    }
  },
}
