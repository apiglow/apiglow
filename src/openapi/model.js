// Normalization of OpenAPI 3.0.x / 3.1.x / 3.2.x → single internal model.
//
// This is THE absorption point for version differences: rendering only consumes
// this model, never the raw schema. Any new version divergence
// must be handled here and nowhere else (CLAUDE.md rule 6).
//
// Expected input: document already dereferenced by json-schema-ref-parser —
// no more `$ref`, but potentially circular JS references.

import { unescapePointerToken } from '../scenarios/pointer.js'
import { compileHideRules, HIDE_EXTENSION } from './hide.js'

// `query` is a Path Item field only since 3.2; leaving it in the
// list costs nothing in 3.0/3.1, where the key doesn't exist. Added at the end
// of the list: the display order of operations for the same path stays unchanged.
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']

// Methods carried by a Path Item: the standard fields above, then the
// free-form methods from `additionalOperations` (3.2) — keys in uppercase in the
// schema, lowercased like everywhere else in the model.
export function* pathItemOperations(pathItem) {
  for (const method of HTTP_METHODS) {
    if (pathItem[method] && typeof pathItem[method] === 'object') yield [method, pathItem[method]]
  }
  const additional = pathItem.additionalOperations
  if (!additional || typeof additional !== 'object') return
  for (const [name, op] of Object.entries(additional)) {
    const method = String(name).toLowerCase()
    // Redeclaring a standard method here is forbidden by the spec: the
    // Path Item's declaration takes precedence, this one is ignored.
    if (!op || typeof op !== 'object' || HTTP_METHODS.includes(method)) continue
    yield [method, op]
  }
}

// `hide`: host config patterns (see hide.js), passed in by the shell.
// `baseUri`: the document's own URI, resolved by the loader from 3.2's `$self`
// (absent when the document declares none) — the model carries it so the shell
// resolves relative servers against it without ever reading the raw document.
export function normalizeDocument(raw, { hide, baseUri } = {}) {
  const hidden = compileHideRules(hide)
  // A hidden tag hides all operations that carry it: it's the
  // most economical way to remove an entire family of internal endpoints.
  const hiddenTags = new Set(
    (raw.tags ?? []).filter((tag) => tag?.[HIDE_EXTENSION] === true).map((tag) => tag.name),
  )
  const isHidden = (path, method, op, id) => {
    if (op[HIDE_EXTENSION] === true) return true
    const tags = op.tags ?? []
    if (tags.some((name) => hiddenTags.has(name))) return true
    return hidden({ id, operationId: op.operationId, method, path, tags })
  }

  const ctx = {
    // Memo raw object → normalized node: preserves sharing (two places in the
    // schema pointing to the same object give the same node) and lets cycles
    // fall back onto an existing node instead of recursing infinitely.
    seen: new Map(),
    // Build stack: revisiting a node still under construction
    // is a real cycle, revisiting a finished node is just sharing (DAG).
    building: new Set(),
    // Original component name, the only recoverable trace of the $ref once the
    // document has been dereferenced: ref-parser replaces `{ $ref: '#/…/Pet' }` with
    // the components.schemas.Pet object itself, whose identity is
    // preserved. Without this, anyOf variants would have no name to display.
    componentNames: new Map(
      Object.entries(raw.components?.schemas ?? {})
        .filter(([, schema]) => schema && typeof schema === 'object')
        .map(([name, schema]) => [schema, name]),
    ),
    allOfChildren: reverseAllOf(raw),
    // Response links, collected during the descent and resolved once every
    // operation exists: a link points at an operation as often forward as
    // backward, and the first pass only knows what it has already built.
    links: [],
  }

  // What hiding removed, counted as it happens. A hidden operation leaves no
  // trace in the model by design — but the document handed out by the "download
  // the schema" action still declares it, and the page offering that file is
  // the only place able to say so (docs/architecture.md §5.1.2). The count, not
  // the names: this is a figure about the file, not a way back to what the host
  // took out.
  let hiddenOperations = 0

  const operations = []
  for (const [path, pathItem] of Object.entries(raw.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    if (pathItem[HIDE_EXTENSION] === true) {
      hiddenOperations += [...pathItemOperations(pathItem)].length
      continue
    }
    // Parameters declared at the path level are inherited by each
    // operation, which can override them individually (key: name + in).
    const pathParams = (pathItem.parameters ?? []).map((p) => normalizeParameter(p, ctx))
    // Path-level `servers` are inherited by each operation that declares none:
    // the model carries the effective (most-specific) list, so no consumer
    // re-implements the operation > path precedence.
    const pathServers = pathItem.servers?.length ? pathItem.servers.map(normalizeServer) : null
    for (const [method, op] of pathItemOperations(pathItem)) {
      if (isHidden(path, method, op, operationKey(path, method, op))) {
        hiddenOperations += 1
        continue
      }
      operations.push(normalizeOperation(path, method, op, pathParams, ctx, 0, pathServers))
    }
  }

  // Top-level webhooks (3.1 only — in 3.0 the array stays empty, rule 6).
  // Same shape as an operation but reversed direction: it's the API that calls the
  // integrator's server. Kept out of `operations` so that try-it,
  // groups and the pager don't treat them as callable endpoints;
  // the shared ctx preserves the identity of common schema nodes.
  const webhooks = []
  for (const [name, pathItem] of Object.entries(raw.webhooks ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    if (pathItem[HIDE_EXTENSION] === true) {
      hiddenOperations += [...pathItemOperations(pathItem)].length
      continue
    }
    const pathParams = (pathItem.parameters ?? []).map((p) => normalizeParameter(p, ctx))
    for (const [method, op] of pathItemOperations(pathItem)) {
      if (isHidden(name, method, op, webhookKey(name, method, op))) {
        hiddenOperations += 1
        continue
      }
      webhooks.push(normalizeWebhook(name, method, op, pathParams, ctx))
    }
  }

  resolveLinkTargets(ctx.links, raw, [...operations, ...webhooks])

  const tags = collectTags(raw, operations, hiddenTags)
  attachLabels(tags, [...operations, ...webhooks])

  return prune({
    sourceVersion: String(raw.openapi),
    // The version the document was WRITTEN in, when it isn't the one above:
    // `swagger2.js` stamps `x-converted-from` on what it produces, and the
    // settings diagnostics show it — otherwise a 2.0 file would silently
    // report itself as 3.0.4 everywhere the app names a version.
    convertedFrom: textOrUndefined(raw['x-converted-from']),
    // 3.1: the dialect the document's schemas are written in. Recorded, never
    // acted upon: every schema is read as 2020-12 (newest-wins). A dialect that
    // says otherwise is an audit finding (`schema-dialect`), not a branch here.
    sourceDialect: typeof raw.jsonSchemaDialect === 'string' ? raw.jsonSchemaDialect : undefined,
    // 3.2 `$self`, already resolved against wherever the document was read
    // from — a relative `$self` means "next to me", and only the loader knows
    // where that is.
    baseUri: baseUri ?? undefined,
    info: normalizeInfo(raw.info),
    externalDocs: normalizeExternalDocs(raw.externalDocs),
    servers: (raw.servers ?? []).map(normalizeServer),
    tags,
    groups: buildGroups(tags, operations),
    operations,
    webhooks,
    // Absent, like every other optional key, when there is nothing to record: a
    // documentation that hides nothing has no gap to declare.
    hiddenOperations: hiddenOperations || undefined,
    securitySchemes: Object.entries(raw.components?.securitySchemes ?? {}).map(([name, s]) =>
      normalizeSecurityScheme(name, s),
    ),
    security: raw.security ?? [],
  })
}

// Who publishes this API, under what terms, and where to ask. `summary` is
// 3.1; everything else exists since 3.0 and was simply dropped until now.
function normalizeInfo(raw) {
  const info = raw && typeof raw === 'object' ? raw : {}
  const contact = info.contact && typeof info.contact === 'object' ? info.contact : null
  const license = info.license && typeof info.license === 'object' ? info.license : null
  // Newest-wins: 3.1's SPDX `identifier` and the older `url` are mutually
  // exclusive in the spec, and a document carrying both has already contradicted
  // itself — the identifier is the one a machine can act on.
  const identifier = textOrUndefined(license?.identifier)
  return prune({
    title: info.title ?? '',
    version: info.version ?? '',
    summary: info.summary,
    description: info.description,
    termsOfService: externalUrl(info.termsOfService),
    contact: contact
      ? orUndefined({
          name: textOrUndefined(contact.name),
          url: externalUrl(contact.url),
          email: textOrUndefined(contact.email),
        })
      : undefined,
    license: license
      ? orUndefined({
          name: textOrUndefined(license.name),
          identifier,
          url: identifier ? undefined : externalUrl(license.url),
        })
      : undefined,
  })
}

// External Documentation Object, at any of the four levels that declares one
// (root, tag, operation, schema). No URL, nothing to render: the description
// alone points nowhere.
function normalizeExternalDocs(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const url = externalUrl(raw.url)
  return url ? prune({ description: textOrUndefined(raw.description), url }) : undefined
}

// Outbound URLs are restricted to http(s) (rule 5): a `javascript:` or `data:`
// href in a rendered link is script execution smuggled through a description
// field. Anything else is dropped silently here.
function externalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    // Base only settles relative URLs, which an anchor would resolve against
    // the page anyway; the placeholder keeps the model pure in Node.
    const url = new URL(value, globalThis.location?.href ?? 'https://schema.invalid/')
    return url.protocol === 'http:' || url.protocol === 'https:' ? value.trim() : undefined
  } catch {
    return undefined
  }
}

