import { pointer } from '../pointer.js'

// The 3.2 `in: querystring` parameter is the whole query string as one value,
// and the specification fences it in (OAS 3.2, Parameter Locations, MUST): it
// is described with `content` — the media type says how the string is
// written — never with `schema`; an operation has at most one, counting the
// Path Item's; and none sits next to an `in: query` parameter, since both
// would claim the same string. This documentation sends the querystring value
// as is and appends the query parameters after it, which is a query string
// neither declaration describes.
//
// Read on each operation's merged parameter list, the Path Item's included. One
// finding per conflict: on the parameter using `schema` (once per declaration),
// on each querystring parameter beyond the first, and on the querystring
// parameter of an operation that also has query parameters.
export const querystringParameter = {
  id: 'querystring-parameter',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const reported = new Set()
    for (const entry of ctx.operations) {
      const querystrings = entry.parameters.filter(({ param }) => param.in === 'querystring')
      if (!querystrings.length) continue
      for (const { param, dataPath } of querystrings) {
        if (param.schema === undefined || reported.has(dataPath)) continue
        reported.add(dataPath)
        check(false, {
          op: entry,
          dataPath: `${dataPath}${pointer('schema')}`,
          params: { name: String(param.name), conflict: 'schema' },
        })
      }
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
