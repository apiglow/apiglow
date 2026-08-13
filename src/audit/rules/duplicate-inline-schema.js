// The same shape written out twice instead of shared: the two copies are
// identical today and drift the day one of them gets a field. Cheap heuristic
// (docs/audit.md §4.4): identical canonical serializations, above a size worth
// naming.
//
// This only ever sees real duplication. In the dereferenced document a `$ref`'d
// component is ONE object shared by every use site, so a shape the author did
// factor out is collected once by `ctx.schemas` and can never form a group.

// Below this, extracting a component costs more than the repetition: `{"type":
// "string","format":"date-time"}` is not a missing component.
const MIN_SIGNATURE_SIZE = 200

// The serialization is only ever compared to another serialization, so a cycle
// or an absurd nesting becomes a marker rather than a stack overflow (rule 7).
const MAX_DEPTH = 12

export const duplicateInlineSchema = {
  id: 'duplicate-inline-schema',
  category: 'consistency',
  severity: 'info',
  run(ctx, check) {
    const named = componentNames(ctx.document)
    const groups = new Map()
    for (const entry of ctx.schemas) {
      const key = signature(entry.schema, 0, new Set(), named)
      if (key.length < MIN_SIGNATURE_SIZE) continue
      const group = groups.get(key)
      if (group) group.push(entry)
      else groups.set(key, [entry])
    }
    for (const group of groups.values()) {
      for (const [index, entry] of group.entries()) {
        // The first occurrence is where the shared component would naturally
        // live: the copies are the finding, not the original.
        check(index === 0, {
          op: entry.op,
          location: entry.location,
          dataPath: entry.dataPath,
          params: { count: group.length },
        })
      }
    }
  },
}

// Canonical JSON: keys sorted, so two objects written in a different order still
// collide. A referenced component collapses to its name instead of its content:
// dereferencing inlined it, and `{ type: array, items: $ref Pet }` written at six
// endpoints is six `$ref`s, not six copies of Pet.
function signature(value, depth, ancestors, named) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  // Only below the root: two components identical to each other are exactly what
  // this rule is looking for.
  if (depth > 0 && named.has(value)) return JSON.stringify(`~ref:${named.get(value)}`)
  if (ancestors.has(value)) return '"~cycle"'
  if (depth > MAX_DEPTH) return '"~deep"'
  ancestors.add(value)
  const body = Array.isArray(value)
    ? `[${value.map((item) => signature(item, depth + 1, ancestors, named)).join(',')}]`
    : `{${Object.keys(value)
        .sort()
        .map(
          (key) => `${JSON.stringify(key)}:${signature(value[key], depth + 1, ancestors, named)}`,
        )
        .join(',')}}`
  ancestors.delete(value)
  return body
}

function componentNames(document) {
  const named = new Map()
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    if (schema && typeof schema === 'object') named.set(schema, name)
  }
  return named
}