function textOrUndefined(value) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

// An object whose every field was dropped is not an empty object, it is an
// absent one — the renderer would otherwise draw a heading over nothing.
function orUndefined(obj) {
  prune(obj)
  return Object.keys(obj).length ? obj : undefined
}

// Reverse index of the parent-side polymorphism idiom: the parent declares the
// `discriminator` and the subtypes point BACK at it through `allOf`, so nothing
// on the parent lists them. Only `components.schemas` is scanned — a subtype
// declared inline somewhere has no name a mapping could address anyway.
// Identity, not name: after dereference, a child's `allOf` entry IS the parent
// object.
function reverseAllOf(raw) {
  const index = new Map()
  for (const [name, schema] of Object.entries(raw.components?.schemas ?? {})) {
    for (const part of schema?.allOf ?? []) {
      if (!part || typeof part !== 'object') continue
      if (!index.has(part)) index.set(part, [])
      index.get(part).push(name)
    }
  }
  return index
}

// Tags declared first (schema order), then tags referenced by
// operations without being declared, in encounter order.
function collectTags(raw, operations, hiddenTags) {
  const seen = new Set()
  const tags = []
  for (const tag of raw.tags ?? []) {
    if (seen.has(tag.name) || hiddenTags.has(tag.name)) continue
    seen.add(tag.name)
    // summary/parent/kind: 3.2. `name` stays the identifier operations point
    // at (and the nav's group key); `summary` is the display label.
    tags.push(
      prune({
        name: tag.name,
        summary: textOrUndefined(tag.summary),
        description: tag.description,
        parent: textOrUndefined(tag.parent),
        kind: textOrUndefined(tag.kind),
        externalDocs: normalizeExternalDocs(tag.externalDocs),
      }),
    )
  }
  for (const op of operations) {
    for (const name of op.tags) {
      if (seen.has(name)) continue
      seen.add(name)
      tags.push({ name })
    }
  }
  return tags
}

// 3.2 tag `kind` (registry values: `nav`, `badge`, `audience`): only a
// navigational tag makes a nav section. The others say something ABOUT the
// operations carrying them — `badge` literally, `audience` names who an
// endpoint is for — and a section built out of one would be a heading over a
// label; they become operation labels instead (`attachLabels`). A tag that
// declares no kind, and a tag no `tags` entry declares at all, are
// navigational: that is every tag written before 3.2.
function isNavTag(tag) {
  return !tag.kind || tag.kind === 'nav'
}

