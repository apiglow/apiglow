# Schema audit

This document is the functional source of truth for the
audit feature, alongside [`architecture.md`](architecture.md) (§5.12). The
shipped rule set lives in `src/audit/rules/`, one file per rule with its
tests; this catalog describes each of them.

## 1. What this is

An analyzer for the OpenAPI schema the app loads, in the browser on the
`#/audit` page, and from the command line (`apiglow audit`, §8) where a CI
job can gate on it. It produces a report of findings — severity, message,
rationale, location, deep link to the operation — grouped into categories,
each scored, with an aggregate letter grade.

It is **not** a general-purpose linter competing with Spectral, vacuum or
Redocly lint on ruleset breadth or configurability. Our differentiators:

- **zero install**: runs on the schema the docs already fetched, in the
  browser — and in CI, one `npx` line with no ruleset to write;
- **clickable findings**: every finding on a rendered operation deep-links
  to it via the existing hash routing;
- **docs-readiness rules**: a category no generic linter can have, because
  it measures how the schema behaves *in this app* (see §4.5).

## 2. Product decisions

Current policy; changing one means revising this section, not silently
drifting.

1. **On by default, deliberately discreet, fully disablable.** The
   audience is the API producer working on their schema, not the consumer
   reading published docs — so the feature is active by default but gets
   **no nav entry**: its only entry point is a small block in the settings
   drawer (§5.11 of architecture.md), the least prominent spot in the UI,
   linking to `#/audit`. A publisher who wants none of it sets
   `features.audit: false`, which removes the route, the settings block
   and any computation entirely. Discreet-by-placement avoids publicly
   grading an API in its own docs while keeping the tool one click away
   for authors.
2. **Curated, doc-oriented ruleset** (104 rules across the six §4
   categories), each rule a pure, individually tested function — and
   **configurable**, because a real API has deliberate, permanent
   exceptions the baseline (§8.3) cannot cover on new code. The `audit`
   block of the host config (root and `openapi.specs[]` entries alike)
   switches a rule off or changes its severity, globally or under some
   JSON pointers:

   ```json
   "audit": {
     "rules": { "property-described": "off", "parameter-described": "error" },
     "overrides": [{ "paths": ["/paths/~1legacy~1*"],
                     "rules": { "operation-examples": "off" },
                     "reason": "frozen legacy API" }]
   }
   ```

   - Precedence: the rule's own severity, then `rules`, then every override
     covering the pointer, in declaration order — the last word wins.
   - A pointer pattern covers what it matches and everything below it; `*`
     matches within one segment, `**` as a whole segment any number of
     them.
   - A check where its rule is off does not count at all — neither as a
     finding nor in the score; a rule off everywhere is not even run.
   - A rule that takes options is configured with an object — its options
     next to an optional `severity`, Redocly's shape:
     `"operation-id-tool-name": { "severity": "warning", "maxLength": 128 }`.
     Options apply to the whole document: an override changes severities
     only, since a threshold that moved from one path to the next would
     grade one document by two yardsticks. Each value is checked against
     what the rule declares; `apiglow audit --explain <id>` lists a rule's
     options with their defaults and bounds.
   - Per spec: rules merge by id (the spec's last), overrides accumulate,
     root first.
   - `reason` is free text for the next reader of the config — JSON has no
     comments — and the audit only checks it is text.
   - Every entry is checked against the registry: the page names a wrong
     one in the console and applies the rest; the CLI refuses to run
     (exit status 2) — a pipeline must never pass on a configuration
     nobody wrote.
   - A grade computed this way is **not the default grade** and says so
     wherever it goes (`report.profile`, §3): next to the letter on the
     page, in both exports and in the JSON. Grades stay comparable because
     a custom one is never presented as the default.

   No custom rules. The baseline is not an ignore list either: it changes
   which findings fail a CI job, never which ones are reported.
3. **Per-category score + aggregate letter.** Category percentages make
   the letter defensible; the letter alone would be arbitrary, counts
   alone are not shareable.
4. **Dedicated routed page `#/audit`**, reached from the settings drawer
   only. Not a home-page section, not a nav entry; the report itself is a
   full page, not a settings-panel widget.
5. **Versions: exactly what the app supports** — OpenAPI 3.0.x / 3.1.x /
   3.2.x. No Swagger 2.0 pipeline just for the audit: a 2.0 document is
   converted to 3.0.4 upstream of everything (`src/openapi/swagger2.js`),
   and what the audit scores is that conversion. Rules are version-aware
   (see §4.6), and the conversion's own approximations get a rule of their
   own (`conversion-approximation`).
6. **The rule engine is in-house, plain JS.** Not because dependencies are
   forbidden — the dependency policy admits libraries for spec and format
   work (design rationale: `architecture.md`) — but because a linter's
   value *is* its rule set, and ours is written for what this app renders.
   A general-purpose OpenAPI linter would answer a different question.
7. **A command line for CI, on the same engine** (§8). The page and
   `apiglow audit` run the same rules and produce the same report; the
   command only adds what a pipeline needs around it — an exit status,
   machine-readable output, a baseline. It is part of the MIT package like
   everything else. `features.audit` does not apply to it: that switch
   removes the page from published documentation, and an author running
   the command asked for the report.

## 3. Report shape

A finding:

```
{ ruleId, severity, category, location, opRef | null, dataPath, params, hidden? }
```

- `severity`: `error` (almost certainly a schema bug) / `warning`
  (probably hurts consumers or the docs) / `info` (worth knowing).
- `category`: one of the six §4 categories.
- `opRef`: the operation route target when the finding maps to a rendered
  operation — the UI links it. A finding on a **callback** carries its
  parent operation's `opRef`: the callback is rendered inside that page and
  has no route of its own, so its `location` names the callback to tell it
  apart (`{callback name} · {METHOD} {runtime expression}` — the runtime
  expression alone would not say which callback fired, and two findings on
  one operation would be indistinguishable, on the page and in the export
  alike). Findings on operations hidden via `x-apiglow-hide` or
  `openapi.hide` keep `opRef: null` and show a "hidden" badge instead of a
  dead link: the audit sees the **full** schema (an author wants the whole
  picture), but never links to a non-routable view. Hidden operations are
  detected by absence from the normalized model — the model *is* the hide
  filter's verdict, so the engine reimplements none of it.
- `dataPath`: JSON-pointer-ish path into the schema document, displayed
  for findings without an `opRef` (components, top-level info, …).
- `params`: the values the finding's i18n message interpolates
  (`t('audit.rule.{id}.message', finding.params)`); `hidden` marks a
  finding on an operation the model filtered out (the badge of the
  `opRef` bullet above).

The report also carries its own identity and perimeter:

- `report.api`: title, `info.version`, `contact` and `license`, read from
  the raw `info` like every other rule input — the model normalizes these
  too, but it drops what it cannot render (an empty `contact: {}`, a
  `javascript:` licence URL), and those are exactly the cases
  `info-metadata` grades. The report shows what the document wrote.
- `report.scope`: operations, groups, webhooks, security schemes — the
  same units as the home page's stats — plus the schemas, the audit's own
  unit of work. Counted on the document, so hidden operations are in the
  figures. "Groups" is the count of distinct tags, declared or merely used;
  no fallback bucket for untagged operations (`operation-tagged` already
  reports them one by one), a tag borne only by a webhook makes no group
  (the nav lists webhooks flat, in their own section), and neither does a
  3.2 tag whose `kind` is not navigational (it badges the operations
  carrying it). No
  "callbacks" figure: the scope counts the same units as the home page,
  and nothing in the app counts callbacks.
- `report.profile`: `{ custom, rules, options, overrides }` — whether the
  run used a rule configuration (§2.2), the severities and the options it
  set, by rule, and how many path overrides it declared. `custom: false` is the default grade. A
  configuration that switches every applicable rule off leaves nothing to
  grade: `score` and `grade` are then `null`, and the page shows a dash
  rather than inventing a letter.

Every rule ships four mandatory i18n strings — `audit.rule.{id}.label`,
`.message`, `.why`, `.fix` — in both `en` and `fr` (rules 9/17 of
CLAUDE.md). The label names a folded group, where a message interpolated
with one occurrence's values could not speak for all of them. The two
others split the actionable half, which is the product: `.why` says why it
matters, in one or two sentences; `.fix` is the recipe — what to write, and
where — shown under it on the page and in both exports, and what an agent
fixing the document reads. A `.fix` may interpolate the finding's params
like the message does. `tests/audit-strings.test.js` checks all four over
the registry, in both languages.

### Scoring

- Each rule application is a pass/fail check against a target (an
  operation, a parameter, a component, the document).
- Category score = weighted pass rate over its applicable checks, weights
  by severity: error 3, warning 2, info 1. Not-applicable checks don't
  count (an API with no deprecations scores 100 % on deprecation hygiene,
  not 0), and a category with no applicable check at all is absent from
  the report rather than scored.
- Aggregate letter from the mean of category scores: A ≥ 90, B ≥ 80,
  C ≥ 65, D ≥ 50, F below. Thresholds are constants in one place
  (`src/audit/constants.js`), and the UI's grade colors reuse `gradeFor()`
  rather than a second set of thresholds.

## 4. Rule catalog

104 rules, one file per rule under `src/audit/rules/`, `rules/index.js` the
only registry. Rules whose scope must be narrowed to stay truthful say so
below: a finding that names a degradation which cannot happen is a false
positive, not caution.

**Scope of the walk**: regular operations, webhooks, and callback
operations — one level deep for callbacks, like normalization (the spec
allows callbacks of callbacks, and a dereferenced circular `$ref` makes
that infinite). A callback entry carries its parent's route key and its
parent's hidden state: a callback has no route of its own, the doc renders
it inside the operation that declares it, so its findings deep-link to the
parent.

### 4.1 Correctness

Contradictions inside the document — mostly `error`. The three
version-awareness rules (§4.6) also belong to this category: a construct
that contradicts the declared version is a correctness finding.

- `duplicate-operation-id` (`error`) — the same `operationId` declared
  more than once.
- `path-param-declared` (`error`) — path template placeholder with no
  declared `in: path` parameter. Skips webhooks and callbacks: their
  "path" is a name or a runtime expression, whose `{…}` are not path
  templates.
- `path-param-in-template` (`error`) — declared `in: path` parameter
  absent from the path template. Same webhook/callback exemption.
- `path-param-required` (`error`) — path parameter not marked
  `required: true`.
- `required-property-declared` (`error`) — `required` listing properties
  absent from `properties`.
- `required-with-default` (`warning`) — a required parameter, or a
  property listed in `required`, that still declares a `default`. The
  default can never apply — the caller always supplies the value — and it
  says the opposite of `required`, so readers and code generators get
  contradictory signals. Both spellings live in one rule because they are
  one authoring mistake; one check per required element, so the score
  reads as the share of the mandatory surface that does not contradict
  itself.
- `example-type-mismatch` (`error`) — `example`/`examples` value
  incompatible with the declared type or enum.
- `default-allowed` (`error`) — a `default` its own schema rejects
  (outside the `enum`, or violating min/max): the form prefills a value
  the API will refuse, and every client generator copies it.
- `unused-component` (`warning`) — component defined but never
  referenced, in every `components` section the spec defines, `pathItems`
  included. Reads the **source** document: once dereferenced, a `$ref` is
  indistinguishable from an inline copy (§5).
- `security-scheme-declared` (`error`) — `security` requirement
  referencing an undeclared scheme.
- `response-substance` (`warning`) — response object with neither
  `content` nor `description` substance.
- `discriminator-mapping` (`info`) — `discriminator.mapping` key whose
  target is neither one of the composite's variants nor a schema
  inheriting from it through `allOf`. `info` because an external target is
  legitimate and looks the same from here.
- `link-target` (`warning`) — response `link` whose `operationId`, or
  whose same-document `operationRef`, names no operation of this document.
  Unlike a discriminator target, both spellings promise something local,
  hence `warning`. An `operationRef` into another document is skipped — a
  real usage this app cannot follow — and so is a link declaring neither
  field, which is an invalid Link Object rather than a broken one.
- `field-without-value` (`error`) — a field declared with no value
  (`null`) where OpenAPI gives an empty value no meaning. The usual cause
  is invisible in the file: a YAML flow mapping cut by an unquoted comma —
  `{ description: The signed mandate, as uploaded by the client }` is the
  description "The signed mandate" plus an empty field "as uploaded by
  the client" — and the description then shows cut short everywhere, which
  reads as a bug of whatever displays it. A bare `description:` or an
  unquoted `type: null` lands here too. Read on the source document, so a
  component is reported once at its declaration. Skipped: what takes any
  value — `example`, `default`, `const`, `enum`, an Example's `value` /
  `dataValue`, a Schema's `examples` list, a Link's `parameters` and
  `requestBody`, `x-*` extensions — and the payloads under them; array
  elements, whose `null` is a value. One check per empty field and none
  otherwise, like the version rules: a clean document is not graded on the
  fields it got right.
- `schema-dialect` (`info`) — a `jsonSchemaDialect` this app does not
  read as 2020-12: the document is read anyway, with 2020-12 meaning.

**Structure.** The rules below hold the document to what the specification
says each object is (OAS 3.0.4 / 3.1.1 / 3.2.0 §4.8, "Schema"): its fixed
fields, which are required, what kind of value each takes, and the
constraints each object puts on them. They read one
table (`src/audit/openapi-objects.js`) — every object's fields, version by
version — and one typed walk of the **source** document built from it
(`ctx.objects`): every OpenAPI object in document order, a `$ref` standing
where an object may stand typed as a Reference to it. Each object is seen
once, at its declaration; a `$ref` into another file is followed through
what the loader read there and reported under the `$ref`'s own pointer,
which the CLI's positions follow into that file. Every rule from here to
the end of §4.1 is graded like `field-without-value`: one check per defect,
none otherwise — a document is not graded on the thousands of fields it got
right, and a clean one keeps its score.

- `unknown-field` (`error`) — a field the object does not have in the
  declared version: `descripton`, `requried`, a 3.0 `allowEmptyValue` left
  on a 3.2 Header. An object holds its fixed fields and `x-` extensions
  only; no tool reads anything else, this app included. A field a later
  version introduced is `version-construct`'s; a Schema Object's keywords
  are open in 3.1 (`schema-keyword-typo` has the misspelled ones); a
  Reference Object's extra keys are `ref-siblings`'.
- `required-field-missing` (`error`) — a required field absent: `info.version`,
  a Parameter's `in`, a Server Variable's `default`, a 3.0 Operation's
  `responses`, the field a security scheme's type requires (`name` and
  `in` for `apiKey`, `scheme` for `http`, `flows` for `oauth2`,
  `openIdConnectUrl`), and in 3.1+ at least one of `paths`, `components`,
  `webhooks`. An OAuth flow's URLs are `oauth-flow-urls`'s, a Response
  missing both content and description `response-substance`'s.
