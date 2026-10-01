# Changelog

What changed in each released version, written for the people installing it.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html) —
before 1.0.0, a minor bump may break an installation.

Entries are written as the change lands, under `Unreleased`; `npm run release`
promotes that section into a numbered one ([`docs/release.md`](docs/release.md)).

## [Unreleased]

### Added

- Three components for your prose pages: `<Cards>` for a grid of links,
  `<Steps>` for a numbered walkthrough, `<Tabs>` for "cloud or self-hosted".
  You write them like MDX, but nothing is compiled and no framework ships —
  they are Markdown syntax, and a renderer that does not know them (GitHub,
  your editor) simply shows the prose inside. Full Markdown in every child:
  fences, callouts, tables, `{{variables}}`.
- Enum values carry their meaning: when a schema describes each value — with
  `x-enum-descriptions` (a list next to `enum`), `x-enumDescriptions` (a map
  from value to text), or as a `oneOf` of constants each with its own
  `description` — the documentation lists every value with what it means.
  A `oneOf` of constants now reads as the enum it is: a select in the try-it,
  not a choice between variants.
- `[Pagination](apidoc:page/pagination)` links one docs page to another by
  slug. Like the operation references it joins, the link is built through the
  router, so it keeps working under a multi-spec install where a hand-written
  `#/page/…` would not.
- `apiglow audit`: the schema audit from the command line, for CI.
  `npx apiglow audit openapi.yaml` grades the schema with the same rules as
  the `#/audit` page and exits non-zero when a check fails — findings of a
  given severity (`--fail-on`, errors by default), a minimum grade or score.
  A committed baseline (`--write-baseline`, then `--baseline`) lets an
  existing API adopt the check and fail only on new findings; an entry that
  no longer matches anything fails the run until `--prune-baseline` drops
  it. Reports as console text, Markdown (for a pull request or a GitHub job
  summary) or a versioned JSON report whose findings carry a stable
  fingerprint and whose rules come with their rationale and fix — what a
  script or an agent reads. One run writes several of them with
  `--report <format>=<file>`, including the formats CI platforms display
  themselves: SARIF for GitHub code scanning, GitHub annotations on the
  pull request's diff, GitLab Code Quality for the merge-request widget.
  `--min-severity` and `--only-new` trim what a report lists without
  changing the verdict. Every finding is placed at `file:line:column` in
  the file you edit, through `$ref`s into other files too; `--config`
  audits what your documentation shows, overlays and multi-spec included; a
  quoted pattern (`'apis/**/openapi.yaml'`) audits every schema of a
  monorepo, each under its path. `--offline` keeps a run off the network,
  `--fetch-timeout` bounds the wait for a remote schema. On GitHub, the
  `apiglow/audit-action` action does it all in one step; the docs carry
  recipes for GitLab, pre-commit and oasdiff.
- A 39th audit rule, `field-without-value`, catches a field declared with no
  value. Its usual cause is a YAML flow mapping cut by an unquoted comma:
  `{ description: The signed mandate, as uploaded by the client }` is the
  description "The signed mandate" plus an empty field — and the description
  then shows cut short in the documentation and its exports, which looks like
  their bug.
- The audit checks the document's structure against the OpenAPI
  specification, version by version: a field an object does not have
  (`descripton`), a required field missing (`info.version`, a parameter's
  `in`), a value of the wrong kind or outside the allowed set (`in: body`,
  `type: int`). Fields a later OpenAPI version introduced are now caught
  wherever they sit, not only in the handful the audit listed before.
  So are the objects' own constraints: fields that exclude each other, a
  parameter with both or neither of `schema` and `content`, a status code or
  a media type key that is none, a component name with forbidden characters,
  a URL or email field holding neither, a licence identifier that is no SPDX
  expression, duplicate tags and 3.2 tag parents that lead nowhere.
  Paths and parameters: a path that is no path template, two paths that are
  the same once their variables are renamed, a parameter listed twice, a
  header name `fetch` refuses, a style the parameter's location does not
  allow, a server URL variable with no definition, the 3.2 `querystring`
  parameter and `additionalOperations` used against their rules.
  References and the rest: a `$ref` that leads nowhere or to the wrong kind
  of object, siblings next to a `$ref` other tools ignore, a runtime
  expression that does not parse, an encoding the payload never uses, an
  operation with no success response, a discriminator its schemas do not
  declare, a security requirement asking for a scope no flow offers.
  Schemas are held to their own keywords: an `enum` its type rejects, bounds
  no value satisfies, a `pattern` that is no regular expression, a `format`
  the type cannot carry, a keyword that cannot apply (`maxLength` on an
  integer), a misspelled one (`maxLenght`, `readonly`), a nullable `enum`
  without `null`, an array without `items`, a property both read-only and
  write-only, a recursion no finite value satisfies, a `oneOf` listing a
  member twice. Payloads too: an example that is only a `$ref` (shown as
  written, not followed), raw bytes in a JSON body, a form body with no
  properties to build a form from, required fields in a merge patch, a
  problem+json `status` that contradicts its response code.