// Nav sections, in schema order, each parent immediately followed by its
// children (3.2 `parent`). The list stays FLAT: every consumer but the nav
// reads it as a reading order — the pager, llms.txt, the history labels — and
// the nesting travels as `parent`, resolved here to a tag that IS in the list.
function buildGroups(tags, operations) {
  const declared = new Map(tags.map((tag) => [tag.name, tag]))
  const groups = new Map()
  for (const tag of tags) {
    if (isNavTag(tag)) {
      groups.set(
        tag.name,
        prune({
          tag: tag.name,
          summary: tag.summary,
          description: tag.description,
          externalDocs: tag.externalDocs,
          operationIds: [],
        }),
      )
    }
  }
  const untagged = []
  for (const op of operations) {
    const navTags = op.tags.filter((name) => groups.has(name))
    // An operation whose every tag is a label has no section of its own: the
    // fallback group is where it is still reachable.
    if (!navTags.length) {
      untagged.push(op.id)
      continue
    }
    for (const name of navTags) groups.get(name).operationIds.push(op.id)
  }

  // The spec requires `parent` to name an existing tag and forbids a cycle
  // between parent and child. Both are author errors with no rendering: the
  // tag takes the only other place there is, the root. A cycle ANYWHERE above
  // detaches the tag too — nesting it under an ancestor that loops would build
  // the loop in the nav.
  const parentOf = (name) => {
    const parent = declared.get(name)?.parent
    return groups.has(parent) ? parent : undefined
  }
  const cyclic = (name) => {
    // Terminates: each step adds a tag to `seen`, and there are finitely many.
    const seen = new Set([name])
    for (let above = parentOf(name); above; above = parentOf(above)) {
      if (seen.has(above)) return true
      seen.add(above)
    }
    return false
  }
  const parents = new Map()
  const children = new Map()
  const roots = []
  for (const name of groups.keys()) {
    const parent = cyclic(name) ? undefined : parentOf(name)
    if (!parent) {
      roots.push(name)
      continue
    }
    parents.set(name, parent)
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(name)
  }

  // A tag with no operation of its own is still a section when a tag below it
  // has some: dropping it would reparent its children onto nothing.
  const populated = new Set()
  for (const [name, group] of groups) {
    if (!group.operationIds.length) continue
    for (let up = name; up && !populated.has(up); up = parents.get(up)) populated.add(up)
  }

  const list = []
  const stack = [...roots].reverse()
  while (stack.length) {
    const name = stack.pop()
    if (!populated.has(name)) continue
    const group = groups.get(name)
    const parent = parents.get(name)
    if (parent) group.parent = parent
    list.push(group)
    const kids = children.get(name) ?? []
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i])
  }
  // tag: null = fallback group for operations without a tag; its label is
  // decided by the UI via i18n, not by the model.
  if (untagged.length) list.push({ tag: null, operationIds: untagged })
  return list
}

// The non-navigational tags an operation carries, hung off the operation
// itself: the doc badges them, and the doc only ever sees one operation. The
// tag objects are shared, not copied — nothing downstream writes to them.
function attachLabels(tags, operations) {
  const labels = new Map(tags.filter((tag) => !isNavTag(tag)).map((tag) => [tag.name, tag]))
  if (!labels.size) return
  for (const op of operations) {
    const own = op.tags.map((name) => labels.get(name)).filter(Boolean)
    if (own.length) op.labels = own
  }
}

// Stable id fallback for deep-linking when operationId is absent
// (docs/architecture.md §5.2): `{method}-{path-slug}` — unique because (method, path) is.
// Computed before normalization itself: hiding must be able to target
// an operation by its id without building it. Exported for the audit engine,
// which walks the raw document and must predict the very same id.
export function operationKey(path, method, op) {
  return op.operationId || `${method}-${slugify(path)}`
}

// Webhooks share the #/op/{id} route with operations: id namespace
// prefixed when operationId (unique document-wide per the spec) is absent.
export function webhookKey(name, method, op) {
  return op.operationId || `webhook-${method}-${slugify(name)}`
}

function normalizeOperation(path, method, op, pathParams, ctx, cbDepth = 0, pathServers = null) {
  const parameters = [...pathParams]
  for (const rawParam of op.parameters ?? []) {
    const param = normalizeParameter(rawParam, ctx)
    const idx = parameters.findIndex((p) => p.name === param.name && p.in === param.in)
    if (idx >= 0) parameters[idx] = param
    else parameters.push(param)
  }
  return prune({
    id: operationKey(path, method, op),
    operationId: op.operationId,
    method,
    path,
    summary: op.summary,
    description: op.description,
    deprecated: op.deprecated === true || undefined,
    externalDocs: normalizeExternalDocs(op.externalDocs),
    tags: op.tags ?? [],
    parameters,
    requestBody: op.requestBody ? normalizeRequestBody(op.requestBody, ctx) : null,
    responses: normalizeResponses(op.responses, ctx),
    // Only one level of callbacks: the spec allows nesting (and a dereferenced
    // circular $ref would make it infinite) — cut off here, rule 7.
    callbacks: cbDepth === 0 ? normalizeCallbacks(op.callbacks, ctx) : undefined,
    // null = inherits the global `security`; [] = auth explicitly disabled
    // on this operation. The distinction matters for credential injection.
    security: op.security ?? null,
    servers: op.servers?.length ? op.servers.map(normalizeServer) : pathServers,
  })
}

function normalizeWebhook(name, method, op, pathParams, ctx) {
  const webhook = normalizeOperation(name, method, op, pathParams, ctx)
  webhook.id = webhookKey(name, method, op)
  webhook.kind = 'webhook'
  webhook.name = name
  return webhook
}

