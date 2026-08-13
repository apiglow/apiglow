import { hasText } from '../text.js'

// An operation with neither summary nor description renders as a bare method and
// path: the reader is left inferring what it does from its URL, and the nav
// entry has nothing to show but the same URL.
export const operationDescribed = {
  id: 'operation-described',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      check(hasText(entry.op.summary) || hasText(entry.op.description), { op: entry })
    }
  },
}
