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
2. **Curated, doc-oriented ruleset** (137 rules across the seven §4
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
                     "rules": { "response-example": "off" },
                     "reason": "frozen legacy API" }]
   }
   ```

   - Precedence: the rule's own severity — or the check's, for a rule that
     grades its checks differently (§4 says which) — then `rules`, then
     every override covering the pointer, in declaration order — the last
     word wins. A configured severity applies to every check of the rule.
   - A pointer pattern covers what it matches and everything below it; `*`
     matches within one segment, `**` as a whole segment any number of
     them.
   - A check where its rule is off does not count at all — neither as a
     finding nor in the score; a rule off everywhere is not even run.
   - A setting is a severity or `off`, written as a string.
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
   own (`conversion-approximation`). A document declaring any other version
   is reported as such (`document-openapi`) and graded with the newest
   rules — by the CLI: the page does not open it.
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
- `category`: one of the seven §4 categories.
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
- `report.profile`: `{ custom, rules, overrides }` — whether the run used
  a rule configuration (§2.2), the severities it set, by rule, and how many
  path overrides it declared. `custom: false` is the default grade. A
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
fixing the document reads. A `.why` or a `.fix` may interpolate the
finding's params like the message does. `tests/audit-strings.test.js`
checks all four over the registry, in both languages.

### Scoring

- Each rule application is a pass/fail check against a target (an
  operation, a parameter, a component, the document).
- A check standing for several items — a schema's properties
  (`property-described`), an enum's values (`enum-values-undescribed`), an
  operation's inputs (`unbounded-input`) — earns partial credit,
  `1 − √(failing ÷ items)` (`shareCredit`): in between failing the whole
  unit on one item and counting every item alone, and degressive — the
  first wrong item costs the most, each next one less. One of fifteen costs
  a quarter of the check, five a little over half, ten four-fifths, all of
  them the whole check. Anything short of full credit is a finding.
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

137 rules, one file per rule under `src/audit/rules/`, `rules/index.js` the
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

Two rules are about the file itself, and run whatever it holds (`file: true`
in the registry): a file holding no mapping — nothing, a list, a sentence —
gets a report of these two alone, graded F, since there is no document to
grade.

- `document-syntax` (`error`) — what the text itself gets wrong: a
  duplicate key, a tab used as indentation, a trailing comma, a file cut
  short, an alias to no anchor, a second document in the stream. The loader
  reads past it ([architecture.md](architecture.md) §14.21), so the rest of
  the report still grades what the file holds, but validators and code
  generators refuse the file. One failing check per problem the reading
  reported, `params: { line, column, detail, format }`: `detail` is the
  parser's own one-line message, shown as data; `format` is `JSON` for a
  text that looks like JSON and is not (it was read as YAML), `YAML`
  otherwise. The CLI places it at that line and column, not at a pointer. A
  text read strictly has no check here.
- `document-openapi` (`error`) — the file holds no OpenAPI 3.x or Swagger
  2.0 description: nothing, a list, a sentence, `swagger: 1.x`, an `openapi`
  major other than 3 or an unknown 3.x minor. `params.found` says what it
  holds in a notation no language translates — `(empty)`, `[…]`,
  `"hello world"`, `swagger: 1.2`, `openapi: 4.0.0`. A mapping with a
  version the app does not read is graded anyway, with the newest rules
  (3.2), under this finding; one with no `openapi` field is
  `required-field-missing`'s, a non-string `openapi` `field-value-kind`'s.
  One check per file.
- `duplicate-operation-id` (`error`) — the same `operationId` declared
  more than once.
- `path-param-declared` (`error`) — path template placeholder with no
  declared `in: path` parameter. Skips webhooks and callbacks: their
  "path" is a name or a runtime expression, whose `{…}` are not path
  templates. Skips a key `path-syntax` rejects too: its braces are not
  reliably names, and a malformed template is reported once, there.
- `path-param-in-template` (`error`) — declared `in: path` parameter
  absent from the path template. Same webhook/callback and malformed-key
  exemptions.
- `path-param-required` (`error`) — path parameter not marked
  `required: true`.
- `required-property-declared` (`error`) — a name in `required`, or in a
  `dependentRequired` list, that nothing declares. Read the way a validator
  applies the schema to one value: a name counts as declared under the
  `properties` of the schema, of an `allOf` member, of any `oneOf` /
  `anyOf` branch or `if` / `then` / `else` (recursively), or of the schema
  this one is composed into — a `oneOf` branch requiring what its parent
  lists, an `allOf` member requiring what a sibling defines, the usual way
  to write a variant — or when a `patternProperties` pattern matches it.
  Above a `oneOf` / `anyOf` branch or a conditional, only what surely
  applies with it counts — the parent's own declarations and its `allOf`
  members — never a sibling branch, which applies instead of it. A `$ref`
  the loader left in place (`ref-resolves`') may declare anything and
  matches every name.
  A schema whose whole family declares no property is a free-form object
  and is skipped, unless it says `additionalProperties: false`: then no
  name is declarable and every required one fails. One check per required
  name.
- `required-with-default` (`info`) — a required parameter, or a
  property listed in `required`, that still declares a `default`. The
  default can never apply — the caller always supplies the value — and it
  says the opposite of `required`, so readers and code generators get
  contradictory signals. Both spellings live in one rule because they are
  one authoring mistake; one check per required element, so the score
  reads as the share of the mandatory surface that does not contradict
  itself.
- `example-type-mismatch` (`error`, per check) — an `example` / `examples` value
  (schema, parameter, response header, media type — a parameter's or
  header's `content` entry included, its own examples then judged against
  that one media type's schema; Example `value` / `dataValue`) its own
  schema rejects, validated in depth by `src/audit/value-validate.js`:
  `type` (with 3.0's `nullable`), `enum`, `const`, string lengths in code
  points, `pattern` (ECMA-262, `u`), the numeric bounds in both spellings,
  `multipleOf`, array and object sizes, `uniqueItems`, `required`,
  `properties`, `patternProperties`, `additionalProperties` (only with no
  composition beside it), `items`, `prefixItems`, `allOf` (every
  member), `oneOf` / `anyOf` (failing only when every branch does — the
  finding then names the branch the value got furthest into, or, when a
  branch failed on a format alone, that branch, graded `warning`), and the
  formats `date`, `date-time`, `time` (RFC 3339), `uuid`, `ipv4`, `ipv6`,
  `email`, `uri`, `int32`, `int64`. Three-valued: what it does not read
  (`not`, conditionals, `unevaluated*`, `dependent*`, an unresolved
  `$ref`, an invalid pattern, another format, an empty or unknown `type`)
  gives no verdict, never a failure. `required` follows the example's
  direction, read off where it sits under the operation: a request example
  owes no `readOnly` member, a response example no `writeOnly` one — the
  flag counts on whichever `allOf` member declares the property — and a
  component's own example neither, nor a webhook's or a callback's, whose
  request the API sends. The finding names the keyword and the
  place, a JSONPath into the value (`$.tags[0].name`). A broken format
  alone is graded `warning` — JSON Schema 2020-12 §7.2.1 makes format
  assertion "MUST be disabled by default", so validators let it through
  while readers and generated clients trip on it. A lone
  `{ "$ref": … }` value is `example-has-ref`'s.
- `default-allowed` (`error`, per check) — a `default` its own schema
  rejects, judged by the same validator (type, enum, lengths, pattern,
  bounds, sizes, members, compositions, formats): the form prefills a value
  the API will refuse, and every client generator copies it. Same
  keyword-and-place finding, same `warning` for a format alone.
- `unused-component` (`warning`) — component defined but never
  referenced, in every `components` section the spec defines, `pathItems`
  included. Reads the **source** document: once dereferenced, a `$ref` is
  indistinguishable from an inline copy (§5).
- `security-scheme-declared` (`error`) — `security` requirement
  referencing an undeclared scheme.
- `response-substance` (`warning`) — a response with no
  description (nor 3.2 `summary`) and no content that says anything: a
  media type counts when it has a schema (or 3.2 `itemSchema`), an
  example, or a type that is the whole story — a file or plain text
  (`image/png`, `text/plain`). `{ "application/json": {} }` names a format
  and describes nothing, and a media range (`*/*`) not even a format. The
  response renders as a bare status line. A structured media type missing
  its schema is also `response-content-schema`'s, described or not.
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
  unquoted `type: null` lands here too. Read on the typed walk of the
  source document (`ctx.objects`, below), so a component is reported once at
  its declaration, and a property named `value` or `default` is a schema
  like any other, not the keyword. A field is a key of an object or a
  member of a map (`responses: { 200: }`, a component left empty). Skipped:
  what takes any value — `example`, `default`, `const`, `enum`, an
  Example's `value` / `dataValue`, a Schema's `examples` list, a Link's
  `parameters` and `requestBody`, `x-*` extensions — and the payloads under
  them; list members, whose `null` is a value of the wrong kind
  (`field-value-kind`'s). One check per empty field and none
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
once, at its declaration; a `$ref` into another file — a Path Item split
into its own file included — is followed through what the loader read
there and reported under the `$ref`'s own pointer, which the CLI's
positions follow into that file. From 3.1 a Schema's `$ref` combines with
its other keywords, so one with siblings is typed a Schema as well, and
the siblings are read like any schema's. Every rule from here to
the HTTP semantics group is graded like `field-without-value`: one check
per defect, none otherwise — a document is not graded on the thousands of
fields it got right, and a clean one keeps its score.

- `unknown-field` (`error`) — a field the object does not have in the
  declared version: `descripton`, `requried`, a 3.0 `allowEmptyValue` left
  on a 3.2 Header. An object holds its fixed fields and `x-` extensions
  only; no tool reads anything else, this app included. A field a later
  version introduced is `version-construct`'s, a Media Type's `$ref` before
  3.2 included; a Schema Object's keywords
  are open in 3.1 (`schema-keyword-typo` has the misspelled ones); a
  Reference Object's extra keys are `ref-siblings`'; a root `swagger`
  naming another version is `document-openapi`'s.
- `required-field-missing` (`error`) — a required field absent: `info.version`,
  a Parameter's `in`, a Server Variable's `default`, a 3.0 Operation's
  `responses`, the field a security scheme's type requires (`name` and
  `in` for `apiKey`, `scheme` for `http`, `flows` for `oauth2`,
  `openIdConnectUrl`), and in 3.1+ at least one of `paths`, `components`,
  `webhooks`. An OAuth flow's URLs are `oauth-flow-urls`'s, a Response
  missing both content and description `response-substance`'s, a root
  `openapi` where a `swagger` field names another version
  `document-openapi`'s.
- `field-value-kind` (`error`) — a value of the wrong kind (a string where
  a list belongs: `tags: pets`) or outside the set the specification allows:
  a Parameter's `in` (`body` is Swagger 2.0's) and `style`, a security
  scheme's `type` and an apiKey's `in`, a Header's `style`, a Schema's
  `type` (a list only from 3.1), an XML `nodeType`, a Security
  Requirement's scope list. A list or a map is held to its members too,
  each reported where it sits: `security: [api_key]` (names where Security
  Requirement objects belong — the API is left unsecured without a word),
  root `tags: [pets]`, `parameters: [id]`, `responses: { 200: OK }`, a path
  whose value is no object. A Schema may be `true` / `false` from 3.1; its
  `items` is never a list (draft-04 tuples: neither 3.0 nor 2020-12, whose
  `prefixItems` replaced them). The app reads such a field as absent — a
  parameter with no location, a scheme with no type — and never fails on
  it: `tests/malformed-documents.test.js` swaps every field of two real
  documents for a value of another kind, then for `null`, and the model and
  the audit both come through. `null` is `field-without-value`'s, except as
  a list member; a value only a later version allows (`in: querystring` in
  3.1) is `version-construct`'s.
- `parameter-schema-or-content` (`error`) — a Parameter or Header Object
  without exactly one of `schema` and `content`, or whose `content` map holds
  more than one media type (OAS 3.x, Parameter Object: "MUST contain either a
  schema property, or a content property, but not both"; `content` "MUST only
  contain one entry"). With both, tools pick different ones; with neither,
  the value has no type — a bare text box in the try-it. A field present
  without a value is `field-without-value`'s, a `content` that is not a map
  `field-value-kind`'s. An `x-` key of `content` counts as an entry: the map
  holds media types and takes no extension (`media-type-key-syntax` reports
  it too).
- `exclusive-fields` (`error`) — two fields the specification makes mutually
  exclusive, both set: a Parameter's, Header's or Media Type's `example` and
  `examples`; an Example's `value` and `externalValue`, and from 3.2
  `dataValue` with `value`, `serializedValue` with `value` and with
  `externalValue`
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
  type or a file fail or mangle it, and every `$ref` must escape it. Only
  the maps the declared version has: a 3.0 `pathItems` or a 3.1
  `mediaTypes` is `version-construct`'s.
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
  cannot parse. `$self` is `self-uri`'s, a server URL `server-url-form`'s.
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
  fits both, and the reader has to choose. One finding on each later key; a
  key `path-syntax` rejects is left out.
- `paths-ambiguous` (`info`) — two keys a single URL can match where
  concrete-first matching cannot order them: same segment count, compatible
  at every position, each literal where the other is templated
  (`/{entity}/me`, `/books/{id}`). The specification leaves the choice to the
  tooling; the import dialog asks the reader. True ambiguities only:
  `/pets/mine` against `/pets/{id}` is ordered by the spec; a key
  `path-syntax` rejects is left out. A segment holding any `{…}` counts as
  templated. On the demo GitHub schema: 67 pairs, mostly
  `/…/{role_id}/teams` against `/…/teams/{team_slug}`.
- `parameters-unique` (`error`) — a Path Item's or an Operation's
  `parameters` naming the same `name` + `in` twice (OAS 3.x, MUST NOT);
  header names compared without case. Read dereferenced, each list on its
  own — an operation redeclaring a Path Item parameter overrides it. This
  documentation keeps the last declaration; a generator may keep the first.
- `header-parameter-ignored` (`warning`) — an `in: header` parameter named
  `Accept`, `Content-Type` or `Authorization`, and a Response's or an
  Encoding's header named `Content-Type` (OAS 3.x, SHALL be ignored).
  Generators drop them; this documentation drops the Encoding's one too, so
  its value is never sent, but shows such a parameter in the try-it and
  sends what is typed in it, over the body's Content-Type and the injected
  credential. Reported at the definition, a shared parameter once.
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
  Locations and Fixed Fields for use with `schema`, MUST): carrying `schema`,
  `explode` or `allowReserved` (described with `content` instead), a second
  one on the same operation (Path Item's counted), or one next to an
  `in: query` parameter. The fields are read on each declaration, a shared
  parameter once, in components — its `style` is `parameter-style-valid`'s;
  the count and the neighbours on each operation's merged list. Before 3.2
  the location is `version-construct`'s.
- `additional-operation-method` (`error`) — a 3.2 `additionalOperations` key
  the Path Item has a field for, whatever its case (`POST`, `query`) — MUST
  NOT — or one that is no RFC 9110 method token (`GET users`). This
  documentation drops the first kind (its operation never appears); the
  browser refuses to send the second.
- `server-variables` (`error`) — a server URL variable with no valid
  value: a `{name}` with no `variables` entry, and from 3.1 a `default`
  outside its `enum` (MUST) or an empty `enum` (MUST NOT) — 3.0 only says
  SHOULD for both. Every Server Object: root, Path Item, Operation, a
  Link's `server`. The base URL this documentation builds keeps the literal
  braces. A variable declared but unused is not reported; an undeclared one
  is reported once, however often the URL uses it.
- `server-url-form` (`error`) — a server URL that is no URL template: no
  URL once its `{…}` variables are set aside (whitespace, characters a URL
  never holds unescaped, a stray or empty brace — 3.2's
  `server-url-template` grammar, "a URL" before), or from 3.2 a variable
  used twice (MUST NOT). Every Server Object, as above; the base URL this
  documentation builds keeps the literal text.
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
  code or range (uppercase `X`, the only range spelling; `2xx` is
  `status-code-valid`'s) and no `default`, an empty Responses Object
  included (every version: it MUST contain at least one response code, and
  "if only one response code is provided it SHOULD be the response for a
  successful operation call"). Generators
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
  integer`, `1 ×2`, `[]`); two objects with the same members in another
  order are one entry twice. A nullable schema whose enum lacks `null` is
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
  `required` is `schema-keyword-typo`'s. Also 3.0's `nullable: true` with
  no `type` at all — OAS 3.0.4, Schema Object: "This keyword only takes
  effect if type is explicitly defined within the same Schema Object" —
  where the rest of the schema rejects null (a `oneOf` of a string and an
  integer, an `allOf` of an object): validators still refuse null while
  this documentation shows the field as nullable. A schema that already
  admits anything loses nothing and is not reported; from 3.1, `nullable`
  is `version-legacy`'s. The GitHub REST schema carries 92 of them.
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
  registry is open and custom formats are legitimate. `int64` / `uint64` on
  a string passes: past 2^53 a JSON number loses digits in JavaScript, so
  the proto3 JSON mapping — every Google API — writes them as strings.
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
  target's name there); the third the dereferenced schemas. `defect` says
  which, in notation that reads in any language: `oneOf: [#/…/Cat]`,
  `#/…/Cat ×2`, `string ∩ object`.
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
  legitimate, and the try-it not offering its fields is this app's gap. A
  body on a GET or HEAD is `request-body-method`'s, whose fix removes it.
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

**HTTP semantics.** The rules below hold the document to what RFC 9110 and
the RFCs it builds on say a message can carry.

- `request-body-method` (`error`, per check) — a `requestBody` on
  an operation whose method gives content no meaning. RFC 9110 says content
  in a GET, HEAD or DELETE request "has no generally defined semantics" and
  might get the request rejected as a smuggling attempt (§9.3.1, §9.3.2,
  §9.3.5, SHOULD NOT), and forbids it in a TRACE request (§9.3.8, MUST NOT);
  OpenAPI 3.0 makes consumers ignore such a `requestBody` (SHALL), 3.1 and
  3.2 permit it and say to avoid it. Graded by method: GET and HEAD are a
  `warning` — the Fetch standard throws on a body with either, so the
  try-it sends the request without it, says so, and keeps the body in the
  cURL command (`canHaveBody`, `src/openapi/methods.js`); DELETE is an
  `info` — real APIs read a DELETE body on purpose, and the try-it sends it;
  TRACE is an `error`. One check per operation with one of these methods,
  webhooks and callbacks included; the finding at `requestBody`, params
  `{ method }`. A browser's refusal of TRACE itself is
  `forbidden-in-browser`'s.
- `bodyless-status` (`error`) — `content` on a response that cannot
  carry any: a `1XX` range or 1xx code, 204, 304 (RFC 9110 §6.4.1, "do not
  include content"), 205 (§15.3.6, MUST NOT), and every response of a HEAD
  operation, whatever its status (§9.3.2, MUST NOT). The schema describes a
  body no client receives: a generated client types its result from it and
  parses an empty stream, and this documentation shows the body and its
  sample under the status. One check per such response, all operation
  kinds; an empty `content` map passes. A `components.responses` entry used
  under one of these codes is checked once, at the component; a HEAD
  response is checked where the operation lists it, since it usually
  reuses its GET's response, whose content is right for GET.
- `http-date-headers` (`warning`) — a `Retry-After`, `Last-Modified` (RFC
  9110 §10.2.3, §8.8.2), `Expires` (RFC 9111 §5.3) or `Sunset` (RFC 8594 §3)
  response header declared as something other than an HTTP-date, which a
  sender MUST write as IMF-fixdate (RFC 9110 §5.6.7: `Sun, 06 Nov 1994
  08:49:37 GMT`). Fails on the first of: `format: date-time` or `date` (RFC
  3339, which HTTP date parsers are not required to read); a numeric `type`
  (`Retry-After` excepted: its delay-seconds is an integer); an example —
  the Header's `example`/`examples`, its `content` entry's, the schema's
  `example`/`examples` — that is a string but no IMF-fixdate (nor, for
  `Retry-After`, digits), or a number other than a `Retry-After` delay. The
  schema is `schema`, or that of the Header's `content` entry. A client
  generated from the declaration parses every real response wrong. One check
  per Header Object with a schema or an example, header names compared
  without case; a `components.headers` entry once, named by the first of
  these names a response uses it under — by its own key only when no
  response references it. Multipart part headers are out. Other kinds of
  example are `example-type-mismatch`'s; `Deprecation`, a Structured Field
  date, is `deprecation-header-format`'s.
- `query-method-body` (`warning`) — a 3.2 QUERY operation with no
  request body, or one with no `content`. QUERY carries its query in the
  content — "The content of the request and its media type define the
  query", and servers "MUST fail the request" without a matching
  Content-Type (RFC 10008 §2, the method OpenAPI 3.2's `query` field
  defines) — so the operation describes a request every conforming server
  refuses, and the try-it has no body to edit. One check per QUERY
  operation, all kinds; nothing before 3.2. An `additionalOperations` key
  spelled QUERY is dropped by the model and is
  `additional-operation-method`'s.
- `problem-details-shape` (`warning`) — an `application/problem+json`
  response schema that contradicts RFC 9457: a root that is no object (a
  declared `type` without `object`, or `items` — §3: "a JSON object"), or a
  standard member typed against §3.1 — `type`, `title`, `detail`,
  `instance` without `string`, `status` without `number` or `integer`. A
  client MUST ignore a member of the wrong type, so a `status` declared as a
  string is dropped by every conforming reader, and a generated client
  expects what no problem-aware library hands over. Read from the schema
  and its `allOf` members; an undeclared type contradicts nothing. One
  check per problem+json media type of a response (every operation kind,
  `components.responses` included) with a schema; a schema shared under
  `components.schemas` is checked once, there. Params `{ member }`: `$` for
  the root, `$.status` for a member. The value of `status` against the
  response code is `problem-status-mismatch`'s; prose-only error bodies,
  `error-machine-readable`'s.

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
  `description`. A body on a GET or HEAD is `request-body-method`'s, whose
  fix removes it rather than describes it.
- `property-described` (`info`) — a schema with properties lacking a
  `description` (a `title` counts unless it reads the name back). One check
  per schema, its finding naming the undescribed properties: the author
  writes them in one sitting, and self-explanatory `id` / `created_at`
  fields must not read as hundreds of findings. The check's credit is
  degressive in the share left undescribed (Scoring, §3).
- `error-responses-documented` (`warning`) — no error responses at all
  (no 4xx, and no `default`, which covers them) on a mutating operation —
  3.2's `query` method counts as a read. Skips webhooks and callbacks:
  those
  responses come from the integrator's server, not this API.
- `response-example` (`info`) — a success response (`2xx`, `2XX`) whose
  payload has no example (the app generates one, but a hand-written example
  is what the reader copies into their client); an error body's shape is
  the schema's and `error-machine-readable`'s business. One check per
  distinct payload: a `components.responses` entry once, at the component,
  and a payload whose schema is a `components.schemas` entry once, at that
  schema — passing when every response returning it shows an example. One
  check per response rather than per media type: the same payload as JSON
  and as XML is one example to write. Tool operations only: a webhook's or
  a callback's response is the integrator's. A placeholder
  example (`example-placeholder`: `"string"`, Swagger's `{ "id": 0,
  "name": "string" }`) does not count — it shows no more than the
  generated sample. A file response — a PDF, an export, anything the app
  classifies as binary (`body-kind.js`) — has nothing to check: the doc
  shows no sample of a file, and no example stands for its bytes.
- `info-described` (`warning`) — `info.description` missing.
- `info-metadata` (`info`) — `info.contact` or `info.license` missing, or
  present without what makes it usable: a contact needs an `email` or a
  `url` (a name alone reaches no one), a licence an `identifier`, a `url`,
  or a `name` that is itself an SPDX licence expression (`MIT`,
  `Apache-2.0 OR MIT`). Two fields, filled once for the life of the
  document, and the only ones that answer "can I build on this, and who do
  I talk to". Whether the email, URL or identifier is well formed is
  `uri-form`'s and `license-identifier-spdx`'s.
- `redirect-location` (`info`) — a 301, 302, 303, 307 or 308 response
  that declares no `Location` header (compared without case). RFC 9110
  says the server SHOULD send it with the new URI in a 301 and 308 and with
  the other URI in a 302 and 307 (§15.4.2, §15.4.3, §15.4.8, §15.4.9); a 303
  states no requirement because it is defined by the URI in its Location
  header (§15.4.4). Without it, a client author learns the answer is
  elsewhere and nothing about how to follow it. A 300's SHOULD is
  conditional and out, a 201's Location is no requirement, a `3XX` range
  names no single semantics. One check per such response of a tool
  operation; one under `components.responses` is checked once, at the
  component.
- `method-not-allowed-allow` (`info`) — a 405 response that declares
  no `Allow` header. RFC 9110 §15.5.6: the origin server MUST send one,
  listing the methods the resource supports — what a client told "not this
  method" reads to find the right one. The server's side is a MUST; the
  document's gap is what it leaves unsaid, hence `info`. One check per 405 of
  a tool operation; one under `components.responses` is checked once, at
  the component.
- `partial-content-range` (`info`) — a 206 response with neither a
  `Content-Range` header nor a `multipart/byteranges` media type. RFC 9110
  §15.3.7: a single-part 206 MUST carry Content-Range, a multipart one MUST
  be `multipart/byteranges` (each part with its own Content-Range, none at
  the top). A client resuming a download needs one or the other to place
  the bytes it got. One check per 206 of a tool operation; one under
  `components.responses` is checked once, at the component.
- `placeholder-text` (`warning`) — a display label holding a placeholder:
  `info.title`, `info.summary`, a 3.2 Tag `summary` or Response `summary`
  reading `Title`, `TODO`, `string`, `lorem ipsum`… (`isSubstantive`, with no
  name to read back: a label has none). These fields are display text and
  nothing else — the title heads every page and the browser tab, a summary
  names what it sits on wherever it is shown — so the placeholder is printed
  as the name. Read whatever the version, as the documentation reads them (a
  field the version lacks is `unknown-field`'s). One check per such field
  holding text. Operation summaries are `operation-summary-present`'s and
  `operation-summary-style`'s; descriptions are the `*-described` rules'.
- `tag-described` (`info`) — a top-level tag whose description is absent,
  a placeholder, or its name read back (`pets: "Pets"`). A tag is a chapter,
  its description the chapter's introduction: other renderers print it at
  the head of the group, this documentation shows it as the navigation
  group's tooltip. 3.2 tags whose `kind` is not navigational count too —
  they are still documented, as badges. One check per declared tag.
- `response-content-schema` (`warning`) — a response media type with
  a structure to describe — the JSON family (as `body-kind.js` recognizes
  it), XML (`application/xml`, `text/xml`, `+xml`), YAML
  (`application/yaml`, `+yaml`), forms — and neither `schema` nor 3.2
  `itemSchema`. The format is named, the payload is not: a
  generated client gets no type for it, and this app shows the body
  as `any`, with `null` as its generated example (none at all for XML). A
  file or plain text (`image/png`, `text/plain`) is its own description,
  and a media range (`*/*`) names no format. Every operation, webhooks' and
  callbacks' included; a `components.responses` entry is checked once, at
  the component, with the status of its first use allowing content. A
  response HTTP gives no content (1xx, 204, 205, 304, any to HEAD) is
  `bodyless-status`'s, which asks for the content to go. A request body with no
  schema is `untyped-input`'s; a response saying nothing at all,
  `response-substance`'s — the two fire together on `{ "application/json":
  {} }` with no description, one asking for the description, the other for
  the schema.
- `example-placeholder` (`info`) — an example that is a placeholder
  rather than a value: a string whose normalized text (the normalization of
  `isSubstantive`) is a JSON type name, `todo`, `to do`, `tbd`, `fixme`, `xxx`,
  `placeholder`, or starts with `lorem ipsum`; an object or array whose
  string leaves are all such words (one at least) and whose other leaves
  are `0`, `false`, `true` or `""` — Swagger Editor's generated `{ "id": 0,
  "name": "string" }`. Never a value the schema's `enum`/`const` allows (at
  the root, and at a leaf through `properties`/`items`): `"string"` is a fine
  example of a field whose values are type names. No other heuristic: a
  dull but plausible value is an example. One check per example value
  written — a schema's `example` and each `examples` item, a Parameter's,
  Header's or Media Type's `example`, an Example Object's `value` and
  `dataValue` — read on the source, a shared example once at its component.
  The reader takes an example as the API's word, and the try-it prefills it
  as the value to send; `response-example` does not count a placeholder. A value contradicting its schema is
  `example-type-mismatch`'s.

### 4.3 Deprecation hygiene

- `deprecation-replacement` (`warning`) — deprecated element whose
  description does not mention a replacement or sunset (heuristic, on the
  description and summary: absent, or free of any whole word naming a
  successor — `use`, `instead`, `replaced`, `replacement`, `superseded`,
  `successor`, `migrat…`, `sunset`, `prefer`, `in favor of`; `utilisez`,
  `utiliser`, `remplacé`, `remplaçant`, `successeur`, `migrer`, `préférez`,
  `privilégiez`, `au profit`, `à la place` — and of any `YYYY-MM-DD` date;
  a `sunset` or `x-sunset` field answers too). A deprecated operation also
  answers on the wire: one of its responses, any status, declares a
  `Sunset` or `Deprecation` header, or a `Link` header whose description or
  examples name the `successor-version`, `latest-version` (RFC 5829),
  `deprecation` (RFC 9745) or `sunset` (RFC 8594) relation.
- `deprecation-header-format` (`warning`) — a `Deprecation` response header
  (name without case) declared against RFC 9745 §2.1, whose value "MUST be
  a Date as per Section 3.3.7 of [RFC9651]": `@` and seconds since the
  epoch (`@1688169599`). Fails on a schema `type` that admits a boolean or
  excludes a string, a `date-time`, `date` or `http-date` format, or an
  example that is no Structured Field Date (`true`, an HTTP-date, an ISO
  date, a decimal) — the early drafts' `IMF-fixdate / "true"`. Examples are
  read everywhere a Header writes one: its `example` / `examples`, its
  `content` entry's, its schema's `example` / `examples`. A client written
  from the document parses a value the API never sends once it follows the
  RFC; this documentation prints the declared type next to the header's
  name. One check per such header with a schema or an example, on every
  Response (webhooks and callbacks included); a `components.headers` entry
  once, at the component. The date's relation to `Sunset` is
  `sunset-before-deprecation`'s; the other HTTP-date headers are
  `http-date-headers`'.
- `sunset-before-deprecation` (`error`) — a Response declaring both
  `Deprecation` and `Sunset` whose examples put the removal before the
  deprecation. RFC 9745 §4: "The timestamp given in the Sunset HTTP header
  field MUST NOT be earlier than the one given in the Deprecation header
  field" — graded by that MUST NOT. Only what parses is compared: the first
  `Deprecation` example that is a Structured Field Date, the first `Sunset`
  example that is an IMF-fixdate (RFC 8594 §3, RFC 9110 §5.6.7); a pair
  equal to the second passes. One check per such Response, a
  `components.responses` entry once; the finding on its `Sunset` header.
- `deprecated-but-required` (`warning`) — a request input both deprecated
  and required: a parameter with `required: true` (a path parameter is
  skipped — it cannot be optional, its deprecation is the operation's), or
  a writable property of a request body schema listed in its own schema's
  `required`. A deprecated parameter "SHOULD be transitioned out of usage"
  (OpenAPI), a deprecated property tells applications they "SHOULD refrain
  from usage" (JSON Schema 2020-12 §9.3); required says the request fails
  without it — one of the two flags is stale. Paths operations only (a
  webhook or callback request is sent by the API); a response property is
  fine, the server keeps sending it until removal. One check per deprecated
  request input, a shared parameter or schema at its component. On the
  demo GitHub schema: `contexts` of the branch protection update, required
  and "closing down".

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
- `operation-id-collision` (`warning`) — two different operationIds that
  generate one name: `getUser`, `get_user`, `GetUser`, `get-user`. The key
  is the name camelized as openapi-generator does it: the separators its
  `sanitizeName` turns into `_` (`.`, `-`, `:`, `|`, space, `/`, `\`,
  brackets, parentheses) dropped, the first letter and each letter after a
  separator taken in either case, every other letter's case kept —
  `getUserId` and `getUserid` stay two methods. Other symbols stay, since
  generators spell them out (`+1` → `plus1`). openapi-generator camelizes an
  operationId into its method name and, when two land on one name within a
  tag, renames the later `getUser_0` with a warning: the method name depends
  on declaration order. Compared over the whole document (the space the spec
  makes unique), webhooks and callbacks included. One check per operation
  with an operationId; the finding on each one after the first of its key,
  naming an earlier one spelled otherwise. Identical strings are
  `duplicate-operation-id`'s.
- `property-name-collision` (`warning`) — two properties of one schema
  whose names differ and share the key: `user_id` and `userId` both
  generate openapi-generator's `userId` field and `getUserId()`, a Java
  model that does not compile (issues #8291, #20484; the answer is a
  per-name mapping option). The key is `operation-id-collision`'s:
  `userId` and `userid` stay two fields. Own `properties` only, each schema
  once, a component's at the component. One check per schema with two
  properties or more; a finding per colliding name, on the later property.
  GitHub's reaction counts `+1` and `-1` do not collide.
- `schema-name-collision` (`warning`) — two `components.schemas` names
  sharing the key (`Pet.Status`, `pet_status`, `PetStatus`): openapi-generator
  writes one `PetStatus` class, the last schema silently winning, and every
  operation typed with a lost schema returns another's shape; names
  differing by case alone are two files a case-insensitive file system
  holds as one. The key is therefore the camelized name in either case.
  One check per schema component; the finding on each one
  after the first of its key. (The roadmap's
  `name-collision-after-sanitizing`.)

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
  nothing groups callbacks — the finding would name no degradation. A
  document that tags no operation at all made one decision: one check, at
  `paths`, counting the operations.
- `servers-declared` (`warning`) — no `servers` → environment seeding
  (§5.3 of architecture.md) has nothing to offer.
- `security-scheme-described` (`info`) — security scheme without
  `description` → degraded credentials cartouche.
- `oauth-flow-urls` (`warning`) — OAuth2 flow missing
  `authorizationUrl`/`tokenUrl` → the try-it "Get a token" block cannot
  run.
- `operation-summary-present` (`info`) — an operation or a webhook with a
  substantive description and no substantive summary → its navigation
  entry and page heading show the path (a webhook's name), its tab title the
  method and path, the pager a bare "Next"; a placeholder summary is shown as the name
  just the same. Callbacks are exempt: no navigation entry, no page. With
  neither summary nor description the operation is `operation-described`'s
  (§4.2), and has no check here.
- `operation-summary-style` (`info`) — a summary carrying Markdown or HTML
  (`**`, `__`, a backtick, `[…](…)`, a tag) or a line break → printed as
  typed: OpenAPI's summary is plain text, and the documentation shows it as
  plain text everywhere — navigation, page heading, tab title (one line,
  breaks collapsed), a callback's line, the pager. Operations, webhooks and
  callbacks, one check per non-blank summary. No length or wording test:
  those are the author's.
- `tag-declared` (`info`) — a tag operations carry that the top-level `tags`
  list does not declare → its navigation group has no description, no
  external docs, and comes after every declared group, in order of first
  use. Operations under `paths` only: webhooks are listed flat, never by
  tag. One check per distinct tag name carried; the finding sits on the
  first operation carrying it.
- `tag-unused` (`info`) — a declared tag no operation, webhook or callback
  carries, and that is no (3.2) `parent` of a carried tag → hidden from the
  navigation, description and external docs included. Usually a leftover
  from a removed endpoint, or a spelling the operations do not use (the
  other half is then `tag-declared`'s). A tag carried only by webhooks or
  callbacks passes: this documentation files neither under a tag, other
  renderers do. One check per declared tag.
- `markdown-unsafe` (`warning`) — raw HTML in a CommonMark description that
  the sanitizer removes → the reader gets nothing where the author put it.
  Every renderer has to strip what can run code or take over the page, and
  OpenAPI lets it ("Tooling MAY choose to ignore some CommonMark or extension
  features to address security concerns", Rich Text Formatting). The rule
  mirrors what this documentation runs — DOMPurify 3.4.13's HTML profile,
  plus `style`, `form` and the form controls forbidden: a tag outside the
  allow-list (`script`, `iframe`, `object`, `embed`, `svg`, `math`, an
  unknown or custom element), an attribute outside it (`on*` handlers,
  `target`), a URL whose scheme the sanitizer refuses (`javascript:`,
  `vbscript:`, `data:` except on an image or media element), in raw HTML,
  in a Markdown link or in an autolink (`<javascript:…>`). Also catches the
  accidental tag: `List<Pet>` or `/users/<id>` is an element to CommonMark,
  and vanishes. A test holds the mirrored lists to the `dompurify` version
  `package.json` pins. Each description is read the way this documentation
  renders it, each node once where it is written:
  - as a block (`marked.parse`: paragraphs, fenced and indented code blocks,
    reference definitions) — `info`, an operation (a webhook's included);
  - inline (`marked.parseInline`: no code block — an indented line is text,
    a fence a code span — and no reference definition) — a parameter, a
    request body, a response, a header, a link, a schema, a callback's
    operation, and a Reference Object's `description` where it stands for
    one of these;
  - both — a security scheme: a block in the authentication overview,
    inline in an operation's security box; a finding in either counts;
  - not read — a tag (a plain-text tooltip), a server and an External
    Documentation (plain text), a server variable, an example and a Path
    Item (not shown): nothing there is stripped.

  Text in code spans and code blocks is shown as typed and not judged; HTML
  comments are meant to be hidden. One check per description holding raw
  HTML or a link; the finding names the first thing stripped, as written.
- `markdown-links` (`info`) — a link or image in a CommonMark
  description whose target is relative (`./auth.md`, `../x`, `/docs/errors`,
  `diagram.png`, `?page=2`) → OpenAPI resolves it "in their rendered
  context, which might differ from the context of the API description"
  (OAS 3.0.4/3.1.1 §4.6, 3.2.0 §4.1.2.2.3); this documentation sets no base
  and rewrites no link, so it resolves against the documentation page: the
  image does not load, the link lands on a 404 of the documentation host. A
  lone `#fragment` passes (it scrolls to that anchor without changing the
  route), and so does a protocol-relative `//host`. Inline links and
  images, autolinks, the reference definitions a reference uses (in a
  description rendered as a block only), raw `<a href>`, `<area href>` and
  the `src` of `<img>` and the media elements. Descriptions are read as
  `markdown-unsafe` reads them — block, inline, both, or not at all for
  those shown as plain text — so a link in a code span or block, or in a
  server's description, is no link. One check per description with a link;
  the finding names the first relative target.