// Callbacks (3.0 and 3.1): map name → { runtime URL expression → PathItem }.
// Their operations aren't routable — rendered in the parent operation's
// page. cbDepth = 1: any callbacks of their own are ignored.
function normalizeCallbacks(raw, ctx) {
  if (!raw || typeof raw !== 'object') return undefined
  const callbacks = []
  for (const [name, expressions] of Object.entries(raw)) {
    if (!expressions || typeof expressions !== 'object') continue
    const list = []
    for (const [expression, pathItem] of Object.entries(expressions)) {
      if (!pathItem || typeof pathItem !== 'object') continue
      const pathParams = (pathItem.parameters ?? []).map((p) => normalizeParameter(p, ctx))
      const operations = [...pathItemOperations(pathItem)].map(([m, op]) =>
        normalizeOperation(expression, m, op, pathParams, ctx, 1),
      )
      if (operations.length) list.push({ expression, operations })
    }
    if (list.length) callbacks.push({ name, expressions: list })
  }
  return callbacks.length ? callbacks : undefined
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeParameter(raw, ctx) {
  // Rare case: parameter described via `content` (complex serialization) rather
  // than `schema` — we take the first declared media type.
  const viaContent = raw.content ? Object.entries(raw.content)[0] : null
  const schemaRaw = raw.schema ?? viaContent?.[1]?.schema
  // Serialization resolved here, defaults included (they depend on the
  // location): neither the renderer nor the request builder re-derives them.
  const style = raw.style ?? (raw.in === 'query' || raw.in === 'cookie' ? 'form' : 'simple')
  return prune({
    name: raw.name,
    in: raw.in,
    style,
    explode: raw.explode === undefined ? style === 'form' : raw.explode === true,
    // `allowReserved`: the value already carries RFC 3986 reserved characters
    // as structure (a path in a query parameter), so percent-encoding them
    // would corrupt it. Query-only per the spec.
    allowReserved: raw.allowReserved === true || undefined,
    // `allowEmptyValue`: `?flag=` is a value in itself. Deprecated by the spec
    // and honoured all the same (rule 19) — a documented discouragement is not
    // a reason to make a declared parameter unusable.
    allowEmptyValue: raw.allowEmptyValue === true || undefined,
    // Path parameters are always required, even if the schema omits it.
    required: raw.in === 'path' ? true : raw.required === true,
    deprecated: raw.deprecated === true || undefined,
    description: raw.description,
    schema: normalizeSchema(schemaRaw, ctx),
    examples: normalizeExamples(raw, schemaRaw),
    mediaType: viaContent?.[0],
  })
}

function normalizeRequestBody(raw, ctx) {
  return prune({
    description: raw.description,
    required: raw.required === true,
    contents: normalizeContent(raw.content, ctx),
  })
}

function normalizeContent(content, ctx) {
  return Object.entries(content ?? {}).map(([mediaType, mt]) =>
    prune({
      mediaType,
      schema: normalizeSchema(mt?.schema, ctx),
      // 3.2: sequential media type (SSE, application/jsonl, multipart/mixed).
      // `itemSchema` describes ONE element of the stream, not the whole body; it can
      // coexist with `schema` or replace it.
      itemSchema: mt?.itemSchema !== undefined ? normalizeSchema(mt.itemSchema, ctx) : undefined,
      examples: normalizeExamples(mt, mt?.schema),
      ...normalizeEncodings(mt, ctx),
    }),
  )
}

// How each piece of a composite body is serialized (Encoding Object). Three
// spellings of one concept, kept apart because they address different things:
// `encoding` names a property, 3.2's `prefixEncoding` indexes a tuple position
// and `itemEncoding` covers every remaining array item.
//
//   encodings:      [{ property, contentType, headers, style, explode, allowReserved }]
//   prefixEncoding: [<same, positional, no `property`>]
//   itemEncoding:   <same>
function normalizeEncodings(mt, ctx) {
  const encoding = mt?.encoding && typeof mt.encoding === 'object' ? mt.encoding : null
  const encodings = encoding
    ? Object.entries(encoding)
        .filter(([, e]) => e && typeof e === 'object')
        .map(([property, e]) => ({ property, ...normalizeEncoding(e, ctx) }))
    : []
  const prefix = Array.isArray(mt?.prefixEncoding)
    ? mt.prefixEncoding.map((e) => normalizeEncoding(e, ctx))
    : []
  return prune({
    encodings: encodings.length ? encodings : undefined,
    prefixEncoding: prefix.length ? prefix : undefined,
    itemEncoding:
      mt?.itemEncoding && typeof mt.itemEncoding === 'object'
        ? normalizeEncoding(mt.itemEncoding, ctx)
        : undefined,
  })
}

// `style`/`explode` default exactly as a query parameter's do — an encoding
// serializes a value into a form body, which is a query string by another
// name. Resolved here so no consumer re-derives them (same discipline as
// `normalizeParameter`).
function normalizeEncoding(raw, ctx) {
  const style = raw.style ?? 'form'
  return prune({
    contentType: textOrUndefined(raw.contentType),
    style,
    explode: raw.explode === undefined ? style === 'form' : raw.explode === true,
    allowReserved: raw.allowReserved === true || undefined,
    // Per-part headers, multipart only. `Content-Type` is excluded by the
    // spec: `contentType` above is where it is said, and two places saying it
    // is one place too many.
    headers: normalizeEncodingHeaders(raw.headers, ctx),
  })
}

// A part's headers. Unlike a response header, this one has to produce a VALUE:
// what the request actually sends is the header's `example`, failing that its
// schema `default` — a Header Object declares no value of its own, and the
// alternative is a declared header that never leaves.
function normalizeEncodingHeaders(raw, ctx) {
  const headers = Object.entries(raw && typeof raw === 'object' ? raw : {})
    .filter(([name, h]) => h && typeof h === 'object' && name.toLowerCase() !== 'content-type')
    .map(([name, h]) => {
      const schema = normalizeSchema(h.schema, ctx)
      const examples = normalizeExamples(h, h.schema)
      return prune({
        name,
        description: h.description,
        required: h.required === true || undefined,
        schema,
        value: firstDefined(examples[0]?.value, schema.default),
      })
    })
  return headers.length ? headers : undefined
}

function normalizeResponses(raw, ctx) {
  // Object.entries already sorts integer keys ('200', '404') in ascending
  // order; 'default' and '4XX' follow in insertion order — an
  // acceptable display order as is.
  return Object.entries(raw ?? {}).map(([status, r]) =>
    prune({
      status,
      // 3.2: `summary` appears and `description` becomes optional — the
      // empty string remains the fallback, no consumer has to test for its absence.
      summary: r?.summary,
      description: r?.description ?? '',
      headers: Object.entries(r?.headers ?? {}).map(([name, h]) =>
        prune({
          name,
          description: h?.description,
          required: h?.required === true || undefined,
          schema: normalizeSchema(h?.schema, ctx),
        }),
      ),
      contents: normalizeContent(r?.content, ctx),
      links: normalizeLinks(r?.links, ctx),
    }),
  )
}

// Link Objects: the operations this response lets you call next, and how to
// feed them from it. The `parameters` / `requestBody` values are runtime
// expressions (`$response.body#/id`) — kept verbatim, as documentation: nothing
// evaluates them here, that is what a scenario is for.
function normalizeLinks(raw, ctx) {
  if (!raw || typeof raw !== 'object') return undefined
  const links = []
  for (const [name, link] of Object.entries(raw)) {
    if (!link || typeof link !== 'object') continue
    const parameters = Object.entries(
      link.parameters && typeof link.parameters === 'object' ? link.parameters : {},
    ).map(([key, value]) => ({ name: key, expression: expressionText(value) }))
    const entry = prune({
      name,
      description: link.description,
      operationId: textOrUndefined(link.operationId),
      operationRef: textOrUndefined(link.operationRef),
      // Filled by resolveLinkTargets, once every operation is known. `null`
      // stays in the model: "declared, points at nothing we can navigate to" is
      // information the renderer acts on.
      targetId: null,
      parameters: parameters.length ? parameters : undefined,
      requestBody: link.requestBody !== undefined ? expressionText(link.requestBody) : undefined,
      server:
        link.server && typeof link.server === 'object' ? normalizeServer(link.server) : undefined,
    })
    ctx.links?.push(entry)
    links.push(entry)
  }
  return links.length ? links : undefined
}

// A link value is a runtime expression far more often than not, but the spec
// allows any constant: rendered as one line of code either way.
function expressionText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

// `operationId` is matched against the model's own ids — `operationKey` uses
// `operationId` first, so equality is the whole test. A same-document
// `operationRef` is followed by identity: resolving its JSON pointer gives the
// very operation object the descent walked, whatever shape the pointer took
// (`additionalOperations` included). Everything else — an external document, a
// hidden operation, a typo — leaves `targetId: null`, which renders the link
// without navigation. Cross-document links are a possible evolution of the
// multi-spec registry, not something to fake from here.
function resolveLinkTargets(links, raw, operations) {
  if (!links.length) return
  const ids = new Set(operations.map((op) => op.id))
  let byObject = null
  for (const link of links) {
    if (link.operationId) {
      if (ids.has(link.operationId)) link.targetId = link.operationId
      continue
    }
    if (!link.operationRef?.startsWith('#/')) continue
    const target = pointerTarget(raw, link.operationRef)
    if (!target || typeof target !== 'object') continue
    byObject ??= indexOperationObjects(raw)
    const id = byObject.get(target)
    if (id !== undefined && ids.has(id)) link.targetId = id
  }
}

function indexPathItems(index, container, keyOf) {
  for (const [name, pathItem] of Object.entries(container ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, op] of pathItemOperations(pathItem)) {
      index.set(op, keyOf(name, method, op))
    }
  }
}

