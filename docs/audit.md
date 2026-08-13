# Schema audit — feature specification

Status: implemented. This document is the functional source of truth for the
audit feature, alongside [`architecture.md`](architecture.md) (§5.12). The
shipped rule set lives in `src/audit/rules/`, one file per rule with its
tests; this catalog describes each of them.

## 1. What this is

An in-browser analyzer for the OpenAPI schema the app already loads. It
produces a report of findings — severity, message, rationale, location,
deep link to the operation — grouped into categories, each scored, with an
aggregate letter grade.

It is **not** a general-purpose linter competing with Spectral, vacuum or
Redocly lint on ruleset breadth. Those are CI-side, producer-side, install
tools. Our differentiators:

- **zero install**: runs on the schema the docs already fetched, in the
  browser;
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
2. **Curated, doc-oriented ruleset** (38 rules across the five §4
   categories), each rule a pure, individually tested function. No rule
   configurability beyond the feature switch — no custom rules, no
   per-rule severity overrides, no ignore lists. Simplest option first;
   extend only on demand.
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

## 3. Report shape

A finding:

```
{ ruleId, severity, category, location, opRef | null, dataPath }
```

- `severity`: `error` (almost certainly a schema bug) / `warning`
  (probably hurts consumers or the docs) / `info` (worth knowing).
- `category`: one of the five §4 categories.
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
  reports them one by one), and a tag borne only by a webhook makes no
  group (the nav lists webhooks flat, in their own section). No
  "callbacks" figure: the scope counts the same units as the home page,
  and nothing in the app counts callbacks.

Every rule ships three mandatory i18n strings — `audit.rule.{id}.label`,
`.message`, `.why` — in both `en` and `fr` (rules 9/17 of CLAUDE.md). The
label names a folded group, where a message interpolated with one
occurrence's values could not speak for all of them; the rationale says
*why it matters and what to do*, in one or two sentences — the actionable
half is the product. `tests/audit-strings.test.js` checks all three over
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

38 rules, one file per rule under `src/audit/rules/`, `rules/index.js` the
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
- `schema-dialect` (`info`) — a `jsonSchemaDialect` this app does not
  read as 2020-12: the document is read anyway, with 2020-12 meaning.

### 4.2 Documentation completeness

What the document leaves unsaid — mostly `warning`.

- `operation-described` (`warning`) — operation without `summary` and
  without `description`.
- `parameter-described` (`warning`) — parameter without `description`.
- `request-body-described` (`warning`) — request body without
  `description`.
- `property-described` (`info`) — schema property without `description`.
- `error-responses-documented` (`warning`) — no error responses at all
  (no 4xx) on a mutating operation. Skips webhooks and callbacks: those
  responses come from the integrator's server, not this API.
- `response-example` (`info`) — response schema declared without any
  example (the app generates one, but a hand-written example is always
  better). One check per status rather than per media type: the same
  payload as JSON and as XML is one example to write.
- `info-described` (`warning`) — `info.description` missing.
- `info-metadata` (`info`) — `info.contact` or `info.license` missing or
  empty. Two fields, filled once for the life of the document, and the
  only ones that answer "can I build on this, and who do I talk to".

### 4.3 Deprecation hygiene

- `deprecated-inventory` (`info`) — inventory of every
  `deprecated: true` (operations, parameters, properties, security
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
  convention. Header parameters are exempt: `X-Request-Id` follows the
  HTTP convention, not the document's.
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
  fallback nav group. Webhooks and callbacks are exempt: the nav lists
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
  well.
- `schema-expand-walls` (`info`) — schema cycles deeper than the
  lazy-expansion default → readers will hit "expand" walls. Info only —
  the app handles it, but authors should know. The depth mirrors
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
  `type: [..., "null"]`) from 3.1 on, the XML `attribute`/`wrapped`
  booleans from 3.2 on — the threshold travels per construct. All of them
  are silent failures: the newer reader ignores the older spelling.