- A security category in the audit: eleven rules, each against the RFC or
  OWASP risk it breaks — an `http://` server (and the mixed-content block a
  hosted try-it then hits), OAuth and OpenID URLs without TLS, Basic or
  bearer credentials sent to a cleartext server, an API key in the query
  string, an `http` scheme no registry knows (`JWT`, `token`), operations
  open without authentication (a warning on writes, a note on reads, and
  the inventory of what `security: []` declares public), secured operations
  that never document a 401 or 403, a 401 without `WWW-Authenticate`, the
  OAuth password and implicit flows RFC 9700 retires, a 429 without
  `Retry-After`, a `format: password` field returned in a response, and
  request bodies whose strings and arrays have no maximum size.
- A sixth audit category, agent readiness: what an AI agent gets when it
  calls your API through a tool — an MCP bridge, a GPT Action, Semantic
  Kernel. Fifteen rules, each naming what concretely goes wrong: an
  `operationId` OpenAI refuses as a tool name, two operations whose tools
  say the same thing, more operations than a platform takes as tools,
  inputs with no type or no shape, unions an agent cannot tell apart, a body
  that is not an object, recursion a bridge cuts, enum values nothing
  explains, a parameter and a body property sharing a name (Semantic Kernel
  drops the operation, bridges overwrite one), request examples written
  where no tool sees them, errors returned as prose, and what this
  documentation's own MCP export cannot carry (cookies, credentials outside
  a header).
- `apiglow audit --explain <rule>` prints one rule — why it matters, how to
  fix it, its severity and options — and `--list-rules` prints them all as
  JSON. The JSON report now carries each rule's message template next to
  its rationale and fix.
- The npm package ships an agent skill, `skills/apiglow-audit/SKILL.md`:
  drop it where your coding agent reads skills and it runs the audit, fixes
  the findings and audits again — without inventing what your API does, and
  without silencing a rule on its own.
- An audit rule can take options, set next to its severity:
  `"operation-id-tool-name": { "severity": "warning", "maxLength": 128 }`.
- Every audit rule now says how to fix what it found, next to why it matters:
  on the page, in the Markdown report and in the CLI's console output.
- The audit's rules are configurable: switch one off, or change its severity,
  for the whole document or only under some paths (`/paths/~1legacy~1*`), in an
  `audit` block of the config — read by the audit page and by
  `apiglow audit` alike, or passed to the CLI with `--audit-config`. A grade
  computed this way is labelled "custom rule set" wherever it appears, so it
  never passes for the default one, and the CLI refuses to run on an entry it
  cannot read.

### Changed

- The audit holds examples and defaults to their whole schema: nested
  properties, required members, lengths, patterns, bounds, sizes, formats
  and compositions. A finding names the keyword and where in the value it
  breaks (`$.tags[0].name`); a broken format alone is a warning. Required
  properties declared through `allOf`, `oneOf`, `anyOf` or
  `patternProperties` count as declared, and `dependentRequired` is checked
  too. A 3.0 `nullable` with no `type`, Swagger's `x-nullable` and a 3.1
  schema `example` are flagged, each with its exact rewrite. A contact
  counts with an email or a URL, a licence with an identifier, a URL or an
  SPDX name. A response whose media type says nothing
  (`"application/json": {}`) no longer counts as content, a placeholder
  example (`"string"`, `{ "id": 0, "name": "string" }`) no longer counts as
  an example, and a deprecated operation answering with `Sunset` or
  `Deprecation` headers counts as dated.
- `app.js` is 63 kB lighter: the schema audit now loads only when someone
  opens `#/audit`, from `audit.js` next to `app.js`. Nothing changes on a
  CDN install; a self-hosted copy needs `dist/audit.js` beside `app.js`, or
  the audit page says it could not load.
- Placeholder text no longer passes for documentation in the audit: a
  description that reads "TODO", "string" or "lorem ipsum", or that only repeats
  its field's name ("User Id" on `userId`, the title code generators write for
  every property), now counts as missing.