- `document-has-operations` (`warning`) — no operation under `paths` and no
  webhook → nothing to document: the home page says the schema declares no
  operations, the navigation is empty, a generator produces a client with no
  method. Hidden operations count. OpenAPI 3.1 allows a components-only
  document on purpose — a library of schemas other documents reference — and
  it fires there too: such a document is not one to publish as an API
  reference, or the rule is to be switched off for it. One document check.
- `example-external-only` (`info`) — an Example with
  `externalValue` and no inline value (`value`, `dataValue`,
  `serializedValue`). This app never fetches it — a page retrieving
  whatever URL a document names is a request-forgery surface — so the doc
  shows a link ("Declared in an external file, not fetched by this page"),
  and the try-it prefill and the response example skip it. Any other
  renderer needs CORS from that host, and 3.0 leaves the base of a relative
  `externalValue` to the implementation. The fix follows the version: 3.2
  takes a `dataValue` beside the link; before, `value` and `externalValue`
  are exclusive, so the inline `value` replaces it. One check per Example
  carrying a string `externalValue`, on the source. A malformed URL is
  `uri-form`'s; both fields in 3.0/3.1, `exclusive-fields`'.
- `type-missing` (`info`) — `untyped-input`'s question asked of what
  the API sends: a value whose schema says nothing about it (`{}`, `true`,
  annotations only, a 3.0 `nullable: true` alone) in a response body of any
  operation, or in a parameter or request body of a webhook or callback.
  Same predicate, same positions (`src/audit/untyped.js`): the root of a
  parameter and of a JSON body, every property, array item and tuple item
  below — a response's `readOnly` properties included, its `writeOnly`
  ones left out; 3.2 `itemSchema` judged like a body root. A schema
  `untyped-input` walks (any tool input) is that rule's: only its children
  outside the inputs get a verdict here — a shared component's `readOnly`
  property, for one. A schema met only as a composition member, an
  `additionalProperties` or a `patternProperties` value is not judged on
  its own (one that holds a value elsewhere is, whatever the order of the
  operations); a response media type with no schema is
  `response-content-schema`'s; a file has no type to give; a status or a
  method that allows no content (204, a HEAD response) is
  `bodyless-status`'. This app shows the value as `any` and its generated
  example holds `null` there. A schema in `components.schemas` is graded
  once, at the component, and so is a response in `components.responses`.
