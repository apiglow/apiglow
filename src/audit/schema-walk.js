// Shared traversal of the schemas of a dereferenced document. Rules that check
// a schema (required properties, examples, defaults) iterate `ctx.schemas`
// instead of re-walking the document each: one walk, one check per distinct
// schema object.

import { pointer } from './pointer.js'

// Depth budget (rule 7). Identity dedup already terminates cycles materialized
// by ref-parser; the budget bounds the other unbounded case, a document that
// nests fresh objects forever.
const MAX_DEPTH = 24

// Keywords whose value is one schema, and those whose value is a map of them.
const KEYWORD_SCHEMAS = [
  'if',
  'then',
  'else',
  'not',
  'contains',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
]
const KEYWORD_SCHEMA_MAPS = ['patternProperties', 'dependentSchemas', '$defs']

// Media types carried by an operation: request body then responses, each with
// the pointer to its own declaration site.
export function* operationContents(entry) {
  for (const [mediaType, content] of Object.entries(entry.op.requestBody?.content ?? {})) {
    if (!content || typeof content !== 'object') continue
    yield {
      kind: 'request',
      mediaType,
      content,
      dataPath: `${entry.pointer}${pointer('requestBody', 'content', mediaType)}`,
    }
  }
  for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
    for (const [mediaType, content] of Object.entries(response?.content ?? {})) {
      if (!content || typeof content !== 'object') continue
      yield {
        kind: 'response',
        status,
        mediaType,
        content,
        dataPath: `${entry.pointer}${pointer('responses', status, 'content', mediaType)}`,
      }
    }
  }
}

// → [{ schema, dataPath, op, location }] — `op` is the operation entry the
// schema was reached from (null for a component), `location` its display label
// when there is no operation to name.
export function collectSchemas(document, operations) {
  const seen = new Set()
  const entries = []

  const visit = (schema, dataPath, op, location, depth = 0) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
    if (depth > MAX_DEPTH || seen.has(schema)) return
    seen.add(schema)
    entries.push({ schema, dataPath, op, location })
    const child = (sub, ...segments) =>
      visit(sub, `${dataPath}${pointer(...segments)}`, op, location, depth + 1)

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [name, sub] of Object.entries(schema.properties)) child(sub, 'properties', name)
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      child(schema.additionalProperties, 'additionalProperties')
    }
    child(schema.items, 'items')
    for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
      if (!Array.isArray(schema[keyword])) continue
      for (const [index, sub] of schema[keyword].entries()) child(sub, keyword, index)
    }
    // 2020-12 applicators: a schema hidden in a conditional branch or a `$defs`
    // is a schema all the same, and every rule that grades one must see it.
    for (const keyword of KEYWORD_SCHEMAS) child(schema[keyword], keyword)
    for (const keyword of KEYWORD_SCHEMA_MAPS) {
      if (!schema[keyword] || typeof schema[keyword] !== 'object') continue
      for (const [name, sub] of Object.entries(schema[keyword])) child(sub, keyword, name)
    }
  }

  // Components first: a schema shared by an operation and `components.schemas`
  // is then reported at its definition site — where the author fixes it once,
  // rather than at whichever operation happened to be walked first.
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    visit(schema, pointer('components', 'schemas', name), null, `components.schemas.${name}`)
  }

  for (const entry of operations) {
    for (const { param, dataPath } of entry.parameters) {
      visit(param.schema, `${dataPath}/schema`, entry, null)
    }
    for (const { content, dataPath } of operationContents(entry)) {
      visit(content.schema, `${dataPath}/schema`, entry, null)
      // 3.2 sequential media types: `itemSchema` describes one element of the
      // stream and can exist without `schema`.
      visit(content.itemSchema, `${dataPath}/itemSchema`, entry, null)
    }
    for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
      for (const [name, header] of Object.entries(response?.headers ?? {})) {
        const path = `${entry.pointer}${pointer('responses', status, 'headers', name, 'schema')}`
        visit(header?.schema, path, entry, null)
      }
    }
  }

  return entries
}
