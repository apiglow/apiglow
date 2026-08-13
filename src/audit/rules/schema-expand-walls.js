import { operationContents } from '../schema-walk.js'

// Docs readiness, info only — the app handles these schemas, but the author
// should know what reading them looks like: the schema view auto-expands a
// bounded number of levels and puts an "expand" button on everything below,
// systematically so on a recursive node (rule 7). Past that line, the structure
// is only readable through clicks.
//
// Mirrors MAX_AUTO_DEPTH in src/components/schema-view.js. The core does not
// import a component: the value is repeated here, and the two must move
// together.
const AUTO_EXPAND_DEPTH = 3

export const schemaExpandWalls = {
  id: 'schema-expand-walls',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      const roots = operationSchemas(entry)
      if (!roots.length) continue
      check(!roots.some(hasWall), { op: entry, params: { depth: AUTO_EXPAND_DEPTH } })
    }
  },
}

function operationSchemas(entry) {
  const roots = []
  for (const { param } of entry.parameters) roots.push(param.schema)
  for (const { content } of operationContents(entry)) {
    roots.push(content.schema, content.itemSchema)
  }
  for (const response of Object.values(entry.op.responses ?? {})) {
    for (const header of Object.values(response?.headers ?? {})) roots.push(header?.schema)
  }
  return roots.filter((schema) => schema && typeof schema === 'object')
}

function hasWall(root) {
  // The walk never goes past the auto-expand line — below it, the verdict is
  // already known — so its depth is bounded by construction. The per-depth memo
  // keeps a wide shared graph from being re-walked once per path to it.
  const seen = Array.from({ length: AUTO_EXPAND_DEPTH + 1 }, () => new Set())
  const walk = (schema, depth, ancestors) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
    // Back to a node still on the path = the cycle ref-parser materialized:
    // rendered as an expand button whatever its depth.
    if (ancestors.has(schema)) return true
    if (depth > AUTO_EXPAND_DEPTH) return isComplex(schema)
    if (seen[depth].has(schema)) return false
    seen[depth].add(schema)
    ancestors.add(schema)
    const walled = children(schema).some((child) => walk(child, depth + 1, ancestors))
    ancestors.delete(schema)
    return walled
  }
  return walk(root, 0, new Set())
}

// Complex = the schema view gives it a subtree of its own, so it is what an
// expand button hides. A scalar below the line costs nothing to read.
function isComplex(schema) {
  return children(schema).length > 0
}

function children(schema) {
  const list = []
  if (schema.properties && typeof schema.properties === 'object') {
    list.push(...Object.values(schema.properties))
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    list.push(schema.additionalProperties)
  }
  if (schema.items) list.push(schema.items)
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
    if (Array.isArray(schema[keyword])) list.push(...schema[keyword])
  }
  return list.filter((child) => child && typeof child === 'object' && !Array.isArray(child))
}
