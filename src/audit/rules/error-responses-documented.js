import { pointer } from '../pointer.js'

// A mutating operation that documents only its happy path leaves the reader
// blind exactly where the API is hardest to use: validation errors, conflicts,
// permissions. The try-it will show those responses anyway — undocumented.
//
// Read-only methods are out of scope: their failure modes are the generic HTTP
// ones, and demanding a 404 on every GET would be noise.
const SAFE_METHODS = new Set(['get', 'head', 'options', 'trace', 'query'])

export const errorResponsesDocumented = {
  id: 'error-responses-documented',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      // A webhook's responses are what the integrator's server returns, not the
      // API's: "document your errors" is not this document's call to make.
      if (entry.kind !== 'operation' || SAFE_METHODS.has(entry.method)) continue
      const statuses = Object.keys(entry.op.responses ?? {})
      // `default` counts: it is the documented catch-all for everything not
      // listed, error codes included.
      const documented = statuses.some((status) => /^4/.test(status) || status === 'default')
      check(documented, { op: entry, dataPath: `${entry.pointer}${pointer('responses')}` })
    }
  },
}
