import { bodyKind } from '../openapi/body-kind.js'
import { listOf } from '../openapi/model.js'
import { placeInput, saysNothing } from './input-shape.js'
import { pointer } from './pointer.js'
import { SCHEMA_DEPTH } from './schema-walk.js'
import { payloadChildren, toolInputs } from './tool-inputs.js'
import { isObject } from './value-check.js'

// Which values of a payload say nothing about themselves — `{}`, `true`, a
// schema of annotations only — shared by `untyped-input` (what an agent fills
// in) and `type-missing` (what the API sends), so the two rules judge the same
// positions the same way and only differ in the payloads they read.
//
// Judged: a schema that holds a value somewhere — the root of a parameter and
// of a JSON body, a property, an array item, a tuple item. Not judged on its
// own: a schema met only as a composition member (it describes the value
// together with its siblings, `then` / `else` / `dependentSchemas` alike) or as
// an `additionalProperties` or `patternProperties` value (an open map's extra
// keys are `free-form-input`'s). The root of a form or text body is walked, not
// judged: a form with no fields is `multipart-schema-object`'s, and a text
// media type already says text.
//
// A schema is judged when any payload holds a value at it, whatever the order
// the payloads come in: a component met first as an `allOf` member and used as
// a property elsewhere is judged all the same. Hence two passes — the walk
// collects the positions, the verdicts come after.
const VALUE_KEYWORDS = new Set(['properties', 'items', 'prefixItems'])

// `payloads`: `{ entry, side, schema, dataPath, judgeRoot, blankAt }` —
// `entry` the operation the payload belongs to (null for one written in a
// shared component, placed there), `side` `request` for what a client sends (a
// `readOnly` property never is) or `response` for what the API returns (a
// `writeOnly` one never is), `blankAt` where a missing schema is reported
// (null: not this caller's to report). `skip`: schemas another rule judges —
// left out, their children still walked.
export function judgeUntyped(ctx, payloads, check, skip = new Set()) {
  const seen = { request: new Set(), response: new Set() }
  const held = new Set()
  const met = new Map()
  for (const { entry, side, schema: root, dataPath, judgeRoot, blankAt } of payloads) {
    const report = reporter(ctx, entry, check)
    if (root === undefined) {
      if (blankAt) report(null, blankAt, [[[], true]])
      continue
    }
    if (root === true && judgeRoot) report(null, dataPath, [[[], true]])
    if (isObject(root) && judgeRoot) held.add(root)
    const walk = (schema, path, depth) => {
      if (!isObject(schema) || depth > SCHEMA_DEPTH || seen[side].has(schema)) return
      seen[side].add(schema)
      if (!met.has(schema)) met.set(schema, { entry, dataPath: path })
      for (const [child, childPath] of payloadChildren(schema, path, side)) {
        if (VALUE_KEYWORDS.has(childPath.slice(path.length + 1).split('/')[0])) held.add(child)
        walk(child, childPath, depth + 1)
      }
    }
    walk(root, dataPath, 0)
  }
  for (const [schema, { entry, dataPath }] of met) {
    if (skip.has(schema)) continue
    const verdicts = []
    if (held.has(schema)) verdicts.push([[], saysNothing(schema)])
    for (const segments of booleanTrueChildren(schema)) verdicts.push([segments, true])
    if (verdicts.length) reporter(ctx, entry, check)(schema, dataPath, verdicts)
  }
}

// `schema` is null for a root that is no schema object (absent, or `true`),
// which no component can hold. Verdicts are `[segments, untyped]`, relative to
// `dataPath`.
function reporter(ctx, entry, check) {
  return (schema, dataPath, verdicts) => {
    const place = placeInput(ctx, entry, schema, dataPath)
    for (const [segments, untyped] of verdicts) {
      check(!untyped, { ...place, dataPath: `${place.dataPath}${pointer(...segments)}` })
    }
  }
}

// An operation's inputs as payloads, the way `untyped-input` judges them: a
// parameter's root always, a body's root when it is JSON, and a JSON body with
// no schema at its media type.
export function* inputPayloads(entry) {
  for (const input of toolInputs(entry)) {
    const json = input.kind === 'body' && bodyKind({ mediaType: input.mediaType }) === 'json'
    yield {
      entry,
      side: 'request',
      schema: input.schema,
      dataPath: input.dataPath,
      judgeRoot: input.kind === 'parameter' || json,
      blankAt: json ? input.dataPath.slice(0, -'/schema'.length) : null,
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
