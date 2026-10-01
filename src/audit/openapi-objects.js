import { escapePointerToken } from '../scenarios/pointer.js'

// The OpenAPI objects, field by field and version by version — the table the
// structural rules read (docs/audit.md §4.1): which fields an object has in
// 3.0, 3.1 and 3.2, which are required, and what kind of value each takes.
// `walkObjects` types every node of the SOURCE document with it, so a rule
// asks "every Parameter Object" instead of re-deriving where parameters live.
//
// Versions are minors of 3: `since: 1` is 3.1, `removed: 2` is gone in 3.2.
// A field's `kind` is one of:
// - a primitive: 'string', 'boolean', 'number', 'any' (a payload, never walked);
// - an object name of this table ('Info'), or 'Schema';
// - { array: kind } or { map: kind }, whose members may be Reference Objects
//   when `ref` is set.
// `values` lists the allowed strings of an enumerated field, version-gated
// the same way (`{ value: 'querystring', since: 2 }`).

const string = { kind: 'string' }
const boolean = { kind: 'boolean' }
const any = { kind: 'any' }
const url = { kind: 'string', url: true }
const obj = (kind, extra = {}) => ({ kind, ...extra })
const array = (kind, extra = {}) => ({ kind: { array: kind, ref: extra.ref }, ...extra })
const map = (kind, extra = {}) => ({ kind: { map: kind, ref: extra.ref }, ...extra })

const PARAMETER_STYLES = [
  'matrix',
  'label',
  'simple',
  'form',
  'spaceDelimited',
  'pipeDelimited',
  'deepObject',
  { value: 'cookie', since: 2 },
]

