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
