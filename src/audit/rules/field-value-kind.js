import { placeOf } from '../locate.js'
import { allowedValues, inVersion, OBJECTS, objectLabel, PATTERNED } from '../openapi-objects.js'
import { pointer } from '../pointer.js'
import { describeValue, isObject } from '../value-check.js'

// A field holding the wrong kind of value — a list where a string belongs, a
// string where an object does — or a value outside the set the specification
// allows: `in: body` (Swagger 2.0's, gone in 3.0), `style: comma`, a security
// scheme of `type: bearer`, a schema of `type: int`. Validators reject it; this
// documentation and most generators read such a field as absent, so the
// parameter has no location, the scheme no type, the schema no type.
//
// A list or a map is held to its members too: `security: [api_key]` is a list
// of names where Security Requirement objects belong, and leaves the API
// unsecured without a word; `responses: { 200: OK }` declares no response. So
// is a schema's `items` written as a list — draft-04's tuples, which neither
// 3.0 nor JSON Schema 2020-12 (`prefixItems`) reads.
//
// `null` is `field-without-value`'s — a field's, or a map member's; a list
// member is no field, and a `null` there is this rule's. A value only a later
// version allows is `version-construct`'s. One check per wrong value, none
// otherwise.

const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object']

export const fieldValueKind = {
  id: 'field-value-kind',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    const report = (type, at, field, value, expected) =>
      check(false, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: {
          field,
          object: objectLabel(type),
          value: describeValue(value),
          expected,
        },
      })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema') {
        checkSchema(node, dataPath, minor, report)
        continue
      }
      if (type === 'Reference') continue
      if (PATTERNED.has(type)) {
        checkPatterned(type, node, dataPath, report)
        continue
      }
      for (const [key, field] of Object.entries(OBJECTS[type])) {
        const value = node[key]
        if (value === undefined || value === null || !inVersion(field, minor)) continue
        const at = `${dataPath}${pointer(key)}`
        if (!fits(value, field.kind, minor)) {
          report(type, at, key, value, expectedKind(field.kind))
          continue
        }
        if (typeof field.kind === 'object') {
          const member = field.kind.array ?? field.kind.map
          for (const [name, wrong] of misfits(value, field.kind, minor)) {
            const spelled = field.kind.array ? `${key}[${name}]` : `${key}.${name}`
            report(type, `${at}${pointer(name)}`, spelled, wrong, expectedKind(member))
          }
        }
        const allowed = allowedValues(field, minor)
        // A value a later version allows is version-construct's.
        if (allowed && !allowed.includes(value) && !inSomeVersion(field, value)) {
          report(type, at, key, value, allowed.join(' | '))
        }
      }
    }
  },
}

// The container alone: its members are `misfits`'.
function fits(value, kind, minor) {
  if (kind === 'any') return true
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'boolean') return typeof value === 'boolean'
  if (typeof kind === 'string') return isObject(value) || isBooleanSchema(value, kind, minor)
  return kind.array ? Array.isArray(value) : isObject(value)
}

// → [key, member] for each member of a list or map that is not of its kind.
function* misfits(container, kind, minor) {
  const member = kind.array ?? kind.map
  if (member === 'any') return
  const members = kind.array ? container.entries() : Object.entries(container)
  for (const [key, value] of members) {
    if (!kind.array && (key.startsWith('x-') || value === null)) continue
    if (!fits(value, member, minor)) yield [key, value]
  }
}

// From 3.1 a Schema is a JSON Schema, and `true` / `false` are schemas.
function isBooleanSchema(value, kind, minor) {
  return kind === 'Schema' && minor >= 1 && typeof value === 'boolean'
}

function inSomeVersion(field, value) {
  return field.values.some((entry) => (typeof entry === 'string' ? entry : entry.value) === value)
}

function expectedKind(kind) {
  if (typeof kind === 'string') return kind === 'string' || kind === 'boolean' ? kind : 'object'
  if (kind.array) return kind.array === 'string' ? 'array of strings' : 'array'
  return kind.map === 'string' ? 'map of strings' : 'object'
}

function checkSchema(schema, dataPath, minor, report) {
  if (Array.isArray(schema.items)) {
    report('Schema', `${dataPath}/items`, 'items', schema.items, 'object')
  }
  // 3.0 types are one string; 3.1 adds `null` and lists of types — a list in
  // a 3.0 document is version-construct's.
  const { type } = schema
  if (type === undefined || type === null) return
  const allowed = minor >= 1 ? [...SCHEMA_TYPES, 'null'] : SCHEMA_TYPES
  const values = Array.isArray(type) ? (minor >= 1 ? type : []) : [type]
  if (!Array.isArray(type) && typeof type !== 'string') {
    report('Schema', `${dataPath}/type`, 'type', type, minor >= 1 ? 'string | array' : 'string')
    return
  }
  for (const value of values) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      report('Schema', `${dataPath}/type`, 'type', value, allowed.join(' | '))
    }
  }
}

// The members of the patterned maps: a Path Item under each path or callback
// expression, a Response under each status code, the scopes (or roles) under
// each scheme name — always a list of strings.
function checkPatterned(type, node, dataPath, report) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('x-') || value === null) continue
    const at = `${dataPath}${pointer(key)}`
    if (type === 'SecurityRequirement') {
      if (!Array.isArray(value) || !value.every((scope) => typeof scope === 'string')) {
        report(type, at, key, value, 'array of strings')
      }
    } else if (!isObject(value)) report(type, at, key, value, 'object')
  }
}
