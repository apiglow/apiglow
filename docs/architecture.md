# Architecture & functional contract

This document is the functional source of truth for the project, together
with [`scenarios.md`](scenarios.md) (the scenarios feature) and
[`multi-spec.md`](multi-spec.md) (several schemas in one installation).
Design rationale: §14.

## 1. What this is

A 100 % front-end, serverless application that generates interactive,
testable API documentation from an OpenAPI schema, at runtime, in the
browser. The target level of finish is a 3-column reference layout:
navigation generated from tags/paths, a documentation body (description +
parameter tables), and a "Try it" panel on the right
(credentials/environment selector, request editor, per-status response
example switcher).

Differentiators vs Swagger UI/Redoc: environments with variables, local
request history, multi-format export, integrated Markdown pages, executable
scenarios, deep linking, i18n.

**Nothing the reader does leaves the browser.** History, environments,
scenarios, drafts and metrics live in that reader's own storage; the only
requests the app makes are the ones it was told to make — the schema, the
docs pages, the API calls a reader sends themselves, and, when the host
declares a `feedback.url`, the yes/no verdict a reader explicitly clicks on
a docs page (a page slug and a verdict, nothing else — §5.8). There is no
analytics channel and no account, which is a product decision before it is a
technical one: it also fixes the ceiling of what any usage figure here can
honestly mean (§5.6).

The app is embeddable on any static HTTP(S) hosting. **`file://` is NOT
supported** (browsers block ES modules and `fetch` there) — any static dev
server is enough.

What it does:

1. Read a JSON configuration declared in the host HTML page.
2. Fetch and parse an OpenAPI 3.0.x / 3.1.x / 3.2.x schema — or a Swagger 2.0
   one, converted at load — from the configured URL (or read it inline from
   the config).
3. Build the entire interface at runtime in the browser (no static
   generation step).
4. Actually test endpoints (real `fetch` requests, best-effort CORS
   handling + optional proxy).
5. Store history, environments and preferences locally.
6. Export a tested request in several formats.
7. Display static Markdown documentation pages listed in the config.

## 2. Technical stack (locked)

- **Vanilla JS in native ES modules**, zero JS framework, zero
  state-management library.
- **Native Web Components in light DOM** (`customElements.define`, **no
  Shadow DOM** — incompatible in practice with the global Tailwind/daisyUI
  CSS; see §14.1). Scoping by class/prefix
  convention.
- **Tailwind CSS 4 + daisyUI 5**, versions pinned in `package.json`.
- **Bundler: Vite** — dev server for development (readable, unbundled ESM
  sources), library-mode build for distribution. Output: `dist/app.js`
  (minified ESM) + `dist/app.css` + `dist/i18n/*.json` + `dist/fonts/`,
  plus — from a second pass that shares nothing with the first — the
  author-side `dist/bake.js` CLI (§3, [seo.md](seo.md) §4).
- **Runtime dependencies** — short by design, open only for spec/format
  work. An addition must do **spec or format work** *and* correspond to a
  job we actually want done in full, then be justified in this list with its
  weight (the full admission rule and its reasons: §14.2):
  - `@apidevtools/json-schema-ref-parser` — `$ref` resolution (internal,
    external HTTP, circular) + YAML parsing;
  - `marked` — Markdown rendering;
  - `dompurify` — HTML sanitization (**mandatory**, see §8);
  - `highlight.js` — syntax highlighting, slim build (json, bash, http, xml,
    javascript, python, php, go, ruby, java, csharp — the languages the
    snippet generators emit, plus the ones an API doc writes in fences);
  - `json-p3` — RFC 9535 JSONPath, which Overlay 1.1 makes a MUST for an
    action's `target`. Weight on `dist/app.js`: +14 kB gzipped, +63 kB raw.

  Every package here ships to every reader, so any addition is justified in
  this list with its role and its weight.
- **No backend provided.** Optional config-side CORS proxy: see §5.5.

## 3. Distribution: CDN install

Target install mode: an HTML page containing the inline config + **a single
`<script type="module">`** pointing at the bundle published on an npm CDN
(jsDelivr/unpkg).

```html
<!doctype html>
<html>
  <head><title>My API docs</title></head>
  <body>
    <script id="api-doc-config" type="application/json">
    {
      "openapi": { "url": "https://example.com/openapi.json" },
      "theme": { "default": "system", "available": ["apiglow", "apiglow-dark", "corporate"] },
      "language": { "default": "browser", "available": ["en", "fr"] },
      "environments": [],
      "docsPages": [],
      "tryIt": { "proxyUrl": null, "requestCredentials": "same-origin" },
      "history": { "maxEntries": 500, "maxAgeDays": 30 }
    }
    </script>
    <script src="https://cdn.jsdelivr.net/npm/<package>@<version>/dist/app.js" type="module"></script>
  </body>
</html>
```

Hard requirements behind this install mode:

- `app.js` **self-initializes** on load: it reads the
  `<script id="api-doc-config" type="application/json">`, falling back to
  `window.API_DOC_CONFIG`. No manual init step.
- `app.js` **injects its own** `<link rel="stylesheet">` for `app.css`,
  resolved via `new URL('./app.css', import.meta.url)`. **Never
  `document.currentScript`** (it is `null` inside an ES module). Same
  mechanism for lazy-loaded i18n files. See
  §14.9.
- The bundle is a **single file** (`codeSplitting: false`, `undici`
  externalized) — a one-script install cannot chase dynamic chunks. See
  §14.8.
- The repo stays readable in dev: separate ESM sources, Vite dev server, no
  bundling needed to develop.
- Distribution is validated by `npm pack` + a local static server simulating
  jsDelivr, consumed by `demo/cdn-install.html` (`npm run preview:cdn`); the
  e2e suite runs against that simulation.
- An install that wants to be **found** adds nothing to that page: the
  `apiglow bake` CLI shipped in the same package (`bin` → `dist/bake.js`,
  built from `scripts/bake.mjs`) writes the documentation to disk as static
  files the author deposits next to the host page. Author-side, never part
  of the reader's install — see [seo.md](seo.md) and §14.18.
- The demo needs no backend either: the petstore schema declares a
  same-origin server (`/demo-api/v3`) answered in the browser by
  `demo/mock-sw.js`, a service worker holding its state in memory. The
  worker is scoped to that path prefix and never sees the app's own assets.
  The same worker serves the demo's OAuth authorization server under
  `/demo-api/oauth/` — consent page included: a top-level navigation is an
  in-scope request like any other, so even the consent step needs no
  backend.

## 4. Configuration

Config keys (all optional except one of `openapi.url` / `openapi.spec`):

| Key | Description |
|---|---|
| `openapi.url` | URL of the OpenAPI schema (JSON or YAML). |
| `openapi.spec` | The schema itself (object or JSON string) instead of a URL: self-sufficient host page, no request, no CORS. Also usable on a `openapi.specs[]` entry in place of its `url`. `spec` wins over `url`. |
| `openapi.specs[]` | Several schemas in one installation — see [multi-spec.md](multi-spec.md). |
| `openapi.hide` | Patterns hiding operations from the documentation (see §5.2). |
| `openapi.overlays[]` | OpenAPI Overlay 1.1 documents applied to the schema at load — URL (JSON or YAML) or inline object (see §5.1.2). |
| `openapi.userOverlay` | Starting patch seeded into the reader's own overlay slot when their browser holds none yet — document or URL, overridable per spec by replacement (§5.1.2, [user-overlay.md](user-overlay.md) decision 11). |
| `theme.default` / `theme.available` | Initial theme + list offered in the selector. `'system'` as default follows the OS scheme within the first light/dark pair of `available` (§5.9). |
| `theme.custom[]` | Host-defined daisyUI themes, generated at boot with no rebuild: `{ name, extends?, colorScheme?, tokens }` — see §5.9 and [custom-themes.md](custom-themes.md). Root-only. |
| `language.default` / `language.available` | Same pattern for the UI language. `'browser'` as default — the built-in one — follows `navigator.languages` within `available`, matching on the primary subtag (`fr-CA` → `fr`); the selector offers it back as "Automatic" (§14.7). |
| `environments[]` | Default environments: `{ name, baseUrl, color, variables: { key: { value, sensitive } }, defaultHeaders }`. |
| `environmentsLocked` | `true` freezes the declared environments: no CRUD entry point in the UI, only the selector remains. |
| `docsPages` | Prose documentation, ordered array **or** a string URL pointing at a JSON manifest `{ "pages": [ … ] }` whose relative `url`s resolve against itself. Three entry kinds: a page `{ slug, url \| content \| contentId, format?, title?, home? }`, a group `{ group, id?, collapsed?, pages[] }` (one level), an external link `{ href, title? }`. A top-level entry of any kind may declare `nav: 'top' \| 'bottom'` (default `top`) to sit above or below the API reference. A page's body is a file (`url`), the text itself (`content`) or the `id` of an element of the host page holding it (`contentId`, typically a `<script type="text/markdown">`) — what the page carries wins over what it would fetch, as `openapi.spec` wins over `openapi.url`. `title` (all kinds) and the three body fields (pages) also accept a per-language map. `home: true` on at most one page makes it the landing view. Array order is nav order. Full contract: [docs-pages.md](docs-pages.md). |
| `scenarios[]` | Scenarios shipped with the docs — see [scenarios.md](scenarios.md). |
| `features` | Feature switches: `scenarios` / `audit` / `ci` (on by default, `false` removes the feature entirely — `ci` being the "Automate this scenario" panel of `docs/scenario-handoff.md` §4, and that panel alone: what a declared scenario publishes never depends on it), `onboarding` (off by default, `true` adds the generated "First call" page — §5.5.7). |
| `branding` | `{ productName, logoUrl, footerLinks[] }` — `footerLinks` = `{ label, url }` entries added to the footer bar (§5.13). |
| `feedback.url` | Endpoint receiving the docs-page "Was this page helpful?" verdict (`POST { page, verdict }`). `null` by default: without it no feedback row renders and nothing ever leaves the browser (§5.8, [docs-pages.md](docs-pages.md)). |
| `tryIt.proxyUrl` | Optional CORS proxy template, e.g. `"https://my-proxy.example.com/?url={{target}}"`. `null` by default. |
| `tryIt.requestCredentials` | `credentials` mode of try-it requests (`"omit"` / `"same-origin"` / `"include"`). `"same-origin"` by default. `"include"` is required for session-cookie auth when the docs are not hosted on the API's origin (the server must then respond `Access-Control-Allow-Credentials: true` with an explicit origin, and the cookie must be `SameSite=None; Secure`). |
| `oauth` | Per-scheme default `clientId` for the OAuth2 flows the try-it can run. Never a secret. |
| `history.maxEntries` / `history.maxAgeDays` | History retention (defaults: 500 / 30). Root-only — see §14.5. |
| `seo.index` | `false` injects `<meta name="robots" content="noindex">` before the first paint, for an installation that is publicly reachable but not meant to be found. A crawler hint, never a protection. Root-only (one served URL for every spec) — see [seo.md §2](seo.md). |

[`config.example.js`](../config.example.js) is the annotated, user-facing
reference for every key. In multi-spec, almost every key can be overridden
per spec — the merge rules live in [multi-spec.md §2](multi-spec.md).

## 5. Functional contract

### 5.1 OpenAPI loading and parsing

- Supports **OpenAPI 3.0.x, 3.1.x and 3.2.x**, JSON and YAML, plus
  **Swagger 2.0** by conversion (§5.1.1).
- The schema comes from a **URL** (`openapi.url`) or is **carried by the
  page** (`openapi.spec`: object, JSON string or **YAML string** — the
  inline loader tries `JSON.parse` first, then hands the text to ref-parser's
  own YAML parser through a one-shot resolver on a synthetic `inline:` URL, so
  no dependency is added). Same pipeline either way, inline simply skips the
  network step. The home page offers the **source as served** for download
  (the API editor's own file, YAML included, external `$ref`s unresolved;
  indented JSON for an inline schema): the schema is public by construction,
  the browser already has it. When something stands between that file and what
  the page shows — an overlay, a hidden operation — the download says so
  (§5.1.2).
- **`$self` (3.2)** names the URI the document claims as its own. When it is
  there, it — and not the URL the file happened to be fetched from — is the
  base for relative external `$ref`s and for relative server URLs. The loader
  resolves it and exposes it as `model.baseUri`; the shell reads only the
  model (rule 10).
- `$ref` resolution via `@apidevtools/json-schema-ref-parser`: internal,
  external HTTP, and circular refs. Documents whose references are all
  internal `#/…` pointers — the overwhelming case — take a single-pass
  in-house dereference (`src/openapi/deref.js`) instead of the library's
  crawler, several times faster on a heavy schema; anything past that shape
  (external or `file:` refs, a pointer through a ref, a pure ref cycle)
  bails out and the library remains the reference implementation. The fast
  pass's output is pinned deep-equal to ref-parser's by unit test, shared
  target identity and circular references included (§14.20).
- The raw `source` the audit and the overlay dry run read is a **lazy
  getter**: for a JSON document the loader dereferences in place and rebuilds
  the pristine document from the fetched text on first access, so a session
  that never opens either pays no clone of the schema at boot. YAML keeps the
  eager clone (its re-parse is not synchronous), and the rebuild replays the
  same overlay documents the boot applied — never a re-read of storage.
- **Mandatory normalization into a single internal model**
  (`src/openapi/model.js`): the rendering NEVER consumes the raw schema. All
  version differences are absorbed there (`nullable: true` vs
  `type: ["x","null"]`, boolean vs numeric `exclusiveMinimum`, `example` vs
  `examples` vs `dataValue`/`serializedValue`, 3.2's `additionalOperations`
  and `query` method, `in: querystring`, `itemSchema` of sequential media
  types, etc.). No `if (isV31)` branch exists outside normalization. See
  §14.3.
- **JSON Schema 2020-12 keywords** are modeled and rendered:
  `if`/`then`/`else` (one `conditional` branch object), `not`,
  `patternProperties`, `propertyNames`, `dependentRequired`,
  `dependentSchemas`, `unevaluatedProperties`/`unevaluatedItems`,
  `contains` (+ `minContains`/`maxContains`), `contentEncoding`/
  `contentMediaType`. `$defs` entries are named like `components.schemas`
  ones, so a definition referenced twice keeps a name to display. Every
  branch goes through the same normalization as `items`, cycles included.
  `jsonSchemaDialect` is recorded (`model.sourceDialect`) but never acted
  upon: schemas are always read as 2020-12 (newest-wins), and a dialect that
  says otherwise is an audit finding (`schema-dialect`).
  Coverage contract: [openapi-coverage.md](openapi-coverage.md) — its §5.1
  is the one list of what is rendered but deliberately not executed.
- **`discriminator`** is resolved at normalization into a dispatch table
  (`{ propertyName, mapping: [{ key, schemaName, variantIndex }], defaultIndex }`):
  mapping targets (short name, JSON pointer, URI) become variant indices,
  variants the mapping does not name get their own schema name as implicit
  key, and 3.2's `defaultMapping` picks the fallback. The parent-side idiom —
  the parent declares the discriminator, the subtypes point back at it through
  `allOf` — is covered by a reverse index over `components.schemas`, which
  yields the subtype **names** (no variant nodes: that would close a cycle in
  the node graph, see openapi-coverage.md). A key that resolves to nothing is
  kept and displayed as written, with an audit finding
  (`discriminator-mapping`).
- **Document metadata** is modeled in full: the whole `info` block
  (`summary`, `contact`, `license` with its 3.1 SPDX `identifier`,
  `termsOfService`), `externalDocs` at each of the four levels that declares
  one (root, tag, operation, schema node), and response **`links`**. Every
  outbound URL is restricted to `http(s)` at normalization (rule 5): a
  `javascript:` or `data:` one is dropped, and the object that held nothing
  else disappears with it. Newest-wins on the licence: an `identifier` and a
  `url` are exclusive, the identifier survives.
- **Response links** resolve their target once, after every operation is
  built (a link points forward as often as backward):
  `{ name, description, operationId | operationRef, targetId, parameters,
  requestBody, server }`. `operationId` is matched against the model's own
  ids; a same-document `operationRef` is followed by JSON pointer (percent-
  and `~0`/`~1`-decoded) and identified by object identity, so a fallback
  route id (`delete-pets-petid`) resolves like an explicit one. Anything else
  — another document, a hidden operation, a typo — leaves `targetId: null`:
  the link renders without navigation, showing what the schema declared. The
  runtime expressions are **documentation, never evaluated** — that is what a
  scenario does. A dangling target is an audit finding (`link-target`).