function indexOperationObjects(raw) {
  const index = new Map()
  indexPathItems(index, raw.paths, operationKey)
  indexPathItems(index, raw.webhooks, webhookKey)
  return index
}

// JSON pointer inside this document (RFC 6901). Percent-decoding first — the
// pointer travels in a URI fragment — then the `~1`/`~0` escapes, `~1` before
// `~0` as the RFC requires. Exported for the `link-target` audit rule, which
// must resolve a link exactly as this does: what the app navigates to is never
// what the audit flags.
export function pointerTarget(raw, ref) {
  let node = raw
  for (const segment of ref.slice(2).split('/')) {
    if (!node || typeof node !== 'object') return null
    let key = segment
    try {
      key = decodeURIComponent(segment)
    } catch {
      // A stray `%` is not an escape: the segment is its own literal.
    }
    node = node[unescapePointerToken(key)]
  }
  return node
}

// Unifies the example sources, by decreasing priority: named `examples`
// (media type / parameter — map in both versions), single `example`,
// then at schema level: `examples` array (3.1) and `example` (3.0).
function normalizeExamples(container, schemaRaw) {
  if (
    container?.examples &&
    typeof container.examples === 'object' &&
    !Array.isArray(container.examples)
  ) {
    return Object.entries(container.examples).map(([name, ex]) =>
      prune({
        name,
        summary: ex?.summary,
        description: ex?.description,
        // An external example is rendered as a link, so its URL goes through
        // the same http(s) gate as every other one the model exposes (rule 5);
        // one that does not pass carries no value, and no surface shows it.
        // 3.2: `value` is deprecated in favor of `dataValue` (structured
        // form) and `serializedValue` (serialized form, always a
        // string) — mutually exclusive, the order only settles
        // malformed schemas.
        value:
          exampleKind(ex) === 'external'
            ? externalUrl(ex.externalValue)
            : firstDefined(ex?.value, ex?.dataValue, ex?.serializedValue),
        // Which form it came from, because the value's JS type cannot say it
        // and rendering it wrong is not cosmetic: a `serializedValue` is text
        // to show verbatim, a `dataValue` is structured even when it happens
        // to BE a string, and an `externalValue` is a URL pointing at the
        // example rather than being it. 3.0/3.1's single `value` claims
        // nothing, and gets no kind: there the type is all anyone ever had.
        kind: exampleKind(ex),
      }),
    )
  }
  if (container?.example !== undefined) return [{ value: container.example }]
  if (schemaRaw && typeof schemaRaw === 'object') {
    if (Array.isArray(schemaRaw.examples)) return schemaRaw.examples.map((value) => ({ value }))
    if (schemaRaw.example !== undefined) return [{ value: schemaRaw.example }]
  }
  return []
}

// Same order as the `firstDefined` above, so the kind always describes the
// value that was actually picked — a malformed example declaring two forms
// must not end up labelled as the one it did not keep.
function exampleKind(ex) {
  if (ex?.value !== undefined) return undefined
  if (ex?.dataValue !== undefined) return 'data'
  if (ex?.serializedValue !== undefined) return 'serialized'
  if (ex?.externalValue !== undefined) return 'external'
  return undefined
}