- `forbidden-in-browser` (`info`) — what a browser refuses to send,
  by the Fetch standard's lists, shared with the try-it
  (`src/openapi/forbidden.js`): an `in: header` parameter that is a
  forbidden request-header (`Host`, `Cookie`, `Origin`, `Content-Length`,
  any `Sec-`/`Proxy-` name, a method-override header whose declared values
  — `enum`, `const`, `default`, examples — name a forbidden method), and a
  paths operation whose method is CONNECT, TRACE or TRACK (3.2
  `additionalOperations` included). The browser drops the header without a
  word and throws on the method; the try-it names the headers it will not
  send and blocks the method, pointing at the cURL command. Any browser
  client hits the same wall. One check per header parameter (a shared one
  once, in components) and per paths operation; webhooks and callbacks are
  sent by the API. `in: cookie` parameters are left out (the try-it has its
  cookie note), and `Accept`/`Content-Type`/`Authorization` are
  `header-parameter-ignored`'s.
- `server-placeholder` (`warning`) — a server URL, variables at
  their defaults (`serverDefaultUrl`), whose host RFC 2606 reserves for
  documentation: `example.com`, `example.net`, `example.org` and their
  subdomains, any name under `.example` or `.invalid`. The try-it sends to
  the operation's own server, else to the environment seeded from a root
  server or the first root server: from this one, every request goes to a
  host that is not the API. `.test` and `localhost` are not placeholders
  (RFC 6761 testing and local names). One check per Server the client
  calls — root, Path Item, Operation — with an absolute URL, a relative one
  resolved against the document's own URI (`$self`, else where it was read
  from); not a Link's `server`, nor one inside a webhook or a callback. Plain http is
  `server-https`'s, an undeclared variable `server-variables`'.