- **XML**: a schema node carries `xml = { name, namespace, prefix, nodeType }`,
  normalized to 3.2's spelling — 3.0/3.1's `attribute: true` becomes
  `nodeType: 'attribute'` and `wrapped: true` becomes `nodeType: 'element'`
  (rule 6: the sampler knows only one form). One contract worth stating,
  because the spec alone does not decide it: **an array whose XML object says
  nothing is unwrapped**, which is 3.0's default and the shape most documents
  were written against. `src/openapi/sample-xml.js` turns a node into a
  document — pure, deterministic, bounded by the same depth budgets as
  `sample.js`, whose values it borrows for every scalar leaf. It drives the
  try-it body prefill and the response example whenever the media type is
  `application/xml`, `text/xml` or `+xml`-suffixed. A declared example on an
  object is *not* re-serialized into XML: a media-type example is already the
  body the document wants sent, and it is used verbatim. The same predicate
  gates the **XML chips in the schema tree** (`schemaTree`'s `xml` option):
  `<book>`, "wrapped", "attribute" describe a document, and the JSON and XML
  variants of a body usually share one schema — under `application/json` they
  would describe a body nobody sends and make the media type selector look
  inert.
- **Cycles**: ref-parser materializes circular refs as circular JS
  references. The internal model marks cyclic nodes; rendering does **lazy
  expansion with a max depth** (default 3, "expand" button beyond). No
  unbounded recursion, anywhere.
- Webhooks (`webhooks` key) and callbacks are normalized and rendered;
  webhooks get a "simulator" panel (real send of the example payload to a
  receiver URL) instead of the try-it. It injects no credentials — the call
  targets the user's receiver, not the API — but it does resolve the selected
  environment's `{{variables}}` in the URL, the headers and the payload, and an
  unresolved one blocks the send like anywhere else (rule 11). It reuses
  `tryIt.proxyUrl` and, for a
  receiver that allows no origin at all, offers a **fire-and-forget** toggle
  (`mode: 'no-cors'`): the event is delivered, the response is opaque, and the
  non-CORS-safelisted headers are named as dropped before the send
  (`src/openapi/no-cors.js`).
- Explicit, distinct loading/error states: CORS, 404, malformed content,
  invalid schema.

#### 5.1.1 Swagger 2.0 (conversion, not a second pipeline)

A document declaring `swagger: '2.0'` is converted to a **3.0.4 document
before anything else reads it** (`src/openapi/swagger2.js`,
§14.14) — between parse and
dereference, because the converter also rewrites the pointers the moved
components changed. Nothing downstream knows 2.0 exists: a 2.0-shaped
construct reaching the model, a renderer or an export is a converter bug.

The conversion table, in full:

| 2.0 | 3.0.4 |
|---|---|
| `swagger: '2.0'` | `openapi: '3.0.4'` + `x-converted-from: '2.0'` → `model.convertedFrom`, shown in the settings diagnostics |
| `host` / `basePath` / `schemes` | one `servers` entry per **http(s)** scheme (`ws`/`wss` produce none — nothing here can send to them); no scheme → protocol-relative `//host/base`; no host → the `basePath` alone; nothing → no server, existing fallback applies |
| `consumes` / `produces` (root, operation wins) | `requestBody.content` / response `content` maps — one entry per media type, **all sharing the same schema object** so normalization's identity memo keeps one node |
| `in: body` parameter | `requestBody` (the parameter's `name` is dropped, it was never sent). No `consumes` at all → `application/json` |
| `in: formData` parameters | one form body: `multipart/form-data` when `consumes` says so or a `type: file` field is present, else `application/x-www-form-urlencoded`. Each field is a property, `required` collected into the schema, `type: file` → `{ type: 'string', format: 'binary' }` |
| other parameters | flat validation keywords lifted into `schema`; `collectionFormat` → `style`/`explode` (see below) |
| `definitions` / `parameters` / `responses` | `components.schemas` / `.parameters` / `.responses`, with a document-wide rewrite of **fragment-only** `$ref`s. A pointer into another document is left alone: that document was not converted |
| `securityDefinitions` | `components.securitySchemes`: `basic` → `{ type: 'http', scheme: 'basic' }`, `apiKey` unchanged, `oauth2` flows renamed `application` → `clientCredentials` and `accessCode` → `authorizationCode` |
| response `headers` (flat type) | header objects with a `schema` |
| response `examples` (media-type map) | per-content `example`; an example for a media type `produces` never mentioned still gets its entry |
| operation `schemes` | operation-level `servers` |
| schema `discriminator: 'petType'` | `discriminator: { propertyName: 'petType' }` — the shape the polymorphism support reads, and the parent-side `allOf` idiom these documents always used |
| schema `x-nullable: true` | `nullable: true` (newest-wins on the spelling, like everything else here) |
| `type: file` in a schema | `{ type: 'string', format: 'binary' }` |

`collectionFormat` (arrays only): `csv` → `form` + `explode: false` in a
query — it has to be said out loud, 3.0's default there is the exploded form —
and nothing in a path/header, where both defaults already agree; `multi` →
`form` + `explode: true`; `ssv` → `spaceDelimited`; `pipes` →
`pipeDelimited`.

Three cases have **no 3.0 spelling at all**: `tsv` anywhere, and
`ssv`/`pipes`/`multi` outside a query parameter (3.0 reserves the delimited
styles for the query), plus a nested Items Object's own format (3.0 serializes
a parameter with one style, for every level at once). The value falls back on
the comma and the converter records the original in
`x-original-collection-format`, which the `conversion-approximation` audit rule
reports as an `info` finding — the documented-fallback tier of rule 19,
applied to a format question instead of a browser one.

Two things a converted document cannot carry over, both recorded rather than
silent: a root `parameters` entry that is a body or a form field is **not** a
`components.parameters` entry (3.0 has none, and the media types it needs come
from each operation's `consumes`) — it is resolved and inlined at every use
site, the one place the converter follows a pointer itself; and a shared
`components.responses` entry is converted with the **root** `produces`, the
only one a component can see.

#### 5.1.2 Overlays (OpenAPI Overlay 1.1)

`openapi.overlays[]` declares documents that **edit the schema before anything
reads it** (`src/openapi/overlay.js`, pure). Each entry is a URL — fetched
through the same ref-parser that reads the schema, so JSON and YAML alike — or
the overlay object itself, carried by the host page. The shell only passes them
down the `options` channel (rule 10); the loader resolves and applies them.

Where in the pipeline, and why: on the **parsed source, before the 2.0
conversion**. An overlay is written against the file its author has in front of
them, which may well be a 2.0 one; and everything downstream — the audit's
`source` included — then sees a single document, the overlaid one, which is
also the one the app renders. The one thing that does not read it is the
"download the schema" action: it re-fetches the published file, as served
(`specSourceDownload`, `src/shell/views.js` — YAML stays YAML), so what a
reader hands to someone else is the API's own document and never a locally
edited copy of it.

**And it is said out loud.** That exception opens a gap between the page and
the files it hands out, and a hand-off that stays quiet about it lets a reader
import into Postman, or wire an agent to, an API that is not the one they just
read. So every surface offering the published document names the gap, in its
own terms and without waiting to be asked — the note sits next to the button,
never inside the collapsed "what is this file?" explanation:

- the home page download (`specDownloadNotes`, `src/shell/views.js`): "what you
  read here is this file plus *n* overlay(s)";
- the audit page's copy of the same button: the grade above it was computed on
  the patched document, the file below it is the published one;
- `llms.txt`: the Reference link is qualified in the generated text, since the
  agent following it fetches the file and not the document the rest of the
  index describes;
- the MCP card: an overlay with no URL — inline in the host page, or the
  reader's own patch — cannot be handed to a bridge whatever that bridge
  supports, and that is a warning of its own, distinct from the bridge that
  cannot read overlays at all.

The trigger is **applied actions**, not declared overlays: overlays whose
targets matched nothing left the document identical to the file, and there is
no gap to announce. The wording changes when the user's own overlay is among
them, because there the reader owns the difference and their patch has its own
download ([`user-overlay.md`](user-overlay.md) decisions 8 and 10).

Overlays are not the only thing standing between the page and the file:
**hiding** (§5.2) removes operations the published document still declares, and
each surface above carries that statement too — a separate line, because the
two gaps run in opposite directions and reading them as one story would be
wrong in both.

Order is declaration order: the root's overlays first, then the active spec's
own (`openapi.specs[].overlays`, same accumulation rule as `hide`) — a spec's
overlay edits what the root's already produced.

A **third source** is the user's own overlay
([`user-overlay.md`](user-overlay.md)): one Overlay 1.1 document per spec,
authored in the settings panel, stored in localStorage, applied **after**
everything the host declared — the host is who published the defect, so the
user's fix outranks their declarations. It comes from storage, not from
`options`: it is user data, and the shell never carries it (rule 10). It is
also the one overlay the reader can act on, which is why nothing about it is
silent: a permanent header badge while it is applied, and the diagnostics block
naming which of the listed overlays is theirs.

That third slot has a second way in: `openapi.userOverlay` (a document or a
URL, JSON or YAML, overridable per spec by **replacement**) is the starting
patch an installation hands a browser that has none yet. It is written into the
reader's own slot rather than applied over their head — the difference from
`overlays[]`, which the host owns for good — and from the first save it is
theirs. Which of the two it currently is decides the wording everywhere the
document is named: "yours" only once the reader has actually edited it
([`user-overlay.md`](user-overlay.md) decision 11).

A 1.0 document is accepted and read with the 1.1 rules below — newest-wins
(rule 19) decides which semantics we apply, not which files we take.

Actions are `{ target, update }`, `{ target, copy }` or `{ target, remove: true }`.
`target` is a **full RFC 9535 JSONPath**, which 1.1 makes a MUST — slices,
unions, relational and logical filter operators, existence tests and the
function extensions included, not only the children/index/wildcard/descent/
equality subset the Overlay spec's own examples use. The conformance is
`json-p3`'s, not ours (§14.2); what
stays ours is turning each matched node's location into the place to edit, and
the rule 7 bounds. Those are worth stating precisely, because delegating the
traversal changed what can be bounded: the engine caps how **deep** a `$..`
descent may nest, and we cap how many **matches** an action may act on — but
nothing caps the number of nodes a descent *visits*. A filtered descent that matches nothing therefore walks the
whole document; that document is one we have already parsed and hold in
memory, so the walk is finite. `remove` deletes the node from its parent.

`update` follows 1.1's merge rules, stated per target kind: an **object**
merges recursively; an **array** concatenates with an array update and appends
anything else; a **primitive** is replaced by a primitive update. Inside a
merge, a key present on both sides follows the same rules — and an array there
concatenates, 1.1's answer to a question 1.0 left open. The two
crossings the spec calls incompatible (object told to merge with a primitive,
and the reverse) change nothing and are named in a warning.

`copy` (1.1) merges **a node of the document itself** into each target, under
those same rules: its value is a JSONPath that must select exactly one node,
resolved against the document as the actions before it left it. Zero or
several matches change nothing and warn. Precedence is the spec's, read
literally: `remove: true` empties the other two, and `update` and `copy` each
"have no impact" when the other carries a value — so an action declaring both
applies neither, and says so rather than picking a winner.

Nothing about an overlay is silent, because a failed one is invisible by
nature — the schema simply does not say what the integrator thinks it says.
Every deviation is a warning code listed in the settings diagnostics block
(§5.11) and echoed to the console: a target that is not valid RFC 9535, a
target matching **nothing**, an update that cannot be merged where it points, a
copy source that does not name exactly one node, an overlay URL that would not
load, a revision we do not know. An overlay never breaks a load.

### 5.2 Navigation, doc rendering and deep linking

- Menu generated from OpenAPI **tags** (groups) + paths/operations; fallback
  group when tags are absent; order = schema order. A group is labeled by the
  tag's `summary` when it declares one (3.2), by its name otherwise — the name
  stays the key, in the model and on `data-group`. A tag declaring a `parent`
  (3.2) nests **inside** it: the model resolves the hierarchy and hands over a
  flat list in reading order, each nested group naming its parent, and the nav
  is the only surface that rebuilds the tree from it. A group's count pill and
  its change dot cover its subgroups too — folded, it hides them. A tag whose
  3.2 `kind` is not navigational makes no group at all: it badges the
  operations carrying it, in the doc header.
- A closed group's link list is **built on demand** (first open — summary
  click, route, or toggle), not at boot: on a heavy schema a folded menu
  built eagerly would hold thousands of links nobody asked for. Every group still declares
  its operations on `data-ops`, which is how outside code (the e2e helper
  included) finds the group an operation lives in without its link existing
  yet. The first group is built eagerly either way — its links are the DOM's
  proof the reference rendered.
- A landing that targets no operation **unfolds the first reference group**;
  a deep link into an operation opens that operation's group only. The
  default applies once — after that the open set belongs to the reader.
- Per operation: the method badge and the full URL as one composed lockup
  (badge colors via a **static map** of daisyUI classes), the description
  (sanitized Markdown), then the parameters — path/query/header/cookie — as
  **stacked rows** (`.api-param-row`), one per parameter: name, type and
  `required` inline, description and constraint chips (enum, min/max,
  pattern, default) underneath, and the mirror-editable field in the row
  itself. Rows rather than a three-column table because the field needs the
  width, and because the same information then stays readable at any
  viewport.
- Schema rendering: the conditional keywords (`if`/`then`/`else`, `not`,
  `dependentSchemas`) become labeled panes with the same lazy expansion as a
  composite variant; `patternProperties` become rows of the property list,
  badged and never editable; the remaining keywords join the constraint chip
  row. A root object's own constraints sit above its rows.
- Discriminated composites: the header names the discriminator property,
  variants are labeled by their mapping key, and the property's row is badged
  as the discriminator. In the try-it the variants become a **selector** —
  only the selected one is on screen, its discriminator field is filled
  read-only, and switching rewrites the body (previous variant's keys removed,
  new key set). A parent-side hierarchy lists its subtypes as a chip.
- Where each `externalDocs` lands: the home page's metadata line (root), the
  first entry of a group's nav list (tag — never inside its `<summary>`, which
  would nest a link in a disclosure control), the operation header, and a chip
  among a schema's constraints. All four go through one renderer
  (`components/external-docs.js`): new tab, `rel="noopener noreferrer"`, and
  the declared description as the label.
- Response links are listed after the response headers, before the payload:
  name, description, the runtime expressions as chips, and a "go to
  operation" link when the target resolved.
- Request body + response schemas **per HTTP status with a switcher**,
  examples displayed when present, plus a deterministic generated example
  when the schema declares none (pure module `src/openapi/sample.js`).
- **One render per navigation.** The shell sets several properties in a row
  (`operation`, `security`, and an environment change adds `baseUrl`); each
  would trigger its own full build, so they are coalesced behind a microtask.
  The doc element is mounted into `main` only when it is not already there —
  `replaceChildren` with the node it already holds re-runs
  `connectedCallback`, which is a further render of what was just rendered.
  The same guard holds for the docs page and the scenario view.
- Full-text search: Cmd/Ctrl+K palette indexing names, paths, methods,
  schema property names, descriptions, docs page titles, and — built on the
  palette's first open — the **content** of the docs pages, section by
  section (§5.8).
- **Hash routing**: `#/op/{operationId}` (fallback `#/op/{method}-{path-slug}`
  when `operationId` is absent), `#/page/{slug}[/{anchor}]` for docs pages,
  `#/overview` for the technical welcome view (always resolvable, whether or
  not a page took `#/` over), `#/audit` for the schema audit (§5.12) and
  `#/first-call` for the generated onboarding page (§5.5.7).
  View restored on load, scroll to target. Every nav entry is a real,
  copyable link.
- **Hiding operations**: `"x-apiglow-hide": true` in the schema (operation,
  Path Item, or `tags` entry), or `openapi.hide` patterns in the config
  (`tag:X`, `METHOD /path`, `/path`, operationId; `*` wildcard). Filtering
  happens in normalization, so hidden operations are absent from the nav,
  the search, the pager, the diff and every export at once. This is
  documentation-level hiding, **not a security measure**: the browser still
  downloads the full schema.
  That last sentence is a fact about the product, so the product says it
  rather than leaving it in this file: normalization keeps the **count** of
  what it removed (`model.hiddenOperations` — a figure, never the names), and
  every surface handing out the published document declares it (§5.1.2). The
  gap runs the opposite way from an overlay's — the file says *more* than the
  page, not less — which is why it is worded and counted separately, and why
  the audit page is exempt: the audit spans hidden operations itself, so there
  the file and the grade cover the same perimeter.

### 5.3 Environments

- An environment = name + `baseUrl` + key/value variables + default headers
  + optional **color** (closed palette of 10 hues + special auras) shown as
  a background gradient on the selector — an immediate visual cue (e.g. red
  = production).
- Visible, persistent environment dropdown: each entry shows its color,
  name, base URL and a badge when credentials variables expected by the
  schema are missing.
- **Sensitive variables**: per-variable flag → masked display
  (password-type field + eye toggle), visible "unencrypted local storage"
  disclaimer. No real encryption (device-only storage).
- `{{variable}}` interpolation in URL, headers and try-it body — and in the
  webhook simulator's receiver URL, headers and payload, which is a send path
  like any other. **A missing variable = red highlight + send blocked with an
  explicit message** (the literal `{{var}}` is never sent).
- Full CRUD from the UI; `localStorage` persistence. Config environments
  whose *name* is unknown to storage are added on load (without overwriting
  or reselecting).
- **Locked environments** (`environmentsLocked: true`): the config is
  authoritative on the set and structure of environments; local storage only
  keeps runtime state (selection, OAuth-token-like variable values). No CRUD
  entry point is rendered at all.
- **Seeding from `servers`**: on first load of a schema, offer (button, not
  automatic) to create one environment per `servers` entry.
- **Setup link** ([env-setup-link.md](env-setup-link.md)): an
  environment travels to a teammate as one URL, its payload a base64url
  pseudo-query of the hash (`#/?setup=…`) like the other share links. The
  manager's band opens a generator that composes it row by row — sensitive
  values unchecked by default, so
  the default link is a *skeleton*: variable names, no secrets. A lead who owns
  no such environment builds one from scratch instead (a form on the overview
  and in the manager's toolbar, pure generator: it writes nothing, and its
  "preview as recipient" is the landing itself). Landing on one
  scrubs the URL before anything renders, then previews exactly what would be
  written and waits for Apply; an environment of the same name is updated
  (an empty link value never overwrites a filled local one), otherwise it is
  created. Refused outright under `environmentsLocked`, and refused when the
  link names another spec. Bounds in §6.2.

### 5.4 Auth — securitySchemes

- Parses `components.securitySchemes` + global and per-operation `security`.
- Per operation: the applicable auth schemes (type, location, header/param
  name).
- The home page summarizes *all* declared schemes — name, type, deprecation,
  credential location, conventional environment variable — with details
  (Markdown description, OAuth flows with URLs and scopes, OpenID Connect
  discovery) behind a collapse.
- **Convention-based mapping to environment variables**: scheme `X` ↔
  variable `auth.X` (e.g. scheme `bearerAuth` → variable `auth.bearerAuth`,
  sensitive by default). Loading a schema suggests/pre-creates these
  variables in the environment editor.
- Try-it: a credentials selector that captures **and** injects the right
  mechanics per type; every conventional variable of the scheme is editable
  in place (written to the selected environment on blur) — the environments
  dialog is never a mandatory stop to send a request. A host declaring no
  environment is no exception: the first runtime value written creates one
  (`env.defaultName`) and selects it, and the cartouche says so before the
  write. One rule, one place — `envForWrite` (`src/components/env-write.js`)
  over the store's `writable` — for every runtime write: the credential
  fields, the "Get a token" button, the OAuth redirect return whose
  originating environment was deleted while it was away, and the scenario
  extractions marked `persist` (`scenarios.md` §6), so an enabled control and
  a possible write never drift apart. Only `environmentsLocked` closes it: the
  config owns the set, and declaring none there refuses the write and says why
  (`env.lockedNone`). Injection:
  - `http bearer` → `Authorization: Bearer {{auth.X}}`;
  - `apiKey` → header/query/cookie named by the schema;
  - `http basic` → `Authorization: Basic base64(user:pass)` from
    `auth.X.username` / `auth.X.password`;
  - `oauth2` / `openIdConnect` → manual token field, plus a "Get a token"
    block when a flow is drivable (Authorization Code + PKCE, client
    credentials) — both write the same `auth.X` variable.
