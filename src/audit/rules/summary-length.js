import { toolOperations } from '../tool-inputs.js'

// A summary over the 300 characters GPT Actions allows: "300 characters max
// for each API endpoint description/summary field". The summary is the line a
// tool list shows and the description bridges fall back to when the operation
// has none — it is meant to fit at a glance, and past 300 characters it no
// longer fits the platform that publishes the most actions.
//
// Counted in characters (code points), not UTF-16 units: an emoji is one
// character to the reader and to the limit. Only the summary: a description is
// where long prose belongs, and the documentation renders it as such. One
// check per tool operation with a non-blank summary.
const LIMIT = 300

export const summaryLength = {
  id: 'summary-length',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      const summary = entry.op.summary
      if (typeof summary !== 'string' || !summary.trim()) continue
      const length = [...summary].length
      check(length <= LIMIT, {
        op: entry,
        dataPath: `${entry.pointer}/summary`,
        params: { length, limit: LIMIT },
      })
    }
  },
}
