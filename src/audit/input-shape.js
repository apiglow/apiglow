import { inferType, listOf } from '../openapi/model.js'
import { placeOf } from './locate.js'
import { isObject } from './value-check.js'

// What an input schema tells about its value, for the `agent-inputs` rules.
// A type left out is inferred the way this documentation's model infers it
// (src/openapi/model.js `inferType`), so a rule says what the schema view and
// the try-it do with the schema.

const OBJECT_KEYWORDS = [
  'properties',
  'additionalProperties',
  'required',
  'minProperties',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
]
const ARRAY_KEYWORDS = ['items', 'prefixItems', 'contains']

// Keywords that say something about the value: a type, its values, its
// structure, or a constraint built from other schemas. `$ref` is one only when
// it survived dereferencing, i.e. it leads nowhere — `ref-resolves`' finding,
// not a schema that says nothing.
const SAYING_KEYWORDS = [
  'type',
  'enum',
  'const',
  ...OBJECT_KEYWORDS,
  ...ARRAY_KEYWORDS,
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'if',
  '$ref',
]

// `true`, `{}`, or a schema of annotations only (`description`, `example`,
// `format`…): a value of any kind validates. `format: binary` is the exception
// — this documentation reads it as a file (src/openapi/body-kind.js) and the
// try-it offers a file picker, which is a statement about the value.
export function saysNothing(schema) {
  if (schema === true) return true
  if (!isObject(schema)) return false
  if (schema.format === 'binary') return false
  return !SAYING_KEYWORDS.some((keyword) => schema[keyword] !== undefined)
}

// The JSON types a schema admits, `null` left out — declared, else inferred;
// empty when nothing tells. `integer` is reported as written: callers that
// compare JSON kinds fold it into `number` themselves. Declared types are all
// of them, where the model keeps the first: a rule asks whether one of them is
// an object, and `[string, object]` is.
export function valueTypes(schema) {
  if (!isObject(schema)) return []
  const declared = (Array.isArray(schema.type) ? schema.type : [schema.type]).filter(
    (type) => typeof type === 'string' && type !== 'null',
  )
  if (declared.length || schema.type !== undefined) return declared
  const inferred = inferType(schema)
  return inferred ? [inferred] : []
}

export function isObjectSchema(schema) {
  return valueTypes(schema).includes('object')
}

// The schemas the walk reaches from `schema` that describe the same value
// rather than a part of it: its composition members, and the conditional ones
// (`then`, `else`, `dependentSchemas`).
export function compositionMembers(schema) {
  return [
    ...['allOf', 'oneOf', 'anyOf'].flatMap((keyword) => listOf(schema[keyword])),
    schema.then,
    schema.else,
    ...(isObject(schema.dependentSchemas) ? Object.values(schema.dependentSchemas) : []),
  ].filter(isObject)
}

// Where a finding on an input schema goes: the component it is written in when
// it is one (or lies inside one) — reported once, where the author fixes it,
// like the schema rules of §4.1 — else the operation's own position.
// `ctx.schemas` is that index: it walks the components first. `entry` null: a
// payload written in a component that is no schema (a shared response), placed
// at `dataPath`, which names it.
export function placeInput(ctx, entry, schema, dataPath) {
  const site = schemaSites(ctx).get(schema)
  if (site && !site.op) return { op: null, location: site.location, dataPath: site.dataPath }
  return entry ? { op: entry, dataPath } : { ...placeOf(ctx.operations, dataPath), dataPath }
}

const SITES = new WeakMap()

function schemaSites(ctx) {
  let sites = SITES.get(ctx)
  if (!sites) {
    sites = new Map(ctx.schemas.map((site) => [site.schema, site]))
    SITES.set(ctx, sites)
  }
  return sites
}