- What the browser cannot execute is named by `platformLimits`
  (`src/openapi/auth.js`): `mutualTLS`, and an OAuth2 scheme carrying a
  `deviceAuthorization` flow. Each limit is stated as an i18n'd hint in the
  three places the scheme is displayed — operation doc, home summary,
  credentials cartouche — so no surface promises a send it cannot make
  (`openapi-coverage.md` §1.1, tier T3).
- Manual header overrides in the try-it always remain possible.
- **Host-provided credentials**: the host page can feed `auth.X` values at
  runtime through a public provider API (`window.apidoc`, plus the
  `apidoc:ready` event) — ephemeral, memory-only, fills only variables the
  environment leaves empty, and refreshes once on a 401. The overlay lives in
  `src/env/host-credentials.js`; every resolution of a `{{var}}` that feeds a
  send or a credential status goes through the one `VariableSource`
  (`src/env/variables.js`), which composes the overlay with the environment in
  the one order (host overlay < environment < run scope) and answers
  `sourceOf(name, env)` for the badges. Consumers take that source rather than
  the two stores, so a new one cannot compose the merge wrongly — the two
  surfaces that deliberately read the environment ALONE (the webhook
  simulator, the OAuth block) say so on the spot. Nothing is persisted, so rule 13
  has no policy to declare here — and no export can ever carry a host value.
  Spec: [host-credentials.md](host-credentials.md).

### 5.5 Request tester ("Try it")

- Edit parameters, headers and body for each operation; body editing is also
  possible from the central doc column (synced with the panel). The body is
  a JSON *template*: a `{{var}}` may sit unquoted (`"petId": {{petId}}`, so
  the value lands as a number), and both views read and rewrite it in that
  shape (`src/env/json-template.js`).
- **Deliberately minimal body validation**: well-formed JSON + presence of
  top-level `required` fields, checked **after** interpolation. No full JSON
  Schema validation (no Ajv).
- Native `fetch`; duration measured via `performance.now()`; the actual send
  pipeline is the pure-ish module `src/openapi/send.js`, shared with the
  scenario runner.
- **Optional CORS proxy**: when `tryIt.proxyUrl` is configured, a panel
  toggle routes the request through the template (`{{target}}` = encoded
  target URL). Off by default; the app ships no proxy.
- Network errors: **the CORS case is distinguished and explained** (it is
  not an app bug; the proxy is suggested when configured).
- Response display: status, headers (**with a visible note that without
  `Access-Control-Expose-Headers` on the API side, only safelisted headers
  are readable** — the list may be incomplete), pretty-printed JSON body +
  raw view, duration.
- **Live code snippets** in the panel: cURL, JS `fetch`, Node `axios`,
  Python `requests`, PHP, Ruby `net/http`, Java `HttpClient`,
  C# `HttpClient`, Go, HTTPie — a persisted language row (`snippetLang`)
  reusing the export generators.
- Every sent request automatically writes a history entry.

#### 5.5.1 Schema type → form field

The normalized model (never the raw schema, rule 6) decides which field a
value gets. Every declared type has one; where it doesn't, the fallback is
stated and the raw JSON body stays the escape hatch.

| Declared schema | Field |
|---|---|
| primitive, `any`, composite of primitives | text input (`inputmode=decimal` for `integer`/`number`) |
| `enum` ≤ 7 values, `boolean` | select |
| `enum` > 7 values | filterable combobox (free text: a `{{var}}` stays typable) |
| array of primitives | repeatable rows (parameters and body) |
| array of objects / of arrays | rows of sub-editors in the body; single field as a parameter |
| `prefixItems` tuple (3.1) | one fixed slot per position, no add/remove |
| object with declared properties | one field per property (body, and path/query parameters) |
| free-form object (`additionalProperties`) | typed key + value rows |
| `format: binary` | file input (multipart part or whole binary body; a text field under urlencoded, see §5.5.2) |
| composite of objects (`oneOf`…) | no form — raw JSON body |

Fields are `type=text` even for numbers and dates: `type=number` and
`type=date` refuse a `{{var}}`, which must remain typable everywhere (rule
11). Typing happens on send (`src/openapi/coerce.js`); the placeholder shows
the declared example, failing that the shape of the `format`. A select that
receives a value it cannot list (a `{{var}}` from a scenario step, an
off-list value from a reloaded request) **shows it as an extra flagged
option** rather than falling back to "—".

Headers stay one string per name, always: the panel edits them as free
name/value rows, so a header parameter — array-typed or not — gets a single
field. A parameter described by `content` carries a serialized document:
single field too, never spread.

**Cookie parameters are edited like any other** (T3, see §5.5.3): the browser
refusing to send them is a platform limit, not a reason to remove the field.

#### 5.5.2 Body kinds

A request body is not always JSON text. Its **kind** is derived once from the
selected media type by the pure module `src/openapi/body-kind.js`, and
everything downstream reads that single answer: the panel picks its editor,
the central doc mirrors the same editor, `request-builder.js` picks its
serialization, the exports pick their syntax. Rule 6 holds — the 3.0
spelling (`format: binary`) and the 3.1+ one (the media type alone) are
absorbed there, and no `isV31` exists anywhere else.

| Kind | Detected on | Editor | On the wire |
|---|---|---|---|
| `json` | any `*json` media type | text editor + structured doc fields | the text, `Content-Type` from the media type |
| `multipart` | `multipart/*` | one field per top-level property, file input for a `format: binary` one | `FormData`; **no** `Content-Type` set (fetch owns the boundary) |
| `urlencoded` | `application/x-www-form-urlencoded` | the same fields, text only | `URLSearchParams` string + `Content-Type` |
| `binary` | `format: binary`, or any non-textual media type (`application/octet-stream`, `image/*`, `application/pdf`…) | file picker, with a **File ⇄ Text** toggle | the `File` itself, `Content-Type` from the media type |
| `text` | `text/*`, XML, YAML, CSV, GraphQL… | text editor, **pre-filled with an XML sample** when the media type is XML (§5.1) | the text |

**The media type is a single choice, owned by the panel.** Both columns show
a selector when a body declares several; the doc's pushes a `tryit-edit` up
and waits for the state to come back down, exactly like any field. This is
not cosmetic: since the media type decides the *kind* of editor, two columns
left free to drift would document and edit two different bodies — and a file
dropped into the stale one would reach a body that has no room for it.

Two further consequences are contractual:

- **A `format: binary` property under urlencoded degrades to a text field.**
  urlencoded percent-encodes its values; no server expects a file there. The
  documented fallback (rule 19) is to type or paste the value (base64) rather
  than to offer a picker that would lie about what leaves.
- **File contents never leave the tab's memory.** `buildRequest` receives
  metadata only (`{ name, size, type }`); the `File` goes straight from the
  editor's state to `send.js`. It is therefore absent from the history, from
  share links, from scenario steps and from every export — those carry the
  file's *identity* (`@cat.png (2.0 kB, image/png)`) and nothing more. What
  follows from that is stated where it bites: history replay is disabled on
  such an entry (§5.6), and a scenario step carrying one is reserved for
  step-by-step mode ([scenarios.md](scenarios.md) §2).

#### 5.5.3 Parameter serialization (`style`/`explode`)

`style` and `explode` are resolved in the normalized model (defaults
included: `form` in query/cookie, `simple` in path/header) and applied by the
pure module `src/openapi/params.js`, which also reads them back from a URL
(history reload, share link).

- array — `form` + explode (the OpenAPI default) repeats the pair
  (`?tags=cat&tags=dog`); otherwise the values join on the style's delimiter
  (`form`/`simple` `,`, `spaceDelimited` ` `, `pipeDelimited` `|`).
- object — `deepObject` brackets each property (`?owner[city]=Lyon`), `form`
  + explode sends the properties as plain pairs, the non-exploded forms
  flatten `key,value,key,value`.
- path — `label` and `matrix` add their prefix (`.3,4`, `;ids=3;ids=4`);
  each element is encoded individually, delimiters are structure.

A parameter value therefore travels through the state (and through the share
link, the scenario step, the history reload) as a string, a list of strings
or a flat map of strings — that contract is enforced by
`normalizeParamValue`.

Three declarations refine what leaves the browser, and none of them is
visible in the field itself, so each gets a badge in the doc:

- **`allowReserved`** (query, and per-property in an encoding) — the value
  already uses RFC 3986 reserved characters as structure, so they are not
  percent-encoded. Pairs are therefore collected and encoded one by one:
  without the flag by `URLSearchParams` itself, so the ordinary path keeps
  producing byte-for-byte what it always did; with it, the reserved characters
  are put back and a space becomes `%20` (never `+`, which would be a second
  lie about a value passed through verbatim).
- **`allowEmptyValue`** (query) — `?verbose=` is a value in itself. Deprecated
  by the spec and supported all the same (rule 19), through an explicit
  toggle in the panel: a blank field still means "don't send", and
  reinterpreting it would change what every existing request means. The state
  carries a separate `emptyValues` list, so the value contract above stays
  intact. The doc shows the badge, not the toggle.
- **`in: cookie` parameters (T3)** — folded into one `Cookie` header next to
  the cookie credentials, joined on the style's delimiter (`explode` would
  repeat the name inside a single header value, which no server reads back as
  a list). They reach the cURL export and the snippets; a browser drops the
  header a script sets, and the panel says so under the fields rather than
  only in the post-send alert.

**`encoding`** describes how each piece of a composite body is serialized. It
is normalized per media type entry, with the same `style`/`explode` defaults a
query parameter gets — a urlencoded body *is* a query string written somewhere
else, and it goes through the same `params.js` helpers:

| Declared | Where it applies | What it does |
|---|---|---|
| `contentType` | multipart part | the part's own Content-Type — set through a `Blob` (a text part so typed also gains a `filename`, the only way a browser expresses this); a picked File is retyped |
| `headers` | multipart part | static per-part headers, valued from the Header Object's `example`, failing that its schema `default`. `FormData` cannot set them: they survive in the **cURL export** (`;headers=`) |
| `style` / `explode` | urlencoded field | the field's serialization — `explode: true` on an array repeats the pair instead of joining |
| `allowReserved` | urlencoded field | as above |
| `prefixEncoding` / `itemEncoding` (3.2) | array-shaped body | **modeled and rendered, not applied**: an array-shaped body has no field editor to drive (that is `bodyKind`'s territory, §5.5.2). The doc lists them under "Encoding" — what they declare is still what the endpoint expects |

#### 5.5.4 The doc↔panel mirror (rule 20)

The request is edited from two columns. **The try-it panel is the single
source of truth; the central doc holds no choice of its own.** The bridge is
two events, wired by the shell (`src/app.js`):

- `tryit-state` — the panel pushes `currentValues()` down on every refresh;
  the doc applies it in `#applyTryItValues()`.
- `tryit-edit` — the doc pushes a change up; the panel applies it in
  `applyDocEdit()`, re-renders, and the new state comes back down.

A doc widget therefore never acts on its own state, even when it could:
the round trip is what makes the two columns provably equal instead of
merely usually equal.

**The order of application is part of the contract**, because some widgets
decide what the widgets below them *are*:

```
media type  →  discriminator variant  →  fields / file pickers
```

Applied out of order, a pass fills editors that are about to be thrown away
and leaves their replacements empty. Applied only partially, the page keeps
looking plausible while the two columns edit different things — which is why
this class of bug is silent. Three rules follow:

- **Every editable surface is two-way or it is a bug.** A value added to
  `currentValues()` without a matching branch in `#applyTryItValues()` (or
  the reverse) is a half-built mirror.
- **A remount asks for the state again.** Anything that creates editors
  after render — a variant switch, an "expand" button — calls
  `onEditorsChanged`; waiting for the next unrelated push means opening
  empty fields over a body that has values.
- **A programmatic `setValue` never emits.** Following the body must not
  rewrite it: an echo erases the very keys it was just told about.

Widgets currently bound by this: parameter fields (path, query,
`querystring`, header, **cookie**), body field editors at any depth,
array/tuple/free-form-map editors, the body media type selector,
discriminator variant pickers, file pickers, and the response status tabs
(`tryit-response-status` / `showResponseStatus`). The `allowEmptyValue` toggle is
deliberately panel-only — the doc shows the badge, not the control, which is
one editable surface fewer to keep in step for a flag the spec itself
discourages.

One binding is one-way by nature: **`authSchemeName`** travels in
`currentValues()` and the doc marks the scheme the send will inject, but the
choice is made in the panel's cartouche only. The mark is not decoration — the
requirements are alternatives, so several schemes can read "configured" at
once, and without it the reader could not tell which credential was about to
travel.

The guard is `tests/e2e/doc-panel-sync.spec.js`; every new editable surface
extends it.

#### 5.5.5 Importing a request (cURL, Postman, HAR)

The mirror of §5.7: a request written elsewhere becomes a pre-filled try-it.
Opened from the header toolbar; the dialog paste-or-picks, matches, and hands
the shell an operation id — it never sends and never writes.

`src/import/` holds pure parsers (same contract as `normalizeScenario`: bad
input returns error codes, never a throw), one per format, all producing the
same **draft**: `{ name, method, url, headers, body, fields, bodyMode, auth,
warnings }`.

- `curl.js` — POSIX word splitting (the inverse of `shellQuote`), then
  `-X/--request`, `-H/--header`, the `-d/--data*` family, `--data-urlencode`,
  `-F/--form`, `-u/--user`, `--url`, `-G`, `-I`, attached short arguments
  (`-XPOST`) and long `--flag=value`. No-argument flags are swallowed
  silently; anything else is listed as an ignored option rather than
  guessed at.
- `postman.js` — collection v2.1: folder tree flattened, `url` raw or
  decomposed (`:pathVar` substituted from `url.variable`), body modes `raw` /
  `urlencoded` / `formdata` / `file` / `graphql`, auth `basic` / `bearer` /
  `apikey`. **Collection variables are reported, never created**: environments
  are the reader's own object (§5.3).
- `har.js` — `log.entries[].request`, `postData.params` preferred over
  `postData.text`. Recorded cookies are dropped with a warning (T3).
- `index.js` — format detection by content, never by file extension.

The directory also holds the scenario-side importers — `arazzo.js`
([scenarios.md](scenarios.md) §8.4) and `draft.js` — which produce scenarios
rather than request drafts and are out of this section's scope.

`match.js` is the only module there that knows the model exists.
`matchOperation(model, draft, { baseUrls })` strips a known server prefix
(document `servers`, operation `servers`, environment base URLs), aligns the
path against each operation's template, and scores by **literal segments
matched** — a literal beats a parameter, stripping a known prefix breaks a
tie. Equal top scores are an ambiguity the dialog presents; nothing is ever
picked silently. It then builds the panel state: path values from the
alignment, query through `readQueryValues` (arrays included), headers minus
the ones a browser refuses to set, media type from `Content-Type`, and the
body placed **where the operation says it goes** — a urlencoded payload
becomes the field list, a file body becomes a warning and an empty picker.

A credential is matched against the operation's own security schemes
(`Authorization: Basic/Bearer`, `-u`, an apiKey under the parameter name the
document declared) and becomes the conventional `auth.X` variable **in the
run scope** — session-lived, sensitive, hence redacted in the history. It is
never written into the stored environment: a value pasted from someone else's
terminal is not the reader's to keep. Unmatched, it stays a plain header and
says so.

#### 5.5.6 Operation-level servers, and canceling a send

- **Most-specific server wins.** OpenAPI lets a Path Item or a single
  operation declare its own `servers`; the model folds the path level into
  each operation (operation > path), and `buildRequest` targets the
  operation's pinned server when one exists. An environment `baseUrl`
  override replaces the **root** server only: an operation that pins its own
  server keeps it, whatever the environment says. The displayed base URL
  (doc header, panel) goes through the same `effectiveBaseUrl`, so the URL a
  reader sees is the URL the send will hit.
- **Abortable send.** `send()` takes an `AbortSignal`; the panel owns an
  AbortController per in-flight request and shows a Cancel control next to
  Send while one is out. An abort is not a network failure: no diagnosis
  probe runs, no network-error rendering, no history entry — the outcome is
  announced in the live region (`tryit.canceled`) and shown as an info
  alert. The scenario runner passes its own signal (a step `timeout`)
  through the same plumbing.

#### 5.5.7 First touch: prefill, blocked credentials, onboarding page

Three pieces of the same goal — a reader's first Send working, and failing
legibly when it can't.

- **Prefill of required parameters** (`src/openapi/prefill.js`, pure). A
  required parameter starts on the value its schema DECLARES: the first
  `examples` entry (the model already folds the parameter's `example` and the
  schema's into it), failing that `default`, coerced to the declared type.
  Scalars only — an array or object parameter edits through its own widget.
  Optional parameters stay empty, unchanged: sending an explicit default is
  not the same request as leaving the choice to the server. Nothing invented
  here — `sample.js` values illustrate a schema, and one of them sent to a
  real API is a 400 that looks like a value.
- **A blocked send lands on the credential.** An unset credential variable
  already blocked the send as a missing `{{var}}`; it now says so in the
  cartouche's terms (the scheme's name, not `auth.X`) and moves focus into
  the field that fixes it, reopening the collapse if the reader closed it.
  Other missing variables keep their own message; both are announced in the
  live region. That field is editable even when nothing has been selected
  yet — a schema opened on a host without environments would otherwise block
  on a disabled field (§5.4).
- **Generated "First call" page** (`#/first-call`, `features.onboarding`,
  off by default). `pickFirstCallOperation` chooses the cheapest read the
  schema declares — a GET, no request body, not deprecated, fewest required
  parameters left to type once the prefill above is applied — and the page
  renders that operation's ordinary view under a numbered preamble. It adds
  **no control of its own**: the three steps it narrates (language,
  credentials, Send) are the try-it rail's, which is what keeps rule 20
  intact and lands the reader on the panel they will use everywhere else. No
  suitable read ⇒ no page and no nav entry.

### 5.6 Request history

- **IndexedDB.** Entry: timestamp, environment, operationId, resolved
  request (method, URL, headers, body), response (status, headers, body),
  duration, plus the list of sensitive values used — enabling **redaction on
  display and on export** (values replaced by `••••`, explicitly
  disableable).
- A body that isn't plain text also carries its **structured shape** next to
  the display string: `request.form` (multipart parts) or `request.bodyFile`
  (`{ name, size, type }`). Exports render from those rather than parsing the
  display string back, and **replay is disabled** on an entry carrying a file
  — its content was never stored, so re-sending would post the display line
  as if it were the payload. "Reload into the try-it" stays available: that
  is where the file is picked again.
- **Storage cap**: bodies truncated beyond 256 KB, `truncated` flag shown in
  the UI.
- **Retention**: purge on write according to `history.maxEntries` (default
  500) AND `history.maxAgeDays` (default 30), whichever threshold is reached
  first. "Clear history" button. Retention is global to the installation,
  not per spec (§14.5). The rules
  are **stated in the dialog** ("N/max entries kept · oldest ⟨date⟩ ·
  deleted after N days") — silent eviction the user cannot see reads as data
  loss. The count and the date describe the whole store, like the settings
  panel's: they measure what the bound acts on, not the filtered — and in
  multi-spec, spec-scoped — list shown underneath.
- Filterable list view (endpoint, environment, status code, free text);
  actions: **replay as-is** and **reload into the try-it** for editing.
- **One read per open**, and one per store change: the dialog holds that array
  and filters it in memory. The filters narrow the rows, never the read, and
  `list()` walks the whole cursor and deserializes every stored body. Each row
  builds its **detail on first expansion** — redaction, export bar and
  highlighted response body are what a row costs, and the list is rebuilt on
  every keystroke in the free-text filter.
- **Run selector in the try-it**: above the response panel, the list of past
  calls for the displayed endpoint. Selecting one shows its archived
  response (nothing is re-sent) and reloads its request into the form; the
  in-progress draft is set aside and restorable in one click.
- Persistence verified across page reloads.
- **Local metrics** (`src/storage/metrics.js`, pure): two read-only views over
  the same history — a **recent-calls strip** at the bottom of the endpoint
  doc (time, status, duration, environment; a button opens the history
  dialog on that endpoint) and a **most-used card** on the overview
  (endpoints ranked by call count, ties broken by the most recent call).
  Three constraints hold them together:
  - **the scope is stated, never implied.** Hosted equivalents are
    server-side telemetry across every reader; ours can only mean "what you
    sent from this browser", so both labels say so. Anything wider would need
    the analytics channel §1 refuses — a wider number is not a feature away,
    it is a different product.
  - **empty history renders nothing** — no heading, no "0 calls", nothing in
    the accessibility tree.
  - **one read for both surfaces.** The shell reads `list()` once per history
    change, off the boot path, and pushes the result into whichever surface
    is displayed — a send appears in the strip under it without a navigation.

### 5.7 Request log export

For a given history entry:

- **cURL**: copyable shell command, multi-line with `\`, correct quoting;
  "substitute variables" toggle (otherwise `{{var}}` output).
- **Postman Collection v2.1**: importable JSON. No dedicated Insomnia
  format: Insomnia natively imports Postman v2.1 collections.
- **Shareable Markdown**: request + response + context (env, timestamp,
  duration), with code blocks, made to be pasted into a GitHub issue.
- **HAR 1.2**, and a **Debug** dump.
- The panel's **snippet languages** (§5.5), from the same generators, with
  the same substitute toggle.
- Each format: one-click clipboard copy. **Sensitive-value redaction is on
  by default**, disableable.
- Generators are pure functions in `src/export/`, snapshot-tested.
- **Every snippet is dependency-free HTTP.** No SDK-style sample (`npx api
  install …`, a vendor client): those bind the reader to a package ecosystem
  that has to exist, stay published and match the schema, none of which this
  document can promise. What is emitted is what the language itself can run.

Also available: a per-request **share link** (`#/op/{id}?req=…`, base64url
state, sensitive values re-templated into `{{var}}` before encoding), a
per-page "Copy page" Markdown export, the doc-wide **AI surface** (§5.14) and
the **audit report as Markdown** (§5.12). Three of these formats read back
in: see §5.5.5.

### 5.8 Docs pages (prose)

Functional source of truth: [docs-pages.md](docs-pages.md). Summary:

- Local or remote files declared in `docsPages` (inline array or fetched
  manifest, §4), routed at `#/page/{slug}[/{anchor}]`. The nav has two zones:
  the docs zone — pages, one level of collapsible groups, external links — sits
  above the API reference zone.
- **`nav: 'bottom'`** on a top-level entry moves it to a trailing docs zone
  closing the nav, below the webhooks: the appendix half of the prose
  (support, legal, a status link) stops pushing the reference down. Titleless
  by design — the separator says what a second "Documentation" heading would
  say twice. A group travels whole, so the choice is top-level only. The
  resolved outline is arranged top zone first, which keeps "the outline is the
  nav order" true for the pager, the search and the exports alike.
- **A body can travel in the host page** instead of being fetched: `content`
  (the text, for a config a backend generates) or `contentId` (the `id` of an
  element holding it, typically a `<script type="text/markdown">`, for prose
  written by hand). This is what makes the prose side available to an
  installation that serves no static file next to `index.html` — an API doc
  behind a login, a framework serving one route. The config keeps the whole
  structure; the element only ever holds text. Its common indentation is
  removed, without which the surrounding markup would turn the page into a
  code block.
- **Format by URL extension**, never by content-type: `.md` (default),
  `.html` (same DOMPurify profile, markdown-only features do not apply),
  `.txt` (escaped text in a `<pre>`, no ToC). A carried body has no extension:
  the `format` key wins, then the element's `type`, then markdown.
- Markdown pipeline: frontmatter stripped → `marked` with the app's own
  extensions → **systematic DOMPurify** → heading anchors (slug + ¶ link,
  carried by the route) → `highlight.js`. The enrichments are:
  - **GFM callouts** (`> [!NOTE]`, TIP, IMPORTANT, WARNING, CAUTION) → daisyUI
    alerts through a static class map (rule 2); a blockquote everywhere else.
  - **Code tabs**: fenced blocks with no blank line between them become one
    tabbed block, labelled from the fence meta string. The chosen language is
    remembered and applied to every group on every page that has a tab for it.
  - **`apidoc:` references**: `[label](apidoc:createPet)` or
    `[label](apidoc:GET /pets)` becomes a route with a method badge;
    an ` ```apidoc:operation ` fence becomes one card per line. Both resolve
    against the ACTIVE spec's normalized model, `operationId` first then
    `"METHOD /path"`; an unresolvable reference renders visibly broken rather
    than as a dead link. No try-it in prose — the card is a link, so rule 20
    is not in play.
- **Page chrome** on every page, takeover home included: a ToC derived from
  `h2`/`h3` (right-hand column from `xl`, folded dropdown below), prev/next
  links following the flattened nav order, and — only when the host declares
  `feedback.url` (§4) — the "Was this page helpful?" row.
- **Home takeover**: `home: true` on one page makes `#/` render it; the
  technical welcome view moves to `#/overview` and gains a nav entry heading
  the reference zone.
- **`{{var}}` in prose**: a page resolves its references from the very same
  composition the try-it reads (§5.3) — a guide's `curl` shows the reader's own
  base URL. A post-sanitize DOM walk, so a value is a text node and can never
  become markup; markdown pages only. A **sensitive** value never renders: a
  masked chip stands in, and the value reaches neither the DOM, the clipboard,
  the index nor an export. An **unresolved** name renders a chip opening the
  environment manager, rule 11's spirit without a send to block. The search
  index and the llms exports stay uninterpolated — they are the published docs,
  not one reader's session.
- **Search**: the palette indexes page content section by section on its first
  open, in memory only (§6.1).

### 5.9 Theming

- `theme.default` + `theme.available` in the config.
- **Signature pair `apiglow` / `apiglow-dark`**, compiled into `app.css` next
  to the standard themes and offered by default
  (`available: ['apiglow', 'apiglow-dark']`). Flat surfaces, 1 px borders,
  restrained radii; every semantic color is picked so that daisyUI's `-soft`
  derivation of it — the token as ink on an 8 % wash of itself, which is the
  tightest ratio that color ever produces, and what the method badges and the
  cartouche badges are made of — clears 4.5:1 on both halves, which the stock
  themes never guaranteed.
- **`theme.default: 'system'`** (the built-in default) follows the OS
  `prefers-color-scheme`, resolved within the first light/dark pair fully
  present in `available` (`apiglow`/`apiglow-dark`, else `light`/`dark`), and
  keeps following it live. The selector shows it as a "System" segment in the
  mode row above the palettes; without a complete pair the segment disappears
  and `'system'` degrades to the first available theme.
- **The built CSS includes ALL standard daisyUI themes** (cost: CSS
  variables only) so `theme.available` is genuinely free on the consumer
  side without a rebuild.
- Selector limited to `theme.available`, and a **section of the preferences
  menu** (§5.16) rather than a control of its own: the light/dark/system row is
  always shown, the palettes themselves sit behind a disclosure that a reader
  with a working theme never opens. Below two available themes there is no
  choice left and the section is absent. The persisted choice — a theme name or
  `system` — takes priority over `theme.default` (an initial value only).
- **Display serif**: titles render in Source Serif 4 Variable (OFL, credited
  in the About dialog), a 50 KB latin-subset woff2 shipped as
  `dist/fonts/…` and loaded relative to `app.css` like `i18n/*.json`;
  non-latin headings fall back to the system serif stack. Body text and
  chrome stay on the system sans stack.

**Custom themes.** A daisyUI 5 theme is nothing but a block of CSS custom
properties scoped to a `data-theme` selector, so a host can brand the docs
with its own theme **without any build step** — which is the whole feature.
Design record and rationale: [custom-themes.md](custom-themes.md).

- **Config channel** (documented main path): `theme.custom[]` entries of
  `{ name, extends?, colorScheme?, tokens }`. `name` matches
  `^[a-z][a-z0-9-]*$` (CSS-identifier-safe); `tokens` uses the **verbatim
  daisyUI variable names** (`--color-primary`, `--radius-box`, `--border`,
  `--depth`, …), so the output of the
  [daisyUI theme generator](https://daisyui.com/theme-generator/) pastes
  over directly. Add the name to `theme.available` to make it selectable.
- **`extends`** inherits any **built-in** daisyUI theme and overrides only
  some tokens ("dark, but in my brand colors"). Extending another custom
  theme is out of scope. `colorScheme` is inherited from the base when
  absent.
- **Overriding a built-in name in place is supported**: a custom entry named
  `light` restyles the built-in `light`, the rest inherited by cascade.
- **Validation is lenient** (a styling concern must never take the docs
  down): unknown token, invalid value, bad name, duplicate → skipped with a
  `console.warn`; a name absent from `theme.available` is warned but still
  injected. Nothing throws.
- **Root-only** (decision 7 of the spec): a `theme.custom` set on a
  `openapi.specs[]` entry is flagged by name in the console and dropped from
  the effective config — see [multi-spec.md](multi-spec.md). A per-spec
  `theme.available` still narrows what is selectable.
- **Escape hatch, zero app code**: a plain `[data-theme="name"]` block in the
  host page's own CSS plus the name in `theme.available`. Works for a new
  name *and* for overriding a built-in one — daisyUI ships its themes inside
  `@layer base`, and an unlayered rule beats a layered one whatever its
  selector. That last part rests on daisyUI's layering, so the config channel
  is the recommendation for in-place overrides: it mirrors daisyUI's own
  `:is(:root:has(input.theme-controller[value=NAME]:checked),[data-theme=NAME])`
  selector and survives a layering change.

Implementation: `src/theming/custom-themes.js` is pure (validate, merge,
render CSS text); `app.js` reads the config key (rule 10) and hands it to
`src/shell/themes.js`, whose injector appends one
`<style data-apidoc-custom-themes>` **synchronously right
after the `app.css` link**, so document order — what breaks the tie at equal
specificity — never depends on the network. The element arrives already
filled with the themes that need no base; base values for `extends` cannot
be read from `cssRules` (the CDN stylesheet is cross-origin), so the
injector reads them off a hidden `data-theme` probe with
`getComputedStyle`, once the link has fired `load` — or `error`, so a dead
stylesheet still resolves the themes rather than leaving them pending. Rule
3 is untouched: the build still ships every standard theme, custom ones are
additive.

### 5.10 UI i18n

- **Every** UI string goes through the i18n module (`t('key')`) — zero
  hardcoded text in components.
- **English is bundled** as the fallback language (the UI can never be
  broken by a network failure). Other languages: `dist/i18n/{lang}.json`
  **lazy-loaded** via `new URL(..., import.meta.url)` — only the active
  language is downloaded. This asymmetric layout is deliberate — see
  §14.7.
- Shipped languages: `en` (bundled) + `fr`. Adding a language = one JSON
  file.
- The selector is a **section of the preferences menu** (§5.16), next to the
  theme's. Up to three offered languages it is one row of segments —
  "Automatic" plus each code — because picking one costs a reload and the
  choice should not also cost a scan; past that it becomes a list, built on
  the menu's first open (one `Intl.DisplayNames` per language is not a boot
  cost). One available language is not a choice: the section is absent.
- Out of scope: OpenAPI schema content and `.md` pages are displayed as-is,
  whatever the UI language.

### 5.11 Settings panel

Maintenance drawer, reached as an item at the bottom of the preferences menu
(§5.16) — the least prominent thing the bar can open, and never a control of
its own. Nothing in it serves reading the doc, and a discoverable "erase
everything" would be a hazard rather than a feature.

- **Stored data**: one row per dataset group of the §6.2 inventory —
  history, scenarios, snapshots, environments, header memory, and one row
  folding every preference-sized key — with its count and a targeted purge.
  The user-facing counterpart of the bounded-storage policy — the numbers
  §6.1 bounds are otherwise invisible.
- **Schema audit**: title, one line, one button to `#/audit` (§5.12) — the
  audit's only entry point, absent when `features.audit` is `false`. No grade
  is shown here: displaying one would force the report to be computed every
  time the panel opens, and the panel must stay cheap to open.
- **Diagnostics**: bundle version (injected at build time from
  `package.json`), API and OpenAPI versions, the original version when the
  document was converted (§5.1.1 — without it, a 2.0 file reporting "3.0.4"
  would be unexplainable), schema URL, active spec, theme, language, and the
  origin-wide `navigator.storage.estimate()`. Plus, when the config declares
  any, the **overlays** (§5.1.2): how many actions were applied, each
  overlay's `info.description` when it states one — the only place an overlay
  ever says what it is *for* — and the list of what could not be applied, the
  only place a failed overlay is visible at all.
  One button copies the block as plain text for a bug report.
- **Patch this schema locally**: the user overlay's editor
  ([`user-overlay.md`](user-overlay.md) §3), placed right under the
  diagnostics because the warnings it produces are the ones that block lists
  once the document is applied. The heading says whether a patch is active, and
  whose it is — the textarea holds the seeded skeleton, a document the reader
  wrote and one the installation provided alike, so it cannot answer either on
  its own; a patch that arrived from the config also says so in a line of its
  own, next to the two buttons that end it. The document itself is framed as the file it
  would be downloaded as: its name in the frame's header, and next to it either
  its weight against the §6.1 cap or why it does not parse yet, which is what
  the disabled **Download** is waiting for. Under it, a **Check** that dry-runs
  the document against the schema already in memory and reports per-action
  match counts without writing anything, a **Save & reload**, the **Download**
  of a standard Overlay 1.1 file, and — only when one is stored — a confirmed
  **Remove**, held at the far end of the bar. Editing the document clears the
  last dry run: a verdict outliving the text it judged is the one lie this
  section could tell. No host switch hides it (§14.17).
- **Danger zone**: erases every declared dataset and reloads on a
  first-visit state.

Two properties the implementation guarantees:

- **Purges are installation-wide**, never scoped to the active spec, and
  the panel says so. A half-cleared multi-spec install is a support case
  nobody can reason about.
- **The inventory is the reset.** Both read `storageInventory()` in
  `src/storage/maintenance.js`, which is the single declaration of what the
  app leaves on the device — a dataset added to the app but not declared
  there would survive a reset that reported success. That file and §6.2
  move together.

Datasets the app reads once at boot (environments, header memory,
preferences) are flagged `reload: true`: purging their keys cannot
invalidate the in-memory copy, so the action ends in a page reload rather
than leave the UI backed by data the browser no longer holds.

### 5.12 Schema audit

In-browser analysis of the loaded OpenAPI schema — findings by category,
a score per category and an aggregate letter. Full spec, rule catalog and
rationale: [`audit.md`](audit.md), which is this feature's source of truth.
What matters at this level:

- **Routed page `#/audit`**, reached from the settings block (§5.11) or
  opened directly as a deep link. No nav entry: the audience is the API's
  author, not the reader of its docs.
- **On by default, removable**: `features.audit: false` removes the settings
  block, the route and any computation — overridable per spec like the other
  feature switches.
- **Computed on first visit only**, then kept in memory for the page's
  lifetime. Nothing runs at boot: the perf budget is a contract (rule 14) and
  the audit walks the whole raw document.
- **The audit and the user overlay's dry run are the only consumers of the
  raw schema** besides normalization
  (rule 6 governs rendering, and this page renders findings, not the schema).
  The loader therefore returns both raw shapes next to the model: the document
  as served, `$ref`s intact, and its dereferenced twin
  (§14.13). For a converted document
  (§5.1.1) those shapes are the conversion's output, which genuinely declares
  3.0.4 — no rule had to learn a second dialect, and only the conversion's own
  approximations needed one (`conversion-approximation`).
- **Findings never link to what the reader cannot open**: an operation hidden
  by `x-apiglow-hide` / `openapi.hide` is still audited — an author wants the
  whole picture — but its findings carry a "hidden" badge instead of a route.
- **Rendered one row per rule, not one per finding**: a schema-wide omission
  is one decision to make, and a real document produces thousands of findings
  from a handful of rules. Each row carries the count of what it folds and
  unfolds a page of occurrences at a time, materialized only on expansion —
  the same perf contract as the rest of the page.
- **Nothing persisted**: no entry in the storage inventory (§6.2), no policy
  to declare.
- **Exported as Markdown** from the page's copy action (`src/export/`, pure
  generator like the others; the page's other action is the schema download
  of §5.1.2) — the report as a ticket or a commit message.
  It is the one export that is not English-only: its substance exists only as
  i18n strings, so it travels in the language it was read in. Nothing to
  redact, no value the user typed ever enters a report.

### 5.13 Footer and "About"

One thin line at the bottom of the app, on every route and every breakpoint:
`Powered by <tool> v<version>`, the host's own `branding.footerLinks`, and an
**About** link. It names the *tool*, never the documented API — the host's
product name and logo stop at the header (§7).

