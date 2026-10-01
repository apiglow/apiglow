import { listOf } from '../openapi/model.js'
import { pointer } from './pointer.js'
import { isSchemaObject } from './tool-inputs.js'

// The top-level members a client sends in a body described by `schema`: its own
// `properties` and those of its `allOf` members — an `allOf` of objects is one
// object, which is how a bridge flattening the body into tool arguments reads it
// too. A `readOnly` member is never sent. → [{ name, schema, dataPath }], one
// per name, the first declaration winning.
export function sentProperties(schema, dataPath) {
  const found = new Map()
  const visit = (node, path, depth, stack) => {
    if (!isSchemaObject(node) || depth > MAX_DEPTH || stack.has(node)) return
    stack.add(node)
    if (isSchemaObject(node.properties)) {
      for (const [name, sub] of Object.entries(node.properties)) {
        if (found.has(name) || sub?.readOnly === true) continue
        found.set(name, { name, schema: sub, dataPath: `${path}${pointer('properties', name)}` })
      }
    }
    for (const [index, member] of listOf(node.allOf).entries()) {
      visit(member, `${path}${pointer('allOf', index)}`, depth + 1, stack)
    }
    stack.delete(node)
  }
  visit(schema, dataPath, 0, new Set())
  return [...found.values()]
}

// `allOf` chains are short in practice; the bound only stops a document that
// nests fresh members forever (rule 7).
const MAX_DEPTH = 24
