import { unescapePointerToken } from '../../scenarios/pointer.js'
import { componentNames } from '../locate.js'
import { payloadChildren, toolInputs, toolOperations } from '../tool-inputs.js'
import { hasText } from '../text.js'
import { isObject } from '../value-check.js'
import { SCHEMA_DEPTH } from '../schema-walk.js'

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
// `components.schemas` key, else its `title`, else the property it was met
// as, else the input itself (the parameter's name, the body's media type).
//
// The walk follows what an agent sends (tool-inputs.js): `readOnly` properties
// are not, so a cycle through one alone does not count. Bounded (rule 7); a
// schema whose whole reach is known to be acyclic is never walked twice.

export const recursiveInput = {
  id: 'recursive-input',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const names = componentNames(ctx.document, 'schemas')
    const acyclic = new Set()
    for (const entry of toolOperations(ctx)) {
      const inputs = [...toolInputs(entry)]
      if (!inputs.length) continue
      let cycle = null
      let input = null
      for (input of inputs) {
        cycle = findCycle(input.schema, input.dataPath, acyclic)
        if (cycle) break
      }
      if (!cycle) {
        check(true, { op: entry })
        continue
      }
      const name = names.get(cycle.target) ?? inlineName(cycle, input)
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
    if (depth > SCHEMA_DEPTH || visited.has(schema)) return false
    ancestors.set(schema, dataPath)
    let complete = true
    for (const [child, childPath] of payloadChildren(schema, dataPath)) {
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
  if (isObject(root)) explore(root, rootPath, 0)
  return found
}

// A schema with no component name: its title, else the last property on the
// way to it from the input's root, else the input.
function inlineName(cycle, input) {
  if (hasText(cycle.target.title)) return cycle.target.title.trim()
  const tokens = cycle.targetPath
    .slice(input.dataPath.length)
    .split('/')
    .slice(1)
    .map(unescapePointerToken)
  let property = null
  for (let at = 0; at < tokens.length - 1; at += 1) {
    if (tokens[at] === 'properties' || tokens[at] === 'patternProperties') {
      at += 1
      property = tokens[at]
    }
  }
  return property ?? (input.kind === 'parameter' ? input.param.name : input.mediaType)
}