The dialog behind that link states, in this order: name and version, what the
tool is, links to the project and to its issue tracker, the license with its
copyright line, the OpenAPI versions read and the formats exported, a privacy
statement, the keyboard shortcuts, and the third-party components bundled in
the distribution with their version and license.

It has a second way in, at the bottom of the preferences menu (§5.16). The
footer is the conventional home for a credit and the natural gesture from the
version it prints, but at the end of a long page it is also a scroll away, and
a dialog carrying the shortcuts list has no business being hard to reach.

Three properties worth stating, because they are what the design turns on:

- **No switch hides the footer.** A CDN install is a single `<script>`: it
  ships no `README`, no `LICENSE`, no `NOTICE`. This dialog is the only place
  those notices reach the people running the code, so removing it would drop
  an obligation rather than a decoration. A host with its own legal or
  contact pages adds them next to "About" through `branding.footerLinks`.
- **Credits list what ships, and only that** — every runtime dependency,
  Tailwind and daisyUI (whose output is compiled into `app.css`), and the
  bundled Source Serif 4 face (§5.9). Build
  tooling never reaches the browser and is deliberately absent.
  `src/credits.js` is the declaration; `tests/credits.test.js` fails the
  moment it disagrees with `package.json` or with `LICENSE`, which is also
  what makes the dependency rule (§14.2) self-enforcing:
  the list being open for spec and format work, the test is what
  guarantees a new dependency cannot land uncredited — and the §2 list
  is where its role and weight are argued.
- **Every claim has one source.** The identity comes from `package.json`
  through Vite's `define` (like the §5.11 diagnostics), the version lines from
  the two loader constants that reject everything else
  (`SUPPORTED_OPENAPI_VERSIONS` and `SUPPORTED_SWAGGER_VERSIONS` — one promise
  to the reader, whether it is kept by normalization or by conversion), the
  Overlay revision from `overlay.js`, the Arazzo revision from the exporter.
  Imports and exports are two rows, not one: the formats a reader can bring in
  are not the ones they can take away. The dialog restates facts; it does not
  maintain its own.

Below `lg`, the bar keeps its content left-aligned behind a reserved end
padding: the "Try it" FAB floats over the bottom right, and a credit link the
thumb cannot reach is not a credit.

### 5.14 AI surface

Three take-away artifacts, for the reader who is not the one reading: an agent,
or the assistant they are pairing with. All three are **exports** — pure
generators in `src/export/`, produced in the browser. The app runs no server
and calls no model; nothing here is a runtime feature.

They are reachable from where each is wanted rather than from the home page
only: `llms.txt` closes the nav's documentation zone (a button, not a link —
the file is generated here and there is no page to navigate to), and the
**"Copy page"** menu — on an endpoint's doc and on a prose page alike —
carries the hand-off items next to the Markdown ones (§5.14.1).

The two panels that hand over a *file* — the MCP config on the home page, and
"Automate this scenario" on a scenario page — share one shell,
`src/components/take-away-panel.js`: a collapsed `details` carrying a title and
one line naming its reader, the generated file **shown** above the button that
downloads it, the warnings above the file, and names rather than values in it
(rule 12). Each panel keeps what is its own — its generator, its warning
vocabulary, and its decision to render nothing at all rather than a file that
fails on its first run.

- **`llms-full.txt`** (`src/export/llms-full.js`) — the whole documentation
  concatenated into one Markdown: `info`, the declared servers, the security
  schemes and the document-wide requirement, the docs pages fetched on
  demand (`.md` and `.txt` inlined as-is, `.html` flattened to its text),
  the declared workflows with their Arazzo recipe inlined, every operation
  and every webhook. The territory.
  Completeness is a guard, not a habit: `tests/export-completeness.test.js`
  walks the normalized model's own keys and fails on any the export neither
  emits nor explicitly waives — a snapshot freezes what we write, only that
  checklist notices what the model gained and the export ignored.
- **`llms.txt`** (`src/export/llms.js`) — the map, per the
  [llmstxt.org](https://llmstxt.org) convention: title, one-line summary,
  version line, then the docs pages under their nav group's title (ungrouped
  ones share a `## Guides` section), a `## Workflows` section for the
  declared scenarios, one link per operation grouped by tag,
  one per webhook, closing on a `## Reference` section (llms-full.txt, the
  OpenAPI file) and a `## Optional` one — where the nav's external links join
  the external docs, terms and licence. Links
  are absolute URLs into the host page's own hash routes, built through the
  router so the multi-spec prefix travels with them — unless a caller hands in
  a URL mapper, which is what a baked install does to link the `.md` mirrors
  it serves ([seo.md](seo.md) §4). Both files are meant to
  be served statically next to the host page — the docs are a hash SPA, and no
  crawler can browse one by URL.
- **MCP server config** (`src/export/mcp.js`, card in
  `src/components/mcp-card.js`) — the JSON block a reader pastes into their
  agent's client config to call this API. It wires an **off-the-shelf
  OpenAPI→MCP bridge** to this document's URL; the bridge runs on their
  machine, not here.

**Workflows are part of all three files, and of a fourth artifact none of
them can hold.** A declared scenario ([`scenarios.md`](scenarios.md) §3)
publishes a Markdown mirror
(`src/export/scenario-markdown.js`, the workflow sibling of
`toEndpointMarkdown`), a line in the map and an inlined Arazzo recipe in the
territory — because an agent told a documentation has workflows and handed no
recipe is an agent that will improvise the chain instead. What no generated
file can carry is a *schedule*: that one leaves through the "Automate this
scenario" panel (`src/export/ci.js`), as a CI job the reader pastes into the
pipeline they already have. Only config-declared scenarios are ever
published; a reader's own are private state. Full specification:
[`scenario-handoff.md`](scenario-handoff.md), and §14.19 for why the
publishable set is drawn there.

The MCP export carries three constraints worth stating, because they are what
keeps it honest:

- **It is somebody else's contract.** Neither the `mcpServers` envelope (the
  de-facto client config shape) nor the bridges' own flags are defined by the
  MCP specification. They live in one table, `MCP_BRIDGES`, verified against
  each project's README and watched by `docs/registry/specs-registry.md` — one place to
  fix when one of them moves, and the reader gets a link to the bridge's own
  documentation next to the selector.
- **Credentials are placeholders, never values.** Each security scheme becomes
  the header it would travel in (`Authorization: Bearer YOUR_TOKEN`, the
  `apiKey` header name) with a visibly fake value, and the card says so above
  the block. The environments hold real secrets; an export that leaked them
  into a file the reader hands around would be a defect (rule 12). A scheme
  with no header form (`apiKey` in a query or a cookie, `mutualTLS`) is
  reported rather than approximated, and two schemes claiming the same header
  do not both ship — the first declared wins, visibly.
- **No URL, no config.** A schema given inline exists only inside the page:
  there is nothing for a bridge to fetch, and the card is absent rather than
  wrong. Overlays declared by URL (§5.1.2) are passed to the bridge that reads
  them and produce a warning on the one that does not — the agent would
  otherwise see a document the reader never saw. An overlay with **no** URL —
  inline in the host page, or the reader's own patch — cannot be handed over at
  all, and gets its own warning on every bridge, the overlay-reading ones
  included: those are precisely the configs that look complete while missing
  one. **Hiding** gets a third: it lives in this page and never in the
  document, so a bridge pointed at the URL turns the curated-out operations
  into tools — the one surface where the gap of §5.2 becomes an action rather
  than a stale link.

The same gap reaches `llms.txt`, whose `## Reference` section links the
published OpenAPI file while every line above it was generated from that file
overlaid and filtered. When either changed anything, the link is qualified in
the generated text, one clause per gap — an agent told to prefer the
machine-readable contract has to know the two can disagree, and in which
direction each time.

#### 5.14.1 The hand-off menu

The "Copy page" menu answers one question — *give me this page elsewhere* — in
three registers, in that order:

- **This page, as Markdown**: copied, or shown raw first ("View as
  Markdown", a dialog over the doc — a hash SPA has no `?format=md` route to
  hand out, so the raw view is a view, not a URL). Both display and copy the
  same string, and the dialog can save it as `{operationId}.md` /
  `{slug}.md`.
- **This page, handed to an assistant**: ChatGPT and Claude, opened with
  the Markdown embedded in the prompt, truncated to keep the URL under the
  browsers' limit.
- **The whole API, wired to an agent**: `llms-full.txt`, then the MCP
  registration in the three shapes a reader's own tool takes it in — the JSON
  block (home card), the `claude mcp add …` one-liner, and the Cursor and
  VS Code install links. All three come out of one `toMcpConfig` call, so the
  command and the links install exactly what the block shows; the same
  placeholder rule and the same *no URL, no config* rule apply, which is why
  the section is simply absent for an inline schema.

The registration is API-wide even in an operation's menu: what an agent needs
is the document, and the config never narrows to one endpoint. Its base URL
follows the selected environment, never an operation-level `servers` override
— the endpoint doc re-renders on every change, and a prose page, which does
not, rebuilds its menu instead (`src/components/copy-page-menu.js` takes the
MCP context as a provider for exactly that reason).

One menu, two subjects: what changes between them is only the string being
handed over — `toEndpointMarkdown` for an operation, `toDocsPageMarkdown` for
a prose page (§5.14.2).

#### 5.14.2 A prose page as Markdown

`src/export/docs-page-markdown.js` turns a docs page into the Markdown the menu
copies. It works on the body the page component already holds, so nothing is
fetched twice, and it does three things:

- **The page as authored**: `.md` with its frontmatter dropped (the render
  drops it too), `.txt` verbatim, `.html` flattened to its text — the same
  choice `llms-full` makes, for the same reason.
- **A title only when there is none**: the nav title becomes an `# H1` unless
  the body already opens on one. Only the first non-blank line is examined —
  a `#` further down is as likely to be a shell comment inside a fence.
- **`{{var}}` travels literally.** The rendered page resolves references
  against the selected environment, and those values include credentials
  (rule 12); the export carries the template, which is also what makes it
  re-pointable at another environment.

### 5.15 Network insights

Full specification: [`network-insights.md`](network-insights.md). The app
explains what the network just did, using only what the browser already
exposes — no runtime dependency, no server cooperation required, and nothing
rendered when the API opts into nothing.

Three readings, one rule: **facts first, interpretation second, always both.**
An insight sits *next to* the data it reads, never in place of it.

- **Failure diagnosis** (`diagnoseFailure`, `src/openapi/insights.js`) — when
  `fetch` dies before any HTTP response, the raw browser error stays verbatim
  and a verdict is added: offline, mixed content, CORS-suspected, or
  unreachable. The last two are told apart by one probe — a `GET`,
  `mode: 'no-cors'`, no headers, no body, aborted after 5 s, fired only after
  a send has already failed. An opaque answer proves reachability and nothing
  else, so every verdict says "most likely" and means it. Stored on the
  history entry, because the probe cannot be faithfully re-run later.
- **Response header intelligence** (`analyzeResponseHeaders`) — one registry
  of recognized families (rate limit, `Retry-After`, `Deprecation`/`Sunset`,
  `Link` pagination, correlation ids, validators), one parser each, lenient:
  a malformed value yields no insight rather than a broken one. Recomputed at
  render time from the stored headers, never stored — the headers stay the
  single source of truth. Two of the families are actionable on `GET`/`HEAD`:
  follow a `Link` rel, or replay the request with its validator.
- **Transfer insights** (`extractTransfer`) — protocol, compression ratio and
  cache hit, read from the Resource Timing entry the send pipeline already
  locates. Stored, because that buffer is transient and capped. Cross-origin
  without `Timing-Allow-Origin` every size reads 0, which is
  indistinguishable from "no data" and is treated as none.

Rendering is one component, `src/components/insight-strip.js`, shared by the
try-it response panel and the history detail — the two differ only in the
background they land on, and in that the actions live where a response panel
can show what they send back. Storage impact: two nullable fields on the
history entry (`diagnosis`, `transfer`), inside the existing history policy —
no new dataset (§6.1). The HAR export maps the transfer snapshot onto its
standard size fields (§5.7).

### 5.16 The header bar

`src/shell/header.js` composes the bar from parts it is handed already
resolved — `app.js` stays the only module reading the host config (rule 10).

**Four zones, and the order is the reading**: which document (burger, brand,
version, spec selector, status badges) · how to find something in it (the
search trigger) · what to act on it with (environment, history, import) · the
app itself. A 1 px rule stands between them, and the acting zone is where the
one coloured control lives — the environment selector, deliberately the only
pill in the bar, because it is the only control here with consequences (it
decides where a send goes). Everything else is a square glyph of one size,
labelled through its tooltip and its accessible name.

**One line, from 320 px to 2560 px** (`header.spec.js`, which is the contract —
without it "one line" is an opinion). The two flanks split the leftover space
so the search stays centred, but they yield differently: the naming side may be
squeezed, the acting side may not, because a glyph has one size and a word does
not. What goes, in order, as the bar narrows: the API version at lg, the
status-badge labels at xl, the shortcut chip at lg, the API name at sm — but
only when a logo can stand in for it — and the environment's name at sm, where
the colour that identifies it is already doing the work. Nothing that goes is
lost: each survives in an accessible name, a tooltip, or the home page.

**The search trigger exists at every width**: a field from md up, an icon
below. It used to start at lg, which left the phone with no search in the bar
at all and a two-tap path through the navigation drawer — on a documentation
site, for the control reached for first. Exactly one is rendered at a time; the
drawer carries none, so the palette's accessible name stays unambiguous.

**The preferences menu** is the one thing in the bar that is about the app
rather than about the API: the theme section (§5.9), the language section
(§5.10), then the settings drawer (§5.11) and About (§5.13) as items. A theme
and a language are picked once and never again, and a permanent slot in the
bar is paid for on every page; behind one trigger they cost a click on the day
they are wanted and nothing on every other day.

The trigger is a plain overflow glyph, never a gear. A gear opening a menu
whose own first item is called *Settings* says one word for two different
things — so the split is named where the meaning is: **preferences** change
how the app looks, **settings** govern what it keeps.

Each section builds its own controls and the menu supplies the grammar they
are dressed in (`menuSectionHeading`). A section with nothing to choose — one
available theme, one available language — is not rendered, and its separator
goes with it. What a section defers building, the menu triggers on its first
open: it is the only part that knows it is about to be looked at.

## 6. Storage model

Two mechanisms, no dual paths (§14.4):

- **localStorage** — small, user-driven data: environments, preferences,
  theme, language, snippet language, try-it header memory.
- **IndexedDB** — three databases: `apidoc-history` (request history,
  purged by retention), `apidoc-scenarios` (user artifacts, never evicted —
  capped instead), `apidoc-schema` (schema snapshots for the local
  changelog/diff).

One documented exception: the OAuth PKCE handshake state
(`apidoc.oauth.pending`) lives in **sessionStorage** — it must survive the
full-page redirect but stay ephemeral and per-tab, which neither
localStorage nor IndexedDB offers. The key is declared in
`src/storage/maintenance.js` with every other key the app writes, and the
full reset drops it: a fresh start must not resume someone else's login.

Storage keys use the name-neutral `apidoc:` prefix and `apidoc-*` database
names; the console prefix is `[api-doc]`. This is deliberate: renaming the
project is a no-op for stored data.

In multi-spec, environments, header memory and history are namespaced per
spec — see [multi-spec.md §5](multi-spec.md).

### 6.1 Bounded-storage policy

Anything persisted on the user's device declares a policy — TTL + cap,
hard cap with explicit user-facing rejection, or LRU. **No dataset may grow
unbounded**, and adding a new stored dataset requires adding it to the
inventory below **and** to `storageInventory()` in
`src/storage/maintenance.js`, which is what the settings panel (§5.11)
counts and erases.

The three shapes, and why each dataset gets the one it gets:

- **TTL + cap** for machine-generated records the user did not ask to keep
  (history). Eviction is silent, so the rules are stated in the UI.
- **Hard cap with rejection** for user artifacts (scenarios, the user
  overlay). Evicting one would be data loss, so the write is refused instead
  and the user is told to export or delete. A document is never *truncated* to
  fit: a shortened overlay still parses and says something else.
- **LRU** for caches (schema snapshots). Losing one costs a missing
  changelog, nothing more.

The docs-page search index (§5.8) is the one dataset with no policy line
because it has nowhere to grow: it lives in memory for the lifetime of the
page and is rebuilt on the next load — bounded by construction, not by a cap.

Bodies made of files are the one dataset that gets **no** policy, because
nothing about them is persisted: only a name and a size ever reach storage
(§5.5.2). A 200 MB upload therefore costs the same as a 2 KB one.

### 6.2 Key inventory

**localStorage** — prefix `apidoc:`; per-spec keys are `apidoc:{specId}:{key}`
(single-spec installs use the bare key, see [multi-spec.md](multi-spec.md)).

| Key | Scope | Content | Bound |
|---|---|---|---|
| `theme` | global | selected daisyUI theme | single value |
| `language` | global | selected UI language | single value |
| `snippetLang` | global | try-it snippet language | single value |
| `code-lang` | global | selected language of the docs-page code tabs (§5.8) | single value |
| `spec.selected` | global | active spec id (multi-spec) | single value |
| `layout.navWidth` / `layout.tryItWidth` | global | resized column widths | single value each |
| `environments` | per spec | environments (name, baseUrl, variables, default headers) | user-authored or link-authored; the link is capped (below) |
| `environment.selected` | per spec | active environment id | single value |
| `tryit.headers` | per spec | remembered header values | 50 names (FIFO), 8 KB per value |
| `webhookSim.url` | per spec | last webhook target URL | single value |
| `user-overlay` | per spec | the user's own Overlay 1.1 document (§5.1.2) | 64 KB serialized, hard cap: a save above it is refused and writes nothing |
| `user-overlay-seed` | per spec | fingerprint of the host's starting patch as last handed to this browser (§5.1.2) | single value; outlives the document it seeded, which is what makes a removal stick |

Environments are the one localStorage dataset with no numeric cap: the set is
fully visible and deletable in the environment manager, and the only way in is
a gesture in that manager — or an accepted **setup link** (§5.3), which is the
one entry point that is not typed by hand and is therefore bounded at the door:
8 KB of decoded payload, 50 variables, 20 default headers, 200-character names,
4 KB values. Over any of those, the whole link is refused rather than trimmed
(`src/env/setup-link.js`, `tests/env-setup-link.test.js`). What is left is a
volume risk on a variable *value*, not on the count.

**sessionStorage** — one documented exception, above.