- `server-described` (`info`) — with two top-level servers or more,
  one with neither a substantive `description` nor a `name`. This app
  names the environment seeded from a server after its `name` (3.2), else
  its `description`, else its URL (`env-manager.js`): the reader is left
  decoding URLs. One check per top-level server, only when there are
  several — a lone server needs no telling apart. `name` counts whatever
  the declared version, as the environment manager reads it; that it is a
  3.2 field is `unknown-field`'s. Path Item and Operation servers are
  picked by the operation, not by the reader.

### 4.6 Version awareness

Not a category of its own: a construct that contradicts the declared
version is a correctness finding, so these three rules score under §4.1.
They run against the **raw** document and read its declared version
(`ctx.version`, `{ raw, major, minor }`). Both version rules are written
as "does this spelling match the declared version" — the same `nullable`
PASSES in a 3.0 document instead of being punished for it.

- `version-legacy` (`warning`, per check) — a spelling a later version replaced,
  used in a document of that later version, with the exact rewrite built
  from the schema itself as `replacement`: `nullable: true` (→
  `type: ["string", "null"]` from the schema's own type, or a
  `{ type: "null" }` branch beside a typeless composition) and the boolean
  form of `exclusiveMinimum` / `exclusiveMaximum` (→ `exclusiveMinimum: 5`
  from its `minimum`; a `false` → `minimum: 5`) from 3.1 on; Swagger 2's
  `x-nullable: true` in any 3.x document (→ `nullable: true` in 3.0, the
  type list from 3.1). Those are silent failures: the newer reader ignores
  the older spelling. Two more are deprecated but still read, hence graded
  `info`: a Schema Object's `example` from 3.1 on (→ `examples: [<value>]`,
  the value written out in full — one longer than 200 characters elided as
  `examples: [...]`;
  3.1.1: "Deprecated: The example field has been deprecated in favor of the
  JSON Schema examples keyword"), and the XML `attribute` / `wrapped`
  booleans from 3.2 on (→ `nodeType`) — the threshold travels per
  construct. A spelling that only restates the default (`nullable: false`,
  a `false` XML boolean, a boolean bound with no `minimum` / `maximum`
  beside it) said nothing in its own version either and is not checked.
