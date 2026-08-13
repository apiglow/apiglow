# OpenAPI coverage

This document is the **coverage contract** behind imperative rule 19
(`CLAUDE.md`): maximal OpenAPI spec support is a priority and an obligation.
An unsupported construct of a supported version is a defect, not a scope
choice — it is modeled and rendered, or it degrades with an explicit,
documented fallback where the browser platform forbids execution. When
versions conflict on a concept, the normalized model adopts the newest
version's semantics (§3.2).

Read it in this order: **§1** for what is supported, **§5.1** for the
complete list of deliberate degradations (the only list of it anywhere),
**§3** for the principles every construct obeys, **§4** for the per-area
mechanics, including the neighboring formats (Swagger 2.0, request imports,
Arazzo, Overlay).

## 1. Current coverage

Supported: **OpenAPI 3.0.x, 3.1.x, 3.2.x**, JSON and YAML, by URL and
inline alike, plus **Swagger 2.0** converted to 3.0.4 upstream of everything
(`src/openapi/swagger2.js`, §4.5). Version gate: `buildModel` in
`src/openapi/loader.js`, a regex built from the exported
`SUPPORTED_OPENAPI_VERSIONS` — the same list the About dialog advertises, so
the promise made to the reader and the check that rejects a document cannot
say different things — applied after the conversion has run, so
`unsupported-version` fires only for a `swagger` value there is no
conversion table for, or an unknown `openapi` one. All version divergence is
absorbed in `src/openapi/model.js` (rule 6); the audit engine is
version-aware (`version-legacy`, `version-construct`, §3.4).
**OpenAPI Overlay 1.1** documents declared in the config
(`openapi.overlays` / `openapi.specs[].overlays`) edit that source before
any of it runs (§4.7,
`src/openapi/overlay.js`, `docs/architecture.md` §5.1.2).

Normalized and rendered:

- **3.0 ↔ 3.1 unified**: nullability, exclusive bounds, examples, `const`
  → single-value enum, boolean schemas (`{kind:'any'}` / `{kind:'never'}`),
  `prefixItems` tuples (`node.tupleItems`), root `webhooks`, `mutualTLS`,
  circular refs (identity memo + `building` set in `normalizeSchema`,
  `circular` flag consumed by bounded lazy expansion — rule 7).
- **3.2**: `query` method, `additionalOperations`, `itemSchema`
  (SSE/JSONL/multipart), `dataValue`/`serializedValue` (kept apart from
  `externalValue` by `example.kind`, since a value's JS type cannot tell the
  three forms apart — `src/openapi/examples.js` is what every surface reads
  them through; an external example is shown as the link it is and never
  fetched, never pre-filled),
  tag `summary`/`parent`/`kind` (modeled — the flat nav renders neither
  the hierarchy nor the summary, a documented degradation, §5.1),
  server `name`, `deviceAuthorization`
  flow, `oauth2MetadataUrl`, security-scheme `deprecated`,
  `in: querystring`, response `summary`, `$self`, `prefixEncoding` /
  `itemEncoding`, XML `nodeType`.
- **JSON Schema 2020-12** keywords (§2.1, §4.1) and `$defs` naming;
  `discriminator` resolved into a dispatch table, parent-side `allOf` idiom
  included (§4.2); the whole `info` block, `externalDocs` at four levels and
  response `links` with resolved targets (§4.3); body kinds
  (`src/openapi/body-kind.js`, `docs/architecture.md` §5.5.2); `encoding`,
  `allowReserved`, `allowEmptyValue`, cookie parameters and XML samples
  (§4.4). Section numbers of the form "arch. §N" below are
  `docs/architecture.md`'s, which holds the contract for each area.
- Parameter serialization (`src/openapi/params.js`): `form`, `simple`,
  `spaceDelimited`, `pipeDelimited`, `deepObject`, `explode`,
  `allowReserved`, `allowEmptyValue`, content-based parameters (first media
  type); the Encoding Object of a composite body; callbacks (one level,
  rule 7); path-level parameter inheritance with per-operation override.

### 1.1 Support tiers

"Supported" is one of three tiers; every construct lands in the highest
tier the browser platform allows:

