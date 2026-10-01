import { canHaveBody } from '../../openapi/methods.js'
import { isSubstantive } from '../text.js'

// The request body is the one input the reader cannot infer from the URL. Its
// description is where the semantics live — what a partial update accepts, which
// fields are mutually exclusive — and the schema alone never says that. A body
// on a GET or HEAD is `request-body-method`'s: the fix there is to remove it,
// not to describe it.
export const requestBodyDescribed = {
  id: 'request-body-described',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    // Same identity dedup as the parameters: a shared `components.requestBodies`
    // entry is one decision (the document is dereferenced).
    const seen = new Set()
    for (const entry of ctx.operations) {
      const body = entry.op.requestBody
      if (!body || typeof body !== 'object' || seen.has(body) || !canHaveBody(entry.method))
        continue
      seen.add(body)
      check(isSubstantive(body.description), {
        op: entry,
        dataPath: `${entry.pointer}/requestBody`,
      })
    }
  },
}
