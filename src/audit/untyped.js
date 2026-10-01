import { bodyKind } from '../openapi/body-kind.js'
import { listOf } from '../openapi/model.js'
import { compositionMembers, saysNothing } from './input-shape.js'
import { pointer } from './pointer.js'
import { inputChildren, isSchemaObject, toolInputs, toolOperations } from './tool-inputs.js'

// Which values of a payload say nothing about themselves — `{}`, `true`, a
// schema of annotations only — shared by `untyped-input` (what an agent fills
// in) and `type-missing` (what the API sends), so the two rules judge the same
// positions the same way and only differ in the payloads they read.
//
// Judged: the root of a parameter and of a JSON body, and every property,
// array item and tuple item below. Not judged on its own: a composition member
// (it describes the value together with its siblings) and an
// `additionalProperties` value (an open map's extra keys are
// `free-form-input`'s). The root of a form or text body is walked, not judged:
// a form with no fields is `multipart-schema-object`'s, and a text media type
// already says text.

// The state one rule carries across its payloads. `skip`: schemas another rule
// judges — their verdicts are left out, their children still walked.
export function untypedState(skip = new Set()) {
  return {
    seen: { request: new Set(), response: new Set() },
    judged: new Set(),
    passive: new Set(),
    skip,
  }
}

// One payload: `{ schema, dataPath, judgeRoot, blankAt }` — `blankAt`, where a
// missing schema is reported (null: not this caller's to report). `side`:
// `request` walks what a client sends (a `readOnly` property never is),
// `response` what the API returns (a `writeOnly` one never is).
// `report(schema, dataPath, verdicts)`, verdicts `[segments, untyped]` relative
// to `dataPath`; `schema` is null for a root that is no schema object (absent,
// or `true`), which no component can hold.
export function judgeValues(payload, side, state, report) {
  const { schema: root, dataPath, judgeRoot, blankAt } = payload
  if (root === undefined) {
    if (blankAt) report(null, blankAt, [[[], true]])
    return
  }
  if (root === true && judgeRoot) report(null, dataPath, [[[], true]])
  const seen = state.seen[side]
  const walk = (schema, path, depth) => {
    if (!isSchemaObject(schema) || depth > MAX_DEPTH || seen.has(schema)) return
    seen.add(schema)
    for (const member of compositionMembers(schema)) state.passive.add(member)
    if (isSchemaObject(schema.additionalProperties)) state.passive.add(schema.additionalProperties)
    if (!state.skip.has(schema) && !state.judged.has(schema)) {
      state.judged.add(schema)
      const verdicts = []
      if (!state.passive.has(schema) && (depth > 0 || judgeRoot)) {
        verdicts.push([[], saysNothing(schema)])
      }
      for (const segments of booleanTrueChildren(schema)) verdicts.push([segments, true])
      if (verdicts.length) report(schema, path, verdicts)
    }
    const children = side === 'request' ? inputChildren(schema, path) : outputChildren(schema, path)
    for (const [child, childPath] of children) walk(child, childPath, depth + 1)
  }
  walk(root, dataPath, 0)
}

// An operation's inputs as payloads, the way `untyped-input` judges them: a
// parameter's root always, a body's root when it is JSON, and a JSON body with
// no schema at its media type.
export function* inputPayloads(entry) {
  for (const input of toolInputs(entry)) {
    const json = input.kind === 'body' && bodyKind({ mediaType: input.mediaType }) === 'json'
    yield {
      schema: input.schema,
      dataPath: input.dataPath,
      judgeRoot: input.kind === 'parameter' || json,
      blankAt: json ? input.dataPath.slice(0, -'/schema'.length) : null,
    }
  }
}

// Every schema object `untyped-input` walks: the inputs of the tool operations.
export function toolInputSchemas(ctx) {
  const state = untypedState()
  for (const entry of toolOperations(ctx)) {
    for (const payload of inputPayloads(entry)) judgeValues(payload, 'request', state, () => {})
  }
  return state.seen.request
}

// Same budget as the input walk (tool-inputs.js) and the shared schema walk.
const MAX_DEPTH = 24

// The response-side twin of `inputChildren`: a `readOnly` property is sent, a
// `writeOnly` one never is.
function* outputChildren(schema, dataPath) {
  if (isSchemaObject(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) {
      if (isSchemaObject(sub) && sub.writeOnly !== true) {
        yield [sub, `${dataPath}${pointer('properties', name)}`]
      }
    }
  }
  if (isSchemaObject(schema.additionalProperties)) {
    yield [schema.additionalProperties, `${dataPath}/additionalProperties`]
  }
  if (isSchemaObject(schema.items)) yield [schema.items, `${dataPath}/items`]
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
    for (const [index, sub] of listOf(schema[keyword]).entries()) {
      if (isSchemaObject(sub)) yield [sub, `${dataPath}${pointer(keyword, index)}`]
    }
  }
}

// `true` where a value goes: the walk only visits schema objects, and a boolean
// has no identity to deduplicate on — its position is reported with its parent.
function* booleanTrueChildren(schema) {
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [name, sub] of Object.entries(schema.properties)) {
      if (sub === true) yield ['properties', name]
    }
  }
  if (schema.items === true) yield ['items']
  for (const [index, sub] of listOf(schema.prefixItems).entries()) {
    if (sub === true) yield ['prefixItems', index]
  }
}