- `version-construct` (`warning`) — anything used ahead of the declared
  version. 3.1+ constructs in a 3.0 document (`webhooks`, type arrays,
  `jsonSchemaDialect`, `info.summary`, the licence's SPDX `identifier`,
  and the JSON Schema 2020-12 keywords a 3.0 Schema Object does not have —
  `if`/`then`/`else`, `$defs`, `patternProperties`, `propertyNames`,
  `dependent*`, `unevaluated*`, `contains` and its bounds, `content*`;
  not `not`, which 3.0 already carries), and 3.2-only constructs
  (`additionalOperations`, the `query` method, `in: querystring`,
  `itemSchema`, `discriminator.defaultMapping`) in older documents.
- `conversion-approximation` (`info`) — a construct the Swagger 2.0
  conversion could only approximate. The converter
  (`src/openapi/swagger2.js`) marks what 3.0 cannot spell with
  `x-original-collection-format` rather than dropping it; the rule reads
  those markers, and only applies to a document carrying
  `x-converted-from`. The single case: a `collectionFormat` with no 3.0
  style (`tsv` anywhere, `ssv`/`pipes`/`multi` outside a query
  parameter).

## 5. Architecture

- Core module **`src/audit/`**: `engine.js` (walk + rule dispatch +
  scoring) and `rules/` (one file per rule, pure functions). The engine
  returns plain data; no DOM, no storage, no i18n — a finding carries a
  `ruleId` and its parameters, the UI resolves the strings. Fully
  Vitest-able.
- **Input: the raw schema, not the normalized model.** Normalization
  erases exactly what several rules must flag (`nullable`, version
  mismatches). This makes the audit the second legitimate consumer of the
  raw document, next to normalization; rendering still only consumes the
  model (rule 6 concerns rendering, and the audit *page* renders audit
  results, not the schema). Design rationale: `architecture.md`. The
  engine receives both the source document (pre-`$ref` resolution, for
  unused-component and ref-shape rules) and the dereferenced document
  (for rules that need resolved subtrees), plus the normalized model,
  which doubles as the hide-filter verdict so findings on hidden
  operations can be labeled. Concretely:
  `auditSchema({ source, document, model })`. The loader returns the
  three of them (`{ model, source, document }`): it parses first and
  dereferences a clone against the same URL — which keeps the source's
  `$ref`s observable while external `$ref`s still resolve. When
  `features.audit` is off, the shell drops both raw documents — nothing
  to compute from, nothing retained.
- **Lazy, sliced and cached**: nothing is computed at boot. The report is
  computed on first visit to `#/audit`, in-memory-cached per spec,
  recomputed on spec switch. The run is handed out one rule at a time
  (`auditRun()`, a generator) and the shell gives the browser a frame
  between slices: on the repo's heaviest schema a single-task run is half a
  second of frozen page, over the blocking cap of rule 14 on its own. There
  is no partial report — a score needs every category graded — so the view
  appears once, at the end, and not at all if the reader has left by then. No persisted dataset → no change to `storageInventory()`
  and no new storage policy. (A report history/trend over schema versions
  is deliberately out of scope; the `apidoc-schema` snapshots would be
  the natural substrate if ever wanted.)
- **Multi-spec**: report is per active spec, like the rest of the doc.
  `auditHash()` builds the route like the other builders and gets the
  multi-spec prefix for free; the route carries no id segment, unlike
  every other route — it designates the whole document.
- **Config**: `features.audit` (default `true`), overridable per spec
  like other feature switches; `false` removes the route, the settings
  entry and any computation. Documented in `config.example.js`.
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
  mid-row). Expanding shows the rationale once — hoisted to the group,
  stated expanded rather than behind a second disclosure — then the
  occurrences: message, deep link (or "hidden" badge), **50 at a time**,
  materialized on first expansion and never before. The count is always
  on the row and the remainder is always on the "show more" button:
  nothing is dropped silently. A rule that fired once is not folded: its
  own message is more informative than the generic label, and it keeps
  its rationale inline.
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
