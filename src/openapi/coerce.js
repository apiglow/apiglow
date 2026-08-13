// Typing of request body values based on the normalized model.
//
// Two sources produce the try-it's JSON body: pre-filling
// (examples/defaults declared in the schema) and the doc's input
// fields (which only render strings). Both missed the declared type:
// an `example: "20.51"` on a `oneOf: [number, integer]` went out as-is and
// the API replied "this value must be of type float|int".
//
// Rule: the type declared by the schema governs the shape of the value
// written next to it. Conversion only happens if the value satisfies NONE of
// the accepted types, and only when it's lossless and unambiguous — otherwise
// the original value is kept as-is (an inconsistent schema should
// stay visible, not be papered over).

// Composite variant exploration depth (rule 7).
const MAX_COMPOSITE_DEPTH = 3
// Recursive coercion depth for a structured example.
const MAX_DEPTH = 8

// Union of the types accepted by a node, including composite variants. For
// allOf the union is broader than the real intersection, which can only
// widen the candidate conversions — never produce a false one, since the
// value must not match any type at all to be converted anyway.
export function acceptedTypes(schema, depth = 0, out = new Set()) {
  if (!schema || depth > MAX_COMPOSITE_DEPTH || (depth > 0 && schema.circular)) return out
  for (const type of schema.types ?? (schema.type ? [schema.type] : [])) out.add(type)
  if (schema.nullable) out.add('null')
  for (const variant of schema.composite?.variants ?? []) acceptedTypes(variant, depth + 1, out)
  return out
}

function matchesType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    default:
      return false
  }
}

// Order in which conversions are tried when several types are accepted. `integer`
// before `number`: on an integer/decimal oneOf, "20" must stay an integer.
// `string` last — everything converts to a string, it would be a sink.
const CONVERSION_ORDER = ['integer', 'number', 'boolean', 'object', 'array', 'string']

function convert(value, type) {
  switch (type) {
    case 'integer':
    case 'number': {
      // A boolean converts to 0/1 in JS: that would be a made-up value.
      if (typeof value !== 'string' && typeof value !== 'number') return undefined
      const raw = typeof value === 'string' ? value.trim() : value
      if (raw === '') return undefined
      const n = Number(raw)
      if (!Number.isFinite(n)) return undefined
      if (type === 'integer' && !Number.isInteger(n)) return undefined
      return n
    }
    case 'boolean': {
      if (typeof value !== 'string') return undefined
      const v = value.trim().toLowerCase()
      return v === 'true' ? true : v === 'false' ? false : undefined
    }
    case 'object':
    case 'array': {
      // Example given in serialized form (3.2 `serializedValue`, or a hand-written
      // schema): re-parsed to become a JSON structure again.
      const parsed = parseJson(value)
      return matchesType(parsed, type) ? parsed : undefined
    }
    case 'string':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined
    default:
      return undefined
  }
}

function parseJson(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!/^[[{]/.test(trimmed)) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

// Scalar value coerced to one of the types declared by the schema.
export function coerceValue(value, schema) {
  // An enum enumerates the exact expected values: the string rendered by a
  // select is matched back to the declared value, which keeps its type (including
  // `null`, which no conversion could ever recover from "null").
  if (typeof value === 'string' && Array.isArray(schema?.enum)) {
    const index = schema.enum.findIndex((v) => String(v) === value)
    if (index >= 0) return schema.enum[index]
  }
  const types = acceptedTypes(schema)
  if (!types.size) return value
  for (const type of types) if (matchesType(value, type)) return value
  for (const type of CONVERSION_ORDER) {
    if (!types.has(type)) continue
    const converted = convert(value, type)
    if (converted !== undefined) return converted
  }
  return value
}

// Same thing on a structured value: each leaf is checked against the
// schema at its position (property, array element, composite variant).
export function coerceDeep(value, schema, depth = 0) {
  if (!schema || depth > MAX_DEPTH) return value
  if (Array.isArray(value)) {
    const items = itemsSchemaOf(schema)
    return items ? value.map((item) => coerceDeep(item, items, depth + 1)) : value
  }
  if (isPlainObject(value)) {
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      const childSchema = propertySchemaOf(schema, key)
      out[key] = childSchema ? coerceDeep(child, childSchema, depth + 1) : child
    }
    return out
  }
  const coerced = coerceValue(value, schema)
  // A structure recovered from its serialized form has its own leaves
  // to check against the schema.
  if (coerced !== value && (isPlainObject(coerced) || Array.isArray(coerced))) {
    return coerceDeep(coerced, schema, depth + 1)
  }
  return coerced
}

// Schema of a property, descending into variants: an allOf splits
// its properties across several variants, none of which carries all of them.
function propertySchemaOf(schema, name, depth = 0) {
  if (!schema || depth > MAX_COMPOSITE_DEPTH || (depth > 0 && schema.circular)) return null
  const prop = schema.properties?.find((p) => p.name === name)
  if (prop) return prop.schema
  for (const variant of schema.composite?.variants ?? []) {
    const found = propertySchemaOf(variant, name, depth + 1)
    if (found) return found
  }
  return typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null
}

function itemsSchemaOf(schema, depth = 0) {
  if (!schema || depth > MAX_COMPOSITE_DEPTH || (depth > 0 && schema.circular)) return null
  if (schema.items) return schema.items
  for (const variant of schema.composite?.variants ?? []) {
    const found = itemsSchemaOf(variant, depth + 1)
    if (found) return found
  }
  return null
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