### Fixed

- A 3.2 server's `name` is shown wherever the servers are listed — the home
  page, the environment manager, `llms-full.txt`, a copied page — and an
  environment created from that server is called by it, instead of by the
  server's description or URL.
- A relative link in the schema — an external example (`externalValue`), an
  `externalDocs`, license or contact URL — now points next to the schema, as
  OpenAPI 3.1 says, instead of next to the documentation page.
- A `[link](#errors)` in a description or a docs page now scrolls to the
  element with that id, on the page you are reading. It used to send you back
  to the home page.
- HTML in a description or a docs page can no longer carry a `<style>` that
  restyles the whole documentation, nor a form, input, button, textarea or
  select a reader could be asked to type into: they are removed, their text
  kept. An inline `style` attribute still works. Task lists (`- [x] done`)
  show ☑ and ☐ for their markers.
- The try-it says what the browser refuses to send, instead of failing in
  silence or as a network error. A header no page may set — `Origin`,
  `Content-Length`, any `Sec-` header, the full list of the Fetch standard —
  is named under the headers as soon as the request carries it, and a TRACE
  operation gets an error saying browsers refuse the method. Both stay in the
  cURL command. A pasted cURL or a HAR no longer brings in its `Sec-` and
  `Proxy-` headers either.
- A GET or HEAD request with a body in the document is no longer blocked by
  that body: the browser cannot send one, so the try-it now says so next to
  the body editor and sends the request without it. The body stays in the
  cURL command, which is how you send it. Replaying a 3.2 custom method from
  the history also sends it as the document spells it.
- A token request the browser blocks as mixed content (an `http://` token
  URL from a docs page served over https) now says so, instead of the
  generic "CORS or connectivity" error.
- The try-it no longer calls a failed request to `http://localhost` or
  `127.0.0.1` "mixed content": browsers allow those from an https page.
- A secret sent in the URL is masked even when URL encoding changes it: an
  API key with `+`, `/` or `=` (any base64 key) used to stay readable in the
  history and in every export of the request (cURL, HAR, Postman, snippets),
  because it reads `%2B`, `%2F`, `%3D` there.
- The MCP config, `llms.txt`, `llms-full.txt`, a copied page and the baked
  files no longer hand out a base URL holding `{{variables}}` (an environment
  created from a server like `https://{region}.api.example.com`): the
  environment's values are filled in, and a URL that would need a secret or
  an unset variable gives way to the document's own server.
- Server URL variables are filled in: `https://{region}.api.example.com`
  now sends to the variable's default instead of the literal `{region}`, and
  an environment created from that server keeps `{{region}}` as one of its
  variables, so changing it moves every request.
- A request body or a sample built from an `allOf` now carries every
  member's properties, not the first member's alone: the try-it's JSON
  prefill, the response examples, the XML samples, and the fields of a
  multipart or urlencoded form — which used to have no field at all.
- A 3.2 custom method (`additionalOperations`) is sent, and copied into
  snippets and exports, exactly as the document spells it: `purge` is no
  longer sent as `PURGE`.
- A list field holding something else — `tags: pets`, `parameters: {}`, a
  security scheme whose `scheme` is a number — or an empty YAML list item no
  longer takes the whole documentation down, nor the audit: the field reads
  as absent.
- A `$ref` that leads nowhere no longer stops the whole documentation from
  loading: the rest renders, and the audit names the broken reference.
- A `$ref` written inside an example (an API about JSON Schemas, say) is
  shown as written, instead of being replaced by the schema it names.
- A `description` or `summary` written next to a `$ref` now shows, as
  OpenAPI 3.1 says: it used to be dropped on most documents and kept on the
  ones with external references.
- The audit no longer asks for examples on files: a download or an upload (a
  PDF, an export, an image) has no example to write, and neither
  `operation-examples` nor `response-example` counts one against you anymore.
- `schema-expand-walls` no longer flags recursive schemas. A tree or a form
  that describes itself is your data model, not something to fix; deep
  nesting is still reported.
- `npx apiglow bake`, and the `apiglow` bin npm installs, now run the command:
  they used to exit at once without doing anything.
- The bake reads the overlays a config names from the config's own
  directory, like everything else it names, and warns when one cannot be
  read or applied instead of skipping it silently.

## [0.2.0] — 2026-08-16

### Added