function firstDefined(...values) {
  for (const value of values) if (value !== undefined) return value
  return undefined
}

function normalizeServer(raw) {
  return prune({
    // `name`: 3.2, stable identifier of a server to reference it.
    name: raw.name,
    url: raw.url,
    description: raw.description,
    variables: Object.entries(raw.variables ?? {}).map(([name, v]) =>
      prune({ name, default: v?.default, enum: v?.enum, description: v?.description }),
    ),
  })
}

function normalizeSecurityScheme(name, raw) {
  return prune({
    name, // key in securitySchemes → the `auth.{name}` environment variable
    type: raw.type, // apiKey | http | oauth2 | openIdConnect | mutualTLS (3.1)
    scheme: raw.scheme?.toLowerCase(), // for http: bearer | basic | …
    bearerFormat: raw.bearerFormat,
    in: raw.in, // for apiKey: header | query | cookie
    paramName: raw.name, // for apiKey: actual header/param name (≠ scheme key)
    description: raw.description,
    openIdConnectUrl: raw.openIdConnectUrl,
    // 3.2: a scheme can be deprecated, and declare the metadata URL of
    // its authorization server (RFC 8414).
    deprecated: raw.deprecated === true || undefined,
    oauth2MetadataUrl: raw.oauth2MetadataUrl,
    flows: raw.flows
      ? Object.entries(raw.flows).map(([key, flow]) =>
          prune({
            key, // authorizationCode | clientCredentials | implicit | password | deviceAuthorization (3.2)
            authorizationUrl: flow?.authorizationUrl,
            deviceAuthorizationUrl: flow?.deviceAuthorizationUrl,
            tokenUrl: flow?.tokenUrl,
            refreshUrl: flow?.refreshUrl,
            scopes: flow?.scopes,
          }),
        )
      : undefined,
  })
}

// ---------------------------------------------------------------------------
// Normalization of JSON schemas — the trickiest part (cycles).
// ---------------------------------------------------------------------------

export function normalizeSchema(raw, ctx = { seen: new Map(), building: new Set() }) {
  // 3.1: a schema can be a JSON Schema boolean (true = accept everything,
  // false = reject everything). Absent = unconstrained.
  if (raw === undefined || raw === null || raw === true) return { kind: 'any' }
  if (raw === false) return { kind: 'never' }

  const memo = ctx.seen.get(raw)
  if (memo) {
    // Revisiting a node still under construction = a real cycle (circular $ref
    // materialized as a JS reference by ref-parser). The target node is marked:
    // rendering will rely on it for bounded-depth lazy expansion.
    if (ctx.building.has(raw)) memo.circular = true
    return memo
  }

  // The node is registered BEFORE the descent: cycles fall back onto it and
  // the normalized graph reproduces the circularity in a controlled way, without
  // infinite recursion.
  const node = {}
  ctx.seen.set(raw, node)
  ctx.building.add(raw)
  try {
    buildSchemaNode(node, raw, ctx)
  } finally {
    ctx.building.delete(raw)
  }
  return node
}

// Fills `node` in place — the object is already referenced by the memo (and by
// any cycles that fell back onto it during the descent), so it must
// never be replaced by a new object.
// Non-standard types seen in real schemas (PHP/Java generators…):
// mapped to the closest JSON Schema type so field inference
// (boolean select, numeric coercion) works.
const TYPE_ALIASES = { bool: 'boolean', int: 'integer', float: 'number', double: 'number' }