export const OBJECTS = {
  OpenAPI: {
    openapi: { ...string, required: true },
    $self: { ...url, since: 2 },
    info: obj('Info', { required: true }),
    jsonSchemaDialect: { ...url, since: 1 },
    servers: array('Server'),
    // Required in 3.0 only: 3.1 asks for one of paths, components, webhooks.
    paths: obj('Paths', { required: 1 }),
    webhooks: map('PathItem', { since: 1, ref: true }),
    components: obj('Components'),
    security: array('SecurityRequirement'),
    tags: array('Tag'),
    externalDocs: obj('ExternalDocumentation'),
  },
  Info: {
    title: { ...string, required: true },
    summary: { ...string, since: 1 },
    description: string,
    termsOfService: url,
    contact: obj('Contact'),
    license: obj('License'),
    version: { ...string, required: true },
  },
  Contact: { name: string, url, email: string },
  License: {
    name: { ...string, required: true },
    identifier: { ...string, since: 1 },
    url,
  },
  Server: {
    url: { ...string, required: true },
    description: string,
    name: { ...string, since: 2 },
    variables: map('ServerVariable'),
  },
  ServerVariable: {
    enum: { kind: { array: 'string' } },
    default: { ...string, required: true },
    description: string,
  },
  Components: {
    schemas: map('Schema'),
    responses: map('Response', { ref: true }),
    parameters: map('Parameter', { ref: true }),
    examples: map('Example', { ref: true }),
    requestBodies: map('RequestBody', { ref: true }),
    headers: map('Header', { ref: true }),
    securitySchemes: map('SecurityScheme', { ref: true }),
    links: map('Link', { ref: true }),
    callbacks: map('Callback', { ref: true }),
    pathItems: map('PathItem', { since: 1, ref: true }),
    mediaTypes: map('MediaType', { since: 2, ref: true }),
  },
  // Patterned: `/…` → Path Item (`walkObjects` reads the keys).
  Paths: {},
  PathItem: {
    $ref: string,
    summary: string,
    description: string,
    get: obj('Operation'),
    put: obj('Operation'),
    post: obj('Operation'),
    delete: obj('Operation'),
    options: obj('Operation'),
    head: obj('Operation'),
    patch: obj('Operation'),
    trace: obj('Operation'),
    query: obj('Operation', { since: 2 }),
    additionalOperations: map('Operation', { since: 2 }),
    servers: array('Server'),
    parameters: array('Parameter', { ref: true }),
  },
  Operation: {
    tags: { kind: { array: 'string' } },
    summary: string,
    description: string,
    externalDocs: obj('ExternalDocumentation'),
    operationId: string,
    parameters: array('Parameter', { ref: true }),
    requestBody: obj('RequestBody', { ref: true }),
    responses: obj('Responses', { required: 1 }),
    callbacks: map('Callback', { ref: true }),
    deprecated: boolean,
    security: array('SecurityRequirement'),
    servers: array('Server'),
  },
  ExternalDocumentation: { description: string, url: { ...url, required: true } },
  Parameter: {
    name: { ...string, required: true },
    in: {
      ...string,
      required: true,
      values: ['query', 'header', 'path', 'cookie', { value: 'querystring', since: 2 }],
    },
    description: string,
    required: boolean,
    deprecated: boolean,
    allowEmptyValue: boolean,
    style: { ...string, values: PARAMETER_STYLES },
    explode: boolean,
    allowReserved: boolean,
    schema: obj('Schema'),
    example: any,
    examples: map('Example', { ref: true }),
    content: map('MediaType', { ref: 2 }),
  },
  RequestBody: {
    description: string,
    content: map('MediaType', { required: true, ref: 2 }),
    required: boolean,
  },
  MediaType: {
    schema: obj('Schema'),
    itemSchema: obj('Schema', { since: 2 }),
    example: any,
    examples: map('Example', { ref: true }),
    encoding: map('Encoding'),
    prefixEncoding: array('Encoding', { since: 2 }),
    itemEncoding: obj('Encoding', { since: 2 }),
  },
  Encoding: {
    contentType: string,
    headers: map('Header', { ref: true }),
    style: { ...string, values: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'] },
    explode: boolean,
    allowReserved: boolean,
    encoding: map('Encoding', { since: 2 }),
    prefixEncoding: array('Encoding', { since: 2 }),
    itemEncoding: obj('Encoding', { since: 2 }),
  },
  // Patterned: `default` and status codes → Response.
  Responses: {},
  Response: {
    summary: { ...string, since: 2 },
    // Required until 3.2, which made it optional.
    description: { ...string, required: 2 },
    headers: map('Header', { ref: true }),
    content: map('MediaType', { ref: 2 }),
    links: map('Link', { ref: true }),
  },
  // Patterned: runtime expression → Path Item.
  Callback: {},
  Example: {
    summary: string,
    description: string,
    value: any,
    dataValue: { ...any, since: 2 },
    serializedValue: { ...string, since: 2 },
    externalValue: url,
  },
  Link: {
    operationRef: string,
    operationId: string,
    parameters: { kind: { map: 'any' } },
    requestBody: any,
    description: string,
    server: obj('Server'),
  },
  Header: {
    description: string,
    required: boolean,
    deprecated: boolean,
    // 3.2 lists a Header's fields itself instead of borrowing the
    // Parameter's, and these two are not among them.
    allowEmptyValue: { ...boolean, removed: 2 },
    style: { ...string, values: ['simple'] },
    explode: boolean,
    allowReserved: { ...boolean, removed: 2 },
    schema: obj('Schema'),
    example: any,
    examples: map('Example', { ref: true }),
    content: map('MediaType', { ref: 2 }),
  },
  Tag: {
    name: { ...string, required: true },
    summary: { ...string, since: 2 },
    description: string,
    externalDocs: obj('ExternalDocumentation'),
    parent: { ...string, since: 2 },
    kind: { ...string, since: 2 },
  },
  Reference: {
    $ref: { ...string, required: true },
    summary: { ...string, since: 1 },
    description: { ...string, since: 1 },
  },
  Discriminator: {
    propertyName: { ...string, required: true },
    mapping: { kind: { map: 'string' } },
    defaultMapping: { ...string, since: 2 },
  },
  XML: {
    name: string,
    namespace: url,
    prefix: string,
    attribute: boolean,
    wrapped: boolean,
    nodeType: {
      ...string,
      since: 2,
      values: ['element', 'attribute', 'text', 'cdata', 'none'],
    },
  },
  SecurityScheme: {
    type: {
      ...string,
      required: true,
      values: ['apiKey', 'http', 'oauth2', 'openIdConnect', { value: 'mutualTLS', since: 1 }],
    },
    description: string,
    name: string,
    in: { ...string, values: ['query', 'header', 'cookie'] },
    scheme: string,
    bearerFormat: string,
    flows: obj('OAuthFlows'),
    openIdConnectUrl: url,
    oauth2MetadataUrl: { ...url, since: 2 },
    deprecated: { ...boolean, since: 2 },
  },
  OAuthFlows: {
    implicit: obj('OAuthFlow'),
    password: obj('OAuthFlow'),
    clientCredentials: obj('OAuthFlow'),
    authorizationCode: obj('OAuthFlow'),
    deviceAuthorization: obj('OAuthFlow', { since: 2 }),
  },
  OAuthFlow: {
    authorizationUrl: url,
    deviceAuthorizationUrl: { ...url, since: 2 },
    tokenUrl: url,
    refreshUrl: url,
    scopes: { kind: { map: 'string' }, required: true },
  },
  // Patterned: scheme name → list of scopes (or roles).
  SecurityRequirement: {},
}

// Objects whose keys are names, not fields: no table to hold them to.
export const PATTERNED = new Set(['Paths', 'Responses', 'Callback', 'SecurityRequirement'])

// Is this field (or enumerated value) part of the declared version?
export function inVersion({ since = 0, removed = Number.POSITIVE_INFINITY }, minor) {
  return minor >= since && minor < removed
}

// `required: true` everywhere, or `required: n` — required before 3.n only.
export function isRequired(field, minor) {
  if (field.required === true) return true
  return typeof field.required === 'number' && minor < field.required
}

export function allowedValues(field, minor) {
  return field.values
    ?.filter((entry) => typeof entry === 'string' || inVersion(entry, minor))
    .map((entry) => (typeof entry === 'string' ? entry : entry.value))
}

// Schema keywords whose value is one subschema, a list of them, or a map of
// them — what the walk descends into. Payload keywords (example, default,
// enum, const, a 3.1 `examples` list) are never walked.
const SCHEMA_ONE = [
  'items',
  'additionalProperties',
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'unevaluatedItems',
  'unevaluatedProperties',
  'additionalItems',
]
const SCHEMA_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SCHEMA_MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const SCHEMA_OBJECTS = {
  discriminator: 'Discriminator',
  xml: 'XML',
  externalDocs: 'ExternalDocumentation',
}

// Depth budget (rule 7): the source is a tree, but external input.
const MAX_DEPTH = 96

// Every OpenAPI object of the source document, typed → [{ type, node,
// dataPath }], in document order. A `$ref` where an object of type T may stand
// is `{ type: 'Reference', expected: T }`, and is not followed when it points
// inside the document: its target is walked where it is declared, once. One
// that points to another file is followed through the dereferenced document —
// what was read there — and its content reported under the `$ref`'s own
// pointer, which the CLI's positions follow into that file.
export function walkObjects(source, document, minor) {
  const entries = []
  const seen = new Set()

  const visit = (node, kind, dataPath, depth, external) => {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return
    if (typeof kind === 'object') {
      const members = kind.array ? (Array.isArray(node) ? node.entries() : []) : null
      const entriesOf = members ?? (Array.isArray(node) ? [] : Object.entries(node))
      const refable = kind.ref === true || (typeof kind.ref === 'number' && minor >= kind.ref)
      for (const [key, member] of entriesOf) {
        if (!kind.array && String(key).startsWith('x-')) continue
        typed(
          member,
          kind.array ?? kind.map,
          refable,
          `${dataPath}/${escapePointerToken(key)}`,
          depth + 1,
          external,
        )
      }
      return
    }
    if (Array.isArray(node) || seen.has(node)) return
    seen.add(node)
    entries.push({ type: kind, node, dataPath })
    if (kind === 'Schema') return visitSchema(node, dataPath, depth, external)
    if (PATTERNED.has(kind)) return visitPatterned(node, kind, dataPath, depth, external)
    for (const [key, field] of Object.entries(OBJECTS[kind] ?? {})) {
      if (
        node[key] === undefined ||
        (typeof field.kind === 'string' && !OBJECTS[field.kind] && field.kind !== 'Schema')
      )
        continue
      const refable = field.ref === true || (typeof field.ref === 'number' && minor >= field.ref)
      typed(
        node[key],
        field.kind,
        refable,
        `${dataPath}/${escapePointerToken(key)}`,
        depth + 1,
        external,
      )
    }
  }

  // One value where an object of `kind` belongs, a Reference Object allowed or
  // not. A Path Item's own `$ref` is a field of it rather than a Reference.
  const typed = (value, kind, refable, dataPath, depth, external) => {
    if (typeof kind === 'string' && !OBJECTS[kind] && kind !== 'Schema') return
    const isRef = value && typeof value === 'object' && typeof value.$ref === 'string'
    if (isRef && kind !== 'PathItem' && (refable || kind === 'Schema')) {
      if (seen.has(value)) return
      seen.add(value)
      entries.push({ type: 'Reference', expected: kind, node: value, dataPath })
      // An external target the loader could not read is still the `$ref`
      // there: `ref-resolves`' finding, and nothing to type.
      const target = !external && !value.$ref.startsWith('#') ? nodeAt(document, dataPath) : null
      if (target && typeof target.$ref !== 'string') visit(target, kind, dataPath, depth, true)
      return
    }
    visit(value, kind, dataPath, depth, external)
  }

  const visitSchema = (schema, dataPath, depth, external) => {
    const child = (value, ...segments) =>
      typed(
        value,
        'Schema',
        true,
        `${dataPath}/${segments.map(escapePointerToken).join('/')}`,
        depth + 1,
        external,
      )
    for (const keyword of SCHEMA_ONE) {
      if (
        schema[keyword] &&
        typeof schema[keyword] === 'object' &&
        !Array.isArray(schema[keyword])
      ) {
        child(schema[keyword], keyword)
      }
    }
    // 3.0 and draft-04 tuples: `items` as a list.
    if (Array.isArray(schema.items)) {
      for (const [index, item] of schema.items.entries()) child(item, 'items', index)
    }
    for (const keyword of SCHEMA_LIST) {
      if (!Array.isArray(schema[keyword])) continue
      for (const [index, item] of schema[keyword].entries()) child(item, keyword, index)
    }
    for (const keyword of SCHEMA_MAP) {
      const members = schema[keyword]
      if (!members || typeof members !== 'object' || Array.isArray(members)) continue
      for (const [name, item] of Object.entries(members)) child(item, keyword, name)
    }
    for (const [keyword, type] of Object.entries(SCHEMA_OBJECTS)) {
      if (schema[keyword] !== undefined) {
        typed(schema[keyword], type, false, `${dataPath}/${keyword}`, depth + 1, external)
      }
    }
  }

  const visitPatterned = (node, kind, dataPath, depth, external) => {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('x-')) continue
      const at = `${dataPath}/${escapePointerToken(key)}`
      if (kind === 'Paths' || kind === 'Callback')
        typed(value, 'PathItem', false, at, depth + 1, external)
      else if (kind === 'Responses') typed(value, 'Response', true, at, depth + 1, external)
    }
  }

  visit(source, 'OpenAPI', '', 0, false)
  return entries
}

