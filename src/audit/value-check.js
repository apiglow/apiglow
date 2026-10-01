// Value ⇄ schema building blocks: the declared type at the surface (for
// `enum-valid`, which only asks whether an entry has the schema's type), a
// one-line rendering of a value, and the pieces `value-validate.js` — the
// three-valued validator the example and default rules use — builds on.
//
// `checkValueType` returns `null` for "nothing to check here": the caller must
// then not count a check at all, otherwise a schema declaring nothing would
// inflate the score with free passes.

export function checkValueType(value, schema) {
  const types = declaredTypes(schema)
  if (!types.length) return null
  return types.some((type) => valueIsType(value, type))
}

// Short, safe rendering of a value for a finding's i18n parameters: an example
// can be a whole object, and a message is one line.
export function describeValue(value) {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

// The audit reads the RAW document: both nullability spellings coexist here
// (3.0 `nullable` sibling flag, 3.1 `null` inside a type array), unlike in the
// model where normalization has already unified them.
function declaredTypes(schema) {
  const declared = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === 'string'
      ? [schema.type]
      : []
  const types = declared.filter((type) => typeof type === 'string')
  if (schema.nullable === true && !types.includes('null')) types.push('null')
  return types
}

function valueIsType(value, type) {
  switch (type) {
    case 'null':
      return value === null
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'array':
      return Array.isArray(value)
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    default:
      // Unknown type keyword: no verdict rather than a false positive.
      return true
  }
}

// 3.0 spells the exclusive bounds as booleans qualifying minimum/maximum, 3.1
// as numbers. Unified to the numeric form, like normalization does.
export function numericBounds(schema) {
  let { minimum, maximum } = schema
  let { exclusiveMinimum, exclusiveMaximum } = schema
  if (typeof exclusiveMinimum === 'boolean') {
    exclusiveMinimum = exclusiveMinimum ? minimum : undefined
    if (exclusiveMinimum !== undefined) minimum = undefined
  }
  if (typeof exclusiveMaximum === 'boolean') {
    exclusiveMaximum = exclusiveMaximum ? maximum : undefined
    if (exclusiveMaximum !== undefined) maximum = undefined
  }
  const numeric = (bound) => (typeof bound === 'number' ? bound : undefined)
  return {
    minimum: numeric(minimum),
    maximum: numeric(maximum),
    exclusiveMinimum: numeric(exclusiveMinimum),
    exclusiveMaximum: numeric(exclusiveMaximum),
  }
}

export function deepEqual(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every((key) => key in b && deepEqual(a[key], b[key]))
}
