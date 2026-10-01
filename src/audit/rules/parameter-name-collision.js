import { bodyKind } from '../../openapi/body-kind.js'
import { sentProperties } from '../body-properties.js'
import { toolInputs, toolOperations } from '../tool-inputs.js'

// Two inputs of one operation answering to the same name: a path `id` and a
// query `id`, or a parameter and a top-level property of the body. HTTP keeps
// them apart by location; a tool has one flat list of argument names, and the
// tools built from the operation lose one of them. Semantic Kernel's OpenAPI
// plugin compares the names case-insensitively, throws on the clash and leaves
// the operation out of the plugin — logged, no error to the caller. Both MCP
// bridges (`@ivotoby/openapi-mcp-server`, `@tyk-technologies/api-to-mcp`) key
// parameters by name, so the last one silently overwrites the other; ivotoby
// renames a clashing body property `body_<name>`, a name the document never
// gives the agent.
//
// Names compare without case, as Semantic Kernel compares them: `id` and `ID`
// in the query clash there too. The same name at the same location is
// `parameters-unique`'s, and two headers differing by case are one header — an
// override or that rule's. Body properties count for the bodies a bridge
// flattens into arguments, JSON and form ones, read-only ones excepted; two
// properties of one body never clash with each other here.
//
// One check per tool operation with two inputs or more; a failing one per
// colliding name, on the later input of the first colliding pair.
export const parameterNameCollision = {
  id: 'parameter-name-collision',
  category: 'agent',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      const inputs = operationInputs(entry)
      if (inputs.length < 2) continue
      const groups = new Map()
      for (const input of inputs) {
        const key = input.name.toLowerCase()
        groups.set(key, [...(groups.get(key) ?? []), input])
      }
      let clashes = 0
      for (const group of groups.values()) {
        const pair = firstClash(group)
        if (!pair) continue
        clashes += 1
        const [first, second] = pair
        check(false, {
          op: entry,
          dataPath: second.dataPath,
          params: { name: second.name, first: first.location, second: second.location },
        })
      }
      if (!clashes) check(true, { op: entry })
    }
  },
}

const FLATTENED = new Set(['json', 'multipart', 'urlencoded'])

// Parameters in declaration order (Path Item's, then the operation's), then the
// body's properties, each name once across the body's media types.
function operationInputs(entry) {
  const inputs = []
  for (const { param, dataPath } of entry.parameters) {
    if (typeof param.name !== 'string' || typeof param.in !== 'string') continue
    inputs.push({ name: param.name, location: param.in, dataPath })
  }
  const bodyNames = new Set()
  for (const input of toolInputs(entry)) {
    if (input.kind !== 'body') continue
    if (!FLATTENED.has(bodyKind({ mediaType: input.mediaType, schema: input.schema }))) continue
    for (const { name, dataPath } of sentProperties(input.schema, input.dataPath)) {
      if (bodyNames.has(name)) continue
      bodyNames.add(name)
      inputs.push({ name, location: 'body', dataPath })
    }
  }
  return inputs
}

function firstClash(group) {
  for (let j = 1; j < group.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      if (clash(group[i], group[j])) return [group[i], group[j]]
    }
  }
  return null
}

function clash(a, b) {
  if (a.location === 'body' && b.location === 'body') return false
  if (a.location !== b.location) return true
  return a.location !== 'header' && a.name !== b.name
}