- `version-construct` (`warning`) — anything used ahead of the declared
  version. Every field and enumerated value of an OpenAPI object comes
  from the structure table (§4.1): 3.1's `webhooks`, `jsonSchemaDialect`,
  `info.summary`, the licence's SPDX `identifier`, `components.pathItems`,
  `type: mutualTLS`; 3.2's `$self`, `pathItem.query`,
  `additionalOperations`, `in: querystring`, `style: cookie`,
  `mediaType.itemSchema`, `prefixEncoding` / `itemEncoding`,
  `discriminator.defaultMapping`, XML `nodeType`, a Server's `name`, a
  Response's `summary`, a Tag's `summary` / `parent` / `kind`, an
  Example's `dataValue` / `serializedValue`, `components.mediaTypes`, a
  Media Type's `$ref`, the device-authorization flow… — wherever they sit,
  components included. A Reference Object's 3.1 `summary` / `description`
  are `ref-siblings`'. On schemas: type arrays, and every JSON Schema
  2020-12 keyword a 3.0 Schema Object does not have (3.0's list is
  `SCHEMA_KEYWORDS_30`, `src/audit/schema-keywords.js`) — `const`,
  `if`/`then`/`else`, `$defs`, `prefixItems`, `patternProperties`,
  `propertyNames`, `dependent*`, `unevaluated*`, `contains` and its bounds,
  `content*`, `examples`, `$id`, `$schema`, `$anchor`, `$dynamic*`,
  `$vocabulary`, `$comment`; not `not`, which 3.0 already carries, nor the
  spellings of the drafts in between (`definitions`, `dependencies`,
  `additionalItems`, `$recursive*`), which no OpenAPI version introduced.
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

