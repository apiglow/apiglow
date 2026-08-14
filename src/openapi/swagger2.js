// Swagger 2.0 → OpenAPI 3.0.4, upstream of dereference and normalization.
//
// Rule 19: a document written against a version this app claims to read cannot
// be "unsupported", and 2.0 diverges too far to absorb in `model.js` (rule 6).
// It splits a request body across `consumes` and an `in: body` parameter,
// addresses components under three root keys, and spells serialization with
// `collectionFormat`. Converting the document once, before anything else sees
// it, keeps every downstream module — model, audit, renderers, exports —
// reading exactly one shape.
//
// The direction is always old → new (newest-wins): nothing here downgrades
// anything. The converted document is also what the audit scores, and its
// `openapi` field genuinely says 3.0.4 — so a 3.0 spelling inside it is
// correct authoring, not a legacy one (`version-legacy` must stay silent).
//
// What the converter cannot express in 3.0 is marked with
// `x-original-collection-format` rather than dropped: the
// `conversion-approximation` audit rule turns those markers into findings, so
// an approximation is visible to the reader instead of silent.

import { unescapePointerToken } from '../scenarios/pointer.js'

const TARGET_VERSION = '3.0.4'

// The one legal value of the `swagger` field. Anything else claiming 2.x is a
// document we have no conversion table for, and it keeps the
// `unsupported-version` error.
const SWAGGER_2_RE = /^2\.0(\.|$)/

export function isSwagger2(doc) {
  return typeof doc?.swagger === 'string' && SWAGGER_2_RE.test(doc.swagger.trim())
}

// 2.0 has no `trace` and no `query`; `parameters` and `$ref` are handled apart.
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch']

const URLENCODED = 'application/x-www-form-urlencoded'
const MULTIPART = 'multipart/form-data'
// `consumes` is optional in 2.0 and a body parameter still has to land under
// some media type. JSON is what the overwhelming majority of such documents
// meant, and it is what every other converter picks.
const DEFAULT_MEDIA = 'application/json'

// Root keys that moved under `components`, with the JSON-pointer prefix rewrite
// each one implies.
const COMPONENT_MOVES = [
  ['definitions', 'schemas'],
  ['parameters', 'parameters'],
  ['responses', 'responses'],
]

export function convertSwagger2(doc) {
  const ctx = {
    root: doc,
    // Two memos, not one: the same object is never both a Schema Object and
    // something else, and a single memo would hand a plainly-copied node back
    // where a schema conversion was due.
    memo: new Map(),
    schemas: new Map(),
    consumes: mediaList(doc.consumes),
    produces: mediaList(doc.produces),
  }

  const out = { openapi: TARGET_VERSION }
  copyExtensions(doc, out, ctx)
  // The trace of where the document comes from: `model.convertedFrom` surfaces
  // it in the settings diagnostics, so a reader who wonders why the version
  // reads 3.0.4 has the answer in the same block.
  out['x-converted-from'] = doc.swagger.trim()
  if (isObject(doc.info)) out.info = carry(doc.info, ctx)
  if (isObject(doc.externalDocs)) out.externalDocs = carry(doc.externalDocs, ctx)
  const servers = convertServers(doc.schemes, doc)
  if (servers.length) out.servers = servers
  if (Array.isArray(doc.tags)) out.tags = carry(doc.tags, ctx)
  out.paths = convertPaths(doc.paths, ctx)
  const components = convertComponents(doc, ctx)
  if (components) out.components = components
  if (Array.isArray(doc.security)) out.security = carry(doc.security, ctx)
  return out
}

// `host` + `basePath` + `schemes` → one server per scheme. Only http(s) produce
// a server: a `ws://` base is not something this app can send to, and a
// document declaring nothing but websockets is better served by the relative
// fallback than by a URL every request would fail against.
//
// No scheme at all but a host: protocol-relative, which is exactly what 2.0
// meant ("same scheme the document was served with").
function convertServers(schemes, doc) {
  const host = typeof doc.host === 'string' ? doc.host.trim() : ''
  const base = basePath(doc.basePath)
  if (!host) return base ? [{ url: base }] : []
  const list = (Array.isArray(schemes) ? schemes : [])
    .filter((scheme) => scheme === 'http' || scheme === 'https')
    .map((scheme) => ({ url: `${scheme}://${host}${base}` }))
  return list.length ? list : [{ url: `//${host}${base}` }]
}

function basePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() === '/') return ''
  const path = value.trim()
  return (path.startsWith('/') ? path : `/${path}`).replace(/\/$/, '')
}