- `field-value-kind` (`error`) — a value of the wrong kind (a string where
  a list belongs: `tags: pets`) or outside the set the specification allows:
  a Parameter's `in` (`body` is Swagger 2.0's) and `style`, a security
  scheme's `type` and an apiKey's `in`, a Header's `style`, a Schema's
  `type` (a list only from 3.1), an XML `nodeType`, a Security
  Requirement's scope list. The app reads such a field as absent — a
  parameter with no location, a scheme with no type — and never fails on
  it: `tests/malformed-documents.test.js` swaps every field of two real
  documents for a value of another kind, then for `null`, and the model and
  the audit both come through. `null` is `field-without-value`'s; a value only a later
  version allows (`in: querystring` in 3.1) is `version-construct`'s.
- `parameter-schema-or-content` (`error`) — a Parameter or Header Object
  without exactly one of `schema` and `content`, or whose `content` map holds
  more than one media type (OAS 3.x, Parameter Object: "MUST contain either a
  schema property, or a content property, but not both"; `content` "MUST only
  contain one entry"). With both, tools pick different ones; with neither,
  the value has no type — a bare text box in the try-it. A field present
  without a value is `field-without-value`'s, a `content` that is not a map
  `field-value-kind`'s.
- `exclusive-fields` (`error`) — two fields the specification makes mutually
  exclusive, both set: a Parameter's, Header's or Media Type's `example` and
  `examples`; an Example's `value` and `externalValue`, and from 3.2
  `dataValue` with `value` and `serializedValue` with `externalValue`
  ("If this field is present, … MUST be absent"); a Link's `operationRef` and
  `operationId`; a License's `identifier` and `url` (3.1+). Which one a tool
  keeps is undefined — this app shows `examples` over `example`, `value` over
  `externalValue`, the SPDX `identifier` over the `url`. A pair whose field
  the declared version lacks is `version-construct`'s. Named for what it
  covers rather than the examples alone.
- `header-object-fields` (`error`) — a Header Object carrying `name` or `in`
  (OAS 3.0/3.1: "MUST NOT be specified"; 3.2 no longer lists them), usually a
  Parameter pasted into a `headers` map. Ignored — the header is named by its
  key, here and everywhere — so a `name` that differs from the key promises a
  header nobody sees. `unknown-field` leaves these two fields to this rule,
  whose fix says where the name goes.
- `component-key-format` (`error`) — a key of any `components` map not
  matching `^[a-zA-Z0-9.\-_]+$` (OAS 3.x, Components Object, MUST): spaces,
  slashes, accents. Validators reject it, generators turning the name into a
  type or a file fail or mangle it, and every `$ref` must escape it.
- `status-code-valid` (`error`) — a Responses key that is neither `default`,
  a status code from 100 to 599, nor a range with the uppercase wildcard
  (`2XX`) (OAS 3.x, Responses Object): `200 OK`, `2xx`, `600`. Generators
  match no response to it; this app shows the key as written, as if it were
  a status.
- `media-type-key-syntax` (`error`) — a `content` key of a Parameter, Header,
  Request Body or Response that is not a media type or range (OAS 3.x; syntax
  of RFC 9110 §8.3.1 / §12.5.1: `type/subtype`, `type/*`, `*/*`, optional
  `; name=value` parameters): `json`, `application json`. This app sends the
  key as the Content-Type and reads the body's kind from it.
- `extension-reserved-prefix` (`warning`) — 3.1+: a specification extension
  named `x-oai-…` or `x-oas-…`, prefixes "reserved for uses defined by the
  OpenAPI Initiative" (Specification Extensions). No MUST, hence `warning`:
  the cost is a later collision with an official extension. Read on every
  object the walk types; a Reference Object's extra keys are `ref-siblings`'.
- `uri-form` (`error`) — a field the specification types as a URL, a URI or
  an email address ("MUST be in the form of…") holding junk: whitespace,
  control or never-allowed characters, a value even a URL parser refuses, an
  `@`-less email — Info `termsOfService`, Contact `url` / `email`, License
  `url`, External Documentation `url`, the OAuth and OpenID Connect URLs,
  `oauth2MetadataUrl`, an Example's `externalValue`, `jsonSchemaDialect`, and
  an XML `namespace`, which must also be absolute. A relative reference
  passes ("Relative References in URIs"). This app leaves out a link it
  cannot parse. `$self` is `self-uri`'s, a server URL `server-variables`'.
- `license-identifier-spdx` (`warning`) — 3.1+: an `info.license.identifier`
  that is not an SPDX license expression (OAS 3.1, License Object), checked
  against the SPDX expression grammar (SPDX 2.3 Annex D) and the SPDX License
  List 3.29.0 embedded in `src/audit/spdx.js` (licence and exception ids,
  deprecated ones included, case-insensitive; `LicenseRef-…` for a licence
  of one's own). Licence scanners and SBOM generators read `Apache 2` or
  `Proprietary` as no licence at all; this app shows the text as written.
  `warning`: the expression syntax is the SPDX's, the cost lands on tools.
- `self-uri` (`error`) — 3.2: a `$self` that is not a URI reference (OAS 3.2,
  OpenAPI Object, MUST). Unable to read it, this app resolves relative `$ref`s
  and servers against the URL the file was fetched from — what `$self` was
  declared to override. A fragment is not flagged: the 3.2 text does not
  forbid one, and this app ignores it when resolving.
- `tag-unique` (`error`) — two top-level tags with one name ("Each tag name in
  the list MUST be unique"). This app keeps the first declaration and drops
  the second's description, external docs and place in the navigation.
- `tag-parent` (`error`) — 3.2: a tag whose `parent` names no declared tag,
  or whose chain of parents loops ("The named tag MUST exist … circular
  references … MUST NOT be used", Tag Object); every tag of a loop is
  reported. This app files such a tag at the top level of the navigation.
- `path-syntax` (`error`) — a Paths key that is not a path template: no
  leading `/` (OAS 3.x Paths Object, MUST), unbalanced, nested or empty
  braces, a variable used twice (3.2 Path Templating, MUST NOT), a `?` or `#`
  in the path. A literal brace stays in the request the try-it builds, and
  after a `#` the query parameters it appends never reach the server.
  Webhook and callback keys are names and expressions, not paths. A
  variable with no parameter is `path-param-declared`'s.
- `paths-identical` (`error`) — two Paths keys equal once their variable
  names are set aside (`/pets/{id}`, `/pets/{petId}`) — OAS 3.x Path
  Templating Matching, MUST NOT. A request pasted into the import dialog
  fits both, and the reader has to choose. One finding on each later key.
- `paths-ambiguous` (`info`) — two keys a single URL can match where
  concrete-first matching cannot order them: same segment count, compatible
  at every position, each literal where the other is templated
  (`/{entity}/me`, `/books/{id}`). The specification leaves the choice to the
  tooling; the import dialog asks the reader. True ambiguities only:
  `/pets/mine` against `/pets/{id}` is ordered by the spec. A segment holding
  any `{…}` counts as templated. On the demo GitHub schema: 67 pairs, mostly
  `/…/{role_id}/teams` against `/…/teams/{team_slug}`.
- `parameters-unique` (`error`) — a Path Item's or an Operation's
  `parameters` naming the same `name` + `in` twice (OAS 3.x, MUST NOT);
  header names compared without case. Read dereferenced, each list on its
  own — an operation redeclaring a Path Item parameter overrides it. This
  documentation keeps the last declaration; a generator may keep the first.
- `header-parameter-ignored` (`warning`) — an `in: header` parameter named
  `Accept`, `Content-Type` or `Authorization`, and a Response header named
  `Content-Type` (OAS 3.x, SHALL be ignored). Generators drop them; this
  documentation shows such a parameter in the try-it and sends what is typed
  in it, over the body's Content-Type and the injected credential. Reported
  at the definition, a shared parameter once.
- `header-name-token` (`error`) — a header name that is not an RFC 9110
  token (§5.1, §5.6.2): an `in: header` parameter's `name`, the keys of a
  Response's and an Encoding's `headers`. The browser's `fetch` refuses the
  request before sending it; the try-it reports a failed send. Keys of
  `components.headers` are component names and are not read.
- `parameter-style-valid` (`error`) — a `style` the parameter's `in` does not
  allow (path: matrix / label / simple; query: form / spaceDelimited /
  pipeDelimited / deepObject; header: simple; cookie: form, 3.2 cookie;
  querystring: none) or its declared type does not (deepObject → object;
  space/pipeDelimited → array or object) — OAS 3.x Style Values. An unknown
  style is `field-value-kind`'s, `cookie` before 3.2 `version-construct`'s;
  no declared type, no verdict on it.
- `querystring-parameter` (`error`) — 3.2 `in: querystring` (Parameter
  Locations, MUST): described with `schema` instead of `content`, a second
  one on the same operation (Path Item's counted), or one next to an
  `in: query` parameter. Read on each operation's merged list; `schema` is
  reported once per declaration. The demo petstore's and two e2e fixtures'
  `filter` parameters use `schema`.
- `additional-operation-method` (`error`) — a 3.2 `additionalOperations` key
  the Path Item has a field for, whatever its case (`POST`, `query`) — MUST
  NOT — or one that is no RFC 9110 method token (`GET users`). This
  documentation drops the first kind (its operation never appears); the
  browser refuses to send the second.
- `server-variables` (`error`) — a server URL `{name}` with no `variables`
  entry, a `default` outside its `enum` (MUST), an empty `enum` (3.1+, MUST
  NOT). Every Server Object: root, Path Item, Operation, a Link's `server`.
  The base URL this documentation builds keeps the literal braces. A
  variable declared but unused is not reported.
- `ref-siblings` (`warning`) — a key next to a `$ref` that the declared
  version says to ignore (Reference Object, every version: "cannot be
  extended with additional properties, and any properties added SHALL be
  ignored"; 3.1/3.2: only `summary` and `description` are kept, and a
  Schema's `$ref` combines with its sibling keywords as JSON Schema does).
  So: in 3.0, every sibling, a Schema's included; from 3.1, a non-Schema
  reference's siblings other than `summary` / `description`. This app lays
  every sibling over a copy of the target (the loader, rule 19), so the
  reader sees it and a tool honouring the declared version does not — the
  finding is that disagreement. `x-` extensions are spared; a Path Item's
  `$ref` is one of its fields, not a Reference Object. One check per
  ignored sibling.
- `ref-target-kind` (`error`) — a `$ref` whose target is another kind of
  object than its place expects: a Schema where a Parameter belongs, a
  `components/parameters` entry used as a response Header (which has no
  `name` nor `in`), a Response as a Path Item. The loader substitutes
  whatever it reaches, so the doc renders it as the wrong object and
  validators reject the document. The target's kind is the one the typed
  walk gave the node at that pointer, wherever it is declared; a target
  that is itself a `$ref` stands for what it expects; a target the walk did
  not type (another file, an extension, a payload) gets no verdict.
- `ref-resolves` (`error`) — a `$ref` that leads nowhere: a missing
  pointer, a file that cannot be read. The loader leaves it in place
  instead of failing the document (`openapi-coverage.md` §4.4), so the rule
  reads the dereferenced document: a `$ref` the typed walk saw whose
  pointer still holds it there was not resolved. The reader sees nothing
  where it stands; validators and generators stop on it. Reported once, at
  the end of a chain (a `$ref` to a `$ref` that misses). A `$ref` inside an
  example is data and never checked.
- `runtime-expression-syntax` (`error`) — a runtime expression the OAS ABNF
  does not produce ("Runtime Expressions", every
  version): `$request.query` with no name, `$response.headers.X`,
  `$request.body/id` without its `#`, a JSON pointer with a bare `~`, a
  header name that is not a token. Read in a Callback's keys (the `{$…}`
  parts of the URL template, or the whole key when it starts with `$`) and
  in a Link's `parameters` values and `requestBody` when they are strings
  (whole when starting with `$`, else the embedded `{$…}` parts; anything
  else is a constant). Syntax only: whether `$request.path.id` names a
  declared parameter is not checked — the spec's own examples read headers
  no parameter can declare (`Accept`).
- `encoding-valid` (`warning`) — an `encoding` entry no tool applies: its
  key names no property of the media type's schema (MUST, all versions;
  3.2 "Encoding By Name": such entries SHALL be ignored), or the media type
  is not `multipart/*` or `application/x-www-form-urlencoded`, or — before
  3.2 — it sits on a response rather than a request body (3.0/3.1: "SHALL
  only apply to Request Body Objects"). The doc still lists it under the
  media type; the try-it applies an encoding only to the form field
  carrying its name. Properties are read through `allOf`; a schema open to
  others (`additionalProperties` not `false`, `oneOf`/`anyOf`,
  `patternProperties`) gets no verdict. One check per ignored entry.
- `sequential-media` (`warning`) — 3.2's sequence fields where they cannot
  apply (3.2 Media Type Object, "Sequential Media Types", "Encoding By
  Position"): `itemSchema` on a single-document body — JSON, `+json`,
  XML, `+xml`, form-urlencoded; the spec leaves "sequential" open, so only
  those certain non-sequences are flagged — and `prefixEncoding` /
  `itemEncoding` off `multipart/*` (SHALL only apply to multipart), next to
  an `encoding` map (MUST NOT), or with neither an `itemSchema` nor an
  array `schema` (MUST). The doc shows the `itemSchema` as "one item of the
  stream" and lists the positional encodings whatever the media type,
  describing a body the API does not send. Before 3.2 these fields are
  `version-construct`'s.
- `responses-success` (`warning`) — an operation documenting no 2XX or 3XX
  code or range and no `default`, an empty Responses Object included (every
  version: it MUST contain at least one response code, and "if only one response code is provided it
  SHOULD be the response for a successful operation call"). Generators
  type a method's return value from it; the doc shows only failures.
  Webhooks and callbacks are out (the integrator's server answers them);
  an operation with no Responses at all is legal from 3.1, and
  `required-field-missing`'s in 3.0. The demo petstore's failure showcase
  (`errors` tag) fires it on purpose.
- `discriminator-property` (`warning`) — a `discriminator.propertyName` the
  payload is not bound to carry: declared by neither the schema (through
  `allOf`) nor every variant (each `oneOf`/`anyOf` member, or each component
  extending a parent through `allOf`), or declared but not required — 3.0
  and 3.1: it "SHOULD be required … the behavior when the property is
  absent is undefined"; 3.2: optional only with a `defaultMapping` (MUST).
  `warning`, not `error`: before 3.2 it is a SHOULD, and real documents
  (GitHub's REST description) use optional discriminators. Mapping targets
  are `discriminator-mapping`'s.
- `security-scopes` (`error`) — a Security Requirement listing, for an
  `oauth2` scheme, a scope none of its flows declares — the try-it
  preselects an operation's scopes among the flow's, so it drops this one
  and the token lacks it — or, in 3.0, any value for a scheme other than
  `oauth2` / `openIdConnect` ("the array MUST be empty"; 3.1 allows role
  names). `openIdConnect` scopes live in the provider's discovery document
  and get no verdict; an undeclared scheme is `security-scheme-declared`'s.

**Schemas.** The rules below read the dereferenced schemas (`ctx.schemas`,
each reported once, at its component when it has one), except
`schema-keyword-typo`, which reads the source to report a key where it is
written. A schema whose keywords contradict each other, or a keyword that
cannot apply, is a schema the author believes constrains something it does
not.

- `enum-valid` (`error`) — an `enum` that is not a list, is empty, holds an
  entry its own `type` rejects (`enum: ["1"]` on an integer; `null` the type
  forbids), or lists one entry twice. JSON Schema 2020-12 §6.1.2 (MUST be an
  array; SHOULD be non-empty and unique). An empty or ill-typed enum admits
  values nobody can send; a duplicate becomes two constants of one name in a
  generated client — a compile error in Java or C#. This app offers every
  entry as written. Reported per entry (`detail` names it: `"2" ≠ type:
  integer`, `1 ×2`, `[]`). A nullable schema whose enum lacks `null` is
  `nullable-enum-null`'s.
- `nullable-enum-null` (`error`) — null declared allowed — 3.0's
  `nullable: true` next to a `type` (OAS 3.0.3 §4.7.24.1: it adds null to
  that type, and other constraints may still disallow it), or `null` in a
  3.1 type list — while the `enum` does not list `null`: null is never
  valid. `nullable` counts only in a 3.0 document (from 3.1 it is
  `version-legacy`'s). The GitHub REST schema carries 71 of them.
- `array-items` (`warning`) — `type: array` (or a type list holding it)
  without `items`, `prefixItems` or `contains`. OAS 3.0 §4.7.24.1: `items`
  MUST be present for an array; valid but empty from 3.1. The schema view
  shows `array<any>`, the sample is `[]`, the try-it has no element editor;
  generators type a list of anything. `warning` for every version: the
  degradation is the same.
- `constraint-type-mismatch` (`warning`) — a keyword that applies to none of
  the declared types: `maxLength` on an integer, `minimum` on a string,
  `minItems` / `items` on a string, `properties` / `required` on an array.
  JSON Schema 2020-12 validation §6 (each keyword constrains instances of
  its type, any other instance is valid against it): enforced by nobody,
  shown here as a constraint. Only with a declared JSON type; a boolean
  `required` is `schema-keyword-typo`'s.
- `range-contradiction` (`error`) — bounds no value satisfies: `minimum` above
  `maximum`, or equal with either bound exclusive (3.0 booleans and 3.1
  numbers alike), `minLength` / `minItems` / `minProperties` / `minContains`
  above their maximum, `multipleOf` ≤ 0, a negative length or count (the
  last two are JSON Schema MUSTs, §6.2.1 and §6.3–§6.5). Reported once per
  contradiction, `bounds` naming the keywords and values.
- `pattern-valid` (`error`) — a `pattern`, or a `patternProperties` key, that
  is not a regular expression under either ECMA-262 reading (with and
  without the `u` flag). JSON Schema 2020-12 §6.3.3 (SHOULD be a valid
  ECMA-262 regex); a validator fails on it, often for the whole schema.
  This app never compiles a pattern — it shows it as a chip — so nothing
  here reveals it is broken.
- `format-valid` (`warning`) — a `format` the declared type cannot carry
  (`date-time` on an integer, `int32` on a string — OAS Format Registry and
  JSON Schema 2020-12 §7.1: a format applies to one type and is ignored on
  the others), or a curated misspelling of a registered format (`datetime`,
  `date_time`, `dateTime`, `e-mail`, `uuid4`…). Never "unknown format": the
  registry is open and custom formats are legitimate.
- `schema-keyword-typo` (`warning`) — a schema key that no OpenAPI version
  knows but that is a near miss of a keyword: the same letters in another
  case (`readonly`), or one edit away for keys of five letters or more
  (`descripton`, `maxLenght`); and a boolean `required` on a property
  schema, the draft-03 habit (since draft-04, `required` is the parent's
  list). JSON Schema ignores unknown keywords, so the constraint does
  nothing. Read on the source schemas (`ctx.objects`), reported where
  written; the keyword set is every version's (`src/audit/schema-keywords.js`),
  so a keyword of another version is `version-construct`'s or
  `version-legacy`'s, never a typo.
- `composition-sanity` (`warning`) — a composition that cannot mean what it
  says: a bare `oneOf` / `anyOf` of one member (a choice with no alternative:
  the doc shows a "one of" over a single variant); a member listed twice — in
  a `oneOf`, every value matching it then matches two members while `oneOf`
  demands exactly one (JSON Schema 2020-12 §10.2.1.3), so none is valid; in
  `anyOf` / `allOf`, dead weight generators emit twice; an `allOf` whose
  members declare disjoint `type`s (`integer` counts within `number`), which
  accepts nothing. A single member next to any other keyword (`description`,
  `nullable`) is the 3.0 idiom for decorating a `$ref`, and a single-member
  `allOf` is never flagged. The first two read the source (a `$ref` is its
  target's name there); the third the dereferenced schemas.
- `readonly-writeonly` (`error`) — a schema both `readOnly` and `writeOnly`
  (OAS 3.0 Schema Object, MUST NOT; 3.1 leaves both to JSON Schema, which
  gives the pair no meaning). The value is never sent nor returned: the doc's
  samples drop a readOnly property from requests and a writeOnly one from
  responses, so this one appears in neither.
- `recursion-unsatisfiable` (`error`) — a schema no finite instance
  satisfies: a required property leads back to it through required plain
  objects (declared `object`, or untyped with object keywords; a required
  array counts when `minItems` ≥ 1), with no `null`, no `oneOf` / `anyOf`, no
  optional step on the way. Found as cycles of that graph over `ctx.schemas`
  by identity (Tarjan, iterative); one finding per cycle, at its first schema,
  naming the property that closes it. Required properties of `allOf` members
  count.
- `merge-patch-required` (`warning`) — an `application/merge-patch+json`
  request body whose schema (or an `allOf` member) lists `required`
  properties: RFC 7396 §2 lets every member be omitted, so clients built from
  it must send the whole resource, and the try-it marks every field
  mandatory. Usually the resource schema reused as its patch.
- `multipart-schema-object` (`warning`) — a `multipart/form-data` or
  `application/x-www-form-urlencoded` request body with no schema, or one that
  is not an object naming properties: the try-it builds one field per
  top-level property (`src/components/try-it/body-state.js`), so it shows no
  field and sends no body. `multipart/mixed` and the other multipart flavours
  are positional and left alone. A composed schema is not judged: an `allOf`
  of objects is one form, every member's properties its fields
  (`src/openapi/all-of.js`); a choice of forms (`oneOf` / `anyOf`) is
  legitimate, and the try-it not offering its fields is this app's gap.
- `binary-placement` (`warning`) — raw bytes where only text can go: a
  `format: binary` string, or a 3.1 `contentMediaType` of a binary family
  (image, audio, video, font, octet-stream, pdf, archives, `vnd.*`) without
  `contentEncoding`, inside a JSON request or response payload or in a
  parameter (OAS 3.1, "Working with Binary Data": binary in a text
  context is base64-encoded). The doc prefills an empty string where the file
  would go, or — for a whole JSON body declared binary — offers a file picker
  and sends the file labelled as JSON. Multipart parts and non-JSON bodies are
  a file's place and are not looked at. Reported once per schema, at its
  declaration.
- `example-has-ref` (`warning`) — an example whose whole value is
  `{ "$ref": "…" }` — a Parameter's, Header's or Media Type's `example`, an
  Example's `value` / `dataValue`, a Schema's `example` or `examples` item.
  Data is never dereferenced (the loader keeps it as written), so the doc
  shows the literal object and the try-it prefills it; the author meant the
  `$ref` on the Example Object, as an `examples` map entry. A value merely
  containing `$ref` keys deeper down is a payload about JSON Schemas and is
  legitimate. Read on the source. The GitHub REST description has twenty.
- `problem-status-mismatch` (`warning`) — an `application/problem+json`
  response under a concrete status code whose examples (the media type's, the
  schema's) carry a numeric `status` member, or whose schema pins `status`
  (`const`, a one-member `enum`), to another code: RFC 9457 §3.1.2 makes
  `status` the code generated for this occurrence. Ranges and `default` pin
  nothing and are skipped.

### 4.2 Documentation completeness

What the document leaves unsaid — mostly `warning`.

Every "described" rule here, and `security-scheme-described` (§4.5), reads
prose through one test (`isSubstantive`, `src/audit/text.js`): a placeholder
(`TODO`, `TBD`, `string`, `description`, `lorem ipsum`, `à compléter`…) or
the field's name read back (`userId: "User Id"` — the `title` code generators
emit for every property) counts as **no description**. Counting it as present
would grade a fake-complete document above an honest, half-written one. Prose
that merely mentions its name ("User id of the account owner") is substance.

- `operation-described` (`warning`) — operation without `summary` and
  without `description`.
- `parameter-described` (`warning`) — parameter without `description`.
- `request-body-described` (`warning`) — request body without
  `description`.
- `property-described` (`info`) — schema property without `description`.
- `error-responses-documented` (`warning`) — no error responses at all
  (no 4xx, and no `default`, which covers them) on a mutating operation —
  3.2's `query` method counts as a read. Skips webhooks and callbacks:
  those
  responses come from the integrator's server, not this API.
- `response-example` (`info`) — response schema declared without any
  example (the app generates one, but a hand-written example is always
  better). One check per status rather than per media type: the same
  payload as JSON and as XML is one example to write. A file response — a
  PDF, an export, anything the app classifies as binary (`body-kind.js`) —
  has nothing to check: the doc shows no sample of a file, and no example
  stands for its bytes.
- `info-described` (`warning`) — `info.description` missing.
- `info-metadata` (`info`) — `info.contact` or `info.license` missing or
  empty. Two fields, filled once for the life of the document, and the
  only ones that answer "can I build on this, and who do I talk to".

### 4.3 Deprecation hygiene

- `deprecated-inventory` (`info`) — inventory of every
  `deprecated: true` (operations, parameters, schema nodes — request and
  response bodies included — and security
  schemes): the report *is* the deliverable here, since deprecation marks
  are scattered across the pages that carry them. Every **deprecable**
  element is a check, not only the deprecated ones — the score then reads
  as the share of the surface still current: an API with no deprecation
  scores 100 %, one deprecated operation out of fifty barely moves the
  needle, and a document that is half legacy says so.
- `deprecation-replacement` (`warning`) — deprecated element whose
  description does not mention a replacement or sunset (heuristic:
  description absent or free of any "use/instead/sunset/replaced" hint).

### 4.4 Consistency

Mostly `info`. The naming rules detect the document's dominant convention
and flag outliers; a convention needs at least four classified names
before being called dominant, and a single lowercase word (`id`,
`status`) votes for nothing — it is valid camelCase, snake_case and
kebab-case at once.

- `parameter-naming` (`info`) — parameter names off the dominant
  convention. Only `query` and `path` names are classified: headers
  (`X-Request-Id`) follow the HTTP convention, not the document's, and
  cookies and 3.2's `querystring` carry no naming signal either.
- `property-naming` (`info`) — property names off the dominant
  convention.
- `path-style` (`info`) — mixed path segment styles (`/kebab-case` vs
  `/snake_case` vs `/camelCase`). The only rule whose target is a path
  rather than an operation: it links to the first routable operation
  declared on it (§3), because no page renders a path on its own and the
  reader still has somewhere to go.
- `duplicate-inline-schema` (`info`) — the same shape written out inline
  several times instead of shared via components (cheap heuristic:
  identical serialized subtrees above a size threshold). A referenced
  component is collapsed to its name before comparing — dereferencing
  would otherwise turn an array-of-`$ref` written at six endpoints into
  six "copies".

### 4.5 Docs readiness (ApiGlow-specific — the differentiator)

Each message states the concrete degradation *in this app*:

- `operation-id-present` (`warning`) — no `operationId` → unstable deep
  links (fallback `{method}-{path-slug}` route). Callbacks are exempt: a
  callback has no fallback route id to name.
- `operation-tagged` (`info`) — untagged operation → lumped into the
  fallback nav group. An operation carrying only 3.2 label tags (a `kind`
  other than `nav`) lands there too, and is flagged the same way.
  Webhooks and callbacks are exempt: the nav lists
  webhooks flat in their own section and never groups them by tag, and
  nothing groups callbacks — the finding would name no degradation.
- `servers-declared` (`warning`) — no `servers` → environment seeding
  (§5.3 of architecture.md) has nothing to offer.
- `security-scheme-described` (`info`) — security scheme without
  `description` → degraded credentials cartouche.
- `oauth-flow-urls` (`warning`) — OAuth2 flow missing
  `authorizationUrl`/`tokenUrl` → the try-it "Get a token" block cannot
  run.
- `operation-examples` (`info`) — no example anywhere on the operation →
  try-it prefills fall back to generated samples. Any example counts,
  parameters included: a parameter example prefills the try-it just as
  well. Only payloads that can carry an example count: an operation whose
  only payloads are files (a download, an upload) has nothing to check,
  like one that exchanges no payload at all.
- `schema-expand-walls` (`info`) — schemas nested deeper than the
  lazy-expansion default → readers will hit "expand" walls. Info only —
  the app handles it, but authors should know. Recursion is not flagged: a
  recursive schema (a tree, a form that describes itself) is the data
  model, no edit removes it, and the app expands it lazily on purpose
  (rule 7) — the finding could only be acknowledged, on every operation
  using the schema. Nesting is what an author can act on, typically a
  wrapper adding levels the payload does not need. The depth mirrors
  `MAX_AUTO_DEPTH` from `src/components/schema-view.js` as a local
  constant: the core must not import a component, and the two move
  together.

### 4.6 Version awareness

Not a category of its own: a construct that contradicts the declared
version is a correctness finding, so these three rules score under §4.1.
They run against the **raw** document and read its declared version
(`ctx.version`, `{ raw, major, minor }`). Both version rules are written
as "does this spelling match the declared version" — the same `nullable`
PASSES in a 3.0 document instead of being punished for it.

- `version-legacy` (`warning`) — a spelling a later version replaced,
  used in a document of that later version: `nullable: true` (→
  `type: [..., "null"]`) and the boolean form of
  `exclusiveMinimum`/`exclusiveMaximum` (→ numeric) from 3.1 on, the XML
  `attribute`/`wrapped`
  booleans from 3.2 on — the threshold travels per construct. All of them
  are silent failures: the newer reader ignores the older spelling.
- `version-construct` (`warning`) — anything used ahead of the declared
  version. Every field and enumerated value of an OpenAPI object comes
  from the structure table (§4.1): 3.1's `webhooks`, `jsonSchemaDialect`,
  `info.summary`, the licence's SPDX `identifier`, `components.pathItems`,
  `type: mutualTLS`; 3.2's `$self`, `pathItem.query`,
  `additionalOperations`, `in: querystring`, `style: cookie`,
  `mediaType.itemSchema`, `prefixEncoding` / `itemEncoding`,
  `discriminator.defaultMapping`, XML `nodeType`, a Server's `name`, a
  Response's `summary`, a Tag's `summary` / `parent` / `kind`, an
  Example's `dataValue` / `serializedValue`, `components.mediaTypes`, the
  device-authorization flow… — wherever they sit, components included. A
  Reference Object's 3.1 `summary` / `description` are `ref-siblings`'.
  On schemas: type arrays, `const`, and the JSON Schema 2020-12 keywords a
  3.0 Schema Object does not have — `if`/`then`/`else`, `$defs`,
  `patternProperties`, `propertyNames`, `dependent*`, `unevaluated*`,
  `contains` and its bounds, `content*`; not `not`, which 3.0 already
  carries.
- `conversion-approximation` (`info`) — a construct the Swagger 2.0
  conversion could only approximate. The converter
  (`src/openapi/swagger2.js`) marks what 3.0 cannot spell with
  `x-original-collection-format` rather than dropping it; the rule reads
  those markers, and only applies to a document carrying
  `x-converted-from`. The single case: a `collectionFormat` with no 3.0
  style (`tsv` anywhere, `ssv`/`pipes`/`multi` outside a query
  parameter).

### 4.7 Agent readiness

What an AI agent gets when it calls the API through a tool built from the
document — an OpenAPI→MCP bridge (the two this documentation's MCP export
offers, `@ivotoby/openapi-mcp-server` and `@tyk-technologies/api-to-mcp`),
a GPT Action, Semantic Kernel's OpenAPI plugin. Mostly `info`. Each
message names the concrete degradation — a platform that refuses, a bridge
that renames, drops or overwrites, a model left to guess — and a vendor's
limit is stated in the message rather than turned into a vendor profile.
The tools are the document's paths operations, hidden ones included: hiding
lives in this documentation, and a bridge reading the file serves them all
the same. Webhooks and callbacks are requests the API sends, never tools.
An operation's inputs are its parameters and its non-file request bodies
(`src/audit/tool-inputs.js`); `readOnly` properties are never sent.

- `operation-id-tool-name` (`info`) — an `operationId` outside
  `^[A-Za-z_][A-Za-z0-9_-]{0,maxLength-1}$`, the names every platform
  accepts as a tool name: OpenAI and AWS Bedrock take letters, digits, `_`
  and `-` up to 64 characters, Vertex AI wants a letter or `_` first,
  Anthropic and MCP stop at 128. OpenAI validates the tool list as a whole,
  so one invalid name fails every call; `@ivotoby/openapi-mcp-server`
  rewrites it to lowercase, abbreviated and hashed. Option `maxLength`
  (default 64, 1 to 128) for a team serving only Anthropic or MCP clients.
  One check per tool operation that has an operationId — a missing one is
  `operation-id-present`'s, a duplicate `duplicate-operation-id`'s. On the
  demo GitHub schema: all 1220 (`meta/root`).
- `summary-length` (`info`) — an operation `summary` over the 300 characters
  GPT Actions allows per endpoint, counted in characters, not UTF-16 units.
  The summary is the line a tool list shows, and the tool's description when
  the operation has none. The description is not graded: long prose belongs
  there.
- `operations-indistinct` (`info`) — two tool operations whose tools carry
  the same description: the operation's `description`, else its `summary`,
  as both MCP bridges and Semantic Kernel build it — compared trimmed,
  whitespace collapsed, without case. Identity only, never similarity: the
  parallel summaries of a CRUD API are not a defect. One finding on each
  operation after the first, naming it. On the demo petstore: the three user
  operations sharing "This can only be done by the logged in user."; on the
  GitHub schema, 41 (64 if summaries alone were compared).
- `tool-surface-size` (`info`) — more than 30 tool operations: GPT Actions
  takes 30 per action; past 128, the OpenAI API refuses the tool list and
  VS Code / GitHub Copilot enable no more at a time, and the message names
  that limit instead. Hidden
  operations count — a bridge reading the file serves them. One document
  check, at `/paths`; none on a document with no operation.
- `bridge-degradation` (`info`) — an operation the MCP server this
  documentation exports cannot call as written: a cookie parameter (neither
  bridge sends cookies), or an effective security (the operation's, else the
  document's) with no alternative whose schemes all travel in a header — an
  `apiKey` in a query or a cookie, `mutualTLS`. The verdict is the export's
  own (`credentialHeader`, `src/export/mcp.js`), so the rule and the
  generated config cannot disagree, and a deprecated scheme counts as not
  carried — the export leaves it out; an empty alternative (`{}`) is
  anonymous access and passes. An undeclared scheme gives no verdict:
  `security-scheme-declared`'s.
- `untyped-input` (`warning`) — an input schema that says nothing about
  its value: no `type`, no `enum`/`const`, no structure, no composition —
  `{}`, `true`, or annotations only (`description`, `example`, `format`) —
  at the root of a parameter or of a JSON body, or at a property, array
  item or tuple item below; a JSON body declared with no schema is flagged
  at its media type. Bridges copy the schema into the tool as it is, so the
  agent guesses the type. In this app the schema view shows `any`, the
  try-it offers a bare text box and sends what is typed as a string
  (`coerceValue` has no type to convert to), and the generated sample is
  `null`. Left to other rules: a composition member (it describes the value
  with its siblings), an `additionalProperties` value (`free-form-input`),
  the root of a form body (`multipart-schema-object`), a parameter with
  neither `schema` nor `content` (`parameter-schema-or-content`); a text
  body's media type already says text, and `format: binary` is a file. An
  unresolved `$ref` is `ref-resolves`'. A schema shared through
  `components.schemas` is graded once, at the component.
- `free-form-input` (`info`) — an input object with no shape: `type:
  object` (or an object by its keywords) with no `properties`, no
  `patternProperties`, no `propertyNames`, no composition, and
  `additionalProperties` absent, `true` or saying nothing. The agent has
  every key to invent; OpenAI's strict mode requires declared properties
  and `additionalProperties: false`. A typed map (`additionalProperties: {
  type: string }`) has a shape, and `additionalProperties: false` alone is
  a closed, empty object. A composition member is not judged on its own,
  nor the root of a form body (`multipart-schema-object`'s).
- `union-ambiguous` (`info`) — an input `oneOf`/`anyOf` of two or more
  branches, with no `discriminator`, where two branches take the same JSON
  type (`integer` and `number` are one) and neither has a `title` or a
  `description` the other lacks — text both inherit from a shared `allOf`
  base names neither. Bridges inline the union, component names gone, and
  the agent picks a branch blind. Not ambiguous: two object branches that
  each require a key the other does not declare (the key is an implicit
  discriminator), two arrays whose items differ in type, a single-constant
  branch. A union made only of constants is an enum
  (`enum-values-undescribed`). OpenAI's strict mode and Gemini do not
  support `oneOf` at all — stated, not graded.
- `input-root-shape` (`info`) — a JSON request body whose root is an
  array, a scalar, or a `oneOf`/`anyOf` (even of objects). GPT Actions
  skips the operation; `@ivotoby/openapi-mcp-server` wraps an array or a
  scalar under a `body` property and makes a union the tool's root;
  Anthropic's API types `input_schema.type` as `"object"` and OpenAI's
  strict mode requires an object root. An `allOf` of objects is an object;
  a root that says nothing gets no verdict (`untyped-input`'s). One check
  per JSON request media type; when the API cannot change, the finding is
  one to accept in the configuration.
- `recursive-input` (`info`) — a request input that reaches itself: a
  schema met again among its own ancestors on the walk of what an agent
  sends (`readOnly` properties are not sent, so a cycle through one alone
  does not count). One check per tool operation with inputs; the finding
  sits where the input reaches back, named after the `components.schemas`
  entry it re-enters. `@ivotoby/openapi-mcp-server` cuts the cycle into
  `{}`; Anthropic's strict mode and Gemini refuse recursion; OpenAI's
  strict mode supports it. Info: the data model is legitimate, the finding
  says what agents receive.
- `input-complexity` (`info`) — a request body past the limits tool
  schemas live under: more than 10 levels of object nesting (Semantic
  Kernel's OpenAPI plugin skips the operation; OpenAI's strict mode
  refuses it), more than 5000 object properties or more than 1000 enum
  values (OpenAI's strict mode). The body object is level 1, each property
  holding an object — directly or as array items — one more; properties
  and enum values are counted over the body's schemas, each once. One
  check per tool operation with a non-file request body; a cycle stops the
  depth where it closes (`recursive-input`'s).
- `enum-values-undescribed` (`info`) — an input enum of two values or more
  (`enum`, or a `oneOf` / `anyOf` of constants) with a value nothing
  explains → an agent filling the tool guesses which value the user's
  request means. A value is explained by a description of its own, read the
  way this documentation reads it (`enumOf`, `src/openapi/model.js` — the
  reading the schema view renders as a list of value and meaning):
  `x-enum-descriptions` / `x-enumDescriptions` (list or map), or the
  `description` / `title` of its constant branch — a placeholder or the
  value read back counts as none (`isSubstantive`). Or by prose naming it as
  a whole word, case-insensitive: the schema's `description`, and through
  `items` and composition the one of the array, wrapper or parameter holding
  it. The message names the first three unexplained values. The fix leads
  with the description, which travels to every tool: OpenAI strict mode keeps
  standard keywords only and drops the `x-` extensions. `null` and boolean
  enums are skipped; one check per input enum, each schema object once, a
  component's at the component.
  Whether the enum is described at all is `property-described`'s and
  `parameter-described`'s.
- `parameter-name-collision` (`warning`) — two inputs of one tool operation
  with one name, case aside: a parameter in two locations (path `id` + query
  `id`, or `id` and `ID` in the query), or a parameter and a top-level
  property of a JSON or form body (`allOf` members included, read-only ones
  excepted) → Semantic Kernel's OpenAPI plugin leaves the operation out
  (logged, no error to the caller); both MCP bridges key parameters by name
  and the last one silently wins, ivotoby renaming a clashing body property
  `body_<name>`. One check per tool operation with two inputs or more; a
  finding per colliding name, on the later input, naming both locations.
  The same name at the same location is `parameters-unique`'s; two headers
  differing by case are one header.
- `request-example` (`info`) — a non-file request body whose schema shows no
  example → the tool's input schema, copied whole from it, gives the agent
  types only. The media type's `example` / `examples` do not count: bridges
  drop them — that is the difference with `operation-examples`, which counts
  them because the try-it prefills from them. The schema shows an example
  when its root (or an `allOf` member) has `example` / `examples`, or when
  every value it sends does: each top-level property carries `example`,
  `examples`, `enum` or `const`, an object through its properties, an array
  through its items, a wrapper or union through a member; a file part of a
  form has nothing to show. One check per distinct schema among an
  operation's non-file request media types: the same payload as JSON, form
  and XML is one example to write.
- `error-machine-readable` (`info`) — an error response (`4XX` / `5XX` codes
  and ranges, `default`) whose content is all prose: `text/*` or HTML only,
  or JSON / XML with no schema, or one with no shape (a bare `string`, an
  empty schema) → an agent whose call fails reads a sentence and cannot
  branch on the error (which field, retry or not). One structured media type
  among several is enough. One check per error response declaring content,
  tool operations only; a response with no content leaves the status as the
  signal and is not checked. Documenting error responses at all is
  `error-responses-documented`'s.

## 5. Architecture

- Core module **`src/audit/`**: `engine.js` (walk + rule dispatch +
  scoring) and `rules/` (one file per rule, pure functions). The engine
  returns plain data; no DOM, no storage, no i18n — a finding carries a
  `ruleId` and its parameters, the UI resolves the strings. Fully
  Vitest-able.
- **Input: the raw schema, not the normalized model.** Normalization
  erases exactly what several rules must flag (`nullable`, version
  mismatches). This makes the audit a second legitimate consumer of the
  raw document, next to normalization (the user overlay's dry run is the
  third and last); rendering still only consumes the
  model (rule 6 concerns rendering, and the audit *page* renders audit
  results, not the schema). Design rationale: `architecture.md`. The
  engine receives both the source document (pre-`$ref` resolution, for
  unused-component and ref-shape rules) and the dereferenced document
  (for rules that need resolved subtrees), plus the normalized model,
  which doubles as the hide-filter verdict so findings on hidden
  operations can be labeled. Concretely:
  `auditSchema({ source, document, model })`. The loader returns the
  three of them next to the model — `source` as a lazy getter, `document`
  eagerly: it parses first and
  dereferences a clone against the same URL — which keeps the source's
  `$ref`s observable while external `$ref`s still resolve. When
  `features.audit` is off, the shell keeps no audit input; the parsed
  source itself outlives the switch, because the user overlay's dry run
  and the schema download still read it (they are the raw document's
  other consumers, `architecture.md` §14.13).
- **Loaded on demand**: the engine, the rules and their English texts are
  `dist/audit.js`, a file of its own next to `app.js`, imported on the
  first visit to `#/audit` (`architecture.md` §14.8) — a reader who never
  opens the page never downloads a rule. The rule configuration is
  validated there, once loaded, and its console warnings appear then.
- **Lazy, sliced and cached**: nothing is computed at boot. The report is
  computed on first visit to `#/audit`, in-memory-cached per spec,
  recomputed on spec switch. The run is handed out one rule at a time
  (`auditRun()`, a generator) and the shell gives the browser a frame
  between slices: on the repo's heaviest schema a single-task run is half a
  second of frozen page, over the blocking cap of rule 14 on its own. There
  is no partial report — a score needs every category graded — so the view
  appears once, at the end, and not at all if the reader has left by then. No persisted dataset → no change to `storageInventory()`
  and no new storage policy. (A report history/trend over schema versions
  is deliberately out of scope.)
- **Multi-spec**: report is per active spec, like the rest of the doc.
  `auditHash()` builds the route like the other builders and gets the
  multi-spec prefix for free; the route carries no id segment, unlike
  every other route — it designates the whole document.
- **Config**: `features.audit` (default `true`), overridable per spec
  like other feature switches; `false` removes the route, the settings
  entry and any computation. The rule configuration is the `audit` block
  (§2.2), read by `app.js` (rule 10) and handed to the engine as
  `input.config`, validated by `src/audit/config.js`. Both documented in
  `config.example.js`.
- **Export**: a "copy report as Markdown" action, implemented as a pure
  generator in `src/export/` and snapshot-tested, consistent with every
  other export. No sensitive values are involved, so no redaction path: a
  report names schema constructs, never a value the user typed. It
  carries **everything the page shows above the findings** — identity,
  contact and license, the perimeter in figures, per-category counts —
  plus **a timestamp to the second** the page itself has no use for: a
  pasted report outlives the schema it graded, and without a date a
  reader finding it in a ticket cannot tell whether it still describes
  anything. The moment is an argument (`{ at }`, defaulting to now), not
  a call to the clock inside the generator, which is what keeps it
  snapshot-testable. Local time rather than `toISOString()`: unlike the
  other exports, which stamp a request that happened at a recorded
  instant, this one answers "when did I run this". It is also the one
  export that is not English-only: the others carry requests and schemas,
  whose labels are structural; here every message and every rationale
  exists only as an i18n string, so `toAuditMarkdown` resolves them
  through `t()` and the report travels in the language it was read in.
  Unlike the page, the exported finding keeps its JSON pointer even when
  it is routable — a pasted report has no app to link into, and the
  pointer is what locates the finding in the file the reader is about to
  edit.

## 6. UI (`#/audit`)

- **Entry point**: a compact block in the settings drawer (§5.11 of
  architecture.md) — title, one-line description, a button navigating to
  `#/audit` (closing the drawer). No live grade in that block: showing
  one would force eager computation, and the drawer must stay cheap to
  open.
- **Identity**: which API, which revision, and what was covered — title,
  `info.version`, declared OpenAPI version, `info.contact` and
  `info.license` when the document carries them, and the same schema
  download the home page offers. A report is read out of context often
  enough — a pasted screenshot, a tab left open — that it must name what
  it graded. The download carries the same disclosure as the home page's
  with one word changed (the grade above it, not the page around it, is
  what the file disagrees with) and one line dropped: hiding is no gap
  here, since the audit already spans hidden operations
  (`architecture.md` §5.1.2).
- **The document in figures**: operations, groups, webhooks, security
  schemes, schemas — the home page's stats (§5.1 of architecture.md) plus
  the schemas, which are the audit's own unit of work. Same component
  (`components/spec-stats.js`), same units, so the two pages are
  comparable; counted on the document, so hidden operations are in there,
  unlike the home's. Zeros are shown here rather than omitted: no
  security scheme, no group, no webhook are all things the report goes on
  to grade.
- Header: aggregate letter + per-category score bars (static daisyUI class
  maps for severity/grade colors — rule 2, no `badge-${severity}`). The
  category names are the report's index: each jumps to its section, unless
  the category has no finding and therefore no section. A name that jumps
  says so at rest — link color, underline and a down arrow — because it
  sits one row away from names that don't. Jumps are buttons rather than
  `href="#…"` anchors: the app is hash-routed and an in-page fragment
  reads as a navigation.
- **Help**, collapsed: the grade bands (rendered from `GRADES`, not
  restated), how a category score is computed, what each severity claims,
  what each category looks at. Read once, then never again — so it must
  not push the findings down permanently.
- Body: findings grouped by category, then **folded by rule** — the same
  omission repeated across a schema is one decision to make, not two
  thousand rows. Each category heading carries its score and its own
  severity counts: a reader who jumped straight to a section must not
  have to scroll back to the summary to weigh it. One row per rule that
  fired = severity badge, the rule's label, the count of what it folds,
  and a chevron at the far right turning with the fold state (the native
  marker is suppressed, and nothing else would say the row opens; at the
  edge the chevrons line up in a column instead of reading as punctuation
  mid-row). Expanding shows the rationale and its fix once — hoisted to the group,
  stated expanded rather than behind a second disclosure — then the
  occurrences: message, deep link (or "hidden" badge), **50 at a time**,
  materialized on first expansion and never before. The count is always
  on the row and the remainder is always on the "show more" button:
  nothing is dropped silently. A rule that fired once is not folded: its
  own message is more informative than the generic label, and its
  rationale sits behind a compact "why" disclosure — the one place a
  second click is cheaper than pushing the next rule down.
- Long JSON pointers (recursive schemas produce several hundred
  characters of one repeated segment) are elided in the middle on the
  page only. The export keeps them whole — it is what locates the finding
  in the file.
- Empty/perfect state is designed, not an afterthought ("No findings —
  A").
- A11y: the page joins the axe e2e sweep; grouping uses real headings;
  score bars carry text alternatives; a jump moves focus onto the heading
  it lands on; a fold's accessible name says what its counter counts.
- `#/audit` remains a real, copyable route like every other view; opening
  it directly (deep link) works without passing through settings. A jump
  between sections is not a navigation and leaves the hash alone.

## 7. Testing

- **Vitest**: every rule gets pass + fail fixtures; the engine gets a
  scoring test with a synthetic mixed report; a full-report **snapshot on
  the demo petstore schema** (`tests/audit-petstore.test.js`) pins the
  end-to-end behavior (regenerated deliberately, per the snapshot
  policy). `tests/audit-strings.test.js` checks `label`/`message`/`why`
  over the whole registry, in both languages — fixture-driven coverage
  alone would only catch rules a fixture happens to fire.
- **Export**: Markdown report generator snapshot-tested like the others.
- **Playwright**: with the default config, the settings drawer shows the
  audit block, its button routes to `#/audit`, the page renders, a
  finding deep-links to its operation, axe sweep green. With
  `features.audit: false`, the settings block is absent and `#/audit`
  does not resolve. `tests/e2e/fixtures/e2e-api-clean.json` is a document
  written to pass every rule: it pins the perfect state end to end and,
  incidentally, guarantees the ruleset stays passable at all — a rule no
  document can satisfy would fail there first.
- **Perf**: the perf e2e budget must not move — the feature stays at its
  default (on) in the perf fixture, and a dedicated assertion checks
  nothing audit-related is computed at boot (the report is only ever
  computed on first visit to `#/audit`). The audit of the heavy schema
  must render as rule rows, with at most one page of occurrences per
  expansion, and no slice of the run may blow the blocking cap — a budget,
  not a knob (rule 14).
- **Command line**: the console report is snapshot-tested next to the
  Markdown one (`audit-export.test.js`); the baseline and the checks have
  their own tests (`audit-baseline.test.js`); the command is run end to end
  from the sources — input forms, streams, exit status, multi-spec, the
  overlays a config declares (`audit-cli.test.js`) — and once more as the
  packaged bin, where its dependencies and catalogs resolve from the
  installed package (`tests/e2e/audit-cli.spec.js`).

## 8. Command line

`apiglow audit` — a command of the `apiglow` binary shipped in the npm
package (`bin` → `dist/cli.js`; the command lives in `scripts/audit.mjs`).
It loads the schema the way the app does (`src/openapi/loader.js`), runs
`auditSchema`, and writes the report through the generators of
`src/export/`.

### 8.1 Invocation

```
npx apiglow audit openapi.yaml
npx apiglow audit 'apis/**/openapi.{yaml,json}'
npx apiglow audit --config apidoc.config.json
```

- **Input**: exactly one of a schema — a path, resolved against the working
  directory, or a URL; JSON or YAML — or `--config`, the JSON object the host
  page inlines in `#api-doc-config`. The config form audits what the
  documentation shows: its overlays are applied, its hidden operations are
  marked hidden, and every spec of a multi-spec install is audited. What it
  names is read under the config file's own directory, exactly as the bake
  reads it ([`seo.md`](seo.md) §4).
- **Several schemas** — a monorepo's: several paths, or a pattern, quoted so
  that the command expands it rather than the shell (`*`, `**`, `?`,
  `[…]`, `{a,b}`; `node_modules` and `.git` are never walked). Each file
  is audited as its own spec, its id the path relative to the working
  directory — the repository root in a CI job — so the reports and the
  baseline name the file, and adding a schema never shifts the others'
  ids. A single path keeps the id `default`.
  - A pattern matching no file is a warning; `--fail-on-unmatched-globs`
    makes it stop the run (exit status 2). Nothing at all to audit always
    does: a CI check never passes on nothing.
- **Rule configuration**: the config's `audit` block (§2.2), or
  `--audit-config <file>` — a JSON file holding the block alone, for a run
  that has no host config or wants to grade differently from the published
  page; it replaces the config's root block. An entry the CLI cannot read
  stops the run with exit status 2, each entry named.
- **`--format`**: `text` (default) — the console report, folded by rule like
  the page, the rationale printed once per rule; `markdown` — the export of
  §5, the shape a pull-request comment or a GitHub job summary takes;
  `sarif`, `github`, `codequality` — for a CI platform to display (§8.4);
  `json` — the engine's report as it is (§3), wrapped with the checks, in a
  versioned contract (`src/export/audit-json.js`):

  ```
  { "format": "apiglow-audit-report", "version": 1,
    "tool": { "name": "apiglow", "version": "0.3.0" },
    "passed": false,
    "specs": [{ "id": "default", "source": "openapi.yaml", "passed": false,
                "gates": [{ "gate": "fail-on", "threshold": "error", "actual": 2, "passed": false }],
                "newFindings": 2,
                "report": { …, "categories": [{ …, "findings": [{ …, "fingerprint": "9f3c…" }] }] } }],
    "rules": { "parameter-described": { "category": "completeness",
               "label": "…", "message": "…", "why": "…", "fix": "…" } } }
  ```

  - `format` and `version` name the shape; a change of shape bumps
    `version`, so a consumer can refuse what it does not know.
  - Every finding carries a `fingerprint`: SHA-256 of the baseline's
    identity — spec, rule, JSON pointer, and the occurrence among findings
    sharing those three (§8.3). It stays the same from one run to the next
    while the document around the finding changes, which is what a CI
    surface or an agent tracking a finding keys on.
  - `rules` carries, once, the texts of every rule that fired, in the
    report's language: `label`, `message`, `why`, `fix`. They are templates
    whose `{placeholders}` are each finding's `params` — a consumer
    explaining a finding needs nothing but the file.
  - `newFindings` is present only with `--baseline`, and so is
    `known: true` on the findings the baseline lists.
  - `omitted` is present only with `--min-severity` or `--only-new`.
- **Positions**: every finding of a schema read from a file carries
  `position: { file, line, column }` — where its node sits in the file the
  author edits — printed as `file:line:column` in the text and Markdown
  reports and on stderr, the form terminals and editors turn into a link.
  - The engine works on the dereferenced document; `src/audit/positions.js`
    walks the finding's pointer back through the text, following a `$ref`
    wherever the next segment is not written beside it, into other files
    too, and `via` lists the `$ref` sites it crossed.
  - A node the text does not hold — a missing field, a node an overlay
    added, a converted Swagger 2.0 document — lands on its deepest existing
    ancestor; a `$ref` that leads nowhere readable keeps the finding on the
    `$ref` itself.
  - One parser for both syntaxes: js-yaml's event stream, which carries the
    offset of every node (JSON is YAML). A schema fetched from a URL or
    inline in a config has no file, and its findings no position. Cost on
    the repo's 12 MB schema: about half a second.
- **`--output <file>`** writes the report to a file instead of stdout.
- **`--report <format>=<file>`**, repeatable, writes one more report per
  occurrence from the same run — the JSON for a script, the Markdown for
  the job summary, without auditing twice. `--format`/`--output` stay the
  shorthand for the stdout report; with `--report` alone, stdout stays
  empty. Two reports aimed at one file are refused.
- **What a report lists**, in every format: `--min-severity
  error|warning|info` keeps the findings that severe or worse — the
  GitHub REST schema yields some 33 600 findings, 32 500 of them `info`;
  `--only-new`, with `--baseline`, keeps those the baseline does not list.
  - The counts, the scores, the grade and every check still read the whole
    report: a filter changes what is shown, never the verdict. Text and
    Markdown say how many findings each filter left out; JSON has it as
    `omitted: { lessSevere, known }` on each spec.
  - Fingerprints are computed before any filter, so a finding keeps its id
    whatever the run lists.
  - `--fail-on` less severe than `--min-severity` is refused: a job would
    fail on findings its report does not show.
- **Network**: a schema, an external `$ref` or an overlay behind a URL is
  fetched, each with `--fetch-timeout <seconds>` to arrive (default 30) —
  a host that accepts the connection and never answers fails the job in
  its first minute, not at the CI platform's own timeout. `--offline`
  refuses every fetch and stops the run (exit status 2), even one the
  loader would otherwise skip with a warning, like an overlay: a job asked
  to stay off the network never passes on a different document.
- **The rules themselves**, without a schema: `--explain <rule>` prints one
  — category, default severity, label, why it matters, how to fix it, the
  options it takes with their defaults and bounds; `--list-rules` prints
  every rule as JSON (`format: "apiglow-audit-rules"`, `version: 1`), with
  the same texts the report's `rules` carries plus each rule's default
  severity and options. Both honor `--language` and refuse anything else on
  the line: a run that looked like an audit and printed a rule would mislead
  whoever reads its exit status.
- **`--language`**: `en` (default) or any shipped catalog (`fr`), for the
  report's messages and rationales — they exist only as i18n strings (§3).
  The command's own lines on stderr stay English, like the bake's.
- **Streams**: the report on stdout, everything about the run — warnings,
  each check, the verdict — on stderr. `--format json > report.json` and
  `--format markdown >> "$GITHUB_STEP_SUMMARY"` therefore hold exactly the
  report.
- **Multi-spec**: one report per spec, in declaration order (path order
  for several files), each under its spec id (`[id]` in text, `<!-- spec: id -->` in Markdown, `id` in
  JSON). The run fails when any spec fails.

### 8.2 Checks and exit status

| Option | Fails when | Default |
| --- | --- | --- |
| `--fail-on error\|warning\|info\|none` | a finding of that severity or a worse one | `error` |
| `--min-grade A\|B\|C\|D\|F` | the aggregate grade is below it | off |
| `--min-score 0-100` | the aggregate score is below it | off |
| `--baseline <file>` | it lists findings that no longer occur (§8.3) | on with a baseline |

Each check is reported on its own line (`PASS` / `FAIL`), and any failing
check fails the run. A report with no scored category has nothing to
grade, and the two grade checks pass on it rather than fail on a missing
value. When `--fail-on` fails, stderr lists the findings that made it fail
(the first 20, then a count — the report always carries all of them).

Exit status: `0` every check passed, `1` a check failed, `2` the audit
could not run — an unknown option, a value out of range, a schema that
cannot be read. Every option is validated before anything is loaded: a
typo in a threshold must neither cost a download nor read as "no
threshold".

### 8.3 Baseline

Adopting the check on an existing API should not mean fixing its whole
history first. A baseline records the findings a team has seen and
accepted; committed next to the schema, it makes `--fail-on` count only
the findings it does not list.

```
npx apiglow audit openapi.yaml --write-baseline audit-baseline.json
npx apiglow audit openapi.yaml --baseline audit-baseline.json
```

- **Identity** of a finding: its rule and its JSON pointer, the two things
  that survive an unrelated edit of the document. Messages and locations
  do not (a renamed parameter rewrites both), nor does a severity a later
  version of a rule may change.
- **Counted, not a set**: several findings can share an identity, and a
  pointer listed twice covers two occurrences — a third is new.
- **Grade and score ignore it**: they describe the document, and a
  baseline accepts findings, not a lower grade.
- **Not an ignore list** (§2.2): every finding is still in the report; in
  JSON the known ones carry `known: true`.
- `--write-baseline` records every current finding and passes — it is not a
  check — and does not combine with `--baseline`. The file is sorted
  throughout, so writing it again on an unchanged schema rewrites it byte
  for byte, and a review diff shows only what moved:

  ```
  { "format": "apiglow-audit-baseline", "version": 1,
    "specs": { "default": { "parameter-described": ["/paths/~1pets/get/parameters/0"] } } }
  ```

- A file that is not a baseline this version writes is an error (exit
  status 2), never read as empty — which would fail every finding — nor as
  covering everything — which would pass a regression.
- **Stale entries** — an entry no finding matches any more: the finding
  was fixed, its rule switched off, its spec removed. They fail the run by
  default, listed on stderr and in the JSON report
  (`staleBaseline: [{ spec, ruleId, dataPath }]`): an entry left behind
  would one day hide a new finding that happens to land on the same
  pointer.
  - `--prune-baseline <file>` writes the baseline without them — the known
    findings of each audited spec, never a new one — and the check passes;
    the file may be the `--baseline` itself.
  - `--allow-stale-baseline` lists them and passes.

### 8.4 Reports for CI platforms

Three formats exist for a CI platform to display the findings itself,
next to the code. All three carry the report's messages, in the report's
language, and are written by `src/export/audit-ci.js`.

- **`sarif`** — SARIF 2.1.0, for GitHub code scanning (and any SARIF
  viewer). One run per spec, its `automationDetails.id`
  `apiglow-audit/<spec id>/`, so each spec's alerts open and close on
  their own.
  - Each rule fired is described once: label, rationale, fix (`help.text`
    and `help.markdown`), its category as a tag, and
    `problem.severity` — `error`, `warning`, or `recommendation` for
    `info`. The texts are templates, as in the JSON report; each result
    carries its `params`.
  - Each result: `level` (`error`, `warning`, `note`), the message, the
    position as `physicalLocation` (the URL for a fetched schema), the JSON
    pointer as a logical location, the `$ref` sites crossed as
    `relatedLocations`, the fingerprint as
    `partialFingerprints["apiglowFingerprint/v1"]`, and with a baseline,
    `baselineState` (`new` or `unchanged`).
  - GitHub reads at most 25 000 results per run and refuses the upload
    beyond. A larger run keeps the new findings first, then the most
    severe, and stderr says how many were left out.
- **`github`** — GitHub workflow commands, printed by a step to annotate the
  pull request's diff: `::error`, `::warning`, `::notice` (for `info`),
  with the file, line, column and the rule as title. GitHub shows ten
  annotations of each kind per step and drops the rest silently, so new
  findings come first and, when some are left out, one last `::notice`
  says how many.
- **`codequality`** — GitLab Code Quality: `check_name` (the rule),
  `description`, `severity` (`error` → `critical`, `warning` → `major`,
  `info` → `minor`), `location` and our fingerprint, which is what lets
  the merge-request widget tell new findings from resolved ones.

### 8.5 In a CI job

Pin the version, as for the CDN install: a new release can add a rule, and
a rule added under a pipeline is a build that fails for a reason nobody
changed.

**GitHub Actions.** The action
[`apiglow/audit-action`](https://github.com/apiglow/audit-action) runs the
command in one step: annotations on the diff, the Markdown report on the
job summary, SARIF to code scanning with `sarif: true`. Its tag is the
CLI version it runs.

```yaml
- uses: actions/checkout@v7
- uses: apiglow/audit-action@v0.2.0
  with:
    schema: openapi.yaml
    baseline: audit-baseline.json
```

The same by hand, every piece in sight:

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@v7
  - uses: actions/setup-node@v7
    with:
      node-version: 24
  - name: Schema audit
    run: |
      npx --yes apiglow@0.2.0 audit openapi.yaml --baseline audit-baseline.json \
        --format github --report markdown="$GITHUB_STEP_SUMMARY" --report sarif=audit.sarif
  - if: always()
    uses: github/codeql-action/upload-sarif@v4
    with:
      sarif_file: audit.sarif
```

**GitLab CI.** The findings in the merge-request widget, the JSON report
kept as an artifact:

```yaml
schema-audit:
  image: node:24
  script:
    - npx --yes apiglow@0.2.0 audit 'apis/**/openapi.yaml'
        --baseline audit-baseline.json
        --report codequality=gl-code-quality-report.json --report json=audit.json
  artifacts:
    when: always
    reports:
      codequality: gl-code-quality-report.json
    paths: [audit.json]
```

**pre-commit.** A local hook (`repo: local`): `language: system` runs the
`npx` line as written, pinned like the CI job's. `pass_filenames: false`,
because the command names its schema itself — handed the staged files, it
would audit only those, under ids the baseline does not know. Any YAML
change triggers it, since a `$ref` can sit in another file.

```yaml
repos:
  - repo: local
    hooks:
      - id: apiglow-audit
        name: Schema audit
        entry: npx --yes apiglow@0.2.0 audit openapi.yaml --baseline audit-baseline.json
        language: system
        files: \.ya?ml$
        pass_filenames: false
```

**Breaking changes.** Out of scope: the audit grades one version of the
document, and its baseline answers "what is new", not "did the contract
break". [oasdiff](https://github.com/oasdiff/oasdiff) compares two
versions, next to the audit:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- name: Breaking changes
  run: |
    git show "origin/$GITHUB_BASE_REF:openapi.yaml" > base.yaml
    docker run --rm -v "$PWD:/specs:ro" tufin/oasdiff:v1.32.1 \
      breaking /specs/base.yaml /specs/openapi.yaml --fail-on ERR
```

**An agent fixing the schema.** Pipe it the JSON report (§8.1): every
finding placed at `file:line:column`, its rule's `message`, `why` and `fix`
in `rules`, and a fingerprint that survives the edit around it. The loop is
audit, fix, audit again until every check passes; with a baseline,
`--only-new` keeps its attention on what a change introduced.

```
npx apiglow@0.2.0 audit openapi.yaml --format json --min-severity warning
```

The package ships that loop as an agent skill —
`skills/apiglow-audit/SKILL.md`, in the Agent Skills format (a `SKILL.md`
with a `name` and a `description` in its front matter). Copy the folder
where the agent reads skills (`.claude/skills/` for Claude Code, for
instance) from `node_modules/apiglow/skills/`, or from the repository. Beyond
the commands, it holds what an agent must not do on its own: invent what
the API does to fill a description or an example, or make the run pass by
switching a rule off, writing a baseline or lowering `--fail-on` — each is
the owner's decision.
