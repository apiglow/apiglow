import { normalize } from './text.js'
import { deepEqual } from './value-check.js'

// An example that stands in for one rather than showing a value: a JSON type
// name, a "TODO", a "lorem ipsum" — what Swagger Editor's generated example
// (`{ "id": 0, "name": "string" }`) and a hurried author leave behind. The
// reader copies it as the API's own word, and the try-it prefills it as the
// value to send.
//
// Deliberately narrow: a string whose normalized text is one of the words
// below, and an object or array made only of those strings and of the
// generators' neutral fillers (`0`, `false`, `true`, `""`), at least one such
// string inside. A plausible value never qualifies, however dull, and neither
// does a value the schema itself allows by `enum`/`const` — `"string"` is a fine
// example of a field whose values are JSON type names.
export function isPlaceholderExample(value, schema) {
  if (allowedConstant(value, schema)) return false
  if (typeof value === 'string') return isPlaceholderText(value)
  if (value === null || typeof value !== 'object') return false
  const state = { placeholders: 0 }
  return fillerOnly(value, schema, state, 0) && state.placeholders > 0
}

// What the example rules count as an example: a value present and no
// placeholder.
export function isRealExample(value, schema) {
  return value !== undefined && !isPlaceholderExample(value, schema)
}

// An Example Object counts unless every inline value it carries is a
// placeholder; one with no inline value (`externalValue`) is
// `example-external-only`'s to judge.
export function isRealExampleObject(example, schema) {
  if (!example || typeof example !== 'object') return true
  const values = [example.value, example.dataValue].filter((value) => value !== undefined)
  return !values.length || values.some((value) => !isPlaceholderExample(value, schema))
}

function fillerOnly(value, schema, state, depth) {
  if (depth > MAX_DEPTH) return false
  const entries = Array.isArray(value)
    ? value.map((item, index) => [item, itemSchema(schema, index)])
    : Object.entries(value).map(([key, item]) => [item, propertySchema(schema, key)])
  for (const [item, sub] of entries) {
    if (allowedConstant(item, sub)) return false
    if (typeof item === 'string' && item !== '') {
      if (!isPlaceholderText(item)) return false
      state.placeholders += 1
    } else if (item !== null && typeof item === 'object') {
      if (!fillerOnly(item, sub, state, depth + 1)) return false
    } else if (!FILLERS.has(item)) {
      return false
    }
  }
  return true
}

const FILLERS = new Set([0, false, true, ''])

// Generated examples are shallow; the cap bounds a hostile one (rule 7).
const MAX_DEPTH = 32

// `isSubstantive`'s normalization, so a placeholder reads the same in prose and
// in an example: "TODO:", "todo" and "To-do" alike.
function isPlaceholderText(text) {
  const normalized = normalize(text)
  return PLACEHOLDERS.has(normalized) || normalized.startsWith('lorem ipsum')
}

const PLACEHOLDERS = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'todo',
  'tbd',
  'fixme',
  'xxx',
  'placeholder',
])

function allowedConstant(value, schema) {
  if (!isObject(schema)) return false
  if (schema.const !== undefined && deepEqual(schema.const, value)) return true
  return Array.isArray(schema.enum) && schema.enum.some((candidate) => deepEqual(candidate, value))
}

function propertySchema(schema, key) {
  return isObject(schema) && isObject(schema.properties) ? schema.properties[key] : undefined
}

function itemSchema(schema, index) {
  if (!isObject(schema)) return undefined
  if (Array.isArray(schema.prefixItems) && index < schema.prefixItems.length) {
    return schema.prefixItems[index]
  }
  return schema.items
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
