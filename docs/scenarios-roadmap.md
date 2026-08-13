# Scenarios roadmap — beyond the v1 boundary

Forward-looking product plan. It re-examines the deliberate exclusions of
[`scenarios.md`](scenarios.md) §10 against a competitive analysis of the
market, and records the decided direction for the next waves of the
scenarios feature.

Two reading rules:

- **This is not a description of current behavior.** `scenarios.md` remains
  the functional source of truth for what exists; a workstream graduates
  into it (and into `architecture.md`) only when implemented.
- **The plan is written at the functional level, on purpose.** These
  features may land far in the future; module names, file paths and other
  implementation anchors of today's codebase are deliberately avoided,
  because the code will have moved by then. Where the current spec is
  referenced, it is by concept (the runner, the step model, the share
  sanitizer), not by file.

## 1. Scope surveyed and decided direction

The competitive analysis behind this plan covers three fields: API clients
and their runners (Postman, Insomnia, Bruno, Hoppscotch, Yaak, Restfox,
Thunder Client), documentation platforms (ReadMe, Scalar, Redocly,
Mintlify, Fern, Speakeasy, Apidog, Zudoku…), and the Arazzo /
declarative-testing ecosystem (Respect, Jentic, Stepci, Hurl,
Schemathesis, Microcks…). The decided direction:

- **Ambition**: both "living documentation" and "declarative test bench",
  with the Arazzo specification as the compass for what the model can
  express.
- **Constraint**: browser-first stays; a hosted optional service is
  conceivable at the far end (its frontier is sketched here, §5.9).
- **Expressiveness**: no scripting, ever — the gap is closed with a closed
  library of declarative value generators and transform pipes (§5.2).
- **Core workstreams**: async execution (retry/polling), full Arazzo 1.1
  alignment including branching with a flow-graph view, and executable
  onboarding with tooled prerequisites.
- **Also decided in**: minimal stateless mock runs, SSE/WebSocket steps,
  human "manual gate" steps, a host-provided AI assistant (full scope:
  generation, diagnostic, docs-anchored chat).

## 2. Market picture

What the analysis established, condensed to what drives this plan:

1. **Nobody executes Arazzo in the browser.** Arazzo 1.0 (2024) → 1.1
   (May 2026) has runners (Redocly Respect, Jentic arazzo-engine,
   Itarazzo) — all CLI/CI-side. Redocly's interactive console is roadmap.
   No documentation product renders an Arazzo workflow as an executable,
   in-docs experience. This is exactly our seat, and it is empty.
2. **Chaining is script-locked across the industry.** Postman, Bruno,
   Hoppscotch and Insomnia all answer "take the id from step 1" with
   JavaScript. Only Yaak (template functions) and Thunder Client
   (GUI-declarative) prove the 90 % case needs no code — which is what our
   model already does. Vendors now sell AI (Postbot & co) to *write* the
   scripts their primitives impose; a declarative model makes most of that
   generation unnecessary.
3. **Declarative retry/polling is a universal hole.** Postman's canonical
   answer is a `setNextRequest`-on-self script hack; its one declarative
   retry checkbox is buried in paid scheduled runs. Hurl's
   `retry`/`retry-interval` (re-run until asserts pass) is the cleanest
   scriptless pattern in the field. Arazzo has first-class `retry` actions
   (`retryAfter`, `retryLimit`, criteria-gated). Nobody does declarative
   backoff.
4. **Runner features are where the money gates are.** Postman meters
   scheduled/monitored runs; Bruno paywalls CSV data-driven runs; Thunder
   Client caps free runs. Client-side, unmetered runs are themselves a
   differentiator, and pricing resentment is an active migration driver.
5. **Run history is cloud-locked (Postman) or absent (every local-first
   tool).** Locally persisted, inspectable run history is unoccupied
   territory.
6. **The only multi-step walkthrough construct in a docs product — ReadMe
   Recipes — is static.** Narrated code, canned responses, no execution,
   no connection to the try-it. Executable tutorials wired to a live
   console have no incumbent. ReadMe also holds a de-facto monopoly on
   onboarding personalization (injected keys, getting-started templates,
   per-developer dashboards) — all server-backed.
7. **AI table stakes vs. differentiator.** llms.txt, Markdown-for-LLMs,
   docs chat and generated MCP servers went from novel to expected in ~18
   months. The differentiated angle for us is Arazzo-as-agent-recipe:
   deterministic multi-step workflows agents can follow instead of
   improvising endpoint chains — evangelized by SmartBear and Jentic, who
   have no docs product to attach it to.