- `untyped-input` (`warning`) — an input schema that says nothing about
  its value: no `type`, no `enum`/`const`, no structure, no composition —
  `{}`, `true`, or annotations only (`description`, `example`, `format`) —
  at the root of a parameter or of a JSON body, or at a property, array
  item or tuple item below; a JSON body declared with no schema is flagged
  at its media type. Bridges copy the schema into the tool as it is, so the
  agent guesses the type. In this app the schema view shows `any`, the
  try-it offers a bare text box and sends what is typed as a string
  (`coerceValue` has no type to convert to), and the generated sample is
  `null`. Left to other rules: a schema met only as a composition member
  (it describes the value with its siblings — one that also holds a value
  elsewhere is judged, whatever the order of the operations), an
  `additionalProperties` or `patternProperties` value (`free-form-input`),
  the root of a form body (`multipart-schema-object`), a parameter with
  neither `schema` nor `content` (`parameter-schema-or-content`); a text
  body's media type already says text, and `format: binary` is a file. An
  unresolved `$ref` is `ref-resolves`'. A schema shared through
  `components.schemas` is graded once, at the component. Its predicate and
  positions are shared with `type-missing` (`src/audit/untyped.js`).
- `free-form-input` (`info`) — an input object with no shape: `type:
  object` (or an object by its keywords) with no `properties`, no
  `patternProperties`, no `propertyNames`, no composition, and
  `additionalProperties` absent, `true` or saying nothing. The agent has
  every key to invent; OpenAI's strict mode requires declared properties
  and `additionalProperties: false`. A typed map (`additionalProperties: {
  type: string }`) has a shape, and `additionalProperties: false` alone is
  a closed, empty object. Not judged on their own, as they complete what
  holds them: an `allOf`, `then`, `else` or `dependentSchemas` member, and
  a `oneOf` / `anyOf` branch of an object with a shape of its own
  (`properties`, `patternProperties`, `propertyNames`, a closed or typed
  `additionalProperties`); a branch of a union with no shape of its own is
  all an agent gets for that choice, and is judged. Nor is the root of a
  form body (`multipart-schema-object`'s). A schema reached through a
  judged position anywhere is judged, whatever the order of the operations.
- `union-ambiguous` (`info`) — an input `oneOf`/`anyOf` of two or more
  branches, with no `discriminator`, where two branches take the same JSON
  type (`integer` and `number` are one) and neither has a `title` or a
  `description` the other lacks — text both inherit from a shared `allOf`
  base names neither. Bridges inline the union, component names gone, and
  the agent picks a branch blind. Not ambiguous: two object branches that
  each require a key the other does not declare (the key is an implicit
  discriminator), two object branches that both require a key whose
  `const` / `enum` values they hold apart (`kind: { const: a }` and
  `kind: { const: b }`), two arrays whose items differ in type, a
  single-constant branch. A union made only of constants, as this
  documentation reads one (`enumOf`), is an enum
  (`enum-values-undescribed`); one whose constant branch says more than its
  value (a `format`) is graded here. OpenAI's strict mode and Gemini do not
  support `oneOf` at all — stated, not graded.
- `input-root-shape` (`info`) — a JSON request body whose root is an
  array, a scalar, or only a `oneOf`/`anyOf` (even of objects): a root
  stating an object type that also holds a union (`{ type: object,
  properties, oneOf: [{ required: [email] }, …] }`) is an object. GPT Actions
  skips the operation; `@ivotoby/openapi-mcp-server` wraps an array or a
  scalar under a `body` property and makes a union the tool's root;
  Anthropic's API types `input_schema.type` as `"object"` and OpenAI's
  strict mode requires an object root. An `allOf` of objects is an object;
  a root that says nothing gets no verdict (`untyped-input`'s). One check
  per JSON request media type; when the API cannot change, the finding is
  one to accept in the configuration.
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
  it — an enum held in several places is explained by that prose only when
  every place's names the value, whatever the order of the operations. The
  message names the first three unexplained values. The fix leads
  with the description, which travels to every tool: OpenAI strict mode keeps
  standard keywords only and drops the `x-` extensions. A value its spelling
  explains — words of two letters or more joined by `_`, `-`, a space or
  camelCase: `active`, `past_due`, `inProgress` — needs nothing more: an
  enum of such words is not checked, and in a mixed one only the codes
  (`A1`, `3`, `x_ok`) are asked for. `null` and boolean enums are skipped;
  one check per input enum holding a code, each schema object once, a
  component's at the component, its credit degressive in the share of
  values left unexplained (Scoring, §3).
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
  drop them, even though the try-it prefills from them. The schema shows an example
  when its root (or an `allOf` member) has `example` / `examples`, or when
  every value it sends does: each top-level property carries `example`,
  `examples`, `enum` or `const`, an object through its properties, an array
  through its items, a wrapper or union through a member; a file part of a
  form has nothing to show. One check per distinct schema among an
  operation's non-file request media types: the same payload as JSON, form
  and XML is one example to write. An object whose declared properties are
  all `readOnly` has nothing to send, and is not checked.
- `error-machine-readable` (`info`) — an error response (`4XX` / `5XX` codes
  and ranges, `default`) whose content is all prose: `text/*` or HTML only,
  or JSON / XML with no schema, or one with no shape (a bare `string`, an
  empty schema) → an agent whose call fails reads a sentence and cannot
  branch on the error (which field, retry or not). A shape is an object or
  an array, declared or inferred as the schema view reads it (`{ required:
  [code] }` is an object), or reached through a composition. One structured
  media type among several is enough. One check per error response
  declaring content, tool operations only, a response shared through
  `components.responses` once, at the component; a response with no content
  leaves the status as the signal and is not checked. Documenting error
  responses at all is `error-responses-documented`'s.

### 4.8 Security

What the document lets through, each rule against the RFC or the OWASP API
Security Top 10 (2023) risk it breaks. The document cannot prove what the
server does; it is the contract every client is built from, and what it
says is what generated clients, gateways and this documentation do.
Operation-level rules read the document's paths operations, hidden ones
included — a webhook or a callback is a request the API sends, and its
security is the receiver's. An operation's effective security and its
servers come from `src/audit/security.js`, on the readings the try-it uses
(`securityRequirements` in `src/openapi/auth.js`, `serverUrl` in
`src/openapi/servers.js`); what counts as cleartext from
`src/openapi/mixed-content.js`, which the try-it's mixed-content diagnosis
and the OAuth block share — `http:` to any host but the machine itself (`localhost`, `127.0.0.0/8`,
`[::1]`, which W3C Secure Contexts holds potentially trustworthy). Three rules
grade their checks at more than one severity — `auth-scheme-weak`,
`operation-unsecured`, `oauth-legacy-flows` (§2.2: a configured severity
applies to all of them).

- `server-https` (`warning`) — a Server Object whose URL, variables at
  their defaults, is `http:` to a host other than the machine itself:
  every credential and payload crosses the network in clear, and a browser
  blocks a request from an https page to it as mixed content (W3C Mixed
  Content) — the try-it of any hosted install cannot reach it without a
  CORS proxy, and diagnoses the failure as mixed content. `localhost`,
  `127.0.0.0/8` and `[::1]` are exempt (W3C Secure Contexts: potentially
  trustworthy, and nothing leaves the machine); a relative URL is resolved
  against the document's own URI, as the try-it does — its 3.2 `$self`,
  else the URL it was read from, else the host page for an inline one:
  `/v1` in a document served over http is cleartext — and a document the
  CLI reads off the disk has no http(s) base, so a relative URL there gives
  no verdict; an undeclared variable in the host gives no verdict
  (`server-variables`'). Servers the client calls: root, Path Item,
  Operation, a Link's `server`; one inside a webhook or a callback is the
  receiver's. One check per Server with a string URL. The credential an
  operation exposes on such a server is `auth-scheme-weak`'s.
- `oauth-url-tls` (`error`) — an OAuth or OpenID Connect endpoint over
  cleartext http: a flow's `authorizationUrl`, `tokenUrl`, `refreshUrl`,
  `deviceAuthorizationUrl`, a scheme's `openIdConnectUrl` or 3.2
  `oauth2MetadataUrl`. RFC 6749 requires TLS on the authorization and token
  endpoints (§3.1, §3.2, MUST) and for refresh tokens (§10.4), RFC 8628 §3.1
  on the device endpoint, RFC 8414 §3 an https metadata URL, OpenID Connect
  Discovery §3 an https issuer; OpenAPI repeats it on every flow URL. In the
  try-it, from an https page, the login navigates to the http page (a
  navigation is not blocked: the reader types a password there) and the
  token request is blocked as mixed content. A URL counts only where
  something fetches it: on a flow that uses it ("Applies To"), under an
  `oauth2` scheme; `openIdConnectUrl` on `openIdConnect`,
  `oauth2MetadataUrl` on `oauth2`. Loopback exempt. A relative URL is
  judged where the app sends it, resolved against the document's own URI
  like a server's. One check per such URL present; a missing one is
  `oauth-flow-urls`', a malformed one `uri-form`'s.
- `auth-scheme-weak` (`error`, per check) — a tool operation whose
  effective security names, in any alternative, a credential that needs
  TLS, while one of the servers it goes to is cleartext http (read like
  `server-https`'s, a relative URL against the document's own URI). A bearer
  token — `http` `bearer`, and the access token of an `oauth2` or
  `openIdConnect` scheme, sent as `Authorization: Bearer` too — is an
  `error` (RFC 6750 §5.3, MUST); `mutualTLS` is an `error` (the client
  certificate travels in the TLS handshake, RFC 8705 §2: over http the
  scheme cannot work); `http` `basic` is a `warning` (RFC 7617 §4, SHOULD
  NOT). One check per tool operation using one of these, graded at the most
  severe; the finding names that scheme and the first cleartext server. An
  `apiKey` has no transport rule to cite — its server is `server-https`'s,
  which reports the server once where this rule reports what each operation
  exposes on it.
- `apikey-in-query` (`warning`) — an `apiKey` security scheme with `in:
  query`. Servers, proxies and CDNs log a URL whole, TLS or not; RFC 9110
  §17.9 calls sensitive information in a URI unwise, RFC 6750 §2.3 / §5.3
  says the same of tokens in a query string ("browser history, web server
  logs"), OWASP API2:2023 lists credentials in the URL. In the try-it the
  key is part of the request URL, which the history stores and every export
  of the request carries; redaction masks it there by default, but the
  server's and every proxy's logs keep it. One check per `apiKey` scheme.
- `http-scheme-registered` (`warning`) — an `http` security scheme whose
  `scheme` is not in the IANA HTTP Authentication Schemes registry (as
  updated 2025-02-18: Basic, Bearer, Concealed, Digest, DPoP, GNAP, HOBA,
  Mutual, Negotiate, OAuth, PrivateToken, SCRAM-SHA-1, SCRAM-SHA-256,
  vapid), compared without case — `JWT`, `token`, `apiKey`, a value with a
  space. OpenAPI 3.x: the value SHOULD be registered. It is the first word
  of the `Authorization` header: the try-it sends it lowercased, the MCP
  export capitalized, and a server expecting `Bearer` refuses both. One
  check per `http` scheme with a non-empty string `scheme`. A registered
  scheme the try-it cannot drive (`Digest`, `Negotiate`) is out of scope.
- `operation-unsecured` (`warning`, per check) — a tool operation anyone
  can call (OWASP API2:2023, Broken Authentication). The document is the
  contract: a generated client sends no credential, and this documentation
  shows no authentication section and a try-it with no credentials form
  (`applicableSchemes`). Open by omission — no `security` on the operation
  nor at the root, or a root `security: []`, which generators emit by
  default and which says nothing of any one operation — is a `warning` on a
  method that changes state and an `info` on a safe one (GET, HEAD,
  OPTIONS, TRACE, QUERY, and the safe methods a 3.2 `additionalOperations`
  may name: SEARCH, PROPFIND, REPORT; any other custom method counts as a
  write). Open by declaration — `security: []` on the operation, or an
  empty `{}` alternative at either level (optional authentication) — is an
  `info` whatever the method: the inventory of what is public on purpose,
  told apart by the `access` param (`omitted` / `declared`). A secured
  operation passes, graded at the severity an omission would have had. A
  document with no security scheme and no `security` anywhere (a root `[]`
  aside) gets one check instead, at
  `/components/securitySchemes`: one gap, not one per operation. Hidden
  operations count; webhooks and callbacks are the receiver's. A `security`
  list of malformed entries gives no verdict (`field-value-kind`'s); a
  requirement on an undeclared scheme reads as secured
  (`security-scheme-declared`'s).
- `secured-op-errors` (`info`) — a secured tool operation that does not
  document how it refuses a caller. Two checks: per operation whose
  effective security has a requirement and no anonymous alternative, a
  `401`, a `403` or the `4XX` range is documented (`default` does not count:
  it is every other failure) — and when no secured operation documents one,
  one check at `paths` instead, the document's single decision; per
  documented `401` of a tool operation, the
  response declares `WWW-Authenticate`, which RFC 9110 §15.5.2 says the
  server MUST send with at least one challenge. A generated client maps each
  documented status to an error, an agent reads it to decide whether to ask
  for credentials. The try-it's insight strip does not read
  WWW-Authenticate, so the document is where the reader learns the scheme. A
  401 written under `components.responses` is checked once, at the
  component. Whether a mutating operation documents any error is
  `error-responses-documented`'s.
- `oauth-legacy-flows` (`error`, per check) — an OAuth 2.0 flow the
  Security Best Current Practice retires: `password` is an `error` (RFC
  9700 §2.4, MUST NOT: the client app sees the user's password), `implicit`
  a `warning` (§2.1.2, SHOULD NOT: the token comes back in the redirect URL,
  where it leaks and can be replayed). One check per flow of each `oauth2`
  scheme, the others passing; a 3.2 `deprecated` scheme still counts — its
  flows run until clients have left. The try-it runs neither flow and falls
  back to a token pasted by hand. URLs over http are `oauth-url-tls`'s,
  missing ones `oauth-flow-urls`'.
- `rate-limit-retry-after` (`info`) — a documented `429` without a
  `Retry-After` header (case-insensitive). RFC 6585 §4: a 429 MAY say how
  long to wait, in seconds or as an HTTP date (RFC 9110 §10.2.3); a client
  written without knowing it retries at once or backs off by a guess. The
  try-it's insight strip reads the header from a live 429 or 503 whatever
  the document says, when the API exposes it to the page
  (Access-Control-Expose-Headers): documenting it is the promise to client
  authors. Quota headers (`RateLimit-*`, `X-RateLimit-*`) do not stand in
  for it. One check per 429 of a tool operation; one written under
  `components.responses` is checked once, at the component.
- `sensitive-field-exposure` (`warning`) — a schema marked `format:
  password` (on itself or on an `allOf` member) that a response body of a
  paths operation carries, without `writeOnly: true` on it or on an `allOf`
  member. `format: password` is OpenAPI's "hint to obscure the value";
  `writeOnly` is the keyword for a value sent and never returned — OpenAPI
  3.0: "SHOULD NOT be sent as part of the response", JSON Schema 2020-12
  §9.4: "never present when the instance is retrieved". OWASP API3:2023
  (Broken Object Property Level Authorization) is the reference. Generated
  clients type the response with the field, and this app's response sample
  shows it filled in (`pa55w0rd`), where a writeOnly property is left out.
  By the document's word only, never by property name: a `token` may be what
  the operation exists to return. Response bodies only (`schema` and 3.2
  `itemSchema`) and everything below them — properties, readOnly ones
  included, map and `patternProperties` values, array and tuple items,
  composition members, `then`, `else` and `dependentSchemas`; not response
  headers, not request schemas, not webhook or callback responses (the
  integrator writes them), and nothing under a writeOnly schema. One check
  per password schema, each schema object once, a component's at the
  component. A schema both readOnly and writeOnly is `readonly-writeonly`'s.
  No demo document returns one: the petstore's `User.password` has no
  format.
- `unbounded-input` (`info`) — a paths operation whose request body takes
  a string or an array with no upper bound. OWASP API4:2023 (Unrestricted
  Resource Consumption): "Define and enforce a maximum size of data on all
  incoming parameters and payloads". Request bodies only, files excepted:
  parameters travel in the request line and the headers, which every server
  already caps (RFC 9110 §4.1 asks for 8000 octets of URI and answers 414
  past its own limit, RFC 6585 §5 431 for headers) — a body has no such
  ceiling short of the upload limit. Every value position below the body
  root — properties (readOnly ones skipped, the keyword on the property or
  on an `allOf` member; those declared in `then`, `else` or
  `dependentSchemas` included), map and `patternProperties` values, array
  and tuple items. A string is bounded by `maxLength`,
  `enum`, `const`, a fixed-shape `format` (`date`, `date-time`, `time`,
  `uuid`, `ipv4`, `ipv6`, `duration`) or a `pattern` whose every top-level
  alternative is anchored `^…$` with no `*`, `+` or `{n,}` outside a
  character class or a lookaround; an array by `maxItems`, `enum`, `const`,
  or `prefixItems` with `items: false`. A bound in an `allOf` member bounds
  the value; a `oneOf`/`anyOf` bounds it when every branch able to hold
  the value's type does — a branch with no type of its own constrains the
  parent's (`{ type: string, anyOf: [{ maxLength: 5 }, { format: uuid }] }`
  is bounded), a branch typed otherwise does not apply. A file (`format:
  binary`, or a binary `contentMediaType` with no `contentEncoding`) is not
  a string to bound; numbers are out of scope; an untyped input is
  `untyped-input`'s. One check per operation with at least one string or
  array in its body, its credit degressive in the share of them left
  unbounded (Scoring, §3), its finding counting the unbounded values and naming
  the first three (`owner.name`, `tags[]`, `labels.*`, a body root by its
  media type); a component used at two places of the body (`billing`,
  `shipping`) counts at each, the walk bounded at 5000 positions per
  operation. Graded per operation, so a shared component left unbounded
  shows in each operation accepting it.

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
  `auditSchema({ source, document, model, problems })` — `problems` being
  what the loader's tolerant read found wrong in the text, `[]` for a text
  read strictly (`document-syntax`). The loader returns `source`,
  `document` and `problems` next to the model — `source` as a lazy getter, `document`
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
- **While it runs**: the audit is sliced one rule per frame (half a second
  of work on the 12 MB demo schema), so the page shows a progress card
  with the share of rules run rather than staying blank. A hidden tab
  draws no frame and holds its timers to one a second: there the run
  yields through a message, and still finishes in the background.
- **One overview card**, the verdict first: the document's identity heads
  it as a caption, then the grade and the category bars side by side from
  a tablet up (stacked on a phone, the grade on the first screen).
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
  the schemas, which are the audit's own unit of work. Same units and
  labels, so the two pages are comparable, but a line of figures rather
  than the home's tiles: here they caption the grade. Counted on the
  document, so hidden operations are in there, unlike the home's. Zeros
  are shown here rather than omitted: no security scheme, no group, no
  webhook are all things the report goes on to grade. Figures are written
  the reader's way (`40 148`).
- Summary: the aggregate letter inside a ring drawn to the score, the
  severity counts under it, and per-category score bars (static daisyUI
  class maps for severity/grade colors — rule 2, no `badge-${severity}`).
  The bars share one grid, so they start on one line whatever the names.
  The category rows are the report's index: each jumps to its section,
  unless the category has no finding and therefore no section — it then
  carries a check mark. A row that jumps says so at rest — its name in
  link color, underlined, with a down arrow — and the whole row is the
  target. Jumps are buttons rather than `href="#…"` anchors: the app is
  hash-routed and an in-page fragment reads as a navigation.
- **Help**, collapsed: the grade bands (rendered from `GRADES`, not
  restated), how a category score is computed, what each severity claims,
  what each category looks at. Read once, then never again — so it must
  not push the findings down permanently.
- Body: findings grouped by category, then **folded by rule** — the same
  omission repeated across a schema is one decision to make, not two
  thousand rows. Each category heading carries its score and its own
  severity counts: a reader who jumped straight to a section must not
  have to scroll back to the summary to weigh it. One row per rule that
  fired = severity tag (one width for the three severities, so the titles
  start on one line; above the title on a phone), the rule's label, the
  count of what it folds,
  and a chevron at the far right turning with the fold state (the native
  marker is suppressed, and nothing else would say the row opens; at the
  edge the chevrons line up in a column instead of reading as punctuation
  mid-row). Expanding shows the rationale and its fix once — hoisted to the group,
  stated expanded rather than behind a second disclosure — then the
  occurrences, where first (deep link, "hidden" badge, or location and
  pointer) then the message, **50 at a time**,
  materialized on first expansion and never before. The count is always
  on the row and the remainder is always on the "show more" button:
  nothing is dropped silently. A rule that fired once is not folded: its
  own message is more informative than the generic label, and its
  rationale sits behind a compact "why" disclosure — the one place a
  second click is cheaper than pushing the next rule down.
- A reading problem (`document-syntax`) quotes the file around it: the
  line before, the line itself marked, a caret under the column, the line
  after — the schema's text as the page's download serves it (the
  browser's cached copy of the loader's request). A position alone would
  send the reader to an editor to see what it holds.
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
  policy). `tests/audit-strings.test.js` checks `label`/`message`/`why`/`fix`
  over the whole registry, in both languages — fixture-driven coverage
  alone would only catch rules a fixture happens to fire.
  `tests/audit-rules-document.test.js` runs the loader and the engine, the
  CLI's way, on every file of `tests/fixtures/broken/` — a duplicate key, a
  trailing comma, an empty file, a list, OpenAPI 4… — and pins that each
  gets a report and which file rule fires.
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
  directory, or a URL; JSON or YAML, valid or not (§8.2) — or `--config`, the JSON object the host
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
  - What the text itself gets wrong (`document-syntax`) is placed at the
    line and column the parser reported: where a text is broken, a pointer
    means nothing.
  - The text is read once, by the same tolerant reader the loader falls
    back to (`src/openapi/read-document.js`), so a broken file is placed as
    it was audited. A JSON text is placed by a scan of its own tokens; a
    YAML one by the source ranges the `yaml` package's document keeps. The
    index is built on first use, a byte order mark counts as no column. A
    schema fetched from a URL or inline in a config has no file, and its
    findings no position. Cost on the repo's 12 MB schema: under 0.2 s, the
    whole `apiglow audit` run about 1.2 s.
- **`--output <file>`** writes the report to a file instead of stdout.
- **`--report <format>=<file>`**, repeatable, writes one more report per
  occurrence from the same run — the JSON for a script, the Markdown for
  the job summary, without auditing twice. `--format`/`--output` stay the
  shorthand for the stdout report; with `--report` alone, stdout stays
  empty. Two reports aimed at one file are refused.
- **What a report lists**, in every format: `--min-severity
  error|warning|info` keeps the findings that severe or worse — the
  GitHub REST schema yields some 5 000 findings, 4 000 of them `info`;
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
  — category, default severity, label, why it matters, how to fix it;
  `--list-rules` prints every rule as JSON (`format: "apiglow-audit-rules"`,
  `version: 1`), with the same texts the report's `rules` carries plus each
  rule's default severity. Both honor `--language` and refuse anything else on
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
cannot be reached. Every option is validated before anything is loaded: a
typo in a threshold must neither cost a download nor read as "no
threshold".

A file the command can open always gets a report, however broken it is. A
text no strict parser accepts is read tolerantly
([architecture.md](architecture.md) §14.21) and each of its errors is a
`document-syntax` finding; a file holding no OpenAPI description, or one of
a version the app does not read, is a `document-openapi` finding — both
`error`, so the default `--fail-on error` fails the run with status `1`, and
`--fail-on none` lets it pass. `spec "…" could not be loaded`, with status
`2`, therefore means the schema could not be reached — a missing file, a
network failure, a fetch past `--fetch-timeout` — or that a document read
whole could still not be processed.

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
- uses: apiglow/audit-action@v0.3.0
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
      npx --yes apiglow@0.3.0 audit openapi.yaml --baseline audit-baseline.json \
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
    - npx --yes apiglow@0.3.0 audit 'apis/**/openapi.yaml'
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
        entry: npx --yes apiglow@0.3.0 audit openapi.yaml --baseline audit-baseline.json
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
npx apiglow@0.3.0 audit openapi.yaml --format json --min-severity warning
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
