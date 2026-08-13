import { hasText } from '../text.js'

// The request body is the one input the reader cannot infer from the URL. Its
// description is where the semantics live — what a partial update accepts, which
// fields are mutually exclusive — and the schema alone never says that.
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
      if (!body || typeof body !== 'object' || seen.has(body)) continue
      seen.add(body)
      check(hasText(body.description), { op: entry, dataPath: `${entry.pointer}/requestBody` })
    }
  },
}