8. **Arazzo 1.1 and its roadmap keep raising the ceiling**: AsyncAPI
   sources with `send`/`receive` steps (`correlationId`, `timeout`),
   workflow composition with input mapping, Selector Objects
   (jsonpath/xpath/jsonpointer), and announced work on loops, human
   ("actor-in-the-loop") steps, transformers, MCP/A2A. Designing toward
   these is designing with the grain.

**Positioning sentence**: *the only tool where the documentation itself
executes the workflow* — authored visually in the docs, replayable by every
reader against live or simulated servers, exported as standard Arazzo that
the reader's CI (Respect, Speakeasy…) and the reader's agents can run
unchanged.

## 3. Guiding principles

These extend the existing rules; none replaces them.

1. **Declarative, still.** A scenario remains inert, serializable data.
   The expressiveness gap is closed by closed libraries of named pure
   functions (§5.2), never by user-supplied code. The no-scripting
   decision stands.
2. **Arazzo is the compass.** The internal model tracks the newest Arazzo
   version's semantics, the same way OpenAPI normalization tracks the
   newest OpenAPI. What the model can say beyond the current spec ships as
   `x-` vendor extensions in exports and is folded back when the spec
   catches up (transformers, human steps, loops are all announced).
3. **Browser-first, service-optional.** Every feature must be fully
   functional with zero backend. Where the platform physically cannot do
   something (receive a webhook, run at 3 a.m.), the answer is an honest
   documented degradation, a hand-off to the user's CI, or — far end — an
   optional hosted service that the product never requires (§5.9).
4. **Free where the market meters.** Iterations, data-driven runs, run
   history: client-side and unmetered by construction.
5. **Nothing executes without a gesture.** Already true for imports and
   share links; extends verbatim to AI-generated scenarios (previewed
   through the same import gate) and to prerequisite probes (§5.4).
6. **Sensitive values never widen.** Pipes cannot unmask a sensitive
   value; generated/extracted values default to run scope; anything sent
   to a host AI endpoint goes through the same redaction as a share link;
   the relay (if ever built) stores nothing by default.
7. **Every new persisted dataset declares its bound** (TTL + cap, hard
   cap, or LRU), per the existing bounded-storage rule.

## 4. Reading the waves

Workstreams below are ordered by dependency, not by date. Each states: why
(market evidence), functional design, model delta, Arazzo mapping,
invariants, and open questions. Rough dependency graph:

```
W1 async execution ──┐
W2 generators/pipes ─┼─→ W3 Arazzo alignment
                     │
W4 onboarding ←── W5 simulated runs
W6 event steps (needs W1 timeout machinery)
W7 test bench (needs W1; data-driven benefits from W3 inputs)
W8 AI assistant (needs W3 for good generation targets)
W9 hosted frontier (last, optional, gated)
```

## 5. Workstreams

### 5.1 Async execution: retry, polling, delay, timeout

**Why.** The universal hole (§2.3). Async APIs — job submission, payment
confirmation, provisioning — are the very flows a tutorial wants to walk
through, and today they dead-end at "now poll this endpoint yourself".

**Functional design.**

- Per-step, optional `retry` policy: *re-evaluate this step until its
  success criteria pass*, with `interval` (ms), optional `backoff`
  (multiplier, capped), `maxAttempts`, and overall `timeout`. Declarative
  retry-until-criteria, the Hurl pattern with Arazzo vocabulary.
- Per-step optional `delay` (wait before sending) — the polite-pacing knob
  the market puts in runners.
- The run report shows attempts, not just the final verdict: "step 3 —
  attempt 4/10, next in 2 s", with a live countdown in auto-run and
  step-by-step alike. A CLI cannot show a polling loop breathing; a docs
  UI can, and that is the demo moment.
- Step-by-step mode: the stepper drives the polling (a "polling…" state
  with cancel), the user keeps the real send button for the first attempt.
- A failed-then-retried step writes one history entry per attempt, tagged
  with the attempt index (history remains the durable trace).

**Model delta.** `Step.retry = { interval, backoff?, maxAttempts,
timeout? }`, `Step.delay`. Absence = today's behavior.

