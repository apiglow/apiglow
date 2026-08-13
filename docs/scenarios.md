# Scenarios — executable request sequences

Functional specification of the scenarios feature. Part of the functional
source of truth, alongside [`architecture.md`](architecture.md).

## 1. Vision and positioning

A scenario = a named, replayable sequence of HTTP steps, with value chaining
between steps and success criteria — all of it **100 % declarative** (no
`eval`/`new Function`, hence no Postman-style scripting; the constraint is a
feature: a scenario is fully serializable, shareable, analyzable and
exportable).

Positioning:

- **Postman/Bruno/Hoppscotch**: collections + runner + chaining, but via JS
  scripts, and they are *apps* separate from the docs. Here the runner lives
  *inside* the documentation.
- **Arazzo** (OpenAPI Initiative — steps, `outputs`, `successCriteria`,
  runtime expressions like `$response.body#/id`): the standard that
  describes exactly this model. The internal model is deliberately mapped
  onto Arazzo concepts, and scenarios export to Arazzo 1.1.
- Guided step-by-step mode: an authored scenario becomes an interactive
  tutorial executed in the real try-it ("Onboarding: create an account →
  get a token → first payment").

## 2. Data model

Pure module `src/scenarios/model.js` (defensive validation: untrusted input
→ never throws, returns `null` or an error list).

```js
Scenario = {
  id,            // local: uuid; config: declared id [A-Za-z0-9._-] — the
                 //   entry slug is the narrow [a-z0-9-], workflow ids add
                 //   dots and case (§3)
  name, description,          // description in Markdown (DOMPurify-sanitized)
  source: 'config' | 'local', // config = read-only, duplicable locally
  inputs: {name: string},     // values the scenario carries for its own
                              // variables (Arazzo workflow input defaults) —
                              // lowest precedence at run time (§6)
  steps: [Step],
}
Step = {
  id,            // uuid, stable across reorders (key of run reports)
  opId,          // operation id from the normalized model (unique PER spec)
  note,          // optional Markdown — the tutorial text in step-by-step mode
  request,       // SAME shape as share.js state: { path, query, queryString,
                 //   headers: [{name, value}], cookie, body, bodyFileName,
                 //   mediaTypeIndex, formFields }
                 // — TEMPLATE form ({{var}} unresolved), never a sensitive
                 //   value; bodyFileName is what reserves a file-carrying
                 //   step for step-by-step mode
  expect: {      // optional; default: 2xx status = success
    status,      // exact code (201) or class ('2xx')
    assertions: [{ pointer /* RFC 6901 into the JSON body */,
                   op: 'exists'|'equals'|'regex', value /* literal, or pattern for regex */ }
                 // or { op: 'matches', query } — an RFC 9535 JSONPath, its own
                 // field: a pointer and a query are two languages (§6)
                ],
  },
  extract: [{    // the chaining
    name,        // variable name, referenced as {{name}} in later steps
    source: 'body' | 'header',
    pointer,     // RFC 6901 for body; header name otherwise
    query,       // OR an RFC 9535 JSONPath over the body — its own field,
                 // and its presence is what makes the row a query row (§6)
    persist,     // false by default; true = written to the active environment after the run
    sensitive,   // masks the value in report/exports; forced true when persisting to auth.*
  }],
  continueOnFailure,  // false by default: a failure stops the run
  timeout,            // optional, ms — Arazzo's step timeout (§6)
}
```

- The `request` shape is **shared with `src/export/share.js`**: capture,
  share links and scenarios manipulate the same mirror of the try-it panel.
  File fields in `formFields` (`fileName`) are not replayable automatically
  (file content is never stored) → the step requires step-by-step mode,
  where the user re-picks the file.
- Run variables: at interpolation time, a **run-scope overlay** sits on top
  of environment variables, which sit on top of `scenario.inputs`
  (`{...inputs, ...envVars, ...runVars}`, later wins on collision — §6).
- Orphan step (opId missing after schema evolution): "operation not found"
  badge in the view, run blocked at that step with an explicit message.
- Pointers are stored as JSON Pointers (RFC 6901) — the file format and the
  Arazzo export require it — but displayed and entered in dotted notation
  (`triplon.original_operator`), with conversion living only at the edges. A
  pasted pointer is still accepted; a segment containing a dot displays raw
  (no unambiguous dotted form exists).

## 3. Configuration (authored scenarios)

- Single-spec: root key `scenarios: [{ id, title, url | document }]`. In
  multi-spec: **only inside `openapi.specs[]` entries** (a scenario
  references opIds that belong to one specific spec — no root merge, unlike
  docsPages; root declarations are ignored with a warning).
- **Two formats, and the document says which** — the loader sniffs it with
  `isArazzoDocument`, nothing is declared:
  - the file envelope of §8.1, one file for one scenario;
  - an **Arazzo workflow document** (JSON or YAML), read by the importer of
    §8.4. It carries `workflows[]`, so one entry declares as many scenarios
    as the document holds workflows — the author's own file, the one their
    CI runs, with no conversion step and nothing to re-author.
- **Two carriers**, independent of the format: `url` (a file to fetch) and
  `document` (the object itself, in the config — no fetch, so nothing to
  serve next to the page; it wins over `url` when both are declared, the
  rule `docsPages` and `openapi.spec` already state).
- `id` = stable slug, and the route of the scenario an envelope entry
  declares. An Arazzo document names its own: each workflow is routed under
  its `workflowId`, whose alphabet (`[A-Za-z0-9._-]`) is a usable route as
  is; two documents claiming the same one are disambiguated by their entry
  (`{entry}.{workflowId}`, first claimant keeps the bare form). `title`
  names an entry declaring a single scenario; declaring several, each takes
  its own name.
- An invalid or duplicate entry id does **not** take the documentation down
  (unlike a broken spec id, which breaks storage and routing): the entry is
  dropped at config normalization and flagged in the console, like an
  incomplete `docsPages` entry. An entry whose document cannot be fetched,
  or is not a scenario at all, keeps a record carrying its error instead:
  the nav still lists what the config declared, and the route says why
  nothing runs. A **partially
  supported workflow is not discarded** either: it renders with a visible badge
  naming what this documentation cannot execute, and the same list goes to
  the console — no human is watching at boot, so the importer's toast has no
  equivalent here, and a config scenario is read-only anyway (displaying a
  construct we cannot run is not offering to edit it).
- **The loaded model wins.** A file written for CI points its
  `sourceDescriptions` at the production schema; operations resolve against
  the schema this documentation loaded regardless. When the document
  declares **several** sources and a step names one explicitly, the choice
  this app cannot honor is flagged (`arazzo-source-ambiguous`); a
  single-source document resolves silently — there is only one thing it
  could mean. Multiple sources stay out of scope while
  cross-spec scenarios are (§9).
- Declared entries are resolved once, off the boot critical path: the nav
  shows the declared labels until their documents are in, since how many
  scenarios an entry declares is in the file and not in the config.
- `pinned: true` (optional): the scenario is additionally featured on the
  home page, in a card placed before the auth card (description + steps +
  open link). Config-only: a local scenario cannot be pinned; an Arazzo
  entry pins every workflow it declares.
- Config scenarios: read-only (no reorder/edit/delete); a "Duplicate" button
  makes a local editable copy.
- `features: { scenarios: false }` removes the entire feature — nav section
  (creation and import included), "Add to a scenario" buttons, home card,
  `#/scenario/{id}` and `#/scenario-import` routes (they answer "this
  scenario doesn't exist" — a received share link must not import anything
  into a doc that opted out), Cmd+K index. Declared `scenarios` are then
  ignored; local scenarios already stored stay in the database, intact.
  Overridable per spec.

## 4. Storage

- Dedicated IndexedDB database **`apidoc-scenarios`** (keyPath `id`, field +
  index `specId`, `createdAt`/`updatedAt`). Separate from `apidoc-history`
  because the life cycles are opposite: history is purged by retention, a
  scenario never evaporates. Ids come from the model (no autoIncrement) and
  survive export/import.
- **Hard cap of 200 scenarios per spec** (bounded-storage policy, see
  [architecture.md §6.1](architecture.md)): being user artifacts, they are
  never evicted — the creation is refused instead, with a message telling the
  user to export or delete one. The cap is per spec so that one busy API
  cannot lock the others out.
- `ScenarioStore extends EventTarget` (`change` event, same contract as
  `HistoryStore`): `add/update/remove/get/list/duplicate`, plus `count` and
  `clear` for the settings panel's inventory and reset. Reads re-validate
  through `normalizeScenario` — a record written by an older version is
  untrusted input like any other; an unrecoverable record is skipped rather
  than failing the whole list.
- Runs are **not** persisted as objects: each executed step writes its
  normal history entry, enriched with
  `scenario: { id, runId, stepId, stepIndex }`. The run report is in-memory
  view state; history is the durable trace (such entries carry a "scenario"
  badge).

## 5. UI

### 5.1 Navigation and routes

- "Scenarios" section in the nav, placed **before the endpoint reference**
  (after Markdown pages): config scenarios first, then local ones (an icon
  distinguishes the source), then "+ New scenario". With no scenario at all,
  the section collapses to a single "Scenarios" entry whose click creates a
  scenario and navigates to it — the feature stays discoverable without an
  empty section occupying the top of the nav.
- Route `#/scenario/{id}` (prefixed `#/s/{specId}/` in multi-spec). Indexed
  in Cmd+K (name + description + step names). Markdown pages can naturally
  link to `#/scenario/{id}` — that is the docs ↔ tutorial bridge.
- File import lives in the Export menu of a scenario page, and as a
  dedicated button on an *empty* scenario (where "how do I fill this?" is
  the question being asked).

### 5.2 Scenario view (central column)

- Header: name (inline-editable when local), Markdown description, source
  badge ("shipped" / "local"), step counter; actions: **Run all**,
  **Step by step**, Export menu (file / link / Arazzo / import), Duplicate,
  Delete (local).
- **Prerequisites panel**: the union of `{{vars}}` referenced by steps,
  minus those produced by an earlier extraction; each variable shown with
  its state in the active environment (provided / missing). It answers "why
  is this going to fail" *before* the first send.
- Step list as a vertical timeline: order number, method badge, path, note
  (Markdown), extraction chips (`{{paymentId}} ← /id`) and assertion chips,
  ↑/↓ reorder buttons (local only — keyboard-accessible by construction),
  per-step actions: "Open in the try-it" — spelled out, in primary, because
  it is where every edit of a step starts and an icon read as decoration —
  then "Update from try-it" (recaptures the panel's current state — that *is*
  step editing; there is no separate step editor by design) and "Delete".
- **Reading the chaining**: each step shows what it **produces**
  (`{{petId}} ← /id`) *and* what it **consumes**, with provenance —
  `{{petId}} ⇠ step 1` (green, a chain link), `⇠ environment` (gray),
  `⇠ not provided` (red).
- **Run report** (in-memory, displayed on the timeline): per step
  green/red status, HTTP code, duration, extracted values (masked when
  `sensitive`), detailed assertions (expected/actual), link to the history
  entry; unreached steps grayed out. Final banner: n/m passed, total
  duration, "Persist variables" button when `persist` extractions are
  pending.
- **`{{` autocompletion**: typing `{{` in any request field (parameters,
  headers, body — panel and central doc alike) suggests what is resolvable
  *at that point* (earlier extractions in step-edit mode, run scope in
  step-by-step, then active-environment variables), each entry saying where
  it comes from. Nothing to suggest = no list at all (`{{` is also how you
  write a variable that doesn't exist yet).
- **Writing the chaining**: "Open in try-it" puts the panel in an explicit
  **step-edit mode** — a banner above the panel names the step being
  edited, lists the variables writable there (a click copies the `{{name}}`
  template), and carries the "Save into step" button. The mode ends when
  leaving the step's operation (saving from another endpoint would record
  that other endpoint's request) or when a run starts.

### 5.3 Guided step-by-step

- Launch → stepper banner above the try-it: "Step 2/5 — {note}", with
  Previous / Skip / Quit. The app navigates to the step's operation and
  loads its `request` into the panel — same mechanics as loading a shared
  `?req=` link.
- The user sees the request, can modify it, and clicks the **real Send
  button**. On response: extractions applied to the run scope, assertion
  evaluated, the banner shows the verdict and a "Next step" button (no
  auto-advance: let the user read the response). Failure → Retry / Continue
  anyway / Stop.
- The banner lists the **available variables** (run scope acquired by
  earlier steps, sensitive values masked).
- A step blocked by a missing variable (typically: the step producing it was
  skipped) → an inline **input form** in the banner. Values entered join the
  run scope; an optional checkbox also writes them to the selected
  environment (run scope is the default — a test value has no reason to
  outlive the run).
- Re-sending the current step after its verdict re-judges it on the new
  response — the request actually sent is the panel's (the user may have
  fixed a parameter), and verdict, extractions and variables follow the
  last send.
- A send from *another* operation during a run is ignored (it would corrupt
  verdict and extraction) and is not tagged with the run.
- Mobile: the stepper lives in the try-it bottom sheet, above the form.
- The panel's in-progress draft is snapshotted at launch and restored on
  exit, on the relevant endpoint only.

### 5.4 Capture

- **From the try-it**: "Add to a scenario" (top of panel and export bar —
  two distinct moments: before sending, and after reading a satisfying
  response) → dropdown: existing local scenarios + "New scenario". Captures
  the **template form** of the current state (even if never sent); sensitive
  values pasted in clear are re-templated via the share-link sanitizer.
- **From history** (list view + run selector): same action; a history entry
  stores the *resolved* request → rebuilt into template form using the
  entry's recorded sensitive values.
- Capture navigates to the target scenario and unfolds the added step's
  chaining editor — the remaining work (chain, verify, order) is on that
  page.
- **One-click extraction**: in the scenario view, the keys of a response are
  **clickable**: clicking `access_token` creates
  `{ name: 'accessToken', pointer: '/access_token' }` pre-filled (editable
  name, persist/sensitive toggles). Manual pointer entry remains as fallback.
  - **The row is the target**: each key line is a band that lights up under
    the pointer and under keyboard focus, and **opens** with the two gestures
    — `↳` extract, `✓` check — as icon buttons carrying a tooltip and an
    accessible name that state which key they act on. They sit at a fixed
    left edge, before the indented key, so they align down a single column
    whatever the depth: a lone `✓` at the end of a long line went unseen, and
    the eye lost the row on the way to it. The key itself stays a one-click
    shortcut for the frequent gesture, extraction. An unavailable action is
    **hidden, not greyed** (a container has nothing to check, a dynamic key
    has no pointer at all); the slot stays, which is what holds the column.
  - **The place is kept across the write.** Each click rewrites the step, and
    the whole timeline re-renders in answer: the list a key was picked from
    comes back scrolled where it was, and the keyboard on the button it acted
    with. Extraction is a series of clicks in one list — sent back to the top
    of it each time, the second key costs a hunt. The mechanism is generic
    (`keepPlace` in `components/dom.js`, `data-keep-scroll` /
    `data-keep-focus`), and the route stops re-mounting the view it already
    holds: `replaceChildren` with the element in place still detaches it, and
    the browser drops every scroll offset underneath.
  - **Two sources, two tabs**: the step's **observed response** (last run or
    linked history entry) and the operation's **declared schema**. Response
    keys are known ahead of any real send — the schema tab makes extraction
    available right after capture, and it is the only one showing optional
    fields absent from an observed body. Status selector for which response
    to inspect; declared headers extractable, extraction only (no check —
    body is all that assertions evaluate).
  - **The schema tab shows only types**, never sample values, and its check
    only creates an `exists` assertion: an `= "string"` assertion pre-filled
    from a schema would be a false verdict committed sight unseen.
    Inspecting a status never writes `expect.status`.
  - `allOf` is merged in this view (unlike the doc rendering, which keeps it
    composite): without merging, an `allOf: [Base, {props}]` schema — a very
    common shape — would show no keys. `oneOf`/`anyOf` show the first
    variant with a count (`· 1/3`). Dynamic keys (`additionalProperties`)
    are not clickable and say so.