function convertPaths(paths, ctx) {
  const out = {}
  for (const [path, item] of Object.entries(isObject(paths) ? paths : {})) {
    if (!isObject(item)) continue
    out[path] = convertPathItem(item, ctx)
  }
  return out
}

function convertPathItem(raw, ctx) {
  const out = {}
  copyExtensions(raw, out, ctx)
  // A Path Item `$ref` survives as one: pointing at another path item of the
  // same (converted) document resolves fine, and an external one is a document
  // this converter never sees.
  if (typeof raw.$ref === 'string') out.$ref = rewriteRef(raw.$ref)
  const shared = splitParameters(raw.parameters, ctx)
  if (shared.others.length) out.parameters = shared.others
  for (const method of METHODS) {
    if (!isObject(raw[method])) continue
    out[method] = convertOperation(raw[method], shared, ctx)
  }
  return out
}

function convertOperation(raw, shared, ctx) {
  const own = splitParameters(raw.parameters, ctx)
  const consumes = mediaList(raw.consumes) ?? ctx.consumes ?? []
  const produces = mediaList(raw.produces) ?? ctx.produces ?? []
  // An operation declaring a body of its own replaces the path item's whole
  // body declaration — mixing a shared `in: body` with an own `formData` would
  // build a body out of two contradictory descriptions.
  const body = own.body || own.formData.length ? own : shared

  const out = {}
  copyExtensions(raw, out, ctx)
  for (const key of ['tags', 'summary', 'description', 'operationId']) {
    if (raw[key] !== undefined) out[key] = carry(raw[key], ctx)
  }
  if (isObject(raw.externalDocs)) out.externalDocs = carry(raw.externalDocs, ctx)
  if (raw.deprecated === true) out.deprecated = true
  if (own.others.length) out.parameters = own.others
  const requestBody = convertRequestBody(body, consumes, ctx)
  if (requestBody) out.requestBody = requestBody
  out.responses = convertResponses(raw.responses, produces, ctx)
  if (Array.isArray(raw.security)) out.security = carry(raw.security, ctx)
  // Operation-level `schemes` override the root ones over that operation only,
  // which is what 3.0's operation `servers` says. Without a `host` there is no
  // scheme to override anything of: the servers would repeat the root's.
  if (Array.isArray(raw.schemes) && typeof ctx.root.host === 'string' && ctx.root.host.trim()) {
    const servers = convertServers(raw.schemes, ctx.root)
    if (servers.length) out.servers = servers
  }
  return out
}

// Splits a 2.0 parameter list into what stays a parameter and what becomes a
// body. `in: body` / `in: formData` entries are resolved through an internal
// `$ref` when they are one: 3.0 has no such parameter to reference, and the
// media types the body needs come from the operation's own `consumes`. That is
// the single place this converter follows a pointer itself — an external `$ref`
// stays a reference and is classified as an ordinary parameter, the one
// conversion this document cannot do alone.
function splitParameters(list, ctx) {
  const out = { others: [], body: null, formData: [] }
  for (const entry of Array.isArray(list) ? list : []) {
    if (!isObject(entry)) continue
    const isRef = typeof entry.$ref === 'string'
    const resolved = isRef ? localParameter(ctx, entry.$ref) : entry
    const where = resolved?.in
    if (where === 'body') out.body ??= resolved
    else if (where === 'formData') out.formData.push(resolved)
    else if (isRef) out.others.push({ $ref: rewriteRef(entry.$ref) })
    else out.others.push(convertParameter(entry, ctx))
  }
  return out
}

function localParameter(ctx, ref) {
  const match = /^#\/parameters\/(.+)$/.exec(ref)
  if (!match) return null
  const name = unescapePointerToken(match[1])
  const param = ctx.root.parameters?.[name]
  return isObject(param) ? param : null
}

function convertParameter(raw, ctx) {
  const out = {}
  copyExtensions(raw, out, ctx)
  out.name = raw.name
  out.in = raw.in
  if (raw.description !== undefined) out.description = raw.description
  // A path parameter is required by definition in both versions.
  if (raw.in === 'path' || raw.required === true) out.required = true
  if (raw.allowEmptyValue === true) out.allowEmptyValue = true
  const { style, explode, original } = serialization(raw)
  if (style) out.style = style
  if (explode !== undefined) out.explode = explode
  if (original) out['x-original-collection-format'] = original
  out.schema = flatSchema(raw, ctx)
  return out
}

