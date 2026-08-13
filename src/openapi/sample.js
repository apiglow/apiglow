// Example value derived from a normalized schema: what the API would
// respond, computed without network access.
//
// No source of randomness or clock — two renders of the same schema give the
// same value. A doc whose example changes on every display is unreadable,
// and the function stays testable by snapshot.
//
// Same values for a response example and for pre-filling a
// request body: an empty string in a `date-time` field teaches nothing
// and doesn't go out as-is either. `forResponse` now only distinguishes
// readOnly/writeOnly. Constraints (bounds, lengths, multipleOf) are
// always honored: an out-of-domain value would be a counter-example.

import { coerceDeep } from './coerce.js'
import { defaultVariant } from './model.js'

// Documentation values, never routable or addressable: RFC 5737 ranges
// (192.0.2.0/24), RFC 3849 (2001:db8::/32) and the example.com domain.
const FORMAT_SAMPLE = {
  'date-time': '2024-01-15T09:30:00Z',
  date: '2024-01-15',
  time: '09:30:00',
  duration: 'P3D',
  email: 'user@example.com',
  'idn-email': 'user@example.com',
  hostname: 'example.com',
  'idn-hostname': 'example.com',
  ipv4: '192.0.2.1',
  ipv6: '2001:db8::1',
  uri: 'https://example.com/resource',
  iri: 'https://example.com/resource',
  'uri-reference': '/resource',
  'uri-template': '/resource/{id}',
  uuid: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  byte: 'ZXhhbXBsZQ==',
  password: 'pa55w0rd',
  'json-pointer': '/data/0',
  regex: '^[a-z]+$',
  // A binary has no usable textual representation.
  binary: '',
}

// Maximum STRUCTURAL expansion depth (nested objects and arrays).
const MAX_DEPTH = 2
// Absolute safety net (rule 7: no unbounded recursion): composite
// chains don't count towards MAX_DEPTH but are still bounded here.
const HARD_DEPTH = 12
// An array with a high `minItems` shouldn't produce an unreadable block.
const MAX_ITEMS = 3

// Typical value of a known format, for a field's placeholder: what a
// `date-time` or a `uuid` looks like says more than the word "string".
// `binary` deliberately has none.
export function formatSample(format) {
  return FORMAT_SAMPLE[format] || undefined
}

export function sampleValue(schema, { forResponse = false } = {}) {
  return build(schema, 0, forResponse)
}

function build(schema, depth, forResponse) {
  if (!schema || schema.circular || depth > HARD_DEPTH) return null
  // The depth bound only targets recursion: a scalar leaf costs nothing
  // to represent, however deep it is, and the `null` that replaced it
  // was a counter-example — rejected by any API that validates
  // types (`"id": null` on an integer).
  if (depth > MAX_DEPTH && (schema.kind === 'object' || schema.kind === 'array')) return null
  // What the schema declares itself always takes precedence over what we
  // invent — but its SHAPE still remains subject to the type declared next to it: an
  // `example: "20.51"` on a numeric schema describes 20.51, not the string "20.51"
  // (see coerce.js).
  if (schema.examples?.length) return coerceDeep(schema.examples[0], schema)
  if (schema.default !== undefined) return coerceDeep(schema.default, schema)
  if (schema.enum?.length) return coerceDeep(schema.enum[0], schema)

  switch (schema.kind) {
    case 'object': {
      const obj = {}
      for (const prop of schema.properties ?? []) {
        // readOnly belongs to responses, writeOnly to requests.
        if (forResponse ? prop.schema?.writeOnly : prop.schema?.readOnly) continue
        obj[prop.name] = build(prop.schema, depth + 1, forResponse)
      }
      return obj
    }
    case 'array': {
      // `contains` only constrains SOME element, but with no `items` next to it
      // it is the only thing known about the content — one element that
      // satisfies it beats an empty array that illustrates nothing.
      if (schema.items === undefined && schema.contains) {
        const only = build(schema.contains, depth + 1, forResponse)
        return only === null ? [] : [only]
      }
      const item = build(schema.items, depth + 1, forResponse)
      if (item === null) return []
      const count = Math.min(Math.max(schema.minItems ?? 1, 1), MAX_ITEMS)
      return Array.from({ length: count }, () => item)
    }
    case 'composite': {
      // With a discriminator, the sample must be the variant the API would
      // dispatch to — the same one the try-it selector starts on.
      const chosen = defaultVariant(schema)
      const variant = schema.composite.variants[chosen?.index ?? 0]
      let value
      if (!variant || ['object', 'array', 'composite'].includes(variant.kind)) {
        value = build(variant, depth + 1, forResponse)
      } else {
        // Constraints carried by the composite itself (bounds, format,
        // lengths) apply to the value regardless of the chosen variant:
        // without them, a `oneOf: [number, integer]` with `minimum: 15` would give 0.
        const merged = { ...schema, kind: 'primitive', ...variant }
        delete merged.composite
        delete merged.discriminator
        value = build(merged, depth + 1, forResponse)
      }
      // The key is what tells the server which variant this is: a body missing
      // it, or carrying the name of another variant, is rejected outright.
      if (chosen && value && typeof value === 'object' && !Array.isArray(value)) {
        value[schema.discriminator.propertyName] = chosen.key
      }
      return value
    }
    default:
      return scalar(schema)
  }
}

function scalar(schema) {
  switch (schema.type) {
    case 'string':
      return stringSample(schema)
    case 'integer':
    case 'number':
      return numberSample(schema)
    case 'boolean':
      return false
    default:
      return null
  }
}

function stringSample(schema) {
  // 2020-12 spells `format: byte` as `contentEncoding: base64` — same value to
  // show, and a raw "string" in a base64 field is a counter-example.
  const encoded = schema.contentEncoding === 'base64' ? FORMAT_SAMPLE.byte : undefined
  let value = FORMAT_SAMPLE[schema.format] ?? encoded ?? 'string'
  if (schema.minLength > value.length) value = value.padEnd(schema.minLength, 'x')
  if (schema.maxLength !== undefined && value.length > schema.maxLength)
    value = value.slice(0, schema.maxLength)
  return value
}

// Starts at 0 and brings it back into the declared domain. Not 1 as a step for
// `number` either: a fractional step would introduce binary rounding
// errors (0.1 + 0.2) into a value that's displayed as-is.
function numberSample(schema) {
  let value = 0
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum)
    value = schema.exclusiveMinimum + 1
  if (schema.minimum !== undefined && value < schema.minimum) value = schema.minimum
  if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
    value = schema.exclusiveMaximum - 1
  if (schema.maximum !== undefined && value > schema.maximum) value = schema.maximum
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    value = Math.ceil(value / schema.multipleOf) * schema.multipleOf
  }
  return schema.type === 'integer' ? Math.round(value) : value
}