function nodeAt(root, dataPath) {
  let node = root
  for (const token of dataPath.slice(1).split('/')) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[token.replaceAll('~1', '/').replaceAll('~0', '~')]
  }
  return node
}

// How a finding names an object: the spec's own name for it, which is also what
// a reader searches the specification for.
const LABELS = {
  OpenAPI: 'OpenAPI',
  PathItem: 'Path Item',
  ExternalDocumentation: 'External Documentation',
  RequestBody: 'Request Body',
  MediaType: 'Media Type',
  ServerVariable: 'Server Variable',
  SecurityScheme: 'Security Scheme',
  SecurityRequirement: 'Security Requirement',
  OAuthFlows: 'OAuth Flows',
  OAuthFlow: 'OAuth Flow',
}

export function objectLabel(type) {
  return LABELS[type] ?? type
}

// How a document spells a field of that object: `info.summary`, `xml.nodeType`
// — the key it sits under where the spec gives it one.
const SPELLINGS = {
  OpenAPI: '',
  XML: 'xml',
  ExternalDocumentation: 'externalDocs',
  OAuthFlows: 'flows',
  OAuthFlow: 'flow',
}

export function fieldSpelling(type, key) {
  const owner = SPELLINGS[type] ?? `${type[0].toLowerCase()}${type.slice(1)}`
  return owner ? `${owner}.${key}` : key
}