// `collectionFormat` → `style` + `explode`. Only an array parameter has one,
// and only `query`/`formData` reach the styles 3.0 defines for a delimiter:
// `spaceDelimited` and `pipeDelimited` are query-only there, so the same
// collection format in a path or a header has no 3.0 spelling at all. It is
// marked as an approximation instead of silently becoming a comma.
//
// `csv` is 2.0's default and needs saying out loud in `query`, where 3.0's
// default is the exploded form; in `path`/`header` both defaults already agree.
function serialization(raw) {
  if (raw.type !== 'array') return {}
  const delimited = raw.in === 'query' || raw.in === 'formData'
  const format = typeof raw.collectionFormat === 'string' ? raw.collectionFormat : 'csv'
  if (format === 'csv') return delimited ? { style: 'form', explode: false } : {}
  if (format === 'multi') {
    return delimited ? { style: 'form', explode: true } : { original: format }
  }
  if (format === 'ssv') {
    return delimited ? { style: 'spaceDelimited', explode: false } : { original: format }
  }
  if (format === 'pipes') {
    return delimited ? { style: 'pipeDelimited', explode: false } : { original: format }
  }
  // `tsv` — and anything unknown: 3.0 has no tab-delimited style, so the
  // parameter falls back on the comma and says so.
  return delimited ? { style: 'form', explode: false, original: format } : { original: format }
}

// The validation keywords a 2.0 parameter, Items Object or response header
// carries flat, lifted into the `schema` 3.0 expects.
const FLAT_KEYS = [
  'type',
  'format',
  'default',
  'enum',
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
  'multipleOf',
]

// Nested Items Objects are inline by spec, but a dereferenced `$ref` could have
// made them cyclic — same bound as everywhere else (rule 7).
const MAX_ITEMS_DEPTH = 10

function flatSchema(raw, ctx, depth = 0) {
  const schema = {}
  for (const key of FLAT_KEYS) {
    if (raw[key] !== undefined) schema[key] = carry(raw[key], ctx)
  }
  // `type: file` is 2.0's way of saying "bytes", in a form field or a file
  // response alike; 3.0 says it with the binary format.
  if (raw.type === 'file') {
    schema.type = 'string'
    schema.format = 'binary'
  }
  if (isObject(raw.items) && depth < MAX_ITEMS_DEPTH) {
    schema.items = flatSchema(raw.items, ctx, depth + 1)
    // An inner collection format has nowhere to go: 3.0 serializes a parameter
    // with one style, for every level of nesting at once.
    const format = raw.items.collectionFormat
    if (typeof format === 'string' && format !== 'csv') {
      schema.items['x-original-collection-format'] = format
    }
  }
  return schema
}

function convertRequestBody(body, consumes, ctx) {
  if (body.body) return convertBodyParameter(body.body, consumes, ctx)
  if (body.formData.length) return convertFormData(body.formData, consumes, ctx)
  return null
}

function convertBodyParameter(raw, consumes, ctx) {
  const schema = isObject(raw.schema) ? carrySchema(raw.schema, ctx) : undefined
  const types = consumes.length ? consumes : [DEFAULT_MEDIA]
  const out = {}
  copyExtensions(raw, out, ctx)
  if (raw.description !== undefined) out.description = raw.description
  if (raw.required === true) out.required = true
  // One entry per media type, all sharing the same schema OBJECT: normalization
  // memoizes by identity, so the shared schema stays one node in the model
  // instead of N copies of the same tree. The parameter's `name` is dropped —
  // 3.0's request body has none, and 2.0's was never sent anywhere.
  out.content = Object.fromEntries(types.map((type) => [type, schema ? { schema } : {}]))
  return out
}

// `in: formData` parameters are properties of a form body. Which form: what
// `consumes` says, and failing that the presence of a file — a file field can
// only travel as multipart.
function convertFormData(params, consumes, ctx) {
  const declared = consumes.filter((type) => type === MULTIPART || type === URLENCODED)
  const hasFile = params.some((param) => param.type === 'file')
  const types = declared.length ? declared : [hasFile ? MULTIPART : URLENCODED]

  const properties = {}
  const required = []
  const encoding = {}
  for (const param of params) {
    const schema = flatSchema(param, ctx)
    if (param.description !== undefined) schema.description = param.description
    properties[param.name] = schema
    if (param.required === true) required.push(param.name)
    const { style, explode, original } = serialization({ ...param, in: 'formData' })
    if (style) {
      encoding[param.name] = compact({
        style,
        explode,
        ...(original ? { 'x-original-collection-format': original } : {}),
      })
    }
  }
  const schema = compact({
    type: 'object',
    properties,
    required: required.length ? required : undefined,
  })
  const shared = Object.keys(encoding).length ? encoding : undefined
  return compact({
    // A form body with a required field is itself required: 2.0 said so per
    // field, 3.0 says it once for the whole body and keeps `required` per
    // property inside the schema.
    required: required.length ? true : undefined,
    content: Object.fromEntries(types.map((type) => [type, compact({ schema, encoding: shared })])),
  })
}