- Announcements: a strip across the top of the documentation where you say
  what the schema cannot — a maintenance window, a deprecation date, a version
  that just shipped. Declare them inline in the config, or point
  `announcements` at a file your ops team edits on its own, with no redeploy of
  the host page. Each entry takes inline Markdown (one language or several), a
  level, an optional `startsAt` / `endsAt` window that publishes and retires it
  without anyone remembering to, and a dismissal the reader's browser
  remembers — unless you pin the notice.

### Removed

- The bottom credit bar is gone, and with it the `branding.footerLinks`
  option: About — with the license and the third-party notices — is reached
  from the preferences menu in the header, and the page keeps the height the
  bar was taking. A `footerLinks` left in a config is ignored.

### Changed

- The header holds one line at every screen size, phones included, where it
  used to take up to three. Theme, language, settings and About moved into one
  preferences menu at the end of the bar; the environment selector, the
  history and the request importer stay in reach.
- Search is now in the header at every width — an icon on a phone, a field
  from a tablet up. It used to appear only on wide screens, and reaching it on
  a phone meant opening the navigation drawer first.
- On a phone the "Try it" button steps out of the way while you scroll down —
  it no longer sits on top of the line you are reading — and comes back as soon
  as you scroll up.
- Keyboard shortcuts are advertised only on devices that have a keyboard: the
  search field's shortcut chip and the palette's key legend are withheld from a
  touch-only device.

### Fixed

- Phone layout: the spec selector's list no longer runs off the screen and
  gives the page a sideways scroll, dialogs no longer sit flush against the top
  and bottom edges (and stay reachable under a browser toolbar), an
  environment named for a real deployment no longer pushes the authentication
  badge out of its card, and the environment editor shows the whole of a
  variable's name.
- On a phone, following a link in the navigation now opens the new page at its
  top. The right page arrived, but scrolled to wherever the previous one had
  been left.
- Selected rows in the spec, environment and search menus: the second line (a
  spec's id, an environment's base URL, a result's path) was dark ink on the
  dark fill.
- Menu separators were drawn as two segments with a notch in the middle.
- Escape closes the search palette on the first press when a query has been
  typed, as its own legend says.
- The external-documentation and warning symbols came out of the colour-emoji
  font on Android.

## [0.1.0] — 2026-08-15

### Added

- Interactive API documentation generated in the reader's browser from an
  OpenAPI schema: one `<script>` tag, one config block, no backend.
- **Specifications** — OpenAPI 3.0.x, 3.1.x and 3.2.x rendered from a single
  normalized model, Swagger 2.0 converted at load with every approximation
  reported, OpenAPI Overlay 1.1 applied at load with anything it could not
  express listed rather than dropped.
- **Try-it panel** — real requests sent from the browser, environments and
  `{{variable}}` interpolation, every authentication scheme fillable, cookies,
  in-browser OAuth2, and an optional proxy for APIs that refuse the docs'
  origin.
- **Scenarios** — named, replayable request sequences, fully declarative:
  response values chained into later steps, assertions, a run report and a
  step-by-step tutorial mode. Arazzo 1.1 imports and exports.
- **Schema audit** — 38 rules across five categories, a score per category, a
  letter grade and a Markdown report, computed in the browser.
- **Imports and exports** — history entries out as cURL, Postman 2.1, HAR 1.2
  and Markdown, sensitive values redacted by default; the same formats paste
  back into a pre-filled try-it. Live request snippets in ten languages.
- **Docs pages** — Markdown and HTML prose woven into the reference navigation,
  with groups, per-page table of contents, callouts, tabbed snippets, links
  resolving to an operation, and pages carried by the host document itself.
- **AI surface** — `llms.txt`, `llms-full.txt`, per-operation Markdown copy and
  an MCP configuration block wiring an OpenAPI→MCP bridge, all generated
  in-browser with placeholder credentials.
- **Theming** — every standard daisyUI theme shipped in the CSS, plus custom
  themes declared in the configuration and generated at boot.
- **English and French** interfaces, both shipped and selectable at runtime.
- **`apiglow bake`** — a CLI that writes a crawlable static snapshot of the
  documentation for search engines.
- **Local storage with stated limits** — history, scenarios and snapshots in
  IndexedDB, environments and preferences in localStorage, each dataset with a
  documented retention policy.
- Keyboard-operable interface throughout, with focus management, live regions
  and an automated accessibility sweep in continuous integration.

[Unreleased]: https://github.com/apiglow/apiglow/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/apiglow/apiglow/releases/tag/v0.2.0
[0.1.0]: https://github.com/apiglow/apiglow/releases/tag/v0.1.0
