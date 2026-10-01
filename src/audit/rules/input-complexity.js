import { listOf } from '../../openapi/model.js'
import { isObjectSchema } from '../input-shape.js'
import { inputChildren } from '../tool-inputs.js'
import { isSchemaObject, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'

// A request body too big for the limits agents' tool schemas live under:
// - Semantic Kernel's OpenAPI plugin skips an operation whose body nests deeper
//   than 10 levels (`PayloadPropertiesHierarchyMaxDepth`) — the tool is simply
//   not there;
// - OpenAI's strict mode refuses a schema with more than 10 levels of nesting,
//   more than 5000 object properties in all, or more than 1000 enum values
//   across its enums.
// The bridges copy the body schema into the tool whole, so the document's size
// is the tool's.
//
// One check per tool operation with a request body (a file body has none to
// measure); each figure is the worst of its media types. Depth counts levels of
// objects: the body object is level 1, and each property holding an object —
// directly or as array items — one more; a composition member describes the
// same level. Properties (those an agent sends, `readOnly` left out) and enum
// values are counted over the body's schema objects, each once however often
// it is reached. A cycle stops the depth where it closes: recursion is
// `recursive-input`'s.
const LIMITS = { depth: 10, properties: 5000, enumValues: 1000 }
const MAX_HOPS = 24

export const inputComplexity = {
  id: 'input-complexity',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    // A schema's depth does not depend on where it is reached from, a cycle
    // aside: one computation per schema for the whole run.
    const depths = new Map()
    for (const entry of toolOperations(ctx)) {
      const bodies = [...toolInputs(entry)].filter((input) => input.kind === 'body')
      if (!bodies.length) continue
      const figures = { depth: 0, properties: 0, enumValues: 0 }
      for (const { schema, dataPath } of bodies) {
        figures.depth = Math.max(figures.depth, depthOf(schema, depths, new Set(), 0))
        const { properties, enumValues } = counts(schema, dataPath)
        figures.properties = Math.max(figures.properties, properties)
        figures.enumValues = Math.max(figures.enumValues, enumValues)
      }
      const within = Object.entries(LIMITS).every(([name, limit]) => figures[name] <= limit)
      check(within, { op: entry, dataPath: `${entry.pointer}/requestBody`, params: figures })
    }
  },
}

function depthOf(schema, memo, ancestors, hops) {
  if (!isSchemaObject(schema) || ancestors.has(schema) || hops > MAX_HOPS) return 0
  if (memo.has(schema)) return memo.get(schema)
  ancestors.add(schema)
  let below = 0
  let same = 0
  for (const [child, , nested] of inputChildren(schema, '')) {
    const depth = depthOf(child, memo, ancestors, hops + 1)
    if (nested) below = Math.max(below, depth)
    else same = Math.max(same, depth)
  }
  ancestors.delete(schema)
  const depth = Math.max((isObjectSchema(schema) ? 1 : 0) + below, same)
  memo.set(schema, depth)
  return depth
}

function counts(schema, dataPath) {
  let properties = 0
  let enumValues = 0
  walkInputSchema(schema, dataPath, (node) => {
    if (isSchemaObject(node.properties)) {
      properties += Object.values(node.properties).filter((sub) => sub?.readOnly !== true).length
    }
    enumValues += listOf(node.enum).length
  })
  return { properties, enumValues }
}