**Arazzo mapping.** Exports as `onFailure` action of type `retry` with
`retryAfter`/`retryLimit` (+ criteria); backoff and timeout have no Arazzo
field yet → `x-` extension, folded back if the spec grows one. Imports the
reverse way (an Arazzo retry action becomes a `retry` policy instead of
today's warning).

**Invariants.** Bounded by construction: no infinite polling
(`maxAttempts` required, hard ceiling), no retry on steps whose method is
non-idempotent unless the author explicitly opts in (a POST that retries
is a footgun worth a deliberate checkbox).

**Open questions.** Whether `Retry-After` response headers override the
declared interval (probably yes, capped); whether a retry-exhausted step
distinguishes "never matched" from "transport failed".

### 5.2 Computed values: generators and transform pipes

**Why.** The remaining reason people reach for scripts is "I need a fresh
idempotency key / today's date / this value base64-encoded". Postman
solved generators declaratively years ago (`{{$guid}}`, `{{$timestamp}}`,
`{{$randomEmail}}`…) — proof this needs no code. Transforms almost nowhere
exist declaratively.

**Functional design.**

- **Generators**: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoNow}}`,
  `{{$randomInt(min,max)}}`, and a small faker-ish family (email, name,
  string of length n). Evaluated at send time, fresh per attempt (a
  retried step regenerates — an idempotency key that must be stable across
  attempts is extracted into a run variable first, which the UI suggests).
- **Pipes**: `{{var | base64}}`, `{{var | urlencode}}`, `{{var | upper}}`,
  `{{var | slice(0,8)}}`, `{{var | jsonstringify}}`… A closed, versioned
  library of pure transforms; pipes compose left to right.
- The `{{` autocompletion already specified for variables extends to
  generators and pipes, with inline documentation per entry.
- Run report and prerequisites panel display the *evaluated* value next to
  the template (generators make "what was actually sent" non-obvious;
  the report answers it).

**Model delta.** None structural — this is interpolation-layer vocabulary.
The share/scenario sanitizer learns that `{{$…}}` is never a sensitive
literal.

**Arazzo mapping.** Arazzo has no expression functions today; transformers
are on its announced roadmap. Until then: exported values keep the pipe
syntax inside the string and the export marks the workflow with an `x-`
extension declaring the function library + version, so our own import (and
any cooperating runner) round-trips losslessly; foreign runners see it as
an opaque input default, named in the export warnings.

**Invariants.** The library is closed (adding a function is a product
decision, documented, versioned); a pipe applied to a `sensitive` value
yields a `sensitive` value; no pipe performs I/O.

**Open questions.** Whether cryptographic helpers (HMAC signing for APIs
that require request signatures) join the library — high value, but async
evaluation and key-handling UX need care; candidate for a later revision
of the library rather than v1 of pipes.

### 5.3 Full Arazzo alignment: criteria, selectors, composition, branching

**Why.** Decided core. Even the only browser-adjacent TS runner skips
regex/jsonpath criteria and retry/goto; matching Respect's semantic
coverage *in the browser* makes us the reference interactive
implementation, and everything authored here runs unchanged in CI
([`scenario-handoff.md`](scenario-handoff.md) §4).

**Functional design.**

- **Criteria**: assertions grow the Arazzo criterion types — `regex`,
  `jsonpath` (RFC 9535), and `xpath` for XML bodies (the browser has a
  native XPath engine; version caveats documented). The assertion editor
  keeps the current one-click JSON Pointer path as the default; the richer
  types are an "advanced" drawer, not the front door.
- **Selectors**: extractions accept the 1.1 Selector Object forms
  (jsonpath/xpath/jsonpointer + context), superset of today's pointer.
- **Composition**: a step may *call another scenario* of the same spec,
  with explicit input mapping (which variables the child receives, which
  outputs come back). One nesting level first — reusable "login and get a
  token" prologues are 90 % of the demand; deep nesting waits for real
  need. Cycles refused at validation.
- **Branching**: full `onSuccess`/`onFailure` actions — `end` (stop the
  run with a verdict), `goto` (jump to a named step or scenario), `retry`
  (§5.1). The linear timeline stays the authoring surface; when a scenario
  contains any `goto`, the view gains a **read-only flow graph** (nodes =
  steps, edges = sequence/branches, the last run's path highlighted).
  Nobody renders this in docs today; Jentic's Arazzo UI visualizes but
  does not execute.
- **Cross-spec scenarios** (revisits the §9 exclusion): Arazzo's multiple
  `sourceDescriptions` is the standard way to express "auth API then
  payment API". In multi-spec installs, a step may reference an operation
  of another *loaded* spec through a qualified reference. The scenario
  lives under one home spec (storage, routes unchanged); foreign steps
  render with the foreign spec's badge. Guarded by a config switch, off by
  default.
- **Workflow-level inputs**: a scenario may declare typed inputs (JSON
  Schema, the Arazzo `inputs` object). The prerequisites panel becomes the
  input form; today's "union of unbound `{{vars}}`" behavior remains the
  inferred default when nothing is declared.

**Model delta.** Assertion/extraction type unions; `Step.call` (scenario
reference + input map); `Step.onSuccess/onFailure` action lists;
`Scenario.inputs`; qualified opId references.

**Arazzo mapping.** This wave *is* the mapping: after it, import warnings
shrink to (workflow-nesting beyond one level, `context`-scoped criteria if
deferred, payload `replacements` if deferred) — each still a named
warning, never silent.

**Invariants.** `goto` cannot create an unbounded loop silently: the
runner carries a global step-execution budget per run (generous, visible
when hit). The flow graph is derived, never authored — the file format
stays a step list with actions, diffable in a PR.

**Open questions.** Whether `goto` is executable in guided step-by-step
(probably yes — the stepper simply follows the jump, and that is a
*great* tutorial device: "payment declined? the tutorial branches to the
retry path"); how much of `components` (reusable parameters/actions) the
authoring UI exposes versus import-only.

### 5.4 Executable onboarding: completion, prerequisites, manual gates

**Why.** Decided core. The only walkthrough construct in the docs market
is static (ReadMe Recipes); onboarding personalization is a ReadMe
monopoly built on webhooks and a backend. An executable, front-end-only
equivalent has no incumbent.

**Functional design.**

- **Completion state**: pinned scenarios form a getting-started checklist.
  Per-step completion (verdict-based, from real runs) persists locally;
  the home card and nav show progression ("3/5 — resume"); reopening
  resumes at the first incomplete step. Completion is per scenario × per
  environment (passing on staging says nothing about prod).
- **Tooled prerequisites**: the checklist checks its own preconditions —
  environment selected, required variables bound, auth configured — and
  deep-links to the exact form that fixes each gap. For "auth actually
  works", the author may designate a **probe operation** (a cheap
  read-only endpoint); the checklist offers "Check my setup", which runs
  the probe *on click* (never automatically — principle 5) and turns the
  auth line green/red with the real error surfaced. This is ReadMe's
  Personalized Docs value with zero backend: the reader's keys are
  already in their local environment store.
- **Manual gates**: a step kind with no request — instructional Markdown
  plus an explicit "Done" confirmation ("click the link in the email we
  just sent"). In auto-run, the run pauses on the gate; in step-by-step it
  is a normal step with a confirm button instead of Send. Covers the
  email-verification / dashboard-action holes that pure-HTTP tutorials
  fall into.
- **Authoring**: nothing new to learn — a tutorial is a scenario with
  notes, gates, and a pin.

**Model delta.** `Step.kind = 'request' | 'gate'` (gates carry only
`note`); completion is view-state persisted locally (bounded: per-spec
cap, LRU on scenario deletion), never part of the scenario file.

**Arazzo mapping.** Gates export as `x-` human steps today, aligned with
the announced actor-in-the-loop feature so the fold-back is mechanical.

**Invariants.** Completion never blocks anything (a checklist, not a
lock); probes are author-designated, read-only by declaration, and
user-triggered.

**Open questions.** Whether completion state participates in share links
(probably never — it is personal); whether a "reset my progress" needs
more than a button (it does not).

### 5.5 Simulated runs (minimal mock mode)

**Why.** The reader without credentials is the most common reader of
public API docs. Speakeasy/Microcks run workflows against generated mocks
in CI; nobody offers "walk the tutorial without an account" in docs.
Decided scope: the minimal, stateless version.

**Functional design.**

- A per-run toggle: **Simulate**. Each step, instead of sending, receives
  the operation's declared example response (status selectable among the
  documented responses, default the success one). Extractions and
  assertions evaluate against the example; chaining works when the
  examples are coherent (`{{petId}}` extracts from the example body).
- Simulated runs are visibly badged everywhere ("simulated" banner on the
  report; history entries tagged and excluded from any real-traffic
  views); persist-to-environment is disabled (a fake token in the real
  environment would be poison).
- No state machine, no cross-step consistency promises: if the POST
  example returns id 7 and the GET example returns id 9, the tutorial
  still walks — the report notes values come from examples. The stateful
  mock (an example-graph that remembers what was "created") is named as a
  possible later deepening, not planned.

**Model delta.** None on the scenario. The runner gains an injected
simulated sender — same seam the tests already use, which is the whole
trick.

**Invariants.** A simulated run can never write durable state outside its
tagged history entries; the toggle never sticks silently across scenarios
(explicit per run).

### 5.6 Event steps: SSE and WebSocket

**Why.** Arazzo 1.1 made async first-class (`send`/`receive`,
`correlationId`, `timeout`). Streaming endpoints (LLM APIs, live feeds)
are everywhere and no declarative tool covers them. Both protocols are
fully browser-native — this is the rare async feature a front-end tool
can do *without* degradation.

**Functional design.**

- A **subscribe step**: opens SSE or WebSocket on an operation (or raw
  URL for specs that document streams loosely), then evaluates declarative
  **message matchers** — "success when a message matches these criteria",
  with per-step `timeout`, optional "collect N messages", extraction from
  the matched message into run variables. WS may also declare a message to
  send on open (the `send` half).
- The step-by-step banner streams the messages live with match
  highlighting — again a demo moment no CLI can reproduce.
- Webhooks-as-received remain impossible in a browser; the honest
  degradations are: a polling step (§5.1) on a verification endpoint, a
  manual gate (§5.4), or — far end — the relay (§5.9). The docs say so
  in those words.

**Model delta.** `Step.kind = 'subscribe'` with protocol, open-message,
matchers, timeout, extraction targets.

**Arazzo mapping.** Exports to 1.1 `receive` (and `send`) actions with
`timeout`/`correlationId` where expressible; AsyncAPI source descriptions
are *not* parsed in the first pass (the OpenAPI operation or raw URL is
the source) — named as such in export warnings until an AsyncAPI
normalization pass ever exists.

**Invariants.** Every subscription carries a timeout and a message cap;
closing the run closes the socket, always.

### 5.7 Test-bench maturity: persisted runs, data-driven, organization, interop

**Why.** The "test tool" half of the ambition, deliberately after the core
waves. Each item is table stakes somewhere and gated or absent everywhere
(§2.4, §2.5).

**Functional design.**

- **Persisted run reports**: the last N runs per scenario (bounded, LRU)
  persist locally. Nav and scenario list show the last verdict badge and
  age ("green, 2 h ago"). Two runs diff side by side (verdicts, durations,
  extracted values with sensitivity respected) — regression reading
  without a cloud dashboard.
- **Data-driven runs**: a scenario with declared inputs (§5.3) can run
  over an **input table** — pasted/imported CSV or JSON rows, stored
  bounded alongside the scenario. One run per row, matrix report (rows ×
  steps), failures addressable per cell. Free, client-side — the exact
  feature Bruno meters.
- **Organization**: flat list + **tags** with filter chips (and the cap
  message pointing to them). Folders/hierarchy stay rejected — tags cover
  grouping without inventing a tree to sync, and the nav stays shallow.
- **Postman interop**: import a Collection v2.1 *as a scenario* —
  structure, order, requests, and the declaratively expressible fraction
  of scripts (`pm.environment.set` from response → extraction; simple
  `pm.test` status/equality asserts → assertions). Everything else
  degrades **loudly** per item, the same named-warning discipline as the
  Arazzo import. Export to Postman is not planned: exporting Arazzo and
  being importable-from everywhere positions us as a producer of the
  standard, not another silo.

**Model delta.** Run-report store (new bounded dataset); `Scenario.tags`;
input tables as attached bounded datasets.

**Invariants.** Run reports respect `sensitive` masking at rest; input
tables pass the same sanitizer as any import; no report ever leaves the
machine except through an explicit redacted export.

### 5.8 Host-provided AI assistant

**Why.** Decided scope: full assistant. The market made docs-AI table
stakes, but it generates *scripts* (imperative code you must trust). Our
inversion: the AI emits **inert declarative data** that goes through the
same preview-and-consent gate as any import — verifiable, diffable, never
auto-executed.

**Functional design.** Activated only when the host config provides a
completion endpoint (host's model, host's keys, host's bill — the product
bundles nothing and phones nowhere by default):

- **Generation**: "describe your goal" → draft scenario (steps chosen from
  the normalized operations, chaining proposed from schema-name matching —
  the same heuristic the chaining suggester already uses, LLM-arbitrated).
  The draft lands in the standard import preview; the user reads and
  accepts, or not.
- **Diagnostic**: on a failed run, "explain this failure" sends the
  redacted report (share-sanitizer applied — principle 6) and receives an
  explanation plus, where applicable, a proposed declarative patch to the
  step, itself previewed as a diff before apply.
- **Docs-anchored chat**: a panel answering over the normalized model,
  docs pages and scenarios ("how do I create a payment?" → answer, deep
  links, offer to generate a scenario). Grounding data is assembled
  client-side; what is sent is visible on demand.

The flip side of this workstream, which needed no LLM, has landed on its
own: workflows in `llms.txt` and `llms-full.txt` and a per-scenario Arazzo
recipe presented as an agent recipe — the SmartBear/Jentic thesis, attached
to an actual docs product ([`scenario-handoff.md`](scenario-handoff.md) §3).

**Model delta.** None on scenarios — the assistant is a shell-level
feature; the core only ever sees validated scenario data through the
existing import path.

**Invariants.** No endpoint configured → no AI surface at all (not a
teaser); everything AI-emitted is data, previewed, attributed ("draft
generated by your organization's assistant"); everything AI-sent is
redacted first and inspectable.

### 5.9 The hosted frontier (sketch only)

**Why.** Two physically impossible things remain: receiving real webhooks
and running while the browser is closed. The door stays open to an
*optional* hosted service; this section fixes its boundary so future work
cannot creep.

**Sketch.**

- **Webhook relay**: an ephemeral capture URL per waiting step; the
  browser long-polls/streams the relay; a webhook-wait step becomes fully
  real. Relay stores nothing beyond the pending delivery window, holds no
  credentials, sees only what the third party sends it.
- **Scheduled runs / monitoring**: the CI hand-off
  ([`scenario-handoff.md`](scenario-handoff.md) §4) is and remains
  the primary answer; a hosted scheduler would only ever re-run what CI
  could, for users without CI, and reports back into the same local run
  store.
- **Boundary rules**, stronger than the features: the product is 100 %
  functional without the service; the service is generic infrastructure
  (no product logic that the browser lacks); explicit opt-in per spec, per
  feature; self-hostable if it exists at all.

No design beyond this is committed; the section exists so §10-style "out
of scope" stays honest about *why* (physics, not disinterest).

## 6. The revised out-of-scope

After this plan, the deliberate exclusions of `scenarios.md` §10 become:

- **Scripting** — permanently; generators/pipes are the answer, and the
  no-scripting decision is unchanged. This is the one exclusion that
  hardened.
- **Folders/hierarchy** — rejected in favor of tags (§5.7).
- **Postman scenario export** — import yes, export no (§5.7).
- **Stateful mocking** — named as a possible deepening of §5.5, unplanned.
- **Load/performance testing** — a different product; still out entirely.
- **In-browser scheduling** — physically out; answered by the landed CI
  hand-off ([`scenario-handoff.md`](scenario-handoff.md)) and §5.9.
- Everything else on the original list (data-driven iterations,
  delay/retry/polling, run report persistence, non-HTTP steps, Postman
  import-as-scenario, scheduled runs) graduates from "out of scope" to "a
  planned workstream above".

## 7. Risks and watchpoints

- **Arazzo spec drift**: loops, actor-in-the-loop and transformers are
  announced but unlanded; every related design here (§5.1 backoff, §5.2
  pipes, §5.4 gates) ships as `x-` extensions with a fold-back plan —
  the risk is a divergent spec shape, mitigated by keeping the extensions
  small and data-only. Watch the Workflows SIG.
- **Scope gravity of the assistant** (§5.8): chat UIs grow. The invariant
  "AI emits only importable data" is the fence; any feature that needs the
  AI to *act* rather than *draft* is out.
- **Branching complexity** (§5.3): goto turns scenarios into programs.
  The step-execution budget and the derived-graph rule are the guardrails;
  if authoring branched scenarios proves confusing, branching can remain
  primarily an import/execution capability with minimal authoring UI —
  that fallback is acceptable and cheap.
- **XPath/JSONPath engines**: browser XPath is XML-only and dated, and
  RFC 9535 JSONPath needs a vetted implementation. The dependency policy
  covers this: a query language over a document of a claimed spec is
  exactly the work runtime dependencies are open for, and a
  conformance-tested engine is the whole job we want done. The
  in-house-subset fallback is not the expected answer here.
- **Example coherence** (§5.5): simulated runs are only as good as the
  spec's examples; the audit feature is the natural place to surface
  "your examples don't chain" to the docs author.

## 8. Graduation rule

A workstream leaves this document by landing in `scenarios.md` (and
`architecture.md` for cross-cutting parts) as present-tense specification,
with its tests mapped in `CONTRIBUTING.md`, its storage bounds declared,
and — where a decision was structural — an ADR. This roadmap then shrinks
by one section; it is done when it is empty.
