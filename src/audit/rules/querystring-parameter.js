import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// The 3.2 `in: querystring` parameter is the whole query string as one value,
// and the specification fences it in (OAS 3.2, Parameter Locations and Fixed
// Fields for use with `schema`, MUST): it is described with `content` — the
// media type says how the string is written — never with `schema`, `explode`
// or `allowReserved`; an operation has at most one, counting the Path Item's;
// and none sits next to an `in: query` parameter, since both would claim the
// same string. This documentation sends the querystring value as is and
// appends the query parameters after it, which is a query string neither
// declaration describes.
//
// The forbidden fields are read on each declaration, so a shared parameter is
// reported once, in components; its `style` is `parameter-style-valid`'s. The
// count and the neighbours are read on each operation's merged parameter list,
// the Path Item's included: one finding on each querystring parameter beyond
// the first, and one on the querystring parameter of an operation that also
// has query parameters. Before 3.2 the location itself is
// `version-construct`'s.
const SCHEMA_FIELDS = ['schema', 'explode', 'allowReserved']

export const querystringParameter = {
  id: 'querystring-parameter',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    if (ctx.version.minor < 2) return
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Parameter' || node.in !== 'querystring') continue
      for (const field of SCHEMA_FIELDS) {
        if (node[field] === undefined) continue
        const at = `${dataPath}${pointer(field)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { name: String(node.name), conflict: field },
        })
      }
    }
    for (const entry of ctx.operations) {
      const querystrings = entry.parameters.filter(({ param }) => param.in === 'querystring')
      if (!querystrings.length) continue
      const [first, ...others] = querystrings
      for (const { param, dataPath } of others) {
        check(false, {
          op: entry,
          dataPath,
          params: { name: String(param.name), conflict: String(first.param.name) },
        })
      }
      const query = entry.parameters.find(({ param }) => param.in === 'query')
      if (query) {
        check(false, {
          op: entry,
          dataPath: first.dataPath,
          params: { name: String(first.param.name), conflict: String(query.param.name) },
        })
      }
    }
  },
}