**IndexedDB** — three databases, one store each:

| Database | Store | Content | Policy |
|---|---|---|---|
| `apidoc-history` | `entries` | request/response log | TTL + cap: `history.maxAgeDays` (30) AND `history.maxEntries` (500), purged on every write; bodies truncated at 256 KB with a `truncated` flag |
| `apidoc-scenarios` | `scenarios` | user-authored scenarios | hard cap 200 per spec; past it the write is refused with an actionable message — never silent eviction |
| `apidoc-schema` | `snapshots` | operation fingerprints per schema URL, for the local changelog | LRU-style: 20 records max, least-recently-*written* evicted; a record over 1 MB is not stored at all |

Snapshot eviction keys on write date rather than read date on purpose:
refreshing the date on read would rewrite a 100+ KB record on every page load
to protect against a case whose worst outcome is one missing changelog.

The storage layer is unit-tested against `fake-indexeddb`
(`tests/history-store.test.js`, `tests/scenario-store.test.js`,
`tests/schema-snapshot.test.js`, `tests/header-memory.test.js`) — the bounds
above are assertions, not intentions.

## 7. Core vs shell

Strict separation between the **core** — `src/openapi`, `src/components`,
`src/scenarios`, `src/storage`, `src/export`, `src/import`, `src/search`,
`src/audit`, `src/env`, `src/docs`, `src/theming`, `src/i18n` — and the
**shell**: `src/app.js` (bootstrap, config reading, branding) plus the
`src/shell/` modules it drives (§9). The host config is read in exactly two
files — `app.js`, and `src/boot-prefetch.js`, whose whole job is firing the
schema fetch before the bundle finishes evaluating (§14.20). The core never
imports the shell and never sees the host config directly.

## 8. Security model

- **All HTML derived from external content** (OpenAPI descriptions,
  examples, remote `.md` pages, scenario files) goes through DOMPurify. No
  exceptions.
- No `eval` / `new Function`; no unsanitized `innerHTML`. Scenarios are 100 %
  declarative for the same reason — no scripting surface.
- Secrets: device storage in clear text is assumed and **flagged in the UI**
  (disclaimer on sensitive variables). Avoid production secrets on shared
  machines.
- A scenario share link never executes nor writes anything on open — import
  requires an explicit user gesture, and exported scenarios never contain
  sensitive values (credentials stay `{{var}}` templates).
- An **environment setup link** (§5.3) is untrusted input from a URL and is
  treated as such: total decode (any deviation is `null`, never a throw), every
  field re-typed, hard caps (§6.2), and one thing it can produce — environment
  content. It cannot name a storage key, reach another spec's environments, or
  execute anything. It writes nothing before an explicit Apply, and its payload
  is taken off the URL by `replaceState` before the first render, which removes
  it from the address bar and from session history — but not from the message
  that carried it nor from the recipient's clipboard, which is why the
  generator ships a skeleton by default and warns, in place, the moment a
  secret is opted in.
- Hiding operations is a documentation feature, not access control (§5.2).

## 9. Project structure

```
/
├── index.html              # local dev page
├── demo/
│   ├── cdn-install.html    # minimal page simulating the CDN install
│   ├── mock-sw.js          # service worker answering the demo API in-browser
│   ├── register-mock-sw.js # its registration, shared by both demo pages
│   ├── schemas/            # demo petstore schema
│   └── scenarios/          # the scenario shipped with the demo
├── config.example.js       # annotated config reference (user-facing)
├── src/
│   ├── app.js              # bootstrap (shell) — reads the host config
│   ├── boot-prefetch.js    # pre-bundle schema fetch — the one other config reader (§14.20)
│   ├── config.js           # host-config reading, shared by the app and the bake CLI
│   ├── shell/              # views, panels, toolbar, themes, head.js (per-route <head>)
│   ├── openapi/            # loader, $ref resolution, model.js (normalization),
│   │                       # auth.js, send.js, sample.js, diff.js, hide.js
│   ├── components/         # light-DOM web components
│   ├── scenarios/          # scenario model, loader, runner, pointer, step controller
│   ├── audit/              # schema audit engine + one file per rule (pure)
│   ├── search/             # Cmd+K index
│   ├── docs/               # docs-pages model: manifest, markdown extensions, sections, vars
│   ├── theming/            # custom theme validation/generation (§5.9, pure)
│   ├── credits.js          # third-party components shipped in the bundle (§5.13)
│   ├── router.js           # hash routing
│   ├── specs.js            # multi-spec config normalization
│   ├── env/                # environment model, colors, interpolation
│   ├── storage/            # prefs (localStorage) + IndexedDB stores
│   ├── export/             # curl, postman, markdown, har, snippets, arazzo, llms, mcp… (pure)
│   ├── import/             # curl/postman/har parsers + operation matcher (pure)
│   ├── i18n/               # runtime i18n + bundled en.json
│   └── styles/
├── i18n/                   # other language sources (fr.json…) → copied to dist/i18n
├── docs-pages/             # demo .md pages
├── docs/                   # this documentation
├── tests/                  # Vitest (pure core) + tests/e2e (Playwright)
└── scripts/                # bake CLI, preview-cdn, health checks
```

## 10. Testing

- **Vitest** targets the pure core only (no DOM environment): normalization
  (3.0 and 3.1 fixtures, circular refs), interpolation, export generators
  (snapshots), auth mapping, scenario runner, routing, multi-spec config.
- **Playwright** covers UI behavior, persistence and the bootstrap — always
  against the **packed tarball** served by the CDN simulation
  (`npm run preview:cdn`), not dev sources: every e2e run revalidates the
  real distribution. The whole suite covers three engines and two emulated
  phones; CI gates on Chromium and dispatches the rest (§13.0). Includes a
  performance budget test against the
  heaviest document the repo ships, the demo's GitHub REST schema
  (`demo/schemas/github.json`, ~12 MB, 1220 operations).

## 11. Non-functional requirements

- Runs on the declared support baseline — Chrome/Edge ≥ 111, Firefox ≥ 128,
  Safari/iOS ≥ 16.4 — enforced at build time and exercised on three engines.
  Policy, enforcement chain and the API audit behind it: §13.
- No account or internet dependency, apart from loading the remote schema,
  remote `.md` pages, language files, and the test requests themselves.
- Performance is a feature: parse/first-render budgets are enforced by the
  perf e2e against that schema. A change regressing the
  budget needs an explicit trade-off decision, not a budget bump.
- Responsive, desktop-first. Below the `lg` breakpoint the 3 columns do not
  stack: the nav becomes a side drawer (header hamburger button) and the
  try-it a full-screen bottom sheet opened by a floating button. One panel
  open at a time; closes on veil click, Escape, route change, or swiping the
  sheet down. The floating button steps out of the way while the reader
  scrolls down — it sits over the doc column, and what is under it is covered
  for as long as they stop there — and comes back on the way up, which is the
  gesture that means "I am looking for the control". Never while it holds the
  focus: away is `visibility: hidden`, and that would take the keyboard
  off-screen with it.
- Keyboard affordances are shown where a keyboard is. The search field's
  shortcut chip and the palette's ↑↓/⏎/esc legend name gestures a finger
  cannot make, so they are withheld from a device with no fine pointer — the
  same predicate that decides whether the copy buttons hide until hover.
- Accessibility: WCAG 2.2 AA on the interactive paths — the model, what is
  enforced and what is knowingly not, in §12.

## 12. Accessibility

Target: **WCAG 2.2 AA on the interactive paths**. The primitives live in
`src/components/a11y.js` — one implementation, so the contract cannot drift
into three slightly different versions.

**Keyboard.** Every control is a native `button`, `a`, `input` or `select`:
no click handler on a `div` (the mobile scrim is the exception, and Escape
does the same job), and the only `tabindex` on a non-interactive element is
the one scrolling blocks carry (below).
Tablists — response codes in the doc, pretty/raw/headers in the try-it,
observed response vs declared schema in the step editor, the code-tab groups
of a docs page (§5.8) — follow the WAI-ARIA APG pattern: **one tab stop for the whole bar**, arrows to move
inside it, Home/End to jump, wrap-around at the edges, selection following
focus. Dialogs are native `<dialog>`: Escape closes them, and `openModal()`
returns focus to the element that opened them (the browser's own restore
gives up when that element's toolbar re-rendered while the dialog was open,
which is our common case). The mobile drawer and bottom sheet do the same.
`modalDismiss()` refuses to build a dismiss control without both an accessible
name for the backdrop and one for the button. Four of those names spell out the
dialog they close; the rest are a plain "Close", which is what a reader needs
beside a dialog that has just announced its own title — harmonizing the ten
would be churn, not a fix.

**An open panel makes the page behind it inert.** Below lg the drawer and the
sheet are modal surfaces, and the scrim only settles the pointer: without more,
Tab walks straight out of the panel into a page the reader cannot see, and a
screen reader browses it just as freely. `shell/panels.js` therefore marks the
rest of the layout `inert` while a panel is open — the other column, the
resizers, the header, the footer and the skip link — and unwinds it on close,
when one panel replaces the other, and when a resize crosses lg, which the
off-canvas CSS handles by media query and `inert` cannot. What stays live is
what has to answer while a panel is open: the scrim, the FAB, the modal
dialogs, and the toast stack, whose `role="status"` would go silent inside an
inert subtree.

The two triggers are in that backdrop, so the panels own the focus round trip
rather than leaving it to the browser: opening the drawer moves focus onto the
drawer itself (`tabindex="-1"`, not its search field — that would raise the
virtual keyboard), opening the sheet onto its close button, and every dismissal
that is not a navigation — Escape, the scrim, the close button, the downward
drag — returns focus to the hamburger or to the FAB. Inert is also why the
central doc cannot be *written* to while the sheet covers it, which is what a
thumb already experienced: the mirror specs act on the doc through
`editInDoc()` (helpers.js), the phone gesture itself.

**Skipping the navigation (2.4.1).** The first tab stop of the document is a
skip link — `sr-only`, revealed on focus — landing on `<main>`, which carries
`tabindex="-1"` so focus actually stops there and the next Tab continues into
the content instead of restarting at the top. It cancels its own click and
moves focus by hand: the fragment belongs to the router (§5.2), and a real
`#apidoc-main` navigation would parse as an unknown route and render the home
page. Without it, the distance between the top of a page and its first line of
content is the length of the nav, which is the size of the documented API.
For the same reason the nav scrolls its own scrollport to bring a
deep-linked entry into view rather than calling `scrollIntoView`: Chromium's
implementation also moves the sequential focus navigation starting point onto
what it scrolled, which would put a reader's very first Tab in the middle of
the endpoint list.

**Scrolling blocks are declared tab stops.** A code block, a header dump or a
wide table scrolls but holds nothing focusable, and a keyboard can only reach
what it can focus. Chromium and Firefox paper over that by focusing such a box
themselves; WebKit does not, and there everything past the visible edge is
reachable by pointer alone — two of the five projects. `scrollBlock()` in
`a11y.js` therefore states it in the markup rather than inheriting it:
`tabindex="0"`, `role="group"` and an i18n'd `aria-label` (a group without a
name is announced as an anonymous one), plus the `.api-scrollport` class that
paints the ring, since daisyUI paints none for a `<pre>`. It is applied to the
example and response blocks of the doc and the try-it, the request and
response bodies of the history, the take-away sources, the Markdown source
view, the setup dialog's table, and every fence of a rendered Markdown block
— OpenAPI descriptions and docs pages alike, swept once per block builder in
`components/markdown.js`. Boxes that already hold a control (the nav, the
try-it column, a menu, the palette results, the scope checkboxes) are left
alone: they are reachable through what is inside them.

**The focus ring is painted, and asserted.** daisyUI answers `:focus-visible`
on a menu entry with a 10 % tint of `base-content` and an explicit
`outline-style: none` — the same treatment `:hover` gets, so the keyboard has
no signal of its own. The design layer restores a 2 px ring for every menu the
app renders, the nav and the dropdowns alike; everywhere else the outline is
daisyUI's or the platform's.

**Announcements.** A single polite live region, created once and mutated
afterwards, carries anything the user cannot see happening: send start,
response status and duration, network failure, scenario run verdict, and a
blocked send. This is deliberately *not* the `role="alert"` boxes the
components render — a live region inserted with its text already in place is
a new node, not a mutation, and screen readers stay silent on it. A blocked
send also moves focus to the field that blocked it. The region travels with the
top layer: a modal `<dialog>` makes the rest of the document inert, and an
inert region is announced to no one, so `openModal()` moves it inside the
dialog for its lifetime and hands it back on close.

**Motion.** What the design layer animates is small on purpose — the nav's
active rail, a tab underline, the send meter and the status flash — and all of
it answers `prefers-reduced-motion: reduce` by dropping the movement and
keeping the state. The guard also covers daisyUI's own modal box, which slides
and scales in without asking: the search palette is opened on every Cmd-K, so
that is the one movement a reader meets constantly.

**Landmarks.** Beyond the shell's own, a docs page contributes two `<nav>`
landmarks with i18n'd labels: its table of contents and its prev/next pair
(§5.8). The nav's external links carry an `aria-hidden` icon and announce the
new-tab behavior through a visually hidden suffix in their accessible name;
an operation card names its whole destination (`METHOD path — summary`)
rather than leaving three fragments to be read in a row.

**Enforcement.** `tests/e2e/a11y.spec.js` runs `@axe-core/playwright` over
home, operation doc, try-it (before and after a send), history dialog,
scenario view, webhook simulator, the search palette and a docs page
exercising every prose feature at once, gating on
`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`/`wcag22a`/`wcag22aa`. It must stay
green (rule 15). Selecting the 2.2 tags is what *enables* `target-size`: axe
ships it off by default, and a tag that names it overrides that — the 2.2 line
of the list is therefore load-bearing, not decorative.

**The keyboard sweep**, which is what axe structurally cannot do: axe judges
nodes, and whether a keyboard can reach a control is a property of the walk
between them. `tests/e2e/keyboard.spec.js` walks the home page and an operation
with the try-it open by Tab alone, forward then back, on the five projects. It
derives the expected stops from the live DOM and asserts that none is missing
and that no stop is unaccounted for; a roving tablist contributes exactly one
stop by construction, because the derivation reads `tabIndex` rather than a
list of exceptions. It asserts a non-zero, non-transparent outline at every
stop — on the control or on the block that owns it, which is where `.collapse`
paints its own. And it asserts the content is two key presses from a cold
start, the skip link being the one it activates instead of tabbing past. The
only stop it accepts without markup asking for it is a scrollport an engine
made focusable on its own — and the reverse is asserted too: no box may
scroll, hold nothing focusable, and lack a declared stop, on any engine. On the
mobile projects it also walks each open panel and asserts the walk never leaves
it, which is the inert backdrop above read from the keyboard's end.

**Target size (2.5.8), and what carries it.** The 24×24 floor is machine-gated
like any other rule, and it is the criterion the 2.2 move actually cost
something: it found 26 nodes over 7 surfaces. Five of them are now sized
rather than argued — the import candidate radio and the shared `checkbox()`
of `dom.js` (16 px, and the rows they sit in are one line apart, so no
clearance stands in for the size), the history toolbar's redaction toggle
(33×20), the audit report's location link and its *why* disclosure (86×16 and
95×16, standalone on their line, where the inline-in-a-sentence exception does
not reach), and the eleven environment color markers, whose painted dot stays
16 px inside a 24 px button because `gap-1.5` left them 22 px of clearance —
two short. What remains under 24 px conforms through the criterion's **spacing
exception**, not through an exemption we granted ourselves: 6 targets on the
home view, 35 on an operation with its try-it open, 23 on the audit report, 52
in the environment manager. Those are daisyUI's stock sizes — `btn-xs` paints
23 px tall, a `badge` button 20 px — and re-cutting them would be owning a
library's metrics to gain one pixel the criterion does not ask for. axe
measures the clearance itself and reports **zero** `incomplete` on every swept
surface, so the exception is verified rather than assumed.

**Reflow (1.4.10) and text spacing (1.4.12), which no scanner asks.** Both are
questions about the page under a constraint it was not authored for — a 320 px
viewport, a reader's own stylesheet — and axe only judges the page it is handed.
`tests/e2e/reflow.spec.js` asks them, on the five projects, over the home view,
the drawer, an operation with its try-it before and after a send, the history
with an entry open, settings, the search palette, the environment manager, a
scenario and its step editor, the webhook simulator, the import dialog, both
halves of the setup link, the audit and a docs page.

- **1.4.10** is measured on `<main>`, the header, every open `.modal-box` and
  whichever off-canvas panel is open — not on `<html>`, which would assert
  nothing: the shell is an `h-screen` column whose content scrolls inside it, so
  the document never grows and the panels are `position: fixed` over it.
  Nothing scrolls sideways at 320 px. What the criterion exempts — "content
  requiring two-dimensional layout" — is not guessed here but named: exactly the
  `.api-scrollport` blocks above, whose declared tab stop is what makes the
  exemption honest, and only for their own overflow, never for a container's.
  The criterion also forbids *loss of information*, which is the half that found
  something: two boxes threw their text away rather than widen. The footer
  credit showed 15 % of "Powered by apiglow v0.1.0" — 160 px of the bar are
  reserved for the "Try it" FAB, leaving 148 for a credit and a link list that
  want 271 — and now truncates from lg up only, wrapping below. A step editor
  preview showed 36 % of `: "available" | "pending" | "sold"`; previews are
  capped at 60 characters upstream, so it wraps instead, at a cost of one line
  at worst and never above 320 px. The floor is **half the string**, and the two
  truncations that stay are deliberate: the doc's base-URL reminder at 74 %,
  which carries `shrink-[9999]` precisely so the path beside it never
  truncates, and the send meter's `aria-hidden` telemetry at 90 %, whose figures
  are spelled out in the response header next to it.
- **1.4.12** injects the criterion's four values as the WCAG working group's own
  bookmarklet does — `line-height: 1.5`, `letter-spacing: .12em`,
  `word-spacing: .16em` on `*`, `margin-bottom: 2em` on paragraphs — and
  measures the *difference*, which is what the criterion asks: not what clips,
  but what the override costs. Vertically, any new clipping fails, and that is
  the criterion's own subject: every height-capped cartouche in the app pairs
  its `max-h-*` with an `overflow-auto` — the history bodies, the step editor's
  key list, the palette results, the response panes — so the answer is "it
  scrolls", and nothing is cut. Horizontally only a fall under the half floor
  fails: widening every line by a few per cent is what a deliberate `truncate`
  absorbs, and the base-URL reminder goes from whole to 86 % on the widest
  mobile project by the same rule that keeps the path intact.