function buildSchemaNode(node, raw, ctx) {
  // --- $defs (2020-12) -----------------------------------------------------
  // Schemas defined for local reuse. Registered like `components.schemas`, and
  // before any descent, so a definition referenced twice already carries its
  // name when the composite that displays it is built. `$defs` says nothing
  // about the described value: it is never rendered as a property.
  if (raw.$defs && typeof raw.$defs === 'object') {
    if (!ctx.componentNames) ctx.componentNames = new Map()
    const names = ctx.componentNames
    for (const [name, schema] of Object.entries(raw.$defs)) {
      if (schema && typeof schema === 'object' && !names.has(schema)) names.set(schema, name)
    }
  }

  // --- type & nullability --------------------------------------------------
  // 3.0: scalar `type` + `nullable: true`; 3.1: array `type` that can
  // contain 'null'. Unified into a main `type` + `nullable` flag.
  let types = Array.isArray(raw.type)
    ? [...raw.type]
    : typeof raw.type === 'string'
      ? [raw.type]
      : []
  types = types.map((t) => TYPE_ALIASES[t] ?? t)
  if (raw.nullable === true && !types.includes('null')) types.push('null')
  const mainTypes = types.filter((t) => t !== 'null')
  node.type = mainTypes[0] ?? inferType(raw)
  if (types.includes('null')) node.nullable = true
  // 3.1 allows several simultaneous types besides null — rare, kept for info.
  if (mainTypes.length > 1) node.types = mainTypes

  // --- composition ---------------------------------------------------------
  for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(raw[keyword]) && raw[keyword].length) {
      // allOf is deliberately not merged: rendered as composite, correct
      // merging (conflicts, nesting, cycles) is beyond the MVP's display
      // needs.
      node.composite = { keyword, variants: raw[keyword].map((s) => normalizeSchema(s, ctx)) }
      break
    }
  }

  // --- discriminator -------------------------------------------------------
  // Which variant a payload actually is, told by one of its own properties.
  // Resolved here once and for all: after dereference the mapping still holds
  // strings, and no consumer should have to re-derive what `Pet` or
  // `#/components/schemas/Pet` points at.
  const discriminator = buildDiscriminator(raw, node, ctx)
  if (discriminator) node.discriminator = discriminator

  // --- metadata ---------------------------------------------------------
  node.schemaName = ctx.componentNames?.get(raw)
  node.title = raw.title
  node.description = raw.description
  node.format = raw.format
  node.default = raw.default
  node.deprecated = raw.deprecated === true || undefined
  node.readOnly = raw.readOnly === true || undefined
  node.writeOnly = raw.writeOnly === true || undefined
  node.externalDocs = normalizeExternalDocs(raw.externalDocs)

  // 3.1: `const` ≡ single-value enum — unified into `enum`.
  // A non-array `enum` (seen in the wild: PHP FQCN as a string) is ignored — letting
  // it through would make rendering iterate the string character by character.
  if (Array.isArray(raw.enum)) node.enum = raw.enum
  else if (raw.const !== undefined) node.enum = [raw.const]

  // 3.0: `example` (single value); 3.1: `examples` (JSON Schema array).
  const examples = Array.isArray(raw.examples)
    ? raw.examples
    : raw.example !== undefined
      ? [raw.example]
      : []
  if (examples.length) node.examples = examples

  // --- numeric constraints ----------------------------------------------
  // 3.0: exclusiveMinimum/Maximum are booleans qualifying minimum and
  // maximum; 3.1: they are directly numeric bounds. Normalized to
  // the 3.1 numeric form (only one of the two min/exclusiveMin keys survives).
  let { minimum, maximum } = raw
  let exclusiveMinimum = raw.exclusiveMinimum
  let exclusiveMaximum = raw.exclusiveMaximum
  if (typeof exclusiveMinimum === 'boolean') {
    exclusiveMinimum = exclusiveMinimum ? minimum : undefined
    if (exclusiveMinimum !== undefined) minimum = undefined
  }
  if (typeof exclusiveMaximum === 'boolean') {
    exclusiveMaximum = exclusiveMaximum ? maximum : undefined
    if (exclusiveMaximum !== undefined) maximum = undefined
  }
  node.minimum = minimum
  node.maximum = maximum
  node.exclusiveMinimum = exclusiveMinimum
  node.exclusiveMaximum = exclusiveMaximum

  node.multipleOf = raw.multipleOf
  node.minLength = raw.minLength
  node.maxLength = raw.maxLength
  node.pattern = raw.pattern
  node.minItems = raw.minItems
  node.maxItems = raw.maxItems
  node.uniqueItems = raw.uniqueItems === true || undefined
  node.minProperties = raw.minProperties
  node.maxProperties = raw.maxProperties

  // --- object structure -----------------------------------------------------
  const requiredNames = Array.isArray(raw.required) ? raw.required : []
  if (raw.properties) {
    const requiredSet = new Set(requiredNames)
    node.properties = Object.entries(raw.properties).map(([name, s]) => ({
      name,
      required: requiredSet.has(name),
      schema: normalizeSchema(s, ctx),
    }))
  }
  if (requiredNames.length) node.required = requiredNames
  if (raw.additionalProperties !== undefined) {
    node.additionalProperties =
      typeof raw.additionalProperties === 'object'
        ? normalizeSchema(raw.additionalProperties, ctx)
        : raw.additionalProperties
  }

  // --- array structure ---------------------------------------------------------
  if (raw.items !== undefined) node.items = normalizeSchema(raw.items, ctx)
  // 3.1: tuples via prefixItems, no 3.0 equivalent — kept for display.
  if (Array.isArray(raw.prefixItems))
    node.tupleItems = raw.prefixItems.map((s) => normalizeSchema(s, ctx))

  // --- JSON Schema 2020-12 applicators -------------------------------------
  // Every branch goes through normalizeSchema, so it inherits the memo/cycle
  // machinery: a self-referencing `if` degrades exactly like a cyclic `items`
  // (rule 7). None of them names a place in a body, so they stay inert for the
  // try-it editor, which only walks `properties`, `items` and `tupleItems`.
  const conditional = prune({
    if: raw.if !== undefined ? normalizeSchema(raw.if, ctx) : undefined,
    // The keyword is named `then`: plain model data, never awaited, and renaming
    // it would stop the model from reading like the spec it mirrors.
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
    then: raw.then !== undefined ? normalizeSchema(raw.then, ctx) : undefined,
    else: raw.else !== undefined ? normalizeSchema(raw.else, ctx) : undefined,
  })
  if (Object.keys(conditional).length) node.conditional = conditional
  if (raw.not !== undefined) node.not = normalizeSchema(raw.not, ctx)

  if (raw.patternProperties && typeof raw.patternProperties === 'object') {
    const entries = Object.entries(raw.patternProperties).map(([pattern, s]) => ({
      pattern,
      schema: normalizeSchema(s, ctx),
    }))
    if (entries.length) node.patternProperties = entries
  }
  if (raw.propertyNames !== undefined) node.propertyNames = normalizeSchema(raw.propertyNames, ctx)
  if (raw.dependentRequired && typeof raw.dependentRequired === 'object') {
    // Plain data, no node: the values are property names, not schemas.
    const entries = Object.entries(raw.dependentRequired).filter(([, names]) =>
      Array.isArray(names),
    )
    if (entries.length) node.dependentRequired = Object.fromEntries(entries)
  }
  if (raw.dependentSchemas && typeof raw.dependentSchemas === 'object') {
    const entries = Object.entries(raw.dependentSchemas).map(([name, s]) => ({
      name,
      schema: normalizeSchema(s, ctx),
    }))
    if (entries.length) node.dependentSchemas = entries
  }
  for (const keyword of ['unevaluatedProperties', 'unevaluatedItems']) {
    if (raw[keyword] === undefined) continue
    // Same convention as `additionalProperties`: a boolean stays a boolean.
    node[keyword] =
      typeof raw[keyword] === 'object' ? normalizeSchema(raw[keyword], ctx) : raw[keyword]
  }
  if (raw.contains !== undefined) node.contains = normalizeSchema(raw.contains, ctx)
  node.minContains = raw.minContains
  node.maxContains = raw.maxContains
  node.contentEncoding = raw.contentEncoding
  node.contentMediaType = raw.contentMediaType
  node.xml = normalizeXml(raw.xml)

  node.kind = node.composite
    ? 'composite'
    : node.type === 'object'
      ? 'object'
      : node.type === 'array'
        ? 'array'
        : node.type
          ? 'primitive'
          : 'any'

  prune(node)
}