- **Chaining from the hole to fill**: the red `{{var}} ⇠ not provided` chip
  on a step is **clickable** → a list of pointers from earlier steps
  (observed responses, else declared schemas) that could provide the
  variable, matched by name (`Pet` + `id` = `petId`; nothing is suggested
  below a similarity threshold). Choosing one writes the extraction into
  the step **that produces** the value, under the name the consuming step
  expects. A second click corrects the pointer instead of stacking a
  duplicate.

## 6. Execution (runner)

- The real send pipeline is `src/openapi/send.js` — shared with the try-it
  panel, so the runner sends exactly the same requests
  ([architecture.md](architecture.md) §14.10 covers the design).
- `src/scenarios/runner.js` — **pure async generator**:
  `runScenario(scenario, { ops, baseUrl, variables, runVariables,
  authInjectionFor, sender, … }) → yield
  StepResult` per step — environment variables arrive as `variables`, the
  run scope as `runVariables`. The `sender` is injected (the real `send.js` in
  production, a fake in tests); auto-run = consume the generator in one go,
  step-by-step = consume it at the pace of manual sends — a single
  orchestration code path (interpolation overlay, extraction, assertions,
  stop/continue). The step-by-step driver is
  `src/scenarios/step-controller.js`, injected the same way and unit-tested
  without a browser.