**The two criteria a scanner cannot answer.** 2.4.11 *Focus not obscured* and
3.3.7 *Redundant entry* have no axe rule; both were walked by hand.

- **2.4.11** had one real failure. The nav's search header is `sticky top-0`
  inside the column's own scrollport, and moving focus *upward* (Shift+Tab)
  scrolls the entry flush with the scrollport top — which is exactly where the
  header is pinned: a 33 px link ended up 100 % covered by the 48 px header.
  The fix is `scroll-padding-top` on the two scrollports that carry a sticky
  header (`scroll-pt-14` on the nav drawer, `scroll-pt-12` on the try-it sheet
  below lg, where the 64 px handle pinned at `-top-4` covers the first 48 px).
  The docs page's table of contents is also sticky but sits in a column of its
  own, overlapping nothing.
- **3.3.7** has nothing to fix, by construction. The credentials cartouche
  reads its fields from the environment store and writes back to it, so a
  token typed once in the try-it is already there everywhere it is asked for
  again; sharing an environment as a link offers its variables *for selection*
  out of that same store rather than asking for them a second time. The setup
  link **builder** is a blank form on purpose — it is the "build from scratch"
  path (`docs/env-setup-link.md` §3.5), offered beside the share dialog for
  someone who has no environment yet, i.e. no previous entry to carry over.

**Color contrast is gated, on the themes we author.** Every scan runs on
`apiglow` — the sweep stores the choice itself, so a fixture that still asks
for stock `light` is measured on the pair anyway — plus one pass on
`apiglow-dark`, and `color-contrast` is enforced like any other rule. What
that promise covers is exactly the default install. Five properties hold
it up, and they are the shape of the design layer rather
than scanner appeasement:

- **the palette is floored by its own `-soft` derivation** — a semantic color
  belongs to the pair only if it clears 4.5:1 as ink on an 8 % wash of itself
  (§5.9). That is a stricter constraint than the same color on the plain
  surface, and it is the one that binds: red at `#dc2626` cleared white at
  4.83:1 and its own wash at 4.36:1;