// discriminator (3.0+, `defaultMapping` in 3.2) → resolved dispatch table:
//
//   { propertyName, mapping: [{ key, schemaName, variantIndex, default }], defaultIndex }
//
// `variantIndex` indexes `node.composite.variants`; it is `null` when the key
// names something we cannot point at — an external or mistyped mapping target,
// or a subtype found by reverse index (the parent-side idiom lists no variants
// to index into). The key stays either way: it is what travels on the wire.
function buildDiscriminator(raw, node, ctx) {
  const propertyName = raw.discriminator?.propertyName
  if (typeof propertyName !== 'string' || !propertyName) return undefined

  // `allOf` is one value, not a choice: a discriminator sitting next to it
  // belongs to the parent-side idiom, resolved through the reverse index.
  const keyword = node.composite?.keyword
  const variants = keyword === 'oneOf' || keyword === 'anyOf' ? node.composite.variants : null
  const targets = variants
    ? variants.map((variant, variantIndex) => ({ schemaName: variant.schemaName, variantIndex }))
    : (ctx.allOfChildren?.get(raw) ?? []).map((schemaName) => ({ schemaName, variantIndex: null }))

  const declared = raw.discriminator.mapping
  const at = (target) => {
    const name = mappingTargetName(target)
    return name === null ? -1 : targets.findIndex((t) => t.schemaName === name)
  }

  const mapping = []
  const claimed = new Set()
  for (const [key, target] of Object.entries(
    declared && typeof declared === 'object' ? declared : {},
  )) {
    const index = at(target)
    if (index >= 0) claimed.add(index)
    mapping.push(
      prune({
        key,
        schemaName: mappingTargetName(target) ?? undefined,
        variantIndex: index >= 0 ? targets[index].variantIndex : null,
      }),
    )
  }
  // Spec: a target the mapping does not name is addressed by its own schema
  // name. Appended after the explicit keys, which the document ordered itself.
  targets.forEach((target, index) => {
    if (claimed.has(index) || target.schemaName === undefined) return
    mapping.push({
      key: target.schemaName,
      schemaName: target.schemaName,
      variantIndex: target.variantIndex,
    })
  })
  if (!mapping.length) return undefined

  // 3.2 `defaultMapping`: the target to assume when the property carries a
  // value no key covers. Marked on its entry as well, so a reader still sees
  // which one it is when there is no variant list to index.
  const fallback = at(raw.discriminator.defaultMapping)
  if (fallback >= 0) {
    const name = targets[fallback].schemaName
    for (const entry of mapping) if (entry.schemaName === name) entry.default = true
  }
  return prune({
    propertyName,
    mapping,
    defaultIndex: fallback >= 0 ? (targets[fallback].variantIndex ?? undefined) : undefined,
  })
}

// XML Object → the 3.2 spelling, which is the only one the sampler reads.
// 3.0/3.1 say `attribute: true` and `wrapped: true`; 3.2 replaced both with one
// `nodeType` (`element` | `attribute` | `text` | `cdata` | `none`), and
// newest-wins makes that the model's form. `wrapped` maps to `element` because
// on an array that is exactly what it means: the items sit inside an element of
// their own instead of repeating in place.
//
// An array whose XML object says nothing stays UNWRAPPED — 3.0's default, and
// the shape the overwhelming majority of documents were written against.
function normalizeXml(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const nodeType =
    textOrUndefined(raw.nodeType) ??
    (raw.attribute === true ? 'attribute' : raw.wrapped === true ? 'element' : undefined)
  return orUndefined({
    name: textOrUndefined(raw.name),
    namespace: textOrUndefined(raw.namespace),
    prefix: textOrUndefined(raw.prefix),
    nodeType,
  })
}

// Short name of a mapping target: `Pet`, `#/components/schemas/Pet`, or a URI
// we cannot follow — always its last pointer segment, unescaped (RFC 6901).
function mappingTargetName(target) {
  if (typeof target !== 'string' || !target) return null
  return unescapePointerToken(target.split('/').pop())
}

// The variant a discriminated composite stands for when nothing has been
// chosen: the one `defaultMapping` names, otherwise the first key that points
// at a variant. Shared by the sample generator and the try-it selector — they
// must agree, or the pre-filled body would contradict the selected variant.
export function defaultVariant(node) {
  const discriminator = node?.discriminator
  if (!discriminator) return null
  const byDefault =
    discriminator.defaultIndex === undefined
      ? undefined
      : discriminator.mapping.find((entry) => entry.variantIndex === discriminator.defaultIndex)
  const entry = byDefault ?? discriminator.mapping.find((entry) => entry.variantIndex !== null)
  return entry ? { index: entry.variantIndex, key: entry.key } : null
}

// Many real-world schemas omit `type`: it's inferred from the structure.
function inferType(raw) {
  if (
    raw.properties ||
    raw.additionalProperties !== undefined ||
    raw.required ||
    raw.minProperties !== undefined ||
    // 2020-12 applicators that only make sense on an object: nothing else
    // constrains the KEYS of a value. `if`/`then`/`else` and `not`, on the
    // other hand, say nothing about the type — a conditional schema stays `any`.
    raw.patternProperties ||
    raw.propertyNames !== undefined ||
    raw.dependentRequired ||
    raw.dependentSchemas
  ) {
    return 'object'
  }
  if (raw.items !== undefined || raw.prefixItems || raw.contains !== undefined) return 'array'
  const values = Array.isArray(raw.enum) ? raw.enum : raw.const !== undefined ? [raw.const] : []
  const sample = values.find((v) => v !== null)
  if (sample !== undefined) return Array.isArray(sample) ? 'array' : typeof sample
  return undefined
}

// Removes `undefined` keys in place: the serialized model stays compact and
// the returned object keeps its identity (essential for cyclic nodes).
function prune(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined) delete obj[key]
  return obj
}

// JSON-serializable copy of a piece of the model: cuts cycles (marker
// '↻') and bounds the depth — rule 7: no unbounded recursion, even
// for debug display. Shared nodes (DAG) are duplicated, only
// a real return to an ancestor is cut off.
export function toSerializable(value, maxDepth = 60, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return value
  if (ancestors.has(value)) return '↻ (circular)'
  if (maxDepth <= 0) return '… (max depth)'
  ancestors.add(value)
  const out = Array.isArray(value)
    ? value.map((v) => toSerializable(v, maxDepth - 1, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, toSerializable(v, maxDepth - 1, ancestors)]),
      )
  ancestors.delete(value)
  return out
}