function convertResponses(raw, produces, ctx) {
  const out = {}
  for (const [status, response] of Object.entries(isObject(raw) ? raw : {})) {
    if (!isObject(response)) continue
    if (typeof response.$ref === 'string') {
      out[status] = { $ref: rewriteRef(response.$ref) }
      continue
    }
    out[status] = convertResponse(response, produces, ctx)
  }
  return out
}

function convertResponse(raw, produces, ctx) {
  const out = {}
  copyExtensions(raw, out, ctx)
  // `description` is required in both versions; the empty string keeps the
  // converted document valid where the source forgot it.
  out.description = typeof raw.description === 'string' ? raw.description : ''
  const headers = convertHeaders(raw.headers, ctx)
  if (headers) out.headers = headers
  const content = convertResponseContent(raw, produces, ctx)
  if (content) out.content = content
  return out
}

// A response body's media types come from `produces`, and 2.0's `examples` map
// is keyed by media type too — an example for a type `produces` never mentioned
// still gets its entry: the document does describe that body.
function convertResponseContent(raw, produces, ctx) {
  const schema = isObject(raw.schema) ? carrySchema(raw.schema, ctx) : undefined
  const examples = isObject(raw.examples) ? raw.examples : {}
  const types = new Set([...(schema ? (produces.length ? produces : [DEFAULT_MEDIA]) : [])])
  for (const type of Object.keys(examples)) types.add(type)
  if (!types.size) return null
  return Object.fromEntries(
    [...types].map((type) => [
      type,
      compact({ schema, example: type in examples ? carry(examples[type], ctx) : undefined }),
    ]),
  )
}

function convertHeaders(raw, ctx) {
  const entries = Object.entries(isObject(raw) ? raw : {}).filter(([, header]) => isObject(header))
  if (!entries.length) return null
  return Object.fromEntries(
    entries.map(([name, header]) => {
      const out = {}
      copyExtensions(header, out, ctx)
      if (header.description !== undefined) out.description = header.description
      out.schema = flatSchema(header, ctx)
      // A response header is read, never serialized by this app, but the
      // delimiter it announced is part of what the document says.
      const format = header.collectionFormat
      if (typeof format === 'string' && format !== 'csv') {
        out.schema['x-original-collection-format'] = format
      }
      return [name, out]
    }),
  )
}

// `definitions` / `parameters` / `responses` move under `components`, which is
// what the document-wide `$ref` rewrite exists for.
//
// Two deliberate omissions. A root `parameters` entry that is a body or a form
// field does NOT become a `components.parameters` entry — 3.0 has no such
// parameter; those are inlined at each use site (see `splitParameters`), where
// the operation's own `consumes` is known. And a shared `responses` entry is
// converted with the ROOT `produces`, the only one a component can see.
function convertComponents(doc, ctx) {
  const components = {}
  for (const [from, to] of COMPONENT_MOVES) {
    const source = isObject(doc[from]) ? doc[from] : null
    if (!source) continue
    const entries = Object.entries(source)
      .filter(([, value]) => isObject(value))
      .map(([name, value]) => [name, convertComponent(from, value, ctx)])
      .filter(([, value]) => value !== null)
    if (entries.length) components[to] = Object.fromEntries(entries)
  }
  const schemes = Object.entries(isObject(doc.securityDefinitions) ? doc.securityDefinitions : {})
    .filter(([, value]) => isObject(value))
    .map(([name, value]) => [name, convertSecurityScheme(value, ctx)])
  if (schemes.length) components.securitySchemes = Object.fromEntries(schemes)
  return Object.keys(components).length ? components : null
}

function convertComponent(from, value, ctx) {
  if (from === 'definitions') return carrySchema(value, ctx)
  if (from === 'responses') return convertResponse(value, ctx.produces ?? [], ctx)
  if (value.in === 'body' || value.in === 'formData') return null
  return convertParameter(value, ctx)
}

// 2.0 declares one flow per scheme and names two of them differently; 3.0 keys
// them under `flows` and renamed those two.
const OAUTH_FLOWS = {
  implicit: 'implicit',
  password: 'password',
  application: 'clientCredentials',
  accessCode: 'authorizationCode',
}

