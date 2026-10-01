import { listOf } from '../../openapi/model.js'

// A schema no finite instance can satisfy: it requires a property whose schema
// requires, directly or a few hops further, the schema itself again — a Node
// with a required `child` that is a Node — with nothing on the way to stop the
// chain: no `null` allowed, no alternative (`oneOf` / `anyOf`), no array that
// may be empty. A valid instance would have to be infinite. Validators reject
// every payload, generators emit a type whose constructor needs an instance of
// itself, and this documentation's sample stops at its depth limit with a
// value the API would refuse.
//
// Conservative by design (rule 7 keeps the walk bounded): an edge is a
// required property — of the schema or of an `allOf` member — whose schema is a
// plain object (declared `object`, or untyped with object keywords), or a
// required array with `minItems` ≥ 1 of such objects. A cycle of those edges,
// found over `ctx.schemas` by identity (the dereferenced document makes a
// recursive `$ref` a cycle of objects), is one finding, at its first schema.
const MAX_ALLOF_DEPTH = 8

export const recursionUnsatisfiable = {
  id: 'recursion-unsatisfiable',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const index = new Map(ctx.schemas.map((entry, i) => [entry.schema, i]))
    const edges = (schema) =>
      requiredTargets(schema)
        .map(({ target, property }) => ({ to: index.get(target), property }))
        .filter(({ to }) => to !== undefined)
    for (const component of stronglyConnected(ctx.schemas.length, (i) =>
      edges(ctx.schemas[i].schema),
    )) {
      const first = Math.min(...component.nodes)
      const { schema, dataPath, op, location } = ctx.schemas[first]
      const property = edges(schema).find(({ to }) => component.nodes.has(to))?.property
      check(false, { op, location, dataPath, params: { property } })
    }
  },
}

// The schemas `schema` cannot exist without: one per required property that
// forces an object, with the property's name.
function requiredTargets(schema) {
  const parts = []
  const gather = (part, depth) => {
    if (!part || typeof part !== 'object' || depth > MAX_ALLOF_DEPTH || parts.includes(part)) return
    parts.push(part)
    for (const member of listOf(part.allOf)) gather(member, depth + 1)
  }
  gather(schema, 0)
  const properties = {}
  for (const part of parts) {
    if (part.properties && typeof part.properties === 'object')
      Object.assign(properties, part.properties)
  }
  const targets = []
  for (const part of parts) {
    for (const name of listOf(part.required)) {
      if (typeof name !== 'string') continue
      const target = forcedObject(properties[name])
      if (target) targets.push({ target, property: name })
    }
  }
  return targets
}

function forcedObject(schema) {
  if (!schema || typeof schema !== 'object' || nullable(schema)) return null
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) return null
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
      ? []
      : [schema.type]
  if (types.length === 1 && types[0] === 'array') {
    return typeof schema.minItems === 'number' && schema.minItems >= 1
      ? forcedObject(schema.items)
      : null
  }
  if (types.length) return types.length === 1 && types[0] === 'object' ? schema : null
  return schema.properties || schema.allOf || schema.required ? schema : null
}

function nullable(schema) {
  if (schema.nullable === true || schema.type === 'null') return true
  return Array.isArray(schema.type) && schema.type.includes('null')
}

// Tarjan's algorithm, iterative (a deep schema graph must not exhaust the
// stack) → the components that hold a cycle: several nodes, or one with an
// edge to itself.
function stronglyConnected(count, edgesOf) {
  const indexOf = new Array(count).fill(-1)
  const low = new Array(count).fill(0)
  const onStack = new Array(count).fill(false)
  const stack = []
  const found = []
  let next = 0
  for (let root = 0; root < count; root++) {
    if (indexOf[root] !== -1) continue
    const work = [{ node: root, edges: null, at: 0 }]
    while (work.length) {
      const frame = work.at(-1)
      if (frame.edges === null) {
        frame.edges = edgesOf(frame.node)
        indexOf[frame.node] = low[frame.node] = next++
        stack.push(frame.node)
        onStack[frame.node] = true
      }
      if (frame.at < frame.edges.length) {
        const { to } = frame.edges[frame.at++]
        if (indexOf[to] === -1) work.push({ node: to, edges: null, at: 0 })
        else if (onStack[to]) low[frame.node] = Math.min(low[frame.node], indexOf[to])
        continue
      }
      work.pop()
      const parent = work.at(-1)
      if (parent) low[parent.node] = Math.min(low[parent.node], low[frame.node])
      if (low[frame.node] !== indexOf[frame.node]) continue
      const nodes = new Set()
      let member
      do {
        member = stack.pop()
        onStack[member] = false
        nodes.add(member)
      } while (member !== frame.node)
      const looped = nodes.size > 1 || frame.edges.some(({ to }) => to === frame.node)
      if (looped) found.push({ nodes })
    }
  }
  return found
}