- **T1 — rendered**: modeled and displayed faithfully.
- **T2 — executable**: additionally drives the try-it request.
- **T3 — rendered with documented fallback**: the browser cannot execute
  it — fetch forbids the `Cookie` header, no client certificates for
  `mutualTLS`, `deviceAuthorization` needs out-of-browser polling. The
  cookie case says so in the UI (i18n'd hint, not silence) and the cURL
  export still carries the
  value (the cookie-auth path in `request-builder.js` does exactly this:
  cookies become a `Cookie` header for cURL, `hasCookies` flags the browser
  limitation); `mutualTLS` and `deviceAuthorization` render in the auth
  overview without an equivalent in-place hint. These are platform limits,
  not gaps; §5.1 carries their rationale.

## 2. Coverage by area

Each area's mechanics are in §4; each area's model contract lives in
`docs/architecture.md`.

### 2.1 JSON Schema 2020-12 keywords (3.1/3.2 documents)

All modeled and rendered (§4.1; arch. §5.1): `if` / `then` / `else`, `not`,
`patternProperties`, `propertyNames`, `dependentRequired`,
`dependentSchemas`, `unevaluatedProperties`, `unevaluatedItems`, `contains`
(+ `minContains` / `maxContains`), `contentEncoding` / `contentMediaType`,
`jsonSchemaDialect`, and `$defs`-local names (a `$defs` schema referenced
twice keeps its display name, like `components.schemas` entries do).
`jsonSchemaDialect` is recorded and deliberately not acted upon — schemas
are read as 2020-12 whatever it says (newest-wins), and saying otherwise is
what the `schema-dialect` audit rule reports. Sample generation ignores the
branch keywords on purpose (§5.1).

### 2.2 Polymorphism

`discriminator` (the base 3.0 object and 3.2's `defaultMapping` alike) is
resolved at normalization into a dispatch table, which orients variant
labeling, rendering, sample generation and the try-it body (§4.2; arch.
§5.1). The parent-side `allOf` idiom yields subtype **names** only — a
deliberate degradation (§5.1).

### 2.3 Document-level objects

Response **`links`** are modeled with resolved targets and rendered with
navigation; their runtime expressions are documentation, never evaluated
(§5.1). **`externalDocs`** is modeled and rendered at every level that
declares one (root, tag, operation, schema). The **`info`** block is
modeled in full: `summary`, `contact`, `license` (+ 3.1 SPDX `identifier`),
`termsOfService`. Details in §4.3; contract in arch. §5.1–§5.2.

### 2.4 Request-side fidelity

- **Body kinds**: a body that is a file (`format: binary`,
  `application/octet-stream`, `image/*`), a set of urlencoded fields, a
  multipart form, or free text each gets the right editor;
  `src/openapi/body-kind.js` is the single derivation (arch. §5.5.2).
- **`encoding`** on multipart/urlencoded parts (`contentType`, `headers`,
  `style` / `explode` / `allowReserved` per part) is applied; 3.2's
  positional `prefixEncoding` / `itemEncoding` are modeled and rendered
  only (§5.1).
- **`allowReserved`**, **`allowEmptyValue`** on parameters.
- **XML object** (`name` / `namespace` / `prefix` / `attribute` /
  `wrapped`, 3.2 `nodeType`), driving XML sample generation when a media
  type is XML.
- **Cookie parameters** (`in: cookie`, distinct from cookie *auth*, which
  also works): T3 by nature.

Details in §4.4; contract in arch. §5.5.3.

### 2.5 Loader

Every combination of the three axes is an accepted input:
OpenAPI 3.x or Swagger 2.0, serialized as JSON or YAML, by URL or inline
(`.yml` included, and an extension-less URL — §4.4). `$self` (3.2) sets the
document base URI: relative external `$ref`s and relative server URLs
resolve against it when present, not against the fetch URL (§4.4).

### 2.6 Swagger 2.0

Converted to a 3.0.4 document between parse and dereference
(`convertSwagger2`, §4.5; conversion table in arch. §5.1.1). What the
format does not allow to survive is marked
(`x-original-collection-format`) and reported (`conversion-approximation`),
never dropped silently.

## 3. Principles binding every construct

### 3.1 Absorption (rule 6)

Every construct is absorbed in `model.js` (or the pre-normalization
converter); no version branch in rendering, ever. Schema-position keywords
go through `normalizeSchema(s, ctx)` so they inherit the memo/cycle
machinery for free (rule 7) — a cyclic `if` or `dependentSchemas` degrades
exactly like a cyclic `items` does.

### 3.2 Newest-wins

Conflicting spellings normalize to the most recent version's form; the
older form remains accepted input forever. The converter direction is
always old → new inside `model.js` (or `swagger2.js`), never a downgrade.
Concretely: `nullable` → `type: [..., 'null']`, boolean → numeric
`exclusiveMinimum`/`exclusiveMaximum`, `example` → `examples`, `const` →
single-value enum, XML `attribute`/`wrapped` → 3.2 `nodeType`, license
`identifier` preferred over `url`, Swagger 2.0 upconverted wholesale.
Newest-wins applies to *spellings*, not to defaults that would change the
meaning of existing documents — see the XML array default in §4.4.

### 3.3 The editable-body contract

`schema-view.js` drives both display and the try-it structured editor
(`isEditableLeaf`, `MAX_EDIT_DEPTH`, `MAX_AUTO_DEPTH = 3`). Every schema
node field is inert for the editor unless explicitly wired: a schema
carrying only display-oriented keywords still renders its base shape and
stays editable. Guard: `tests/e2e/schema-keywords.spec.js` proves a
keyword-heavy schema's declared properties still build fields and the body
still sends (an e2e test because Vitest runs without a DOM here —
`src/components/` is e2e territory by design, see CONTRIBUTING).

### 3.4 Audit synchronization

`src/audit/rules/version-construct.js` flags constructs used ahead of the
declared version; `version-legacy.js` flags 3.0 spellings in 3.1+
documents (with a per-construct `since`: the XML booleans survived 3.1
untouched, so "3.0 spelling in a 3.1+ document" is not one threshold).
Their construct lists track what the model covers: a construct the app
renders must never be flagged as unknown by the audit. `not` is
deliberately absent from `version-construct` — 3.0 already carries it next
to `allOf`/`oneOf`/`anyOf`.

### 3.5 Sanitization and safety

Every rendered string from the schema (link descriptions, contact names,
license names, external URLs) follows rule 5: markdown through the
existing `markdownBlock` (DOMPurify), URLs restricted to `http(s):` (a
rejected one is dropped, and the object left empty disappears with it —
§4.3), outbound links get
`target="_blank" rel="noopener noreferrer"`. No `innerHTML` anywhere new.

### 3.6 No back-compat shims

The app has no installed base to protect (established project practice):
normalization changes replace, they don't fork. No dual reading paths, no
migration of stored data shapes.

## 4. Coverage in detail

### 4.1 Schema keywords

**Model** — `buildSchemaNode` (`src/openapi/model.js`) carries, all
optional and pruned when absent:

- `node.conditional = { if, then, else }` — each branch a normalized node,
  absent branches omitted; the wrapper omitted when none present.
- `node.not = <node>`.
- `node.patternProperties = [{ pattern: <string>, schema: <node> }]`
  (schema order preserved).
- `node.propertyNames = <node>`.
- `node.dependentRequired = { <prop>: [<names>] }` (plain data, no nodes).
- `node.dependentSchemas = [{ name, schema: <node> }]`.
- `node.unevaluatedProperties` / `node.unevaluatedItems` — boolean or
  node, same convention as `additionalProperties`.
- `node.contains = <node>`, `node.minContains`, `node.maxContains`.
- `node.contentEncoding`, `node.contentMediaType` — strings.
- `model.sourceDialect` from `jsonSchemaDialect` when present; schemas are
  *treated* as 2020-12 regardless (newest-wins); a non-default dialect
  yields a `schema-dialect` audit finding (correctness, `info`) — its own
  rule, because "declared ahead of the version" and "declared a dialect we
  read as 2020-12 anyway" are two different statements, and only the first
  is a warning.
- `$defs` naming: `raw.$defs` entries register into `ctx.componentNames`
  (identity → name) *before* the descent, exactly like `components.schemas`
  — a twice-referenced `$defs` schema then displays its name in composites.
  `$defs` itself is not rendered as a property.

`inferType` treats the applicators that can only describe an object
(`patternProperties`, `propertyNames`, `dependentRequired`,
`dependentSchemas`) or an array (`contains`) as type evidence — a typeless
`{ patternProperties: … }` renders as an object, not a scalar. Conditionals
infer nothing: a schema carrying only `if`/`then`/`else` keeps
`kind: 'any'`, and `schema-view` renders the keyword panes even on `any`
nodes.

**Rendering** (`src/components/schema-view.js`): `conditional` and `not`
render as labeled collapsible panes (i18n `schema.if` / `schema.then` /
`schema.else` / `schema.not`), subject to the same `MAX_AUTO_DEPTH` lazy
expansion as composites. `patternProperties` are extra rows in the object
property table, the pattern rendered as `code` with a "pattern" badge
(i18n `schema.patternKey`), never editable in the try-it body (no name to
type a value under). `propertyNames`, `dependentRequired`,
`dependentSchemas`, `unevaluated*`, `contains`/`min`/`maxContains`,
`contentEncoding`, `contentMediaType` join the constraint-chip row;
`dependentSchemas` panes expand like composites when complex. A root
object shows its own constraint chips — without a row of its own,
`dependentRequired` and `unevaluated*` on a body schema would be
invisible.

**Sample generation** (`src/openapi/sample.js`) deliberately ignores
`conditional`/`not`/`dependent*`/`unevaluated*` — merging branch effects
into a deterministic sample is validation work (§5.1). Two exceptions
worth their cost: an array with `contains` and no `items` samples the
`contains` schema once; `contentEncoding: base64` reuses the `byte` format
sample.

**Audit**: all §2.1 keywords flag through `version-construct` in a 3.0
document (they are 3.1+ constructs there).

**Tests**: Vitest fixture exercising every keyword above (including a
self-referencing `if` for cycle safety), snapshot via `toSerializable`;
the §3.3 guard; e2e `tests/e2e/schema-keywords.spec.js`.

### 4.2 Polymorphism

**Model** — on composite nodes (`oneOf`/`anyOf`):

```
node.discriminator = {
  propertyName,                                        // string
  mapping: [{ key, schemaName, variantIndex, default }],
  defaultIndex,                                        // from 3.2 defaultMapping, optional
}
```

Mapping resolution happens at normalization: after dereference,
`discriminator.mapping` values are still strings (`Pet`,
`#/components/schemas/Pet`, relative URI). Each resolves to a variant
index by short name or trailing pointer segment matched against
`ctx.componentNames`; an unresolvable target keeps its entry with
`variantIndex: null` (rendered as plain text, audit info finding).
Variants without an explicit mapping entry get their `schemaName` as
implicit key (spec behavior). `defaultMapping` (3.2) resolves identically
into `defaultIndex`, and additionally sets `default: true` on the mapping
entry — an index alone would drop `defaultMapping` on the parent-side
idiom, which has no variant list to index into. Mapping entries are one
shape for both idioms; a second shape would fork every consumer.

**Parent-side `allOf` idiom** (parent declares the discriminator, children
`allOf`-reference the parent, no `oneOf` — legal in 3.x, common in
converted 2.0 documents): detected by a reverse index over
`components.schemas` (children whose `allOf` contains the parent *by
identity*), and the parent lists its subtypes by **name**. It does not
synthesize variant nodes: that would close a cycle in the node graph — the
child's `allOf` already points at the parent — and `circular` would then
badge every subtype "recursive", hiding them behind an expand button
throughout a very common 3.0 shape. Expanding a subtype from its parent
would need a render-time back-reference that is not a normalized node; the
subtype list stays names-only, the §5.1 degradation.

**Consumers**: `schema-view.js` variant labels prefer the mapping key over
`schemaName`, and the discriminator property row gets a "discriminator"
badge (i18n `schema.discriminator`). `sample.js` picks
`defaultIndex ?? first mapped variant` instead of `variants[0]` and stamps
`obj[propertyName] = key` on the produced object. The try-it structured
editor has a variant selector (without it, every variant's fields would
render at once, all writing to the same body paths); switching variants
removes the previous variant's keys from the body, auto-fills the
discriminator property with the new variant's key and renders it read-only
— the property is the selector's mirror, editing it by hand can only
desynchronize.

**Audit**: `discriminator-mapping` (correctness, `info`) flags
unresolvable mapping targets. It resolves them exactly as
`buildDiscriminator` does — including through the reverse index — so a
target the app renders is never flagged.

### 4.3 Document metadata

**Links** — model, per response entry in `normalizeResponses`:

```
links: [{
  name, description,
  operationId, operationRef,           // as declared, one of the two
  targetId,                            // resolved model op id, or null
  parameters: [{ name, expression }],  // runtime expressions verbatim
  requestBody,                         // expression or literal, verbatim
  server,                              // normalized via normalizeServer
}]
```

Targets resolve in a second pass, not during the descent: a link points
forward as often as backward, and half the operations do not exist yet
while responses are being normalized. `ctx.links` collects the entries,
`resolveLinkTargets` fills their `targetId` once `operations` and
`webhooks` are both complete. An `operationRef` is followed by identity:
the pointer is resolved to its object and that object looked up in an
index built from `pathItemOperations` — which also covers 3.2's
`additionalOperations`, where the operation does not sit under its method
key at all. An external `operationRef` yields `targetId: null`, rendered
without navigation. So does an operation hidden by `openapi.hide`: the
alternative is a link at a route the router refuses. The `link-target`
audit rule does the opposite on purpose — it validates against the
*document*, because a link at a hidden operation is correct authoring. It
is a `warning` (unlike `discriminator-mapping`'s `info`): an `operationId`
is document-local by definition and an `operationRef` starting with `#/`
promises the same, so nothing legitimate is indistinguishable from a typo;
the one legitimate case, a pointer into another document, is skipped
rather than flagged.

Rendering: in the response section of `api-endpoint-doc.js`, after the
response headers table — name, description (markdown), expressions as
`code`, and when `targetId` is set a "go to operation" action navigating
`#/op/{targetId}` through the router. Runtime expressions are
**documentation**, never evaluated; evaluating one against a real response
is what a scenario does (§5.1).

**externalDocs** — `{ description, url }`, modeled at root, tag, operation
and schema-node levels; rendered in the welcome/overview block, the
operation header, the tag group nav and as a chip in `schema-view`. A
tag's external docs is the first entry of its nav list, not part of its
`<summary>`: the header is a disclosure control, and an anchor inside it
is a control inside a control — the toggle swallows the click and the axe
sweep flags it (rule 15). One gate for every outbound URL, at
normalization: `http(s)` only, so a `javascript:` URL never reaches a
renderer to be forgotten about. An object left with nothing else
(`contact: {}`, a licence whose only field was a rejected URL) is dropped
entirely rather than rendered as an empty heading.

**info** — `summary`, `termsOfService` (http(s)),
`contact { name, url, email }`, `license { name, identifier, url }`.
Newest-wins: when a license has both `identifier` (3.1 SPDX) and `url`,
the identifier is rendered and the url dropped. Rendered in the welcome
header: summary under the title, contact as `mailto:`/link, license line,
ToS link.

`llms-full.txt` and the Markdown export deliberately do not carry response
links: they export the operation surface, and links are navigation *about*
it. `externalDocs` does travel — a root-level "More:" line in
`llms-full.txt`, and the operation-level link in the Markdown mirror.

### 4.4 Request fidelity

**Encoding** — on media-type entries in `normalizeContent`:

```
encodings:      [{ property, contentType, headers: [...], style, explode, allowReserved }]
prefixEncoding: [<same shape minus property>]   // 3.2, positional
itemEncoding:   <same shape minus property>     // 3.2
```

In `src/openapi/request-builder.js`: multipart parts get their
`contentType` as the Blob type; urlencoded bodies serialize object/array
fields through the `params.js` helpers with the encoding's style/explode
instead of the defaults. A part's declared headers only exist where a
browser can express them — `FormData` sets `Content-Disposition` and
nothing else — so they travel in the built request and surface in the
**cURL export** (`;headers=`), which is what that export exists for. A
Header Object carries no value of its own, so the value that leaves is its
`example`, failing that its schema `default`. The positional
`prefixEncoding` / `itemEncoding` are modeled and listed in the doc's
Encoding block, not applied: they encode a body that is an *array*, and
`bodyKind` gives one field editor per top-level *property* — an
application would be a body-kind question (an array-shaped multipart
editor), not an encoding one (§5.1).

**Body kinds** — `src/openapi/body-kind.js` is the single derivation of
"which editor": file (binary formats, octet-stream, `image/*` and
friends), urlencoded field list, multipart form, or raw text (arch.
§5.5.2). A `format: binary` property under *urlencoded* renders as a text
field — percent-encoded file bytes are not something any server reads;
multipart keeps the file picker.

**allowReserved** — parameter + encoding flag; query serialization in
`params.js` skips percent-encoding of RFC 3986 reserved characters for
flagged values (T2).

**allowEmptyValue** — the try-it panel renders an explicit "send empty"
toggle and sends `name=` when it is set; a blank field still means "don't
send". The state carries a separate `emptyValues` list rather than a
sentinel in the value bucket, whose contract (string / list / flat map) is
shared with the share link and the scenario step. The doc column shows the
badge and deliberately has no toggle — one editable surface fewer to keep
in step (rule 20) for a flag the spec itself deprecates (the hint's
tooltip says so).

**Cookie parameters** — `in: cookie` parameters join the cookie-auth path
in `request-builder.js`: cookies fold into one `Cookie` header for the
cURL export, `hasCookies` drives the T3 hint. They are editable on both
sides of the doc↔panel mirror like any other parameter. `explode` inside a
cookie is not honored: `form` + explode is the spec's default for
`in: cookie`, but repeating the name inside a single header value reads
back as nothing — the style's delimiter joins instead (§5.1).

**XML** — schema nodes get:

```
node.xml = { name, namespace, prefix, nodeType }
```

Newest-wins normalization of the *spelling*: 3.0/3.1 `attribute: true` →
`nodeType: 'attribute'`; `wrapped: true` on arrays → `nodeType: 'element'`
on the array plus the wrapper name; 3.2's `nodeType` (`element` /
`attribute` / `text` / `cdata` / `none`) is the canonical form. An XML
array with **no** metadata stays unwrapped: 3.2 makes `element` the
default node type of everything, which would wrap arrays that 3.0 left
flat — the shape the overwhelming majority of documents were written
against. Newest-wins applies to the spelling, not to that default.

`src/openapi/sample-xml.js`: `xmlSample(schema)` — deterministic, reuses
`sample.js` values for leaves, applies the xml object's naming /
namespaces / attributes, escapes text nodes, bounded by the same depth
limits. Used by the response-example panel and the try-it body prefill for
`application/xml`, `text/xml` and `+xml`-suffixed media types. Output
rendered as text through highlight.js (`xml`), never `innerHTML` (rule 5).
The sampler is structural: a declared `example` on an object or an array
is not re-serialized into XML — a media-type example is already the body
the document wants sent, and `prefillBody` uses it verbatim (§5.1).

**Loader** (`src/openapi/loader.js`):

- Inline YAML: `loadInlineApiModel` tries `JSON.parse`; on failure it
  registers a one-shot resolver for a synthetic `inline:` URL returning
  the string and lets ref-parser's own YAML parser handle it (no new
  dependency). Malformed YAML → `malformed`.
- YAML by URL: nothing of ours chooses the parser — ref-parser picks it
  from the URL's extension (`.yaml`, `.yml`, `.json`). A spec served from
  a route rather than a file (`/v3/api-docs`, `/openapi`) matches no
  parser at all, and that is precisely the case that works: with none
  matching, ref-parser tries them all in order, JSON first, YAML second.
  The fallback is load-bearing, not incidental — without it an
  extension-less YAML document would be parsed as text and surface as
  `invalid-schema`, an error naming nothing that would explain it. Hence
  the explicit test.
- `$self` (3.2): when the parsed root carries `$self`, dereference runs
  against `new URL(doc.$self, fetchUrl)` instead of the fetch URL, and
  `model.baseUri` (resolved) feeds the shell's relative-server fallback —
  the shell keeps reading only the model, never the raw document
  (rule 10).

**Audit**: `version-construct` covers `prefixEncoding`, `itemEncoding`,
`nodeType`, `$self` (3.2-only constructs); `version-legacy` covers the two
XML booleans with their own `since` (§3.4).

**Tests**: Vitest — encoding application per body kind, allowReserved
serialization table, XML sample snapshots (attributes, namespaces, wrapped
arrays, nodeType text/cdata), inline YAML happy + malformed, `$self`
resolution; the URL path's four accepted inputs and its typed errors in
`tests/loader-remote.test.js` (§2.5); e2e
`tests/e2e/request-fidelity.spec.js`, which also carries the
cookie-parameter doc↔panel sync coverage.

### 4.5 Swagger 2.0

Pure module `src/openapi/swagger2.js`, single export
`convertSwagger2(doc)` returning a 3.0-shaped document. Wired in three
places: `loadApiModel` and `loadInlineApiModel` convert the **parsed,
`$ref`-bearing source** between parse and dereference; `buildModel`
converts too when it receives a raw 2.0 document directly (test/fixture
path; on an already dereferenced document the `$ref` rewrite is a no-op).
The conversion is in-house rather than a dependency: the off-the-shelf
converter is Node-oriented and far heavier than this subset, and the
conversion is a pure document transform the app must control.

Conversion table (complete — anything 2.0 defines and this table omits is
a defect):

- `swagger: '2.0'` → `openapi: '3.0.4'`; the original recorded in
  `x-converted-from: '2.0'`, surfaced as `model.convertedFrom` in the
  settings diagnostics block.
- `host` / `basePath` / `schemes` → `servers`: one server per **http(s)**
  scheme, `{scheme}://{host}{basePath}`; a `host` with no http(s) scheme
  → one protocol-relative server `//{host}{basePath}`; no `host` → single
  relative server
  `basePath` (the relative-server resolution then applies); nothing at all
  → no servers (existing fallback). `ws`/`wss` schemes produce no server
  of their own:
  a URL every request fails against is worse than one server fewer.
  Operation-level `schemes` become operation-level `servers` — host
  permitting: with no root `host` there is no URL to build.
- Root and per-operation `consumes` / `produces` (operation wins) →
  `requestBody.content` / response `content` maps, one entry per media
  type sharing the same schema object (sharing preserved — the identity
  memo deduplicates).
- Parameters: `in: body` → `requestBody` (parameter `name` dropped,
  `required` kept, `schema` moved as-is); `in: formData` → `requestBody`
  with `application/x-www-form-urlencoded`, or `multipart/form-data` when
  any parameter has `type: file` or consumes says so — each formData
  parameter becomes a property, `required` collected into the schema's
  `required` array; `type: file` → `{ type: 'string', format: 'binary' }`
  (in response schemas too).
- Non-body parameters: flat validation keywords (`type`, `format`,
  `items`, `enum`, `minimum`…) wrap into `schema`; `collectionFormat` →
  `csv`: `style: form, explode: false` in query/formData, and nothing at
  all in path/header — both defaults already agree there;
  `ssv` → `spaceDelimited`; `pipes` →
  `pipeDelimited`; `multi` → `form, explode: true`. `tsv` has no 3.x
  equivalent → `form` + `x-original-collection-format: 'tsv'` + audit
  finding (documented approximation) — and neither do `ssv`/`pipes`/
  `multi` in a *path or header* (3.0 reserves `spaceDelimited`/
  `pipeDelimited` for query parameters), nor a nested Items Object's own
  format: same marker, same finding.
- 2.0's `discriminator` is a *string* (the property name) → the
  discriminator object; the parent-side `allOf` idiom (§4.2) is precisely
  what these documents are full of.
- `x-nullable` — not spec, but the spelling every generator of that era
  emitted — → `nullable` (then normalized like any 3.0 document).
- `definitions` → `components.schemas`, `parameters` →
  `components.parameters`, `responses` → `components.responses`, with a
  `$ref` string rewrite (`#/definitions/` → `#/components/schemas/`,
  etc.). The rewrite is **fragment-only**: only pointers starting with
  `#/` move — `other.json#/definitions/Pet` stays untouched, because
  `other.json` was never converted and its `definitions` are still exactly
  where they were. A *body or form* parameter in the root `parameters` map
  is resolved and inlined at every use site rather than moved: 3.0 has no
  such parameter to reference, and a shared component cannot know the
  media types each operation's `consumes` decides. The rest stay
  components, sharing preserved. Symmetrically, a shared
  `components.responses` entry is converted with the **root** `produces`:
  a component has no operation to read one from.
- `securityDefinitions` → `components.securitySchemes`: `basic` →
  `{ type: 'http', scheme: 'basic' }`; `apiKey` unchanged; `oauth2` flow
  rename `implicit` / `password` / `application` / `accessCode` →
  `implicit` / `password` / `clientCredentials` / `authorizationCode`,
  `authorizationUrl` / `tokenUrl` / `scopes` carried over.
- Response `headers` (2.0 flat type) → header objects with `schema`;
  `examples` (2.0 media-type-keyed map) → per-content `example`.

**Audit**: the audit sees the converted document, and `version-legacy`
does not fire on it (its `sourceVersion` is 3.0.4, and 3.0 spellings are
correct there). The `conversion-approximation` rule (correctness, `info`)
grades every place an approximation marker could sit — parameters,
encodings, schemas — so a conversion that lost nothing scores 100 %
instead of being absent; it applies only to a document carrying
`x-converted-from`.

The "download the source as served" action still serves the 2.0 file: it
re-fetches the URL rather than reading `loaded.source` (which is the
converted document, because that is what the audit must score) — the
integrator's own file is what leaves, and the conversion is never smuggled
into it.

**Tests**: Vitest — official petstore 2.0 fixture end-to-end (convert →
normalize → snapshot), a formData/file fixture, a collectionFormat matrix,
security mapping; e2e `tests/e2e/swagger2.spec.js` against the packed
bundle.

### 4.6 Request imports

Directory `src/import/` — pure parsers, mirror of `src/export/`
(snapshot-tested, defensive: bad input → `{ errors: [codes] }`, never a
throw — same contract as `normalizeScenario`):

- `curl.js` — tokenizer reversing POSIX quoting (the inverse of
  `shellQuote` in `src/export/curl.js`), flags: `-X/--request`,
  `-H/--header` (repeatable), `-d/--data/--data-raw/--data-binary/
  --data-urlencoded`, `-F/--form`, `-u/--user` (→ basic auth), `--url`,
  bare URL; unknown flags ignored with a warning list.
- `postman.js` — collection v2.1: flatten the item tree, `request.url`
  (raw + variables), `header`, `body` modes `raw` / `urlencoded` /
  `formdata`, auth types `basic` / `bearer` / `apikey`; collection
  variables surfaced as import warnings (environments are the equivalent —
  no silent auto-creation).
- `har.js` — `log.entries[].request`: method, url, headers, postData;
  cookies dropped with a warning (T3 domain).

Common output shape (`src/import/draft.js`), one per request:
`{ method, url, headers: [{name, value}], body, bodyMode, warnings }`.

The draft stops short of the model, by rule: a parser cannot turn a URL
into path values, nor a body into a field list, because neither is
knowable without the operation. `src/import/` is format work only;
`match.js` is the one request-side module that imports from
`src/openapi/` (the scenario-side `arazzo.js` reads `body-kind.js` too —
§4.7).

Matcher `matchOperation(model, draft)` (`src/import/match.js`): strip a
known server prefix (model servers + active environment base URL), then
score operations by method equality + path-template match. Scoring counts
**literal** segments: a matching literal is evidence while a matching
parameter is not — it accepts anything. Stripping a known server prefix is
worth less than one literal but breaks an otherwise exact tie. Ambiguity →
candidates presented, never a silent guess.

Matched path/query/header values pre-fill the try-it field state. The body
goes where the **operation** says, not where the source said: a
`-d 'a=1&b=2'` against a urlencoded operation IS the field list, and
putting it in a textarea the panel does not show (rule 20: the media type
picks the editor) would leave an empty form over an invisible body.
`bodyMode` survives next to the payload because a disagreement with the
declared media type is worth a warning.

An imported credential (an `Authorization` header, `-u`) lands in the
**run scope**, not in the stored environment: the credentials form writes
`auth.X` to localStorage, and writing a secret pasted from someone else's
terminal into the reader's stored environment is not ours to do. It
becomes the same conventional `auth.X` variable in `tryIt.runVariables` —
the injection consumes it, the auth summary displays it, the history
redacts it (`sensitive`), and it dies with the tab. The avowed cost: the
credentials card keeps showing the environment's value, exactly as it does
for a step-by-step that extracts `auth.token` without persisting it. A
pre-filled request carries `authSchemeName`, so a token belonging to the
second applicable scheme does not leave under the first one's header.

Headers a browser refuses to set are not imported at all — `Host`,
`Content-Length`, `User-Agent`, a HAR's HTTP/2 pseudo-headers: keeping
them would fill the header table with rows `fetch` silently strips.
`Cookie` is the one that leaves with a warning (T3 domain; the cURL export
still carries it).

Format detection reads the content, never the extension; anything that is
not a JSON document goes to the cURL parser, which names what it could not
find (no URL) instead of a generic "unknown format". The import dialog is
built on open and emptied on close: a permanent file input and header in
the page are ambiguous selectors for the rest of the e2e suite — and a
pasted command should not lie in the DOM afterwards.

**Tests**: Vitest — quoting edge cases (nested quotes, `'\''`, multiline
continuations), repeated headers, each Postman body mode, HAR with
cookies, matcher on the petstore fixture (exact, ambiguous, no match); e2e
`tests/e2e/import.spec.js` — paste a cURL command, land in the pre-filled
try-it.

### 4.7 Workflows & overlays

**Arazzo 1.1 import** — `src/import/arazzo.js`, the return trip of the
export in `src/export/arazzo.js`. The gate takes 1.0 and 1.1 alike; the
export emits `arazzo: 1.1.0` and writes `in: querystring` parameters. Mapping onto `src/scenarios/model.js`
(`SCENARIO_FORMAT`, `normalizeScenario` contract — never throw); current
scenario-side text: `docs/scenarios.md` §2, §5.2, §6 and §8.3–8.4.

Unlike the three request parsers next to it, the importer is **not**
operation-blind: an Arazzo step *names* an operation. The operation list
comes in as data (`{ ops }`), never the model — the "format work only"
rule of §4.6 is about coupling to the model, not about knowing what a
media type is, and `body-kind.js` is the only thing this module imports
from `openapi/`.

- workflow → scenario (`workflowId` → id slug, `summary` → description);
  step → step. An unresolvable `operationId` **keeps** its step: it is a
  name a human wrote, the view badges it "operation not found", and it
  gets fixed. An unresolvable `operationPath` pointer **drops** the step —
  a JSON pointer is not an identifier anything can display.
- step `parameters` → request overrides, `in: querystring` landing on the
  model's whole-query-string value; `requestBody.payload` → body.
- workflow-level `parameters` apply to every step (a file declaring its
  auth header once must not import as a scenario where no step has it);
  a workflow's input defaults ride on the scenario as `inputs`, under the
  environment and the run scope.
- `outputs` → `extract`: `$response.body#/ptr` → `body` + pointer,
  `$response.header.X` → `header`; a Selector Object imports when its
  `type` is `jsonpointer` over the response body, is named by type
  otherwise, and a `jsonpath` selector on an output takes the first node;
  references to *prior step outputs* (`$steps.<id>.outputs.<name>`) become
  `{{var}}` references to the variables those outputs created.
- `successCriteria` → `expect`, all four Criterion types accounted for —
  three run, one waived:
  - bare status conditions (`$statusCode == 201`) and simple
    equality/existence → `status` / `exists` / `equals`;
  - a `jsonpath` criterion over `$response.body` → `matches` — the spec's
    truthiness rule, *"a non-empty nodelist"*, being `exists` with a query
    where the pointer was. It exports back as the only criterion written
    as an object with a `type` (1.1 makes `context` mandatory for it); a
    `context` naming anything else warns, by context rather than by type.
  - a `regex` criterion → a pattern applied to one pointed-at value, i.e.
    `equals` with a looser comparator: it reuses `{pointer, op, value}`
    and round-trips through `$response.body#/ptr`. Matching is unanchored,
    the value is stringified as `equals` would compare it, and the guard
    is on the subject's length rather than on the pattern — `RegExp` has
    no step limit, so the text a pathological pattern can backtrack over
    is the only lever.
  - `xpath` criteria are **waived**, not missing:
    `docs/registry/specs-registry.md`.
- `components` references resolve. `info` and
  `sourceDescriptions` are read; `$self` is deliberately not read — one
  workflow document at a time, nothing resolves against it — and not
  warned about. Workflow `successActions` / `failureActions` and step
  actions, a workflow's own `outputs` and `dependsOn`, and a step
  `dependsOn` the strictly sequential run cannot honor are **named and
  refused**, each with its warning code (`scenarios.md` §8.4). Step
  `timeout` is
  honoured through an abort path in the sender and reported as its own
  failure kind, not as a network error.
- AsyncAPI steps (`action` over a `channelPath`) are a documented
  degradation under rule 19 — no message transport in a browser — named
  rather than called malformed.
- `replacements` are reported, not applied (§5.1): a pointer-addressed
  patch list over a payload is a second body-editing language on top of
  `{{var}}`; the payload is imported as declared and the patches are named
  as missing.
- What could not be converted goes to the warning list — a count in the
  toast, the detail in the console, the same channel a config scenario's
  own issues use. No sentence is written into a step's note: a note is
  scenario *data*, and freezing the reader's UI language inside a document
  they may re-export is not conversion.

Round-trip contract: export a scenario to Arazzo, re-import it, semantic
equality (ids regenerated, everything else equal). Three things do not
survive it, by construction (§5.1): `persist`/`sensitive` on an extraction
(Arazzo has no such notion), a variable name carrying a dot (an expression
separator there) unless the export kept the original in the input's
description, and the 2xx expectation — `statusRange` already reads
"nothing" as 200–299, so `$statusCode >= 200 && $statusCode <= 299` comes
back as the default verdict, not as an explicit status. Working around
them would mean writing `x-` extensions into a document other tools have
to read.

**OpenAPI Overlay 1.1** — `src/openapi/overlay.js`,
`applyOverlay(doc, overlay)` pure (a 1.0 document is accepted and read
with the 1.1 rules — newest-wins), applied on the **parsed source, before
the 2.0 conversion and the dereference**: an overlay targets the file its
author has in front of them, which may be a 2.0 one, and everything
downstream (the audit's `source` included) then sees one document, the
overlaid one. The exception is the "download the schema" action, which
re-fetches the published file — and every hand-off built on that file says
so as soon as an overlay changed anything (`docs/architecture.md` §5.1.2).

Config: `openapi.overlays` and `openapi.specs[].overlays`, each
`[url | inline object]` — root and spec entries accumulate, root first.
The loader
resolves the overlay URLs, not the shell: the shell has no YAML parser,
and overlays are written in YAML as often as in JSON — it passes URLs
(exactly as it passes `hide` patterns) and the loader reads them with the
ref-parser it already carries. Rule 10 holds: the core reads data, never
the host config.

Actions `[{ target, update, remove, copy }]`. Target expressions are full
RFC 9535 JSONPath (a MUST in 1.1), resolved by `json-p3` — one of the
pinned spec-format runtime dependencies — so slices, unions, relational
and logical operators, existence tests and function extensions all
resolve; `overlay-target-unsupported` means "not valid RFC 9535". The
merge rules are 1.1's, stated per target kind and applied inside nested
merges too: objects merge, arrays concatenate (an array has no keys to
merge onto, and two arrays are never merged into each other — that would
mean choosing an identity for their entries), primitives replace.
`remove: true` deletes the targeted node; `copy` merges one node of the
document into each target. Per-action warnings surface in the load
diagnostics. Current model-side text: `docs/architecture.md` §5.1.2.

**Tests**: Vitest — `tests/import-arazzo.test.js` (mapping matrix,
malformed workflows, round-trip), `tests/overlay.test.js` (merge rules,
actions, RFC 9535 targets, invalid expressions); e2e
`tests/e2e/workflows.spec.js` — a config with an overlay that retitles an
operation, assert the nav shows the overlay title.

### 4.8 AI surface

Contract: `docs/architecture.md` §5.14.

- **`llms.txt` generator** (`src/export/llms.js`, pure, snapshot-tested):
  an index, and only an index — the llmstxt.org convention makes H2
  sections *link lists*, nothing else, so tag descriptions do not go in
  (`llms-full.txt` is their territory, and an index that recopies it stops
  being one). Content: title, one-line summary (`info.summary`, falling
  back to the first paragraph of the description), version line, base URL,
  then the link lists — the config's Markdown pages, the operations
  grouped by tag (untagged ones under "Other operations"), the webhooks —
  closing on `## Reference` (llms-full.txt, the OpenAPI file) and
  `## Optional` (external docs, terms, licence). Links are absolute URLs
  into the host page's hash routes, built through `router.js`: writing
  `#/op/{id}` by hand would silently drop the multi-spec prefix, which is
  decided in the router and nowhere else. The generator's only hidden
  input is that prefix, locked at boot — deterministic for a given
  install, which is what the snapshot test pins. Offered on the home page
  next to the existing downloads; both files are documented for hosts that
  serve them statically.
- **MCP-server config export** (`src/export/mcp.js` + the home-page card
  in `src/components/mcp-card.js`): the JSON wiring an off-the-shelf
  OpenAPI→MCP bridge to this document's URL — an export artifact, not a
  runtime feature (the app stays a static bundle and runs no server).
  Neither contract involved is specified anywhere: the `mcpServers`
  envelope is the de-facto client config shape, and the flags and
  environment variables belong to each bridge project — hence one table,
  `MCP_BRIDGES` (flags, docs URL, whether the bridge reads OpenAPI
  Overlays), watched by `docs/registry/specs-registry.md`, and a link to
  the bridge's own documentation next to the selector. Naming someone
  else's contract as someone else's is cheaper than pretending it is
  stable. Two bridges are offered because the choice is load-bearing: they
  differ on Overlay support, something this app produces (§4.7), and the
  mismatch is a warning, not a silence. Credentials are placeholders and
  the block is **shown**, not just downloaded — a documentation site
  should not teach people to paste unread blobs into their machine's
  config. Each scheme becomes the header it would travel in, with a
  visibly fake value; a scheme with no header form (`apiKey` in a query or
  a cookie, `mutualTLS`) is reported rather than approximated; two schemes
  claiming the same header do not both ship. No spec URL, no card: an
  inline schema exists only inside the page, so there is nothing for a
  bridge to fetch — same for an inline overlay object, which has no name
  to hand over.

**Tests**: Vitest — `llms.test.js` (index layout snapshot, summary
fallback, deprecated marking, untagged group, multi-spec prefix, empty
document), `mcp.test.js` (one snapshot per bridge, server naming, header
derivation and collision, unsupported and deprecated schemes, overlay
pass-through, missing URLs); e2e in `bootstrap.spec.js` — download
`llms.txt` and assert its links point at the host page's routes, open the
MCP card, switch bridge, download `mcp.json`, and assert the environment's
real token never appears in it.

## 5. Deliberate boundaries

### 5.1 Inside OpenAPI — the documented degradations

Rule 19 allows a construct to "degrade with an explicit, documented
fallback" and forbids the silent hole. This is the one list of those
degradations for the OpenAPI document itself — a degradation absent from
it is a defect, not a decision. (The Arazzo import's own named refusals
are enumerated in `scenarios.md` §8.4; the dependency-side waivers live in
`docs/registry/specs-registry.md`, §6.)

| Construct | What happens instead | Reference |
|---|---|---|
| `prefixEncoding` / `itemEncoding` (3.2) | modeled and listed in the doc's Encoding block, not applied: an array-shaped body has no field editor to drive. An application would be a body-kind question, not an encoding one | §4.4, arch. §5.5.3 |
| Tag `summary` / `parent` / `kind` (3.2) | modeled; the nav stays flat and labels groups by tag name — the hierarchy and the summary have no rendering surface | §1 |
| `explode` inside an `in: cookie` parameter | the style's delimiter joins instead — repeating the name inside one header value reads back as nothing | §4.4 |
| An `example` on an XML object or array | not re-serialized into XML; a declared media-type example is already the body the document wants sent, and `prefillBody` uses it verbatim | §4.4 |
| Parent-side `allOf` polymorphism | the parent lists its subtypes by **name**; no variant nodes, which would close a cycle in the node graph and badge every subtype "recursive". Expanding one would need a render-time back-reference that is not a normalized node | §4.2, arch. §5.1 |
| `if`/`then`/`else`, `not`, `dependent*`, `unevaluated*` in sample generation | rendered, but not merged into the generated sample: deciding a branch is validation work. `contains` and `contentEncoding: base64` are the two exceptions | §4.1 |
| Response `links` runtime expressions | documentation, never evaluated — evaluating one against a real response is what a scenario does | §4.3, arch. §5.2 |
| Arazzo `replacements` on a step payload | reported as missing, not applied: a pointer-addressed patch list over a payload is a second body-editing language on top of `{{var}}` | §4.7 |
| Three things in the Arazzo round trip | `persist`/`sensitive` on an extraction (Arazzo has no such notion), a variable name carrying a dot, and the 2xx expectation that comes back as the default verdict. Working around them would mean writing `x-` extensions into a document other tools must read | §4.7 |

Separately, the **T3 constructs** of §1.1 (the `Cookie` header on send,
`mutualTLS`, `deviceAuthorization`) are platform limits, not choices: the
cookie path says so in the UI and the cURL export still carries the value;
the other two render in the auth overview (§1.1).

### 5.2 Beyond OpenAPI — out of scope, deliberately

AsyncAPI, GraphQL, gRPC/Protobuf: **out of scope** — large effort, niche
for
the current audience, and rule 19 is about the OpenAPI spec, which the app
satisfies.

What this contract does **not** claim: that every OpenAPI construct is
executable in a browser (§1.1's tiers), nor that §5.1 is empty. Both are
recorded, neither is silent.

## 6. The in-house spec-code inventory

The dependency rule (architecture.md §14.2) says a library replaces
in-house code only where it does what we want done better than we do it —
never merely where it overlaps. Applied to every hand-written piece of
spec/format code, the verdicts:

| Ours | Job | Verdict | Weighed against |
|---|---|---|---|
| `src/openapi/overlay.js` (resolution) | RFC 9535 JSONPath | **replaced** | `json-p3` — bundled, weight stated in architecture §2 |
| `src/openapi/swagger2.js` | Swagger 2.0 → 3.0.4 | **keep** | `swagger2openapi` |
| `src/openapi/model.js` | OpenAPI → the normalized model | **keep** | `@scalar/openapi-parser`, `@readme/openapi-parser` |
| `src/scenarios/pointer.js` | JSON Pointer (RFC 6901) | **keep** | `json-p3` — already bundled |
| Arazzo `jsonpath` criteria | success criteria | **supported** | `json-p3` — already bundled |
| Arazzo `regex` criteria | success criteria | **supported** | nothing — `RegExp` is native |
| Arazzo `jsonpath` selectors | step output extraction | **supported** | `json-p3` — already bundled |
| Arazzo `xpath` criteria and selectors | success criteria, step outputs | **waived** | `fontoxpath` |
| `src/openapi/sample.js`, `sample-xml.js` | examples from a schema | **keep** | `openapi-sampler` |
| body validation | JSON Schema validation | **keep, by rule** | `ajv` |
| `src/{import,export}/postman.js` | Postman Collection v2.1 | **keep** | `postman-collection` |
| `src/{import,export}/{curl,har}.js` | cURL, HAR 1.2 | **keep** | nothing worth naming |
| `src/export/{llms,llms-full,mcp}.js` | llms.txt, MCP client config | **keep** | nothing published |

The verdicts whose reasoning is not obvious from the row:

- **JSON Pointer — keep, despite zero marginal weight.** `json-p3` is
  already in the bundle, the strongest possible prior for a swap. It still
  loses on two properties checked against the installed package: its
  `join()` does not escape a `/` inside a token
  (`new JSONPointer('/a').join('b/c')` yields `/a/b/c` where
  `pointerFrom(['a','b/c'])` yields `/a/b~1c`), so the encoding half — the
  one used most across the repo — is not covered; and it throws where
  `resolvePointer` returns `{found: false}`. Our pointers come from
  imported files and free-text entry, so "never throws" is the property
  that matters — adopting it would mean a `try`/`catch` at every call site
  to get back to where we already are.
- **Sample generation — keep, against a genuine candidate.**
  `openapi-sampler` is deterministic by design, the property we need. It
  loses anyway: it samples a **raw OpenAPI schema**, and rule 6 says
  nothing downstream of normalization ever sees one. Ours samples the
  normalized model, shares `sampleValue` with `sample-xml.js` so a
  `date-time` reads identically in both syntaxes, and feeds `coerce.js`
  and the doc↔panel mirror. Taking it would mean breaking rule 6 or
  rebuilding a raw schema from the model — inventing a document nobody
  wrote.
- **Arazzo `jsonpath`/`regex` — supported in-house at near-zero cost.** The
  spec's own rule made JSONPath criteria a small addition rather than a
  second assertion language — a criterion passes when the query *"returns
  a non-empty nodelist"*, which is our `exists` op generalized from a
  pointer to a query; the engine was already bundled. The new surface is
  the field it is written in: `query` beside `pointer`, never in it. For
  extraction selectors, a nodelist must become a value: first node wins —
  the rule the Overlay resolution already applies, so the app says one
  thing about nodelists rather than two. `regex` costs nothing: `RegExp`
  is native.
- **Arazzo `xpath` — waived on cost, criteria and selectors alike** (what
  the waiver refuses is the language): the browser's `document.evaluate`
  is XPath 1.0 and XML-only, so support means `fontoxpath`, ~650 kB
  unpacked against a bundle under 1 MB — for one alternative spelling of
  an assertion a scenario can already make. The need does not command the
  dependency. Recorded in `docs/registry/specs-registry.md`; re-costed if
  that weight falls.
- **`model.js` — keep, by construction.** The largest hand-written spec
  module and the least replaceable: its output *is* the app's internal
  contract (rules 6 and 20). No library produces our model, and both
  candidates pull in the Ajv validation stack the next row refuses.
- The remaining keeps are short. `swagger2openapi` is Node-oriented and
  general-purpose where ours converts to feed our model (architecture
  §14.14). `postman-collection` models a Postman *runtime* where we read
  and write one document shape. cURL has no versioned spec and HAR 1.2 is
  a frozen JSON shape — object work, nothing to be conformant to.
  llms.txt declares no version scheme, and the MCP export's contracts are
  two bridge projects' flag vocabularies, neither versioned. Ajv stays
  out because body validation is minimal on purpose (architecture §14.2):
  the library would answer a question the product chose not to ask.

Most verdicts are grounded in our own rules and move only by decision.
Three are grounded in a measurable property of a candidate library and can
go stale silently when it publishes:

| Row | Reopens when its candidate |
|---|---|
| JSON Pointer | escapes `/` inside a `join()` token, or resolves a miss without throwing |
| Sample generation | can sample anything but a raw OpenAPI schema |
| Arazzo `xpath` | falls far enough in weight to be worth the scope |

Those conditions live here; the versions each candidate was judged against
are state and live in `docs/registry/specs-registry.md` — deliberately not
repeated here, because a copy of a version pin is a copy that goes wrong.

One finding that is not a dependency question: the RFC 6901 escape is
hand-rolled at several sites across `src/scenarios/`, `src/audit/`,
`src/import/` and `src/openapi/`, recorded in the Duplication row of
`docs/registry/code-health-registry.md`.
