import { pointer } from '../pointer.js'

// A response with neither content nor a word of description renders as an empty
// status line: the reader learns that the code exists and nothing else.
export const responseSubstance = {
  id: 'response-substance',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
        if (!response || typeof response !== 'object') continue
        const hasContent = Object.keys(response.content ?? {}).length > 0
        // 3.2 makes `description` optional and adds `summary`: either one is
        // substance.
        const described = [response.description, response.summary].some(
          (text) => typeof text === 'string' && text.trim(),
        )
        check(hasContent || described, {
          op: entry,
          dataPath: `${entry.pointer}${pointer('responses', status)}`,
          params: { status },
        })
      }
    }
  },
}