- Per step: `buildRequest` with `variables = {...inputs, ...env, ...runScope}` → if
  `missing`/`errors` are non-empty, **step fails with the standard signal,
  nothing is sent** → otherwise send → extraction (JSON-parsed body;
  non-JSON, absent pointer, or an empty/null extracted value = extraction
  failure, and the variable stays missing for later steps) → `expect`
  evaluation (default 2xx) → tagged history entry. A failed extraction
  fails the step (letting it stay green would surface the problem three
  steps later as a missing variable, far from its cause);
  `continueOnFailure` has the last word.
- **`timeout`** (Arazzo's step field, ms): the auto run passes an
  `AbortSignal.timeout` to the sender, and an aborted send fails the step with
  its own reason rather than as a network error — *"aborting and failing the
  step"* is the spec's wording, and blaming the API for a deadline we set
  would be the wrong reading. The diagnosis probe is skipped on that path: it
  would question a server we never gave time to answer, and it is the slowest
  thing in a failing send. Step-by-step ignores it — the human drives the
  panel's Send button there, and cutting off a request they made themselves
  is not what the document asked for.
- `equals` compares loosely (`String(a) === String(b)`, serialized form for
  objects/arrays): the expected value comes from a text field, where "7"
  must match the JSON number 7.
- **A query extraction** (`query` instead of `pointer`) is Arazzo's
  `jsonpath` Selector Object on a step output. RFC 9535 returns a nodelist and
  an extraction needs one value, so **the first node wins** — the rule the
  Overlay resolution already applies when it needs one node, so the app says
  one thing about nodelists rather than two. An empty nodelist is
  `query-no-match`, a malformed expression `query-invalid`: both are failed
  extractions leaving the variable missing, exactly as a pointer leading
  nowhere does. It exports back as the Selector Object spelling, the only one
  that can carry a query; pointer and header extracts keep their runtime
  expression, so an existing document exports byte-identically.
- `regex` is Arazzo's `regex` criterion: the pattern goes in the same `value`
  slot `equals` uses for its literal, and is tested — **unanchored**, which is
  what the spec's "matches" means — against the same text `equals` would have
  compared. No flags, no `/…/` delimiters: the condition *is* the pattern. An
  invalid pattern is a failed assertion (`pattern-invalid`), never a throw.
  The one guard is on the **subject**, not the pattern: a value longer than
  100 000 characters fails with `value-too-long`, because native `RegExp` has
  no step limit and the text a pathological pattern can backtrack over is the
  only lever we have. An empty pattern makes the row inactive rather than
  always-true — a half-filled check must not turn a step green.
- `matches` is Arazzo 1.1's `jsonpath` criterion, with the spec's own rule:
  the assertion passes when the RFC 9535 query selects **at least one node**,
  fails on an empty nodelist. It is `exists` generalized from a pointer to a
  query, so it takes no expected value; the evaluation stops at the first
  node, which is also the only bound this walk needs. A malformed expression
  is a failed assertion (`query-invalid`), never a throw — same contract as
  everything else in `evaluate.js`. The editor swaps the path field for a
  query field rather than showing both: the ✓ picker fills a path and means
  nothing here.
- **Three layers of variables**, and the order is the point:
  `scenario.inputs` < environment < run scope. A scenario input is a value the
  *document* provides, so anything the user or the run provides beats it — a
  default that overrode an environment variable would make a shared file
  silently change someone's configuration. Being covered is a default's normal
  fate, which is why `variable-shadowed` does not report it: that warning is
  about a run-scope value hiding an environment one, a genuine surprise. A
  variable with a default is not listed as a prerequisite (§5.2), because the
  scenario carries it.
- **Persisting `persist` extractions**: applied at end of run (or of step,
  in step-by-step) via the environment store, with the `sensitive` flag.
  Allowed even with `environmentsLocked`: it is a runtime value, same
  status as an OAuth token.
- Auto run: strictly sequential steps (chaining requires it), no delay or
  retry.
- CORS/proxy: same settings and same explanatory messages as the try-it.
  The proxy toggle for "Run all" sits in the scenario header (there is no
  try-it panel on that route); step-by-step sends from the panel, with the
  panel's setting.

## 7. Security and redaction

- A stored/exported/shared scenario **never** contains a sensitive value:
  template form at capture, share-link sanitizer as a safety belt on every
  export.
- `sensitive` extracted values: masked `••••` in the report and chips (eye
  toggle); redaction in history via the existing mechanism.
- Markdown descriptions/notes: systematic DOMPurify, including for scenarios
  loaded from the config (a remote file is external content).

## 8. Interop and sharing

### 8.1 File (canonical format)

`{ format: 'apiglow-scenario', v: 1, scenario: {...} }` — "Download"
export; import via the Export menu (defensive validation, errors listed,
never a throw). This is also the format of files declared in the config
(§3): **the authoring loop is "a dev builds the scenario in the UI → commits
it into their docs"** — there is no JSON editor to hand-write. The exported
file carries no `id` (a local id is a private uuid; re-importing would
overwrite the original; config ids are declared slugs).

### 8.2 Share link

- `#/scenario-import?d={base64url}` (prefixed in multi-spec). The payload IS
  the file envelope — one canonical form, one defensive validation. On
  open: a **preview** ("Import this scenario?" — name, listed steps, no
  automatic execution) → local import. Never any execution or write without
  an explicit gesture.
- Size guard: beyond ~8 000 URL characters, the link is still copied but
  with a warning suggesting the file export (messaging apps truncate well
  before browser limits).

### 8.3 Arazzo 1.1 export

Pure generator `src/export/arazzo.js`, snapshot-tested: scenario →
`workflows[0]`; step → `steps[]` with `operationId` when the schema declares
one, `operationPath` otherwise (the internal fallback id exists only here);
what a step extracts becomes `$steps.<stepId>.outputs.<name>` for later
steps (chaining made explicit), remaining `{{var}}`s become `$inputs.*`;
`expect` → `successCriteria` (`$statusCode == 201`, JSON Pointer
conditions). Arazzo names reject dots, so `auth.session` exports as
`auth_session`. `sourceDescriptions` points at the active schema URL.

The document declares `arazzo: 1.1.0`, and two fields are exportable only
because of it: a step's whole query string goes out as
`{name, in: 'querystring', value}`, under the name the operation declares for
that parameter — before 1.1 there was no spelling for it and the field left
the document silently — and a **query extraction** (§6) leaves as the 1.1
Selector Object (`{ context: '$response.body', selector, type: 'jsonpath' }`),
the only spelling that can carry a query. Everything else stays 1.0-readable:
pointer and header outputs keep the short
`$response.body#/x` expressions rather than Selector Objects (the same thing,
and readable by a 1.0 tool), and no `$self` is emitted — one workflow from one
document has no second document to be the base of.

### 8.4 Arazzo 1.1 import

The return trip of §8.3, through the same "Import a file…" entry: the picker
reads our own envelope **or** an Arazzo workflow document (JSON or YAML — the
form the ecosystem writes them in), and the file itself says which. One
workflow becomes one scenario, so a document with three of them imports three.

The same parser reads a document a `scenarios[]` entry declares (§3), where
the workflows become read-only config scenarios instead of local ones — one
importer, whichever door the document came through.

`src/import/arazzo.js` is a pure parser like the request importers next to it,
with one difference worth stating: it is **not operation-blind**. An Arazzo step
names an operation, so the operation list comes in as data (`{ ops }`) — never
the model. `operationId` is resolved against the schema's own ids (through the
`$sourceDescriptions.x.` prefix our export writes), `operationPath` by decoding
its JSON pointer to a path and a method.

