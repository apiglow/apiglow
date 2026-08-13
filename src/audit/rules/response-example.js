import { operationContents } from '../schema-walk.js'

// Per-response counterpart of the readiness rule `operation-examples`: that one
// asks whether the operation carries any example at all (its try-it prefill
// depends on it), this one asks it of each documented response payload, which is
// what the reader copies into their own client.
//
// The app renders a generated sample when there is none, so this is `info`: the
// page is never empty, it is just filled with "string" and 0.
export const responseExample = {
  id: 'response-example',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      // One check per status, not per media type: the same payload declared as
      // JSON and as XML is one example to write, and the app shows whichever
      // media type it finds one on.
      const byStatus = new Map()
      for (const item of operationContents(entry)) {
        if (item.kind !== 'response') continue
        const schema = item.content.schema ?? item.content.itemSchema
        // No schema means no described payload: nothing to exemplify.
        if (!schema || typeof schema !== 'object') continue
        const state = byStatus.get(item.status) ?? { dataPath: item.dataPath, example: false }
        state.example ||= hasExample(item.content, schema)
        byStatus.set(item.status, state)
      }
      for (const [status, { dataPath, example }] of byStatus) {
        check(example, { op: entry, dataPath, params: { status } })
      }
    }
  },
}

function hasExample(content, schema) {
  if (content.example !== undefined) return true
  if (content.examples && typeof content.examples === 'object') {
    if (Object.keys(content.examples).length) return true
  }
  return (
    schema.example !== undefined || (Array.isArray(schema.examples) && schema.examples.length > 0)
  )
}
