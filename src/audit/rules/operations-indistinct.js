import { toolOperations } from '../tool-inputs.js'

// Two operations an agent cannot tell apart: their tools carry the same
// description. An agent picks a tool by its description — both MCP bridges
// (`@ivotoby/openapi-mcp-server`, `@tyk-technologies/api-to-mcp`) and Semantic
// Kernel's OpenAPI plugin build it from the operation's `description`, else its
// `summary` — so two tools saying the same thing are a coin flip, and the one
// it calls may be the one that deletes.
//
// What is compared is that tool description, not the summary alone: an
// operation with a distinct summary but a description copied from a sibling
// still shows the agent the copy. Compared trimmed, whitespace collapsed,
// without case — and identity only: a similarity score would flag the
// legitimate parallels every CRUD API has (`List pets`, `List owners`) and
// leave the author nothing to fix.
//
// One check per tool operation whose tool would have a description (one with
// none is `operation-described`'s); the finding on each operation after the
// first that says the same, naming that first.
export const operationsIndistinct = {
  id: 'operations-indistinct',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const first = new Map()
    for (const entry of toolOperations(ctx)) {
      const field = toolDescriptionField(entry.op)
      if (!field) continue
      const text = entry.op[field].trim().replace(/\s+/g, ' ').toLowerCase()
      const other = first.get(text)
      if (!other) first.set(text, entry)
      check(!other, {
        op: entry,
        dataPath: `${entry.pointer}/${field}`,
        params: other ? { other: `${other.method.toUpperCase()} ${other.path}` } : {},
      })
    }
  },
}

// The field a bridge takes the tool description from, or null when neither
// says anything.
function toolDescriptionField(op) {
  for (const field of ['description', 'summary']) {
    if (typeof op[field] === 'string' && op[field].trim()) return field
  }
  return null
}