The mapping: workflow `summary`/`description` → scenario name and description;
step `description` → note; `parameters` → path/query/header/cookie values, plus
1.1's `in: querystring` onto the whole-query-string value the try-it panel
edits (OAS 3.2's construct, which the model already carries);
`requestBody.payload` → body, or the field list when the operation's media type
is one that edits fields; `outputs` → extractions (`$response.body#/ptr`,
`$response.header.X`, and 1.1's Selector Object when its `type` is
`jsonpointer` over the response body, `jsonpath` becoming a query extraction);
a declared `inputs` **default** → `scenario.inputs`, under the dotted original
where our own export recorded one; `successCriteria` → expected status and
assertions, a `jsonpath` criterion over `$response.body` becoming a `matches`
assertion and a `regex` one over `$response.body#/ptr` a `regex` assertion
(§6). A 1.0 document is read exactly like a 1.1 one.
Runtime expressions become `{{variables}}`: `$inputs.x` and
`$steps.<id>.outputs.<name>` both land on the name of the variable that
produces the value, which is exactly what chaining means on our side.

What Arazzo can say and the scenarios model cannot is **named, never dropped
silently**: a step calling another workflow (no nesting here), an `xpath`
criterion, a `jsonpath` one whose `context` is anything other than the whole
response body, a `regex` one whose `context` does not point *inside* it,
a parameter referencing the Arazzo document's own
components, `replacements` over a payload, `onSuccess` / `onFailure` actions
(workflow- and step-level alike), a workflow's own `outputs` or `dependsOn`,
a step `dependsOn` the strictly sequential run cannot honor, a `requestBody`
content type the operation does not declare, an `arazzo` version we do not
recognize (read as 1.1, and said so),
an output expression that is not a response expression, a Selector Object
whose `type` is `xpath` or anything unknown, a second `querystring` parameter
in one
step. And 1.1's **AsyncAPI steps** — `action` (`send` /
`receive`) over a `channelPath` — which are a documented degradation rather
than a gap (rule 19): a browser HTTP client has no message transport to run
them on, so the step is named and dropped while the HTTP steps around it import
normally.
Every one of them is a warning code; the import announces how many there were
and lists them in the browser console — the same channel a config scenario's
own issues already use.

