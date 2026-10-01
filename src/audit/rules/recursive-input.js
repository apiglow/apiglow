import { unescapePointerToken } from '../../scenarios/pointer.js'
import { inputChildren } from '../tool-inputs.js'
import { isSchemaObject, toolInputs, toolOperations } from '../tool-inputs.js'

// A request input that contains itself: a tree node with child nodes, a filter
// combining filters. The data model is legitimate, and nothing in the document
// is wrong — but an agent's tool schema has to be finite, and its consumers
// disagree on what to do with a cycle:
// - `@ivotoby/openapi-mcp-server`, one of the two bridges this documentation's
//   MCP export wires up, cuts a circular `$ref` into an empty schema `{}`: below
//   the cut, the model fills in a value nothing describes;
// - Anthropic's strict mode does not support recursive schemas, and Gemini's
//   function declarations take no `$ref` at all — no way to say "the same
//   again";
// - OpenAI's strict mode does support it, through `$defs`.
// Info only: the finding tells the author what agents receive; it does not ask
// for a different data model.
//
// One check per tool operation with inputs, failing on the first cycle its
// walk meets: the dereferenced document turns a recursive `$ref` into a cycle of
// objects, and a cycle is a schema met again among its own ancestors on the
// path (a schema merely shared by two properties is no cycle). The finding sits
// where the input reaches back, named after the schema it re-enters — its
// `components.schemas` key, else the last segment of where it was met.
//
// The walk follows what an agent sends (tool-inputs.js): `readOnly` properties
// are not, so a cycle through one alone does not count. Bounded (rule 7); a
// schema whose whole reach is known to be acyclic is never walked twice.
const MAX_DEPTH = 24

export const recursiveInput = {
  id: 'recursive-input',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const names = componentNames(ctx.document)
    const acyclic = new Set()
    for (const entry of toolOperations(ctx)) {
      const inputs = [...toolInputs(entry)]
      if (!inputs.length) continue
      let cycle = null
      for (const { schema, dataPath } of inputs) {
        cycle = findCycle(schema, dataPath, acyclic)
        if (cycle) break
      }
      if (!cycle) {
        check(true, { op: entry })
        continue
      }
      const name = names.get(cycle.target) ?? lastSegment(cycle.targetPath)
      check(false, { op: entry, dataPath: cycle.dataPath, params: { name } })
    }
  },
}

// → { target, targetPath, dataPath } for the first back edge, or null.
// `acyclic` collects the schemas whose reach was walked in full without one: a
// cycle reachable from them would have shown on that walk.
function findCycle(root, rootPath, acyclic) {
  const ancestors = new Map()
  const visited = new Set()
  let found = null
  const explore = (schema, dataPath, depth) => {
    if (acyclic.has(schema)) return true
    if (depth > MAX_DEPTH || visited.has(schema)) return false
    ancestors.set(schema, dataPath)
    let complete = true
    for (const [child, childPath] of inputChildren(schema, dataPath)) {
      if (ancestors.has(child)) {
        found = { target: child, targetPath: ancestors.get(child), dataPath: childPath }
        break
      }
      if (!explore(child, childPath, depth + 1)) complete = false
      if (found) break
    }
    ancestors.delete(schema)
    visited.add(schema)
    if (complete && !found) acyclic.add(schema)
    return complete && !found
  }
  if (isSchemaObject(root)) explore(root, rootPath, 0)
  return found
}

function componentNames(document) {
  const schemas = document.components?.schemas
  const names = new Map()
  if (!isSchemaObject(schemas)) return names
  for (const [name, schema] of Object.entries(schemas)) {
    if (isSchemaObject(schema) && !names.has(schema)) names.set(schema, name)
  }
  return names
}

function lastSegment(dataPath) {
  return unescapePointerToken(dataPath.slice(dataPath.lastIndexOf('/') + 1))
}
