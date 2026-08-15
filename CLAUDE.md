# CLAUDE.md

## Project

100 % front-end interactive API documentation ("web Postman" / Swagger++),
generated at runtime from an OpenAPI schema, distributed via CDN as a single
`<script>`.

**`docs/architecture.md` is the functional source of truth** (with
`docs/scenarios.md` and `docs/multi-spec.md`). Read it before substantial
work. Design rationale: `docs/architecture.md` §14. Contributor guide: `CONTRIBUTING.md`.

## Commands

- `npm run dev` — Vite dev server (unbundled ESM sources)
- `npm run build` — two passes that share nothing: the browser bundle
  (`dist/app.js`, `dist/app.css`, `dist/i18n/*.json`, `dist/fonts/`) and the
  author-side bake CLI (`dist/bake.js`, shipped as the `apiglow` bin —
  `docs/seo.md` §4)
- `npm test` — Vitest (pure core only); must be green before any commit
  touching the core
- `npm run test:e2e` — Playwright (Chromium) against the CDN simulation;
  fixtures in `tests/e2e/fixtures/`
- `npm run preview:cdn` — serves the packed tarball statically to simulate
  the CDN install; refuses to start if `demo/cdn-install.html` and
  `package.json` disagree on the version
- `npm run lint` / `npm run lint:fix` — Biome (format + lint); CI runs
  `biome ci` and it must be green
- `npm run check:invariants`, `check:dist`, `check:surface`, `check:syntax`,
  `check:version` — the gates CI enforces on top of the suites; green unit
  tests alone do not mean a change is committable. What each one covers:
  `CONTRIBUTING.md`
- `npm run release <version>` — the only way a version ships: bumps, promotes
  the `CHANGELOG.md` `Unreleased` section, syncs every pin, runs the fast
  gates, tags. The tag is what publishes (`docs/release.md`). A user-visible
  change writes its changelog line in its own commit.

Both demo pages get their API from `demo/mock-sw.js`, a service worker
answering `/demo-api/v3` in the browser (see CONTRIBUTING). The e2e suite
does not use it.

## Stack (pinned)

- Vite (dev + lib build), Tailwind CSS 4, daisyUI 5 — exact versions frozen
  in `package.json`.
- Vanilla JS ESM, Web Components in **light DOM**, zero framework, zero
  state-management lib.
- Runtime dependencies: `@apidevtools/json-schema-ref-parser`, `marked`,
  `dompurify`, `highlight.js`, `json-p3`, plus what **spec/format work**
  justifies
  (`docs/architecture.md` §14.2). A new one
  is allowed only if it reads/transforms/queries/emits a document of a
  claimed spec, **and** we actually want that whole job done — a bounded
  subset kept on purpose stays a subset, and the library is refused
  (standing case: no Ajv, body validation is minimal by choice). Serious,
  browser-ready, exactly pinned, weight stated in `docs/architecture.md` §2.
  Everywhere
  else — UI, state, utilities — build on the platform.