Round trip: a scenario exported to Arazzo and re-imported is the same scenario
(ids apart — a local id is a private uuid), and
`tests/scenario-roundtrip.test.js` asserts it over a corpus covering every
construct the model expresses. What does not survive does so by construction
rather than by neglect, and the test pins the list: the `2xx` expectation, which
comes back as our default verdict because that is what it is; `persist` /
`sensitive` on an extraction, which Arazzo has no notion of; a variable name
carrying a dot, unless our own export recorded the original in the input's
description — the dot is an expression separator there, and `auth.session`
leaves as `auth_session`; a body that was a file, whose bytes were never stored
and whose empty payload carries no `@name` convention to read the name back
from (a form field does, and survives); and `continueOnFailure`, which Arazzo
has no field for — the nearest spelling is an `onFailure` `goto` onto the next
step, and that tells a runner the failure does not count, where our flag means
it is recorded and the run carries on.

### 8.5 Published artifacts (agents, and the bake)

What a **config-declared** scenario becomes for a reader who is not clicking
anything — full specification:
[`scenario-handoff.md`](scenario-handoff.md) §2–§3. A reader's own scenarios
are never published: the bake is a Node CLI that cannot open IndexedDB, and
the in-app generators hold themselves to the same set so the downloaded
`llms.txt` and the served one describe the same documentation.

