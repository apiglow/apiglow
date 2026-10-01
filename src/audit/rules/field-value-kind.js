import { placeOf } from '../locate.js'
import { allowedValues, inVersion, OBJECTS, objectLabel, PATTERNED } from '../openapi-objects.js'
import { pointer } from '../pointer.js'
import { describeValue } from '../value-check.js'

// A field holding the wrong kind of value — a list where a string belongs, a
// string where an object does — or a value outside the set the specification
// allows: `in: body` (Swagger 2.0's, gone in 3.0), `style: comma`, a security
// scheme of `type: bearer`, a schema of `type: int`. Validators reject it; this
// documentation and most generators read such a field as absent, so the
// parameter has no location, the scheme no type, the schema no type.
//
// `null` is `field-without-value`'s, and a value only a later version allows
// is `version-construct`'s. One check per wrong value, none otherwise.

const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object']

// Every version this table knows: what some version allows.
const LATEST = 99

export const fieldValueKind = {
  id: 'field-value-kind',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    const report = (type, at, value, expected) =>
      check(false, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: {
          field: at.slice(at.lastIndexOf('/') + 1),
          object: objectLabel(type),
          value: describeValue(value),
          expected,
        },
      })
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema') {
        checkSchemaType(node, dataPath, minor, report)
        continue
      }
      if (type === 'Reference' || PATTERNED.has(type)) {
        if (type === 'SecurityRequirement') checkRequirement(node, dataPath, report)
        continue
      }
      for (const [key, field] of Object.entries(OBJECTS[type])) {
        const value = node[key]
        if (value === undefined || value === null || !inVersion(field, minor)) continue
        const at = `${dataPath}${pointer(key)}`
        const expected = expectedKind(field.kind)
        if (!fits(value, field.kind)) {
          report(type, at, value, expected)
          continue
        }
        const allowed = allowedValues(field, minor)
        // A value a later version allows is version-construct's.
        if (allowed && !allowed.includes(value) && !allowedValues(field, LATEST).includes(value)) {
          report(type, at, value, allowed.join(' | '))
        }
      }
    }
  },
}

function fits(value, kind) {
  if (kind === 'any') return true
  if (kind === 'string') return typeof value === 'string'
  if (kind === 'boolean') return typeof value === 'boolean'
  if (typeof kind === 'string') return isObject(value)
  if (kind.array) {
    if (!Array.isArray(value)) return false
    return kind.array !== 'string' || value.every((member) => typeof member === 'string')
  }
  if (!isObject(value)) return false
  return kind.map !== 'string' || Object.values(value).every((member) => typeof member === 'string')
}

function expectedKind(kind) {
  if (typeof kind === 'string') return ['string', 'boolean', 'any'].includes(kind) ? kind : 'object'
  if (kind.array) return kind.array === 'string' ? 'array of strings' : 'array'
  return kind.map === 'string' ? 'map of strings' : 'object'
}

// 3.0 types are one string; 3.1 adds `null` and lists of types — a list in a
// 3.0 document is version-construct's.
function checkSchemaType(schema, dataPath, minor, report) {
  const { type } = schema
  if (type === undefined || type === null) return
  const allowed = minor >= 1 ? [...SCHEMA_TYPES, 'null'] : SCHEMA_TYPES
  const values = Array.isArray(type) ? (minor >= 1 ? type : []) : [type]
  if (!Array.isArray(type) && typeof type !== 'string') {
    report('Schema', `${dataPath}/type`, type, minor >= 1 ? 'string | array' : 'string')
    return
  }
  for (const value of values) {
    if (typeof value !== 'string' || !allowed.includes(value)) {
      report('Schema', `${dataPath}/type`, value, allowed.join(' | '))
    }
  }
}

// Scheme name → the scopes (or roles) required: always a list of strings.
function checkRequirement(requirement, dataPath, report) {
  for (const [name, scopes] of Object.entries(requirement)) {
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string')) {
      report('SecurityRequirement', `${dataPath}${pointer(name)}`, scopes, 'array of strings')
    }
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