- **the ink recipes belong to the semantic colors alone** — `-soft` and
  `-outline` paint the token itself as ink, which a *surface* token cannot
  survive: `neutral` is the dark half's panel color, so `badge-soft
  badge-neutral` reads at 1.37:1 on `apiglow-dark` while clearing 12:1 on
  white. Relighting `--color-neutral` is not the answer — it is what
  `bg-neutral` paints with. A badge with nothing semantic to say (an HTTP
  method outside the colored set, an import candidate for one, a tag `kind`
  that only flags) is `badge-ghost`, whose ink is `base-content` on
  `base-200`;
- **secondary text is a color, never an opacity** — `text-subtle` (70 % of
  the ink) and `text-faint` (66 %) carry every secondary text
  throughout the components, never `opacity-40…80`. Opacity multiplies: a `opacity-60` caption
  inside a `text-white/70` chip lands at 0.42 of the ink, and no ratio
  computed on the token predicts it. The highlight.js comment is the same
  rule applied to a token map: it dims at the `text-faint` level by mixing,
  where an `opacity` would also have reached the fixed palette of the try-it
  code panel, whose colors are not the theme's to dim;
- **daisyUI's own dimmed roles are ours now** — `menu-title`, `stat-title`,
  `label`, table heads and inactive tabs are re-colored at the same level as
  any other secondary text. They are 11–12 px labels, the text a
  low-contrast recipe hurts most;
- **de-emphasis never dims text below the floor** — the response example
  picker marks its unselected chips with a neutral tint and `aria-pressed`
  instead of an opacity, and the send meter's stats carry per-element colors
  instead of a container opacity.

**Where the scanner cannot answer: inside a modal.** daisyUI stretches the
backdrop's dismiss button across the whole `.modal-box`, so axe reports
`color-contrast` as *incomplete* — "background color could not be determined
because it is overlapped by another element" — for every node of a dialog, and
an incomplete is not a violation. What holds the floor there is the palette
rules above, plus a ratio computed from the painted pixels for the surfaces
whose whole point is a color (`a11y.spec.js`, `contrastRatio`); a sweep of an
open dialog gates everything *but* contrast.

The modal is the widest of those blind spots, not the only one: daisyUI paints
buttons and badges with a depth gradient, which axe reads as a background image
it cannot resolve, and a one-character count is "too short to determine if it
is actual text content". Every `incomplete` a sweep collects is therefore
printed to the Playwright output with the reason axe gives for not answering —
journalled, never gated, since a check that could not decide is not a defect
and gating one would redden every dialog by construction. That log is the only
place a ratio no rule ever measured becomes visible, so it is meant to be read,
not just emitted. Read end to end, it answers for itself: the fourteen button
and badge surfaces it leaves undecided clear 4.5:1 on both authored themes. That
is a reading, not a gate — the day a token moves, the same reading is what will
catch it.

**What it is not a promise about: the other themes.** The app ships **every**
standard daisyUI theme (rule 3) and a ratio fixed on `apiglow` says nothing
about `dracula`: overriding a library's palette to fix a stock theme would
replace an inherited limitation with one we own. What the decision owes an
integrator is the figure, not a repaint — `npm run report:contrast`
(`scripts/report-theme-contrast.mjs`) measures the design layer's ink recipes
— the `-soft` and `-outline` badges, the soft alerts, the highlight.js
mapping, the two secondary text levels — on the painted pixels of every theme
in `dist/app.css`, and prints the pairs under 4.5:1 per theme, worst first. It
gates nothing and runs nowhere but by hand; a stock theme costing dozens of
pairs is information for the person choosing it, not a defect to fix here.
Same reasoning for a host's `theme.custom`: those colors are the host's, and
the one scan that renders them (`app-themes.html`) is the single place the
rule is switched off.

**What a screen reader actually says.** axe judges nodes and the keyboard sweep
judges the walk between them; neither hears anything. `npm run report:speech`
(`scripts/report-screen-reader.py`) does: it drives a real Orca over Firefox by
keyboard alone — landing and skip link, an operation opened from the nav, a
send, the response tablist, a webhook delivery, the history dialog, the
environment menu, the search palette, a scenario run — and prints what Orca said
at each step, read out of Orca's own speech log. Attribution is by timestamp
rather than by draining a buffer after each press: an announcement that arrives
late is exactly what a live region is for, and it has to land in the report
rather than in the gap between two reads. It gates nothing: it runs by hand on a
Linux session with `orca` and `Xvfb`, and as the CI job the manual dispatch adds
alongside the other engines, where the transcript is the run summary. Nothing is
ever spoken out loud, speech-dispatcher being pointed at a `printf` for the
occasion, and the report holds stdout on a descriptor of its own — the daemons
under the virtual display write thirty lines there before the first key is
pressed. Five findings, none of them reachable by
a scanner: three are properties of what a press *does*, one is a silence that
only listening could hear, and the last is a field a scanner reads as named
because a placeholder is a name to it.

- **A send dropped the keyboard on `<body>`.** The Send button disabled itself
  under the finger that had just pressed it, so the reader restarted at the top
  of the document — and the document-level focus change swallowed the polite
  announcement that followed 100 ms later, so the one sentence carrying the
  status and the duration was never spoken at all. Cancel now takes the focus
  for the flight and hands it back to Send. The hand-back was already written,
  and had never once run: nothing ever gave Cancel the focus it tested for. It
  also needs Send re-enabled *first* — `focus()` on a disabled button is a
  no-op, and re-enabling at the end of the method is too late. The webhook
  simulator's own Send has no Cancel to lend the keyboard to, so it is never
  disabled at all: it stays put for the flight behind the same re-entry guard
  the scenario run uses below.
- **A scenario run did the same through the other door**: the view rebuilds
  itself when the run starts, and a disabled button cannot be handed focus back.
  The run button stays enabled, carries `data-keep-focus` so `keepPlace()`
  brings the focus across the refresh, and holds the re-entry guard `disabled`
  used to buy.
- **The search palette was silent.** It moves a highlight through a list its
  input never leaves, and the active result was a CSS class and nothing else:
  arrowing announced nothing, and Enter opened something that had never been
  named. It is now the ARIA 1.2 combobox its behavior always described —
  `role="combobox"` on the input, `role="listbox"` on the list, `role="option"`
  per result, `aria-activedescendant` following the highlight — and the result
  count goes through the shared region, a list rebuilt whole on every keystroke
  being an insertion rather than a mutation.
- **And everything a dialog said was said to nobody.** The single region above
  lives on `<body>`, which a modal `<dialog>` makes inert, and an inert subtree
  is not announced — so the settings clearing a dataset, an import landing, a
  palette counting its results all reached a region no reader was listening to.
  Nothing in the DOM shows it: the text is there, correct, in a live region that
  is genuinely live. `openModal()` now walks the region into the top layer with
  the dialog and hands it back on close, to the dialog below if two are stacked.
- **The webhook simulator answered to nobody.** Its Send disabled itself with no
  Cancel to lend the keyboard to, so it dropped focus exactly like the try-it's —
  and it announced a departure, "Sending…", before the request left. On a
  receiver that answers in milliseconds that is the message which *wins*: the
  region collapses two announcements made inside its debounce into one, and the
  status and the duration were erased by the sentence preceding them. The button
  now stays enabled behind a re-entry guard, and only the outcome is spoken —
  which is what the try-it already did. Its receiver URL field, meanwhile, was
  labelled on screen and anonymous to a reader: `labeledBlock` draws a heading,
  not a label, so the accessible name fell through to the placeholder — a name
  axe accepts, and Orca reads out as "https://example.com/hooks/…".

Other gaps we know about: the doc's heading order follows the OpenAPI schema
it renders, so a schema with odd nesting can produce an odd outline; and the
reader we listened to is Orca on Gecko — NVDA, JAWS and VoiceOver have never
been run, so what the pass above establishes is that the model holds on one
real stack, not on all of them.

## 13. Browser support

**Baseline: Chrome/Edge ≥ 111, Firefox ≥ 128, Safari/iOS ≥ 16.4.**

This is the Tailwind CSS 4 / daisyUI 5 floor. The stack already imposes it,
so declaring anything looser would be a lie about a bundle whose CSS layer
could not paint; and it matches the web-platform "widely available"
Baseline. Combined with evergreen auto-update on Chrome/Edge/Firefox, it
covers ~97–98% of global traffic, the residual being browsers the CSS
already cannot serve. Decision record: `docs/cross-browser.md`.

**One source of truth.** The `browserslist` field in `package.json`. Nothing
else states a version:

1. `vite.config.js` derives `build.target` from it through
   `browserslist-to-esbuild` — no hardcoded `es20xx` to drift.
2. Tailwind's Lightning CSS pass reads the same target, and emits only the
   fallbacks the baseline needs: deriving it keeps some 35 kB of duplicated
   pre-`oklch` color declarations out of `dist/app.css`.
3. `npm run check:syntax` (`es-check checkBrowser … --checkFeatures`) reads
   the same field and validates `dist/app.js` after every CI build. It is
   the only guard between a `build.target` regression and a bundle no
   baseline browser can parse — CI's own browsers are all far above the
   floor, so no test suite would notice. Invariant 17 fails if the workflow
   stops running it.

**Old versions are handled statically, never executed.** Playwright ships
one version per engine, so a suite can only ever prove the *current* one.
The lever for old versions is the chain above; the lever for current ones is
the engine matrix below.

### 13.0 The engine matrix

Five Playwright projects, three browser binaries, as parallel CI jobs keyed
on the binary — the mobile projects reuse the one their desktop sibling
installed. A push or a pull request runs the chromium job; the other two
engines run when the workflow is dispatched by hand
(`docs/cross-browser.md` §1):

| Project | Engine | Profile | CI job | Runs on | Not run |
|---|---|---|---|---|---|
| `chromium` | Chromium | Desktop Chrome | chromium | push, PR, dispatch | — |
| `mobile-chrome` | Chromium | Pixel 7 | chromium | push, PR, dispatch | `perf.spec` |
| `firefox` | Firefox | Desktop Firefox | firefox | dispatch | `perf.spec`, `mobile.spec` |
| `webkit` | WebKit | Desktop Safari | webkit | dispatch | `perf.spec` |
| `mobile-safari` | WebKit | iPhone 14 | webkit | dispatch | `perf.spec` |

`npm run test:e2e` stays Chromium-only so a dev loop or an agent run never
pays for the matrix by accident; `npm run test:e2e:all` is the local opt-in.

Three things are deliberately not cross-engine, each for a reason that is not
"it was failing":

- **the perf budgets** stay pinned to `chromium`: they measure through
  `PerformanceObserver('longtask')`, which only Chromium implements, and they
  are a regression tripwire rather than a cross-engine benchmark (rule 14
  forbids loosening a budget to fit an engine — pinning is the alternative);
- **`isMobile`** is unsupported by Playwright's Firefox, so `mobile.spec.js`
  cannot run there and no mobile project can be Firefox-based;
- **the real clipboard** is readable on Chromium alone (`clipboard-read` is
  not a permission the other engines know). The suite therefore asserts the
  *payload* handed to `writeText` through a capture installed on navigation,
  with one Chromium-only test reading the actual clipboard so the capture
  cannot end up measuring itself.

Two harness limitations are recorded where they bite: Playwright's WebKit
reports no post body once it came from a `File`/`Blob` (the upload specs
assert everything but the bytes there), and it refuses to fulfill any 3xx —
which costs the conditional-replay 304 test on that engine and is why the
simulated OAuth authorization server hands back a navigating page instead of
a redirect.

### 13.1 Platform APIs vs the floor

Everything the source uses sits within the baseline, with one exception,
which degrades explicitly (rule 19):

| API | Chrome | Firefox | Safari | Verdict |
|---|---|---|---|---|
| `structuredClone` | 98 | 94 | 15.4 | within |
| `<dialog>` / `showModal()` | 37 | 98 | 15.4 | within |
| `Object.hasOwn` | 93 | 92 | 15.4 | within |
| `requestIdleCallback` | 47 | 55 | 16.4 | within, exactly at the floor |
| `navigator.clipboard.writeText` | 66 | 63 | 13.1 | within |
| `AbortSignal.timeout` | 103 | 100 | 16 | within |
| `crypto.randomUUID` | 92 | 95 | 15.4 | within |
| `inert` | 102 | 112 | 15.5 | within |
| `Intl.DisplayNames` / `RelativeTimeFormat` | 81 | 86 | 14.1 | within |
| CSS `:has()` | 105 | 121 | 15.4 | within |
| **Popover API** (`showPopover`) | **114** | 125 | **17** | **above the floor** |

The Popover API is what puts the anchored list (`anchored-list.js`) in the
top layer, and it lands after the floor on both Chrome and Safari. It is
therefore treated as an enhancement, detected once
(`TOP_LAYER_SUPPORTED`) and degraded in two ways:

- the `{{var}}` autocomplete keeps its list, positioned the same way, as a
  body-level `position: fixed` element with an explicit `z-50`. The top
  layer bought it nothing else — placement was always computed in JS.
- the long-enum combobox (`leafField`) does **not** degrade in place: it is
  rendered inside modal `<dialog>`s (env manager, settings), which own the
  top layer alone, so without it the list would be painted *under* the
  dialog. There it falls back to a native `<select>`, which scrolls and
  supports prefix search.

`tests/e2e/baseline.spec.js` deletes `showPopover`/`hidePopover` before boot
and asserts both behaviors — the only way the suite can exercise a floor no
shipped engine still sits on. A new API above the floor adds a row here and
a test there, or it moves the floor.

## 14. Design rationale

The decisions that shaped the codebase, stated with their reasons. They
exist so a future contributor — human or agent — does not "fix" something
that is the way it is on purpose. Each holds until argued down in a PR, not
worked around silently.

### 14.1 Light DOM, never Shadow DOM

The UI is native Web Components styled by Tailwind CSS + daisyUI — a global
stylesheet driven by utility classes and theme CSS variables. Shadow DOM
isolates a subtree from exactly that stylesheet, so every component renders
in **light DOM**; scoping relies on class/prefix conventions. Consequences:
zero bridging machinery (no constructable stylesheets, no per-component CSS
injection, no `::part`), but also no encapsulation — components avoid
overly generic class names, and host-page CSS can in principle leak in
(accepted: the app owns the whole page in the intended install). Corollary
rule: Tailwind/daisyUI class names are never built dynamically
(`badge-${x}`) — the JIT purge would drop them; static maps only.

### 14.2 Runtime dependencies: platform-first, open only for spec/format work

Every runtime dependency ships to every reader of every documentation built
on this bundle: weight, attack surface, supply-chain liability. So the UI,
state and utilities are built on the platform (native `fetch`, `<dialog>`,
IndexedDB, Web Components), even when a library would be shorter.

The one sanctioned opening is **spec and format work** — reading,
transforming, querying or emitting a document of a specification the app
claims to support. The specifications themselves force it: Overlay 1.1
makes full RFC 9535 JSONPath a conformance MUST, and hand-writing a
conformance-tested query engine is the wrong thing to own — subtly wrong
selection is silent. A dependency is admitted when all four hold: (1) it
does spec/format work; (2) **we genuinely want the whole job done** — where
the app implements a bounded subset on purpose, the subset stays and the
library is refused (standing case: body validation is minimal by choice, so
no Ajv — the library would answer a question the product chose not to ask);
(3) the library is serious — browser-ready, maintained, used through its
published API; (4) its cost is stated: pinned exactly, listed in §2 with
role and weight. Weight is a stated cost, not a veto — and not the reverse
either: the need commands the dependency, never the other way round.

The verdict-by-verdict walk of the existing in-house spec/format code under
this rule lives in the coverage contract
([openapi-coverage.md](openapi-coverage.md)).

### 14.3 One normalized model

OpenAPI 3.0/3.1/3.2 differ in spelling (`nullable` vs `type: [..,"null"]`,
boolean vs numeric `exclusiveMinimum`, `example`/`examples`/`dataValue`,
3.2's free-form methods and `in: querystring`). All versions normalize into
**one internal model** (`src/openapi/model.js`); rendering consumes only
that model, and no version branch exists outside normalization. Hiding is
applied there too: a hidden operation does not exist in the model. New
construct = a change in `model.js` plus fields consumed by views, never a
version branch in a view; everything downstream (nav, search, exports,
diff, llms-full) stays consistent for free. Cyclic schemas are marked in
the model and expanded lazily with a max depth. Tolerances for real-world
generator quirks (`bool`/`int` types, non-array `enum`) live in
normalization only.

### 14.4 The storage split

**localStorage** for small user-driven settings (environments, preferences,
theme, language, header memory); **IndexedDB** for records (history,
scenarios, schema snapshots) — from day one, no store-then-migrate dual
path, no migration code between tiers, ever. Separate databases per life
cycle: history is purged by retention, scenarios never are — one database
would couple opposite policies. The one exception is the OAuth PKCE
handshake state in **sessionStorage**: it must survive a full-page redirect
yet stay ephemeral and per-tab, which neither of the other two offers.
Every dataset declares a bound (§6.1).

### 14.5 History retention is global, not per spec

`history.maxEntries`/`maxAgeDays` are root-only, though nearly everything
else merges per spec: retention is a browser storage cap, not a business
view, and two competing values would make the effective retention depend on
the last spec visited. The exception is declared in code (`ROOT_ONLY_KEYS`
in `src/specs.js`) with its reason, emitted verbatim in the console
warning — a silently inert setting is a treasure hunt.

### 14.6 The scenario model is aligned on Arazzo

Arazzo standardizes exactly the concepts scenarios need — steps, `outputs`,
`successCriteria`, runtime expressions — so the internal model is
deliberately mapped onto them (extractions ↔ outputs, expect ↔
successCriteria, RFC 6901 pointers), and export/import are mostly a
translation of runtime expressions rather than a structural conversion.
The standard's constraints leak in usefully: variable names with dots
export with underscores (Arazzo reserves the dot as its expression
separator); `operationId` is used when the schema declares one,
`operationPath` otherwise — the internal fallback id never leaves the app.

### 14.7 Bundled `en`, lazy-loaded other locales

`src/i18n/en.json` is statically imported: the UI can never be broken by a
network failure. Every other locale lives in the repo-root `i18n/`
directory, copied to `dist/i18n/` at build time (a custom Vite plugin —
Rollup cannot see `new URL()` runtime loads) and lazy-fetched on demand.
The asymmetry is the point — do not "unify" the two locations: bundling
everything kills the lazy load, lazy-loading English kills the no-network
fallback. A language switch reloads the page: every component re-renders
translated without global re-render machinery.

The language actually loaded comes from a **choice**, exactly as the theme's
does (§5.9): a stored code, or the virtual `'browser'` which reads
`navigator.languages` at boot and takes the first entry `available` offers,
primary subtag included. The choice is what the switcher shows as current and
what the selector writes — so touching the menu pins a language for good, and
"Automatic" is the way back to following the browser. `'browser'` is the
built-in `language.default`: an install that configures nothing serves each
reader the language their browser asks for. It resolves to the first offered
language when the browser asks for none of them — never to a code the
switcher could not show as current.

### 14.8 Single-file bundle

One `<script>` tag is the install contract, so the lib build sets
`codeSplitting: false` and externalizes `undici` (pulled transitively by
ref-parser, never imported in the browser: a fetch-based resolver handles
HTTP `$ref`s and an inert `globalThis.Buffer` stub satisfies its
environment probing). Both flags are **load-bearing**: a tooling upgrade
that drops either silently breaks the CDN install while dev mode keeps
working — the packed-tarball e2e and `npm run check:dist` are what catch
it.

### 14.9 Assets resolve via `import.meta.url`

`app.js` must find `app.css` and `i18n/*.json` wherever the host page lives
and whatever CDN path serves it. `document.currentScript` is `null` inside
an ES module, so every runtime asset resolves via
`new URL('./…', import.meta.url)` and `app.js` injects its own stylesheet
link on boot. The bundle is location-independent: any CDN, any subpath, no
configuration — provided the build keeps assets next to `app.js` in `dist/`.

### 14.10 Scenarios are declarative-only, one runner for both modes

Request chaining is usually scripted (Postman, Bruno); here `eval`/`new
Function` are banned and a scenario must be shareable as inert data. So
scenarios are 100 % declarative — JSON Pointer extraction, simple
assertions, `{{var}}` interpolation — and a scenario file or link can never
execute code: importing one is safe to preview and requires an explicit
gesture to store. Execution is a single pure async generator
(`src/scenarios/runner.js`) with an injected sender: auto-run consumes it
in one go, guided step-by-step at the pace of the user's manual sends from
the real try-it. One orchestration path means verdicts, extraction and
failure handling cannot diverge between modes; the try-it sends through the
same pipeline (`src/openapi/send.js`), so a scenario step and a manual send
are the same request by construction. Expressiveness is bounded (no loops,
no computed values) — accepted, and aligned with the Arazzo mapping
(§14.6).

### 14.11 Name-neutral storage keys

Persistent identifiers outlive releases on users' devices. Storage keys use
the `apidoc:` prefix, the IndexedDB databases are `apidoc-*`, the console
prefix is `[api-doc]`, and the public runtime API is the `window.apidoc`
global with the `apidoc:ready` event ([host-credentials.md](host-credentials.md)) —
none carry the product name. The last two are not stored, but they are
contract surface written into host pages we don't control, which renaming
breaks the same way a renamed key breaks saved data. Do not "modernize"
these identifiers to match the package name; the mismatch is the feature.

### 14.12 E2E runs against the packed tarball

The deliverable is the CDN bundle, not the dev sources — a suite
exercising dev sources stays green while the artifact breaks (missing
`files` entry, dropped build flag, bad asset path). So Playwright runs
against the CDN simulation: `npm run build` + `npm pack`, tarball extracted
and served under `/npm/<name>@<version>/`, consumed by fixture pages with
an inline config and a single `<script>` — exactly the install contract,
with the API mocked at the Playwright layer. Unit tests stay scoped to the
pure core, no DOM environment; UI behavior belongs to e2e. Any change to
build output or package layout requires an e2e run even when unit tests
pass. The bundle URL is hardcoded (versioned) in the fixtures, as in
`demo/cdn-install.html`: a version bump updates them.

### 14.13 The audit reads the raw document

Rule 6 keeps every consumer on the normalized model — but the audit must
report exactly what normalization erases (`nullable` in a 3.1 document, a
3.2-only keyword in a 3.0 one, unreferenced components, shapes inlined six
times), which are unreachable from the model. The audit engine is therefore
a **second legitimate consumer of the raw schema** (the user overlay's dry
run, [user-overlay.md](user-overlay.md), is the third and last): the loader
returns the two raw shapes next to the model — `source`, a lazy getter over
the document as served with `$ref`s intact, and `document`, dereferenced
from a clone against the same URL — with `model` used by
the engine only as the hide filter's verdict (a hidden operation's findings
carry a badge instead of a dead link). Rule 6 is unchanged: it governs
rendering, and the audit page renders findings, not the schema. No view,
export or search reads `source` or `document`; version branches exist in
exactly two named places — normalization, and the version-awareness rules
whose purpose is comparing a spelling with the declared version. When
`features.audit` is `false`, the audit's own input is dropped; the parsed
source outlives it either way, because the dry run and the schema download
still read it. Any future
consumer of the raw schema is a new decision, not a precedent this one
grants.

### 14.14 Swagger 2.0 is converted in-house, upstream of normalization

2.0 differs from 3.x in *structure*, not spelling — a request body is a
parameter plus a root `consumes` list, components live under three root
keys with their own `$ref` prefixes, serialization is one
`collectionFormat` enum — so absorbing it in `model.js` would mean the
`if (isV2)` fork rule 6 forbids. Instead `src/openapi/swagger2.js`
(`convertSwagger2(doc)` → a 3.0.4 document) runs **between parse and
dereference**. In-house rather than `swagger2openapi`: the reference
implementation is Node-oriented (own resolver, `fs` paths, YAML stack)
where we ship one browser bundle, and a general-purpose converter cannot
make our calls — we convert to feed *our* model, deciding that a `ws://`
scheme produces no server and that a body parameter is inlined rather than
hoisted. Position-in-pipeline consequences, both deliberate: `$ref` strings
are rewritten (`#/definitions/…` → `#/components/schemas/…`), only possible
before dereference (fragment pointers only — a pointer into another
document was never converted); and the audit sees the conversion's output,
whose `openapi` field genuinely says 3.0.4, so no rule learns a second
dialect (§14.13 holds unchanged). What 3.0 cannot express is **marked, not
dropped**: `x-original-collection-format` records the original value and
the `conversion-approximation` audit rule surfaces each marker — rule 19's
documented-fallback tier applied to a format question. The version gate has
two exported lists (`SUPPORTED_OPENAPI_VERSIONS`, `SUPPORTED_SWAGGER_VERSIONS`),
stated as one promise in the About dialog; `model.sourceVersion` reports
`3.0.4` for a converted document and `model.convertedFrom` carries `2.0`,
so the two numbers are never unexplainable next to each other. Everything
downstream knows nothing about 2.0 — a 2.0-shaped construct reaching the
model, audit, renderers or exports is a converter bug, and the conversion
table is a contract pinned test by test in `tests/swagger2.test.js`.

### 14.15 Browser support follows Baseline "Widely available"

A guest `<script>` inherits its audience's browsers and cannot ask anyone
to upgrade, so platform-feature adoption needs an arbiter that answers the
same way every time: **Baseline (web-platform-dx), Widely available tier**.
Newly available is a watch state, not a green light: CSS
`contrast-color()` — which would let a soft badge stay readable on a
theme we do not author, the half of §12 out of reach — is Newly available
today, and therefore not adopted. The build target (derived from
`browserslist`, §13) moves
only when the policy covers the syntax being adopted and some code actually
wants it. No polyfills, no transpilation fallbacks — Baseline compliance is
what makes them unnecessary. The tier is a floor for *adoption*, not a
promise to refuse older browsers: nothing detects or blocks them. An
adoption needs Widely-available status **and** a concrete cited benefit
(code deleted, or a documented limitation lifted); platform fashion alone
is not a finding. The cost, accepted: genuinely useful APIs stay out of
reach for a while after they ship everywhere. §13.1 is the current audit of
everything the source uses against that floor.

### 14.16 The design layer owns the text colors, daisyUI owns the components

daisyUI stays the component engine; what sits on top of it is a small set of
tokens (§5.9, the type scale and spacing rhythm in `src/styles/app.css`) and
one rule about text: **a secondary level is a color, never an opacity.**

The reason is not taste. `opacity` applies to the whole subtree — it dims the
badges and icons inside a row along with its text — and it multiplies when
nested, so the ratio an element actually renders at is not the one its class
suggests. `text-subtle` / `text-faint` mix the theme's own ink instead: they
keep the hue, leave descendants alone, and are computable, which is what
makes the AA floor gateable at all (§12). The same rule is why de-emphasis
(an unselected chip, a quiet stats row) is expressed as a different color
plus an ARIA state, not as a dimmer copy of the selected one.

Three levels, and the third is the one worth explaining: inside a container
that paints its own text — an alert, a colored badge, the fixed navy request
panel — the theme's ink is the wrong answer, because using it would swap the
container's color for the page's. `text-quiet` mixes `currentColor` instead,
so a secondary line in an error alert stays that alert's red. It is the
narrow exception, and it is a color like the other two.

It extends to a handful of daisyUI's own roles — `menu-title`, `stat-title`,
`label`, table heads, inactive tabs — whose stock recipe sits below the
floor. Taking those over is deliberate: they are labels at 11–12 px, they
read on every theme, and the alternative (re-styling each call site) would
leave the next component to reintroduce the problem. Everything else about
the components is left to the library.

### 14.17 The user overlay: JSON in the editor, no host veto, and who wins when the host's patch changes

Three decisions of [`user-overlay.md`](user-overlay.md) that outlive the
feature itself.

**JSON only in the textarea**, while the URL channel keeps accepting YAML. The
URL rides the ref-parser we already ship, which reads both; the editor would
have to *emit* what it holds — the download of §5.11 is a file the user hands
upstream — and we have no YAML serializer. Half-YAML support (parse but never
emit) would make that download a different document than the one typed. A YAML
paste is refused with the reason, which is a smaller lie than a silent
translation.

**No config flag disables the editor.** Every other feature the host can close
(§5.12, scenarios, onboarding) changes what the *documentation* offers its
readers; a user overlay changes nothing but one browser's view of the schema.
A host that curates its docs loses nothing to it — `hide` still applies
downstream, and the patched document never reaches anyone else. Giving it a
switch would only take away the workaround from the reader the published
schema is already failing.

**The host's starting patch replaces the local copy when it changes.** A
document seeded into a reader's browser (§5.1.2, `openapi.userOverlay`) could
either be frozen at the version that browser first received, or re-seeded
whenever the host publishes a new one. Freezing keeps local edits, at the price
of a copy that drifts silently against a schema that keeps moving — and drift
is exactly the failure this whole feature exists to make visible. So the
declared document wins: changing it re-seeds every browser, local edits
included, and the reader's way out is the download that was already there. What
is *not* re-seeded is a removal — the fingerprint stays behind, so "remove the
patch" survives, which is the one answer a reader must be able to give an
installation about their own view.

### 14.18 Indexability: a runtime head, an author-side bake, and no server

A client-rendered hash SPA is invisible where documentation most needs to be
seen: an AI crawler fetches HTML and runs no JavaScript, and Google collapses
every `#/op/…` into the one URL the server answered. The industry answer is
static or server-rendered HTML per page — and a server is out by charter (§1),
so the answer splits in two, each half optional and each half honest about
what it buys ([seo.md](seo.md)).

**The runtime head** (`src/shell/head.js`) is what every install gets for free:
title, meta description and JSON-LD follow the route. It costs one module and
no build step, and most of its value is not even for crawlers — tabs, history,
bookmarks and shared links are what a human sees, and without it they all carry
the host page's one static `<title>`. What it deliberately does not write is a
canonical: under hash routing every route shares one server URL, so a
per-route canonical would be a claim the browser strips before it means
anything.

**The bake** is the half that requires an author to act, and that is the point:
it emits files, and only somebody deploying a site can put files anywhere. It
is not a prerender — no DOM, no components, no second rendering engine in Node.
It is the export layer of §5.14 written to disk, which is what keeps it from
becoming a second source of truth: a snapshot that disagrees with the app is a
generator bug, and the in-app "Copy page" output disagrees identically, so the
existing snapshot tests catch it. The cost is accepted where the platform
forbids the runtime's own answer: no DOMPurify without a DOM, and jsdom is not
a dependency the spec/format rule (§14.2) lets in, so raw HTML inside Markdown
is escaped in a snapshot while the live view still renders it — a documented
degradation, per rule 19, rather than a sanitizer we would have to trust twice.

**No SSR, no dynamic rendering, no History-API routing** to close the gap
instead. The first two need the server we do not have (and Google deprecated
bot-sniffing anyway); the third needs host-side rewrite rules — exactly what
hash routing exists to spare an integrator — and would still leave the non-JS
crawler with nothing, which is the audience the bake actually serves. The
`seo.index` flag is the other direction of the same doctrine: a publicly
reachable install that should not be found says so in a `<meta>` before first
paint, and the bake refuses to run against that config, because baking a
noindex site is a contradiction, not a preference.

### 14.19 A workflow is published, never re-authored

A scenario crosses this product's boundary twice, and both crossings are
decided by one idea: **the file the author owns is the file everything else
uses** ([scenario-handoff.md](scenario-handoff.md)).

**On the way in**, a `scenarios[]` entry is two independent axes rather than
four cases: the **format** is sniffed from the document — our
`apiglow-scenario` envelope or an Arazzo workflow document, read by the very
importer the file picker uses — and the **carrier** says where it comes from,
`url` (fetched) or `document` (the object straight in the config, for an
install that cannot serve files next to its page). Neither axis is a mode
anyone selects, because a mode is a thing to get wrong. An author who already
writes Arazzo declares those files as they stand and gets an executable
rendering of them; without that door the only way in is re-authoring, click by
click, a workflow that already exists — and once the CI panel exists, keeping
that copy in step with the file CI runs, by hand, forever. One Arazzo document
declares as many scenarios as it holds workflows, so there was no manifest
format to invent either.

**On the way out**, what is publishable is *what the config declares, and
nothing else*. A reader's own scenarios live in IndexedDB and never reach a
generated file. That is not a policy needing a switch: the bake is a Node
process that cannot open IndexedDB, so the boundary is structural, and the
in-app generators hold to the same set only so that a downloaded `llms.txt`
and a served one describe the same documentation. Which recipe a surface hands
out follows from the same idea — a declared Arazzo document is copied whole
(nothing of it passes through our model, so nothing of it can be lost there),
a scenario written in our envelope is generated by `toArazzo`, and an install
whose schema is not published gets no generated recipe at all rather than one
naming a source no runner can fetch, exactly as the MCP export is absent for
an inline schema (§5.14).

### 14.20 The boot pipeline is staged, and a session pays only for what it opens

Run as one task, the load of a heavy document — parse, clone, dereference,
normalize, chained through microtasks that never let the
browser breathe — would build everything the first screen might ever need
while the reader waits: the full nav, the search index, the language
menu, a clone of the schema kept for panels most sessions never open. The perf
contract (rule 14) forbids that shape, and what holds instead is a
principle, not a list of tweaks:

- **Stages are macrotasks.** The loader yields between parse, dereference and
  normalization, so no single boot task sums the pipeline, and the first
  render gets its own task after it.
- **The schema transfer starts before the bundle finishes evaluating.**
  `src/boot-prefetch.js` — deliberately dependency-free, hence evaluated ahead
  of every library's module init, and the one file beside `app.js` allowed to
  read the host config — fires the fetch and the body read; the loader
  receives the in-flight `Response`, never the config. On a CDN install the
  transfer overlaps the whole boot instead of queueing behind it.
- **Derived surfaces build on first use.** Nav group lists (§5.2), the search
  index, the language menu, the raw `source` for the audit and the dry run
  (§5.1): each is paid on the first open of the thing that needs it.
- **Deferred is not exempt.** The changelog fingerprints run off the critical
  path, but deferred WHOLE they landed as a third of a second exactly where
  the reader's first click went. `fingerprintRun` is a batched generator, one
  idle slot per batch — the same shape as `auditRun`, and the shape any future
  whole-model computation takes.
- **The budgets time the app, not the harness.** The boot budget is measured
  in the page, from the navigation's own origin to a real click taking effect
  — the same reasoning that moved the search budget in-page: driven over the
  wire, the steps are CDP round-trips and rAF-paced checks, a third of the
  budget on a CI runner, and a budget decided by the harness is not a budget.