- **Markdown mirror** (`src/export/scenario-markdown.js`): prerequisites,
  then one section per step — what it calls, sends, asserts and extracts.
- **`llms.txt`**: a `## Workflows` section between the docs zone and the
  operation groups, one line per scenario with its step and input counts.
- **`llms-full.txt`**: the same Markdown plus the Arazzo document inlined,
  since a recipe behind a second fetch is a recipe the model does not have.
- **Bake** ([`seo.md`](seo.md) §4): `scenario/{id}.arazzo.json` next to the
  `.md` mirror and the `.html` snapshot. The recipe is the authored document
  copied whole when the entry declared Arazzo, `toArazzo`'s output otherwise
  — one arbitration (`publishedArazzo`) for every surface.

An entry declaring an Arazzo document by `url` is the case the whole design
aims at: the file the author owns is the file the CI runs and the file the
agent fetches, linked as it stands even with no bake.

### 8.6 CI hand-off

An **"Automate this scenario"** panel on the scenario page holds the job that
runs the workflow's Arazzo document on a schedule — GitHub Actions or GitLab
CI, through the Arazzo runner picked there (`src/export/ci.js`, `CI_RUNNERS`).
Scheduling is structurally impossible in a front-end product; the pipeline the
reader already has is the answer, not a feature gap. The variables the job
needs travel as names wired to the platform's secret store, never as values
(§7), and what the selected runner would ignore is named above the snippet.
`features: { ci: false }` removes the panel and nothing else. Full
specification: [`scenario-handoff.md`](scenario-handoff.md) §4.