function convertSecurityScheme(raw, ctx) {
  const out = {}
  copyExtensions(raw, out, ctx)
  if (raw.description !== undefined) out.description = raw.description
  if (raw.type === 'basic') return Object.assign(out, { type: 'http', scheme: 'basic' })
  if (raw.type === 'apiKey') {
    return Object.assign(out, compact({ type: 'apiKey', name: raw.name, in: raw.in }))
  }
  if (raw.type !== 'oauth2') {
    // An unknown type is carried verbatim: it is not ours to invent, and the
    // audit's `security-scheme-declared` rule is the one that judges it.
    return Object.assign(out, carry(raw, ctx))
  }
  const name = OAUTH_FLOWS[raw.flow]
  const flow = compact({
    authorizationUrl:
      name === 'implicit' || name === 'authorizationCode' ? raw.authorizationUrl : undefined,
    tokenUrl: name && name !== 'implicit' ? raw.tokenUrl : undefined,
    scopes: isObject(raw.scopes) ? { ...raw.scopes } : {},
  })
  return Object.assign(out, { type: 'oauth2', flows: name ? { [name]: flow } : {} })
}

// Schema Objects. 2.0's are draft-04 with three divergences worth converting;
// everything else is already 3.0-legal and is copied through.
function carrySchema(value, ctx) {
  if (Array.isArray(value)) return value.map((item) => carrySchema(item, ctx))
  if (!isObject(value)) return value
  if (ctx.schemas.has(value)) return ctx.schemas.get(value)
  const out = {}
  ctx.schemas.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    if (key === '$ref' && typeof item === 'string') {
      out.$ref = rewriteRef(item)
    } else if (key === 'discriminator') {
      // 2.0's discriminator is the property NAME; 3.0 wraps it in an object,
      // which is the shape the model's polymorphism support reads.
      if (typeof item === 'string') out.discriminator = { propertyName: item }
      else if (isObject(item)) out.discriminator = carry(item, ctx)
    } else if (key === 'x-nullable') {
      // The de-facto 2.0 spelling of nullability, emitted by every generator of
      // that era. Translated rather than kept: `nullable` is what 3.0 says, and
      // the model turns it into `type: [..., 'null']` from there. Same
      // newest-wins move as every other spelling in this converter.
      if (item === true) out.nullable = true
    } else if (SCHEMA_CHILDREN.has(key)) {
      out[key] = carrySchema(item, ctx)
    } else if (key === 'properties' || key === 'patternProperties') {
      out[key] = Object.fromEntries(
        Object.entries(isObject(item) ? item : {}).map(([name, child]) => [
          name,
          carrySchema(child, ctx),
        ]),
      )
    } else if (key === 'type' && item === 'file') {
      out.type = 'string'
      out.format = 'binary'
    } else {
      out[key] = carry(item, ctx)
    }
  }
  return out
}

// Positions holding a schema (or a list of them) rather than data. `not` /
// `oneOf` / `anyOf` are not in 2.0's subset, but documents carry them anyway and
// dropping the conversion inside them would be worse than accepting them.
const SCHEMA_CHILDREN = new Set(['items', 'allOf', 'anyOf', 'oneOf', 'not', 'additionalProperties'])

// Deep copy of everything that is not schema-shaped, with the same `$ref`
// rewrite and the same identity memo — the memo preserves sharing (and survives
// the cycles an already-dereferenced document carries).
function carry(value, ctx) {
  if (Array.isArray(value)) {
    if (ctx.memo.has(value)) return ctx.memo.get(value)
    const out = []
    ctx.memo.set(value, out)
    for (const item of value) out.push(carry(item, ctx))
    return out
  }
  if (!isObject(value)) return value
  if (ctx.memo.has(value)) return ctx.memo.get(value)
  const out = {}
  ctx.memo.set(value, out)
  for (const [key, item] of Object.entries(value)) {
    out[key] = key === '$ref' && typeof item === 'string' ? rewriteRef(item) : carry(item, ctx)
  }
  return out
}

// `#/definitions/Pet` → `#/components/schemas/Pet`, and the two other moved
// roots. Only a fragment-only pointer is rewritten: `other.json#/definitions/Pet`
// points into a document this converter never touched, whose `definitions` are
// still exactly where they were.
function rewriteRef(ref) {
  if (!ref.startsWith('#/')) return ref
  for (const [from, to] of COMPONENT_MOVES) {
    if (ref.startsWith(`#/${from}/`)) return `#/components/${to}/${ref.slice(from.length + 3)}`
  }
  return ref
}

function copyExtensions(raw, out, ctx) {
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('x-')) out[key] = carry(value, ctx)
  }
}

function mediaList(value) {
  if (!Array.isArray(value)) return null
  const list = value.filter((type) => typeof type === 'string' && type.trim()).map((t) => t.trim())
  return list.length ? list : null
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compact(obj) {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key]
  }
  return obj
}
