// Schema vocabulary shared by the schema-value rules (docs/audit.md §4.1): which
// keywords apply to which instance types, and every keyword a Schema Object
// knows in any version this app reads. JSON Schema ignores a keyword that does
// not apply to the instance's type, and an unknown keyword altogether.

// Keyword → the instance types it constrains (`integer` is a `number`).
export const APPLIES_TO = {
  minLength: ['string'],
  maxLength: ['string'],
  pattern: ['string'],
  minimum: ['number', 'integer'],
  maximum: ['number', 'integer'],
  exclusiveMinimum: ['number', 'integer'],
  exclusiveMaximum: ['number', 'integer'],
  multipleOf: ['number', 'integer'],
  items: ['array'],
  prefixItems: ['array'],
  contains: ['array'],
  minContains: ['array'],
  maxContains: ['array'],
  minItems: ['array'],
  maxItems: ['array'],
  uniqueItems: ['array'],
  unevaluatedItems: ['array'],
  additionalItems: ['array'],
  properties: ['object'],
  additionalProperties: ['object'],
  patternProperties: ['object'],
  propertyNames: ['object'],
  required: ['object'],
  minProperties: ['object'],
  maxProperties: ['object'],
  dependentRequired: ['object'],
  dependentSchemas: ['object'],
  unevaluatedProperties: ['object'],
}

export const INSTANCE_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']

// The declared types of a raw schema, `nullable` aside: [] when it declares
// none, null when one of them is not a JSON type (no verdict on those).
export function declaredTypes(schema) {
  const { type } = schema
  if (type === undefined) return []
  const list = Array.isArray(type) ? type : [type]
  return list.every((t) => INSTANCE_TYPES.includes(t)) ? list : null
}

// 3.0's Schema Object (an extended draft-04 subset) and 3.1/3.2's (JSON Schema
// 2020-12 plus the OpenAPI vocabulary), with the draft-era spellings a 2020-12
// reader still accepts. A key outside this set is unknown to every version.
export const SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$anchor',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
  '$vocabulary',
  '$comment',
  '$defs',
  'definitions',
  'dependencies',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'prefixItems',
  'items',
  'additionalItems',
  'contains',
  'properties',
  'patternProperties',
  'additionalProperties',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'type',
  'const',
  'enum',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxContains',
  'minContains',
  'maxProperties',
  'minProperties',
  'required',
  'dependentRequired',
  'title',
  'description',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
  'format',
  'contentEncoding',
  'contentMediaType',
  'contentSchema',
  'nullable',
  'discriminator',
  'xml',
  'externalDocs',
  'example',
])

// 3.0's own Schema Object keywords: the draft-04 subset it adopts plus its
// OpenAPI vocabulary. Every other keyword above is JSON Schema 2020-12's, which
// 3.1 adopted, except the draft-era spellings below.
export const SCHEMA_KEYWORDS_30 = new Set([
  '$ref',
  'title',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxProperties',
  'minProperties',
  'required',
  'enum',
  'type',
  'allOf',
  'oneOf',
  'anyOf',
  'not',
  'items',
  'properties',
  'additionalProperties',
  'description',
  'format',
  'default',
  'nullable',
  'discriminator',
  'readOnly',
  'writeOnly',
  'xml',
  'externalDocs',
  'example',
  'deprecated',
])

// Spellings of drafts between 04 and 2020-12 that no OpenAPI version lists.
export const DRAFT_ERA_KEYWORDS = new Set([
  'definitions',
  'dependencies',
  'additionalItems',
  '$recursiveRef',
  '$recursiveAnchor',
])

// A schema's `pattern` (or `patternProperties` key) as a RegExp: ECMA-262,
// read with the `u` flag when it allows it and without otherwise — a pattern
// either reading accepts is a pattern. → null when neither does, which is
// `pattern-valid`'s finding and no verdict anywhere else. Compiled once per
// source: github.json repeats a few dozen patterns across thousands of
// examples. The cache is emptied when full, so a session reading many specs
// does not keep every pattern it ever met.
const PATTERNS = new Map()
const PATTERN_CACHE = 2000

export function compilePattern(source) {
  if (typeof source !== 'string') return null
  if (!PATTERNS.has(source)) {
    if (PATTERNS.size >= PATTERN_CACHE) PATTERNS.clear()
    PATTERNS.set(source, regexOf(source))
  }
  return PATTERNS.get(source)
}

function regexOf(source) {
  for (const flags of ['u', '']) {
    try {
      return new RegExp(source, flags)
    } catch {
      // the other reading may accept it
    }
  }
  return null
}

// The keywords whose value is a subschema (one, a list, or a map of them), in
// the order the walks visit them. A payload keyword (example, default, enum,
// const, a 3.1 `examples` list) is never one.
export const SUBSCHEMA_ONE = [
  'additionalProperties',
  'items',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'unevaluatedProperties',
  'unevaluatedItems',
  'additionalItems',
  'contentSchema',
]
export const SUBSCHEMA_LIST = ['allOf', 'oneOf', 'anyOf', 'prefixItems']
export const SUBSCHEMA_MAP = [
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
]

// The subschemas of a dereferenced schema, as `[subschema, ...segments]`:
// properties first, then the rest in `SUBSCHEMA_*` order. An `items` list
// (draft-04 tuples, which 3.0 does not allow) is walked all the same — its
// members are schemas a reader meets.
export function* subschemas(schema) {
  const objectAt = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (objectAt(schema.properties)) {
    for (const [name, sub] of Object.entries(schema.properties)) yield [sub, 'properties', name]
  }
  for (const keyword of SUBSCHEMA_ONE) {
    const value = schema[keyword]
    if (keyword === 'items' && Array.isArray(value)) {
      for (const [index, sub] of value.entries()) yield [sub, keyword, index]
    } else if (objectAt(value)) yield [value, keyword]
  }
  for (const keyword of SUBSCHEMA_LIST) {
    if (!Array.isArray(schema[keyword])) continue
    for (const [index, sub] of schema[keyword].entries()) yield [sub, keyword, index]
  }
  for (const keyword of SUBSCHEMA_MAP) {
    if (keyword === 'properties' || !objectAt(schema[keyword])) continue
    for (const [name, sub] of Object.entries(schema[keyword])) yield [sub, keyword, name]
  }
}

// Media types whose payload is never text: a `contentMediaType` from these
// families, unencoded, is bytes. Text families (`text/*`, JSON, XML) are a
// string's legitimate content and stay out.
const BINARY_MEDIA =
  /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|vnd\.)/i

// A schema for raw bytes: 3.0's `format: binary`, or 3.1's `contentMediaType`
// of a binary family without a `contentEncoding`.
export function isBinarySchema(schema) {
  if (schema?.format === 'binary') return true
  return (
    typeof schema?.contentMediaType === 'string' &&
    schema.contentEncoding === undefined &&
    BINARY_MEDIA.test(schema.contentMediaType)
  )
}
