import { listOf } from '../openapi/model.js'
import { carriesFile, SCHEMA_DEPTH } from './schema-walk.js'
import { pointer } from './pointer.js'
import { isObject } from './value-check.js'

// What an agent sees of an operation when a tool is built from it — an
// OpenAPI→MCP bridge, a GPT Action, Semantic Kernel's OpenAPI plugin. The
// `agent` rules (docs/audit.md §4.7) all read the document through here, so they
// agree on what a tool is and on what filling one in means.

// The operations that become tools: the document's paths. A webhook or a
// callback is a request the API sends, never one an agent makes. Hidden ones
// count — hiding lives in this documentation, and a bridge reading the file
// turns them into tools all the same.
export function toolOperations(ctx) {
  return ctx.operations.filter((entry) => entry.kind === 'operation')
}

// Everything an agent fills in to call the operation, as `{ kind, schema,
// dataPath, … }`: each parameter (`kind: 'parameter'`, with `param`), then each
// request media type (`kind: 'body'`, with `mediaType`). A parameter described
// by `content` contributes that schema; a body that is a file contributes none
// — a picker's bytes have no shape to describe.
export function* toolInputs(entry) {
  for (const { param, dataPath } of entry.parameters) {
    if (param.schema !== undefined) {
      yield { kind: 'parameter', param, schema: param.schema, dataPath: `${dataPath}/schema` }
      continue
    }
    for (const [mediaType, content] of Object.entries(objectOrEmpty(param.content))) {
      const path = `${dataPath}${pointer('content', mediaType, 'schema')}`
      yield { kind: 'parameter', param, schema: content?.schema, dataPath: path }
    }
  }
  const content = objectOrEmpty(entry.op.requestBody?.content)
  for (const [mediaType, media] of Object.entries(content)) {
    if (!media || typeof media !== 'object' || carriesFile({ mediaType, content: media })) continue
    const dataPath = `${entry.pointer}${pointer('requestBody', 'content', mediaType, 'schema')}`
    yield { kind: 'body', mediaType, media, schema: media.schema, dataPath }
  }
}

// Every schema an agent fills in, below and including `root`: the properties
// it sends (a `readOnly` one is never sent), array items, composition branches
// — the edges `payloadChildren` lists. Each schema object once — a cycle the
// dereference materialized ends there — and within a depth budget (rule 7).
// `visit(schema, dataPath, depth)`.
export function walkInputSchema(root, dataPath, visit, seen = new Set()) {
  const walk = (schema, path, depth) => {
    if (!isObject(schema) || depth > SCHEMA_DEPTH || seen.has(schema)) return
    seen.add(schema)
    visit(schema, path, depth)
    for (const [child, childPath] of payloadChildren(schema, path))
      walk(child, childPath, depth + 1)
  }
  walk(root, dataPath, 0)
}

// The schemas a payload schema leads to, as `[child, dataPath, nested]`: what
// `walkInputSchema` descends into, and what the rules needing the path back to
// an ancestor (a cycle) or a longest path (nesting) — which a walk visiting
// each schema once cannot give — walk themselves. `nested`: the child is the value of
// one of the object's keys, a level down, rather than an item of the same array
// or another description of the same value. `side`: `request` follows what a
// client sends (a `readOnly` property never is), `response` what the API
// returns (a `writeOnly` one never is).
export function* payloadChildren(schema, dataPath, side = 'request') {
  const unsent = side === 'request' ? 'readOnly' : 'writeOnly'
  if (isObject(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      if (isObject(sub) && sub[unsent] !== true) {
        yield [sub, `${dataPath}${pointer('properties', name)}`, true]
      }
    }
  }
  for (const keyword of ['patternProperties', 'dependentSchemas']) {
    if (!isObject(schema[keyword])) continue
    for (const [name, sub] of Object.entries(schema[keyword])) {
      if (isObject(sub))
        yield [sub, `${dataPath}${pointer(keyword, name)}`, keyword !== 'dependentSchemas']
    }
  }
  for (const keyword of ['additionalProperties', 'unevaluatedProperties']) {
    if (isObject(schema[keyword])) yield [schema[keyword], `${dataPath}/${keyword}`, true]
  }
  for (const keyword of ['items', 'unevaluatedItems']) {
    if (isObject(schema[keyword])) yield [schema[keyword], `${dataPath}/${keyword}`, false]
  }
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
    for (const [index, sub] of listOf(schema[keyword]).entries()) {
      if (isObject(sub)) yield [sub, `${dataPath}${pointer(keyword, index)}`, false]
    }
  }
  for (const keyword of ['then', 'else']) {
    if (isObject(schema[keyword])) yield [schema[keyword], `${dataPath}/${keyword}`, false]
  }
}

function objectOrEmpty(value) {
  return isObject(value) ? value : {}
}