## 9. Multi-spec

Everything is **per spec**: store scoped by `specId`, config inside
`specs[]`, prefixed routes, nav and Cmd+K on the active spec only. No
cross-spec scenario (opIds are only unique per spec) — explicitly out of
scope, documented in `config.example.js`.

## 10. Out of scope (deliberate)

Scenario folders/hierarchy; scripting; data-driven iterations (CSV);
delay/retry/polling; Postman collection import *as a scenario* (a collection
imports one request at a time, into the try-it); non-HTTP steps (webhook
waits); Postman scenario export; run report persistence; running a scenario
on a schedule — no server by charter, and the hand-off of §8.6 is the answer
rather than a gap.

The decided evolutions live in [`scenarios-roadmap.md`](scenarios-roadmap.md);
this list remains the implemented boundary until a roadmap workstream
graduates back into this document.

## 11. Tests

Unit (Vitest, pure core): generator runner with a fake sender (chaining,
scope overlay, failure/continue, missing extraction); RFC 6901 pointer;
assertions; model validation (malformed input); re-templating on capture
from a history entry; file + URL encode/decode round-trips; Arazzo snapshot;
Arazzo import (mapping matrix + export/import round trip); step
controller; the declared-scenario loader over both formats and both carriers;
the Markdown mirror and the CI snippets by snapshot; a completeness checklist
walking `normalizeScenario`'s own keys to both exports, so a model that grows
cannot leave them behind. E2E (Playwright): config-declared scenario fixture,
mocked routes for chaining (a POST returns an id → the GET uses it), capture,
reorder, persistence across reloads, step-by-step, share-link preview, a
third-party Arazzo document declared as it stands, the CI panel listing
variable names and no value, and both feature switches.