- daisyUI skill: check it is available before writing component code;
  otherwise install it (https://daisyui.com/docs/skill/). `skills-lock.json`
  at the repo root pins the installed skill for agent environments.

## Imperative rules (anti-footguns)

Rationale for each lives in `CONTRIBUTING.md` and `docs/architecture.md` §14.

1. **Never Shadow DOM.** Light DOM + class-convention scoping.
2. **Never dynamically built Tailwind/daisyUI classes** (`badge-${x}` is
   banned — the JIT purge deletes them). Always explicit static maps, e.g.
   `{ GET: 'badge-success', POST: 'badge-info', DELETE: 'badge-error', … }`.
3. **The built CSS includes all standard daisyUI themes** (Tailwind/daisyUI
   config accordingly), otherwise `theme.available` silently breaks for end
   users.
4. **All runtime asset paths** (`app.css`, `i18n/*.json`) resolve via
   `new URL('./…', import.meta.url)`. **Never `document.currentScript`**
   (null in an ES module). Verify the Vite build preserves this.
5. **All HTML from external content** (OpenAPI descriptions, examples,
   `.md`, scenario files) goes through DOMPurify. No unsanitized
   `innerHTML`, no `eval`/`new Function`.
6. **Rendering consumes only the internal normalized model**
   (`src/openapi/model.js`), never the raw OpenAPI schema. No `if (isV31)`
   branch outside normalization.
7. **Recursive schemas**: lazy expansion with max depth, cycle detection.
   No unbounded recursion, in the model or in the rendering.
8. **Storage**: history/scenarios/snapshots = IndexedDB;
   environments/preferences/theme/language = localStorage. No other
   mechanism, no dual paths. Storage keys and DB names keep the
   name-neutral `apidoc` prefix (`docs/architecture.md` §14.11).
9. **Every UI string via `t('key')`** — zero hardcoded text in components.
   English is bundled as the fallback; `i18n/fr.json` is a shipped feature
   (keep `en`/`fr` keys in sync), never "French debt".
10. **Core vs shell**: `src/app.js` (bootstrap) is the only module reading
    the host config and branding. The core (`openapi/`, `components/`,
    `scenarios/`, `storage/`, `export/`, `i18n/`, …) never sees the host
    config directly.
11. **`{{var}}` interpolation**: missing variable = send blocked + visible
    signal. Never send the literal.
12. **Exports**: generators = pure functions in `src/export/`,
    snapshot-tested. Sensitive values redacted by default.
13. **Bounded storage**: every persisted dataset declares its policy
    (TTL + cap, hard cap, or LRU) and documents it in
    `docs/architecture.md`.
14. **Performance is a feature**: the perf e2e budgets are a contract, not
    a knob to loosen when a change regresses.
15. **Accessibility is mandatory**: keyboard-operable components, focus
    returned on dialog close, live regions for async outcomes, i18n'd
    `aria-*`. Shared primitives in `src/components/a11y.js`; the axe sweep
    (`tests/e2e/a11y.spec.js`) stays green. Model + the one documented
    waiver: `docs/architecture.md` §12.
16. **Every feature has at least one test** (core logic → Vitest; UI
    behavior → Playwright against the packed bundle). The feature→test map
    lives in `CONTRIBUTING.md`.
17. **English-only codebase, bilingual product**: code, comments, tests,
    docs and commit messages in English; `i18n/fr.json` is the only
    sanctioned French, and it is a feature.
18. **Biome is the arbiter of style** (`biome.jsonc`). Don't hand-argue
    formatting, and don't reformat untouched code inside a feature change.
19. **Maximal OpenAPI spec support is a priority and an obligation.** An
    unsupported construct of a supported OpenAPI version is a defect, not a
    scope choice: model it and render it, or degrade with an explicit,
    documented fallback when the browser platform forbids execution. When
    versions conflict on a concept, normalize to the newest version's
    semantics. Coverage contract: `docs/openapi-coverage.md`.
20. **The doc↔panel mirror: the try-it panel is the single source of
    truth, the central doc holds no choice of its own.** Doc-side widgets
    render from the panel's `tryit-state` and push edits up through
    `tryit-edit`, never acting locally — drift between the two columns is
    silent, so before touching any editable surface read the mechanics in
    `docs/architecture.md` §5.5.4, and extend the guard
    (`tests/e2e/doc-panel-sync.spec.js`) with every new one.

## Good enough — convergence rules

Code is not optimized, it is **compliant**. A module that passes the gates
(Biome, tests, `check:*`, the perf budgets) is UNTOUCHABLE — untouchable
against taste, not against new requirements (Design evolution below).

### The other half: choosing the design

The good-enough rule says when to stop improving code that works. It says
nothing about **what to build in the first place**, and there the criterion
is the opposite of frugal: the design that serves the product best over its
life. Build effort is never a criterion — not the size of the diff, not the
number of passes it takes. A design too big for one sitting is split into
steps; it is never shrunk into a lesser design.

The two rules never overlap, and the boundary is the only thing to memorise:
**quality-over-build-cost chooses between designs for work being done
anyway; the good-enough rule governs whether to touch code that already
works.** Reshaping an existing design needs a requirement the old one cannot
serve (Design evolution below) — "I now know a better shape" is not one,
however true it is.

One budget stays real: the user's. Bundle bytes, first render, memory on a
12 MB spec — the CDN visitor pays those forever, and they keep their
enforced numbers (rule 14). The budget dismissed above is ours.

### The gates are the judge, and they already exist

Biome (`biome ci`) at 0 diagnostics · `npm test` green · `npm run test:e2e`
green on what the change touches · `check:invariants`, `check:dist`,
`check:surface`, `check:syntax` green · bundle caps in
`scripts/check-dist.mjs` and perf budgets in `tests/e2e/perf.spec.js` under
budget (both ratcheted by `check:invariants` #18 — loosening one is a
two-file commit). Below budget = done. We do not shave "a bit more".

### Size is a smell, never a limit

`npm run health:size` flags files over 800 lines. That is a prompt to ask
"is this doing too much?" — if the answer is no, the file stays. **A size
cap must never distort a good design**: a cohesive 900-line component beats
two files split to satisfy an arithmetic rule, and a 60-line function that
reads as one linear procedure beats three helpers invented to shorten it.
**Never cite a line count alone as a refactor justification.**

### Mandatory justification

Every refactor edit cites **a metric that moves** (bytes, a budget, a
duplication), **a bug it fixes**, or **a current requirement the existing
design cannot serve** (Design evolution below). Otherwise: forbidden.
Explicit churn bans: taste renames; method reordering; swapping equivalent
syntax (`map` ↔ `for…of`); extracting an abstraction used once; comments
that paraphrase; reformatting what Biome already accepts; replacing a
daisyUI class with hand-written CSS.

### Frozen surfaces do the anti-loop work

Tags, events, storage names, i18n keys are versioned contracts snapshotted
in `public-surface.json` (`npm run check:surface`). What a third refactor
pass finds to "improve" is mostly names — those are product decisions, never
refactors. Runtime dependencies are exactly the five pinned
(`check:invariants` #20): adding one is a human checkpoint, never an agent
decision.

### Convergence

Pass 1 inventories everything BEFORE writing, then applies it all at once —
no drip-feeding. Pass 2 touches only what pass 1 explicitly deferred; no new
findings. Pass 3 only if pass 2 broke something. Pass 4 does not exist — if
the urge remains it is a rewrite, i.e. a human ticket, not a simplify run.
Each pass ends with an explicit verdict: `STABLE` or `REMAINING: <items +
target metric>`. A pass whose diff is < 5 % of the previous pass's →
`STABLE` by default.

### Accepted debt

Anything costing more to fix than the measured gain is annotated
`// @acceptable-debt <reason>` and excluded from later audits. It is a
decision, not a TODO; removing the annotation needs the same justification
as adding it.

### Frozen decisions

Architecture and syntax questions are settled once — in `CONVENTIONS.md`,
CLAUDE.md, or `docs/architecture.md` §14 — and never re-litigated. If no
rule exists: choose, write it down, it becomes law.

## Design evolution

Later work produces information earlier work couldn't have. When what is
being built now cannot be built cleanly on an existing design, reshaping
that design is part of the job — never a filed TODO, never a permission
question. If the feature ships cleanly on the existing design, the reshape
is churn.

- The reshape lands as its own commit with the gates green; the feature
  goes on top as another. Never one mixed diff.
- Reopening a frozen decision — `CONVENTIONS.md`, a frozen public surface, a
  `docs/architecture.md` §14 entry, the pinned dependency list — is a
  product decision, never a refactor. Ask, don't decide.
- Pre-1.0 there is nothing to preserve: do the sweep, never add a
  back-compat path or a migration for a state no user has.
- Reshape too big for the current task: say so and stop clean rather than
  leave half a migration behind.
- Off-path debt (not on the path of what is being built): one line in the
  report, no fix — paid by the first task whose path crosses it.

## Obvious fixes: do them, don't report them

A question costs a context switch; a one-character fix costs seconds. So the
bar for interrupting is **"is there a decision here?"**, never "am I allowed
to touch this?". Three outcomes, and only the middle one is worth a
question:

- **Act now** — one correct answer, and it is already known: a stale
  cross-reference, a `docs/` §-number the current edit invalidated, a key
  added to `i18n/en.json` but not `fr.json`, a dangling import, a typo on
  the line being edited, any inconsistency the change itself created. Doing
  it *is* the report; a clause in passing is enough.
- **Ask** — the outcome is a genuine choice: a design fork, a product/UX
  preference, a frozen surface, an ambiguity whose readings diverge
  materially. Asking includes recommending, and the recommendation follows
  quality over build cost: the option that is best for the product
  long-term, with what each costs stated plainly. Never dress the cheap
  option up as the pragmatic one, and never omit an option because it is a
  lot of work.
- **Do nothing** — churn: no metric moves, no bug fixed, no current
  requirement. Already banned above.

**Surfacing a defect that could have been fixed is worse than useless** — it
spends attention and delivers nothing. Never hand over a broken detail as if
it were a decision. Nothing is left dangling: what is on the path gets done
now, never filed. A turn that ends with state made inconsistent makes it
consistent first.

Boundary — this authorizes the path, not a wander: what was touched, what
was broken, what the change itself made inconsistent. And a mechanical
obstacle (a denied tool call, a missing flag) is not a question for a human:
exhaust the ordinary means first, escalate only when genuinely stuck.

The same triage covers the documents. `docs/` and the specs in `docs/plan/`
are written ahead of the code, so they carry imperfections, and the test is
unchanged: would two careful readers agree there is only one correct
reading? A stale `§`-reference, a wrong path, a numbering the current work
invalidated: fix it. A deliverable that contradicts its own stated
criterion: build what is evidently meant and say so — never build the broken
thing because a document said so. Anything whose reading genuinely diverges
is a design fork. Report every doc defect found, including the ones fixed:
the next task reads the same text.

## Process

- **`README.md` is the shop window, written for humans only** — it
  demonstrates and convinces; reference material lives in `docs/` and
  `config.example.js`, never in the README. Don't grow it with feature
  enumeration or config semantics: add one pitch line + a docs link, or
  nothing. Its assets are reproducible: `.github/readme/CAPTURE.md`.

- **Documents describe state, never history** (doctrine in
  `CONTRIBUTING.md`): no dates on decisions, no process narration, no
  references to documents outside the tree.
- Comments carry only non-obvious rationale (comment policy in
  `CONTRIBUTING.md`). Existing comments are the design record — never strip
  them in a refactor.
- Snapshots: regenerate deliberately and review the diff; never a blind
  `-u`.
- e2e validates the packed tarball: after touching the build config,
  `package.json` `files`/`exports`, or `scripts/`, run `npm run test:e2e`
  even if unit tests pass.
- When a functional question isn't answered by `docs/`, prefer the simplest
  option and record it (a `docs/architecture.md` §14 entry if the decision
  is structural).
