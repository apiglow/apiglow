---
name: upgrade-code
description: >
  Watch and upgrade the pinned technical stack — runtime deps shipped in
  the bundle (app), the build/test toolchain and Node (build), and the
  browser/JS platform itself (platform: new widely-available APIs worth
  adopting) — then produce one consolidated, session-sliced upgrade plan
  in docs/upgrade/.
disable-model-invocation: true
---

# upgrade-code — keep the pinned stack current, deliberately

Fourth of the four-skill audit family — spec-sync (the claimed specs),
app-health (the functional guard net), code-health (the code itself),
upgrade-code (the technical platform). This skill keeps the platform
current:
the runtime deps shipped to users, the build/test toolchain, Node,
and the browser/JS platform the app runs on. The stack is pinned by
design (CLAUDE.md "Stack (pinned)") — pinning without a watch is how a
stack fossilizes; this skill is the watch.

**State lives in `docs/registry/stack-registry.md`** — one row per dependency and
per platform dimension: pinned version, latest known, source of truth,
upgrade ritual. The registry is the auditable extension of
CLAUDE.md's Stack section and what makes runs idempotent; every run
starts by reading it and ends by updating it.

**Version truth rule** (same as spec-sync): never assert a latest version
or a changelog fact from memory. Cheap local detectors first
(`npm outdated`, `npm audit`), then the release notes / changelog fetched
this run for every row that moved; every claim in the run's output cites
its source.

## Scopes

Unlike its siblings, this skill has no `deep` mode: a scoped run *is* the
deep audit of that scope.

- `/upgrade-code` — full watch: app + build + platform.
- `/upgrade-code app` — the runtime deps shipped in the bundle
  (`dependencies`: ref-parser, dompurify, highlight.js, marked, json-p3,
  plus whatever spec/format work has since justified). **Upgrading a member is
  this skill's job; adding one is never it** — architecture.md §14.2
  opened the set, but it opened it to a deliberate decision recorded in
  the README, not to a version watch. App bumps ship to users — bundle-size delta is measured
  and reported in the session.
- `/upgrade-code build` — the toolchain (every `devDependencies` row of
  the registry: Vite, Tailwind, daisyUI, Biome, Vitest, Playwright, axe,
  fake-indexeddb, and the rest of the pinned dev set),
  Node (`.nvmrc`), npm, and the CI actions versions.
- `/upgrade-code platform` — the browser/JS platform: new APIs and
  language features that could replace hand-rolled code or lift a
  documented limitation, plus the `browserslist` floor the build target
  derives from, and Node LTS
  status. Governed by the **Baseline policy**: a feature is adoptable
  when Baseline rates it *Widely Available* (web-platform-dx /
  baseline-status as the single source). The policy is recorded in
  `docs/architecture.md` §14.15; no `adopt` session executes outside it.

Executing a plan works as in the sibling skills:

- `/upgrade-code run [<session>]` — execute the next session of the
  active plan (or the named one). One session = one commit. A `needs-go`
  session asks for its go at execution time.
- `/upgrade-code run all` — chain the plan's sessions in order, one
  commit each, through to the registry update, stopping only at a session
  that fails. A `needs-go` session does not end the chain: it asks its
  question when its turn comes.

## Idempotence contract (the definition of done)

A run must end in exactly one of two states:

1. **Nothing to do** — every row's latest published version is the pinned
   one (or the gap is an accepted hold recorded in the registry), no
   applicable advisory, no adoptable platform feature with a concrete
   benefit, no active plan left with unexecuted sessions (`todo` **or**
   `needs-go`). A nothing-to-do run leaves the registry exactly as it
   found it.
2. **One active plan** — every gap is either a session in
   `docs/upgrade/stack.{YYYYMMDD-HHmm}.md` or a hold recorded in the
   registry with the user's validation and a rationale (e.g. "stay on
   daisyUI 5 until the theme audit"). No third bucket.

Corollary: once all sessions of the active plan are executed, re-invoking
`/upgrade-code` must land in state 1. The final session of every plan is
always "update the registry, clear the active-plan pointer, and close the
plan" (see **Closing a plan**).

## Standard run

1. **Read the registry.** If missing, bootstrap from `package.json`,
   `.nvmrc`, `vite.config.js` (build target) and `.github/workflows/`;
   ask the user before adding a row the registry never listed.

2. **Version watch.** `npm outdated` + `npm audit` for the dep rows;
   release feeds for Node/npm/CI actions; Baseline for the platform rows.
   For every row that moved, fetch the changelog/release notes between
   pinned and latest — this is the evidence everything downstream cites.

3. **Impact analysis** — per candidate bump: classify patch / minor /
   major; extract the breaking changes and migration steps that apply to
   this codebase (cite the files affected); attach the row's **upgrade
   ritual** from the registry (the repo-specific couplings — credits,
   skills-lock, snapshot review, e2e). Security advisories follow the
   **normal flow** (deliberate choice): they become plan
   sessions like any bump — no out-of-plan fast-track — but always sort
   to the top of the execution order.

4. **Platform watch** (full or `platform` runs) — confront Baseline's
   newly-widely-available features with the codebase: does one replace a
   hand-rolled mechanism, lift a waiver/documented fallback, or simplify
   a subsystem? An `adopt` session exists only with a **concrete cited
   benefit** (the code it deletes or the limitation it lifts) — platform
   fashion is not a finding. Also: whether raising the `browserslist`
   floor — and with it the derived build target — is
   warranted (all target browsers per the Baseline policy), and Node LTS
   drift for `.nvmrc`.

5. **Consolidate into one plan.** Same mechanics as the siblings:
   re-verify the active plan's unexecuted sessions, write a new plan file
   merging survivors with this run's findings, fold the old one into it
   (final progress table into the new plan's "Superseded predecessors"
   section, then delete it — the fold is the only surviving trace, and
   no bare `.md` that will never be executed may outlive its
   replacement), exactly one active plan. A surviving
   `needs-go` session stays `needs-go` — rewriting a plan is never a way
   to launder a missing go.
   Before writing the plan file, check the sibling registries' active
   plans and record in the session's Why any overlap with a session
   already in flight. Session kinds: **bump** (a
   version upgrade + its ritual), **adopt** (embrace a platform feature),
   **policy** (pin-policy fixes, the Baseline policy, engines field).
   **Majors are planned but blocked until the user validates them at
   execution time** — the session states what the user is validating
   (the breaking changes and the expected diff surface, not just "go").
   Write that well: it is the raw material of the question the session
   asks when it runs (see **Asking for a go**).

6. **Finish.** Update the registry (versions, holds, pointer).
   Commit the registry — a single `docs(stack): …` commit,
   touching nothing else; the plan is untracked and enters no commit.
   Summarize: what moved, what's planned (bump /
   adopt / policy, majors flagged), what's held, or "nothing to do".

## Upgrade rituals (the repo-specific couplings)

Recorded per row in the registry; the recurring ones:

- **Any dep bump**: pin exact (no `^` — see the pin-policy row), suites
  green, and any snapshot or visual diff **explained by the changelog**
  before acceptance — a diff the changelog doesn't explain is a stop, not
  a shrug. Never a blind `-u` (repo rule).
- **Runtime dep (app scope)**: `src/credits.js` version — the coupling is
  guarded by `tests/credits.test.js`, expect it to fail until updated;
  bundle-size delta measured on the built `dist/app.js` and reported.
  `dompurify`: sanitizer behavior IS a product feature — re-read the
  release notes for sanitization changes and re-run the XSS e2e.
  `marked` / `highlight.js`: rendering snapshots may legitimately move —
  review the diff deliberately.
- **daisyui**: re-sync the pinned daisyUI skill (`skills-lock.json`
  hash), verify rule 3 still holds (all themes in the built CSS), theme
  spot-check, full e2e.
- **tailwindcss / @tailwindcss/vite**: diff the built CSS (purge
  behavior), full e2e.
- **vite**: verify the build invariants — single-file `dist/app.js`,
  `new URL(…, import.meta.url)` asset resolution (rule 4), `undici` kept
  external — then full e2e against the packed tarball (repo rule for
  build-affecting changes).
- **@biomejs/biome**: `npx biome ci` — newly-recommended rules may fire;
  fixing them belongs to the bump session (Biome stays the arbiter,
  rule 18).
- **vitest / playwright / axe / fake-indexeddb**: suites green; axe
  bumps can surface new a11y findings — triage them into the session,
  don't silence them.
- **Node (`.nvmrc`)**: local + CI move together; e2e re-run (the preview
  server and mock OAuth run on Node).

## Behavior contract

Upgrades are not behavior-preserving by definition — the contract is **no
unreviewed behavior change**: every observable difference (test, snapshot,
built CSS, rendered output) is either explained by the fetched changelog
and accepted in the session, or it blocks the session. `adopt` sessions
additionally follow code-health's bar: net simplification with the
deleted code as the cited benefit, no new indirection.

## Session execution (`/upgrade-code run [<session>]`)

Read the active plan, take the first unexecuted session (or the named
one). If it is marked `needs-go`, **ask the user before doing anything
else** (see **Asking for a go**). Security sessions
first. Each session is independently executable; one session =
one commit (`chore(deps): …` for bumps, `refactor(…)` for adopts,
`docs`/`chore` for policy). The session's ritual is part of its
acceptance. End by flipping the session's status to `done ⟨date⟩
⟨commit⟩` in the plan file (untracked, so no commit carries it). If it
was the last session,
perform the
registry-update session, close the plan (see **Closing a plan**) and tell
the user a fresh `/upgrade-code` should report "nothing to do".

## Chained execution (`/upgrade-code run all`)

The same thing repeated: take the plan's sessions in table order
(security first, as the order already encodes) and execute them without
asking between them — one commit and one status flip per session, never a
batched commit, never a bump folded into its neighbour. A `needs-go`
session does not end the chain: when its turn comes it asks its own
question (see **Asking for a go**) and then proceeds on the answer. The
chain stops, cleanly and with a report of what landed, at the first of:

- a session whose ritual or acceptance fails, **including any observable
  difference the fetched changelog does not explain** — that blocks, it
  is not shrugged off to keep the chain moving. Same for a plan analysis
  gone stale (a version pulled, a changelog that contradicts the
  session).
- a session too large to start with what's left of the run: finish and
  commit the one in progress, then hand back.

Session size is what makes the chain legitimate — it is a convenience for
small patch/minor bumps, not a licence to batch. Every per-session rule
of the section above binds identically, rituals included. If the chain
reaches the registry-update session, run it too, close the plan (see
**Closing a plan**) and tell the user a fresh `/upgrade-code` should now
report "nothing to do".

## Asking for a go

A `needs-go` session — in practice a major bump — carries its own
question rather than delegating it to the user's next invocation. When
its turn comes — in `run` or in the middle of `run all` — put the
decision to the user *there*, and let the answer decide:

- **Ask before touching anything.** State what is being validated: the
  breaking changes that apply *to this codebase* with the files they
  hit, the expected diff surface, and the ritual the bump drags along.
  "Upgrade Vite to 9" is not a question; "Vite 9 drops the `x` option
  used in `vite.config.js:70` and rewrites asset URLs, so the
  `import.meta.url` resolution of architecture.md §14.9 needs
  re-verifying" is.
- **Approved** → flip the Status to `todo` and execute it like any other
  session, ritual and acceptance unchanged.
- **Declined** → leave it `needs-go`, execute nothing for it, and **keep
  going** with the next session. A refusal is an answer about *that*
  bump, not a stop signal for the plan. Record the refusal as a hold in
  the registry if the user gives a rationale worth keeping.
- **Never infer the go.** Silence, an ambiguous reply, or a guess about
  what the user would probably accept are all "not approved".

Consequence for the end of the run: a plan with a declined session is
**not finished**. Run the registry update for what did land, but leave
the active-plan pointer in place and do **not** rename the file
`.done.md` — the plan still has work in it. Say so in the report, and
name the session waiting on a decision.

## Closing a plan

A plan whose sessions have all been executed is renamed on the spot:
`docs/upgrade/stack.{YYYYMMDD-HHmm}.md` →
`docs/upgrade/stack.{YYYYMMDD-HHmm}.done.md`. The `.done` is the whole
point — `ls docs/upgrade/` then says at a glance which plans are behind
you and which one is live, without opening a single file.

Mechanics, at registry-update time:

- rename with a plain `mv` — `docs/upgrade/` is gitignored (plans never
  enter a commit, CONTRIBUTING.md doctrine), so no git history follows
  the file and none is expected;
- fix every reference to the old name — the registry's active-plan
  pointer (which goes back to `none`) and any prose in it that cites
  the plan by filename, plus cross-references from the sibling skills'
  registries and plans;
- a **superseded** plan is never renamed `.done.md`: it did not finish,
  it was replaced — and it was folded into its successor's "Superseded
  predecessors" section at supersede time, so no file of it remains.
  `.done.md` means *executed*, not merely closed.

## Plan file format

`docs/upgrade/stack.{YYYYMMDD-HHmm}.md` while it still has unexecuted
sessions, `docs/upgrade/stack.{YYYYMMDD-HHmm}.done.md` once they are all
executed:

```markdown
# Stack upgrade plan — {date}

Produced by /upgrade-code. Supersedes: {previous file or "none"}.
Registry snapshot: {row → pinned → latest, one line per row that moved,
with the sources fetched this run}.

## Superseded predecessors

{Only when Supersedes ≠ "none": one subsection per folded plan — its
filename, its final "Execution order & progress" table (statuses,
commits), and one line on what was executed, carried or dropped.}

## Execution order & progress

One line = one session; update Status at the end of each session.
Security sessions first. Most sessions enter as `todo`; major bumps enter
as `needs-go` and ask for that go when they execute (see **Asking for a
go**).

| # | Session | Kind | Scope | Semver | Status |
|---|---|---|---|---|---|
| 1 | …       | bump / adopt / policy | app / build / platform | patch / minor / major | todo / needs-go |
| n | Registry update | — | all | — | todo |

## Sessions

### 1. {title}
- **Why**: {the gap or advisory, with the URL(s) fetched this run}
- **Breaking changes that apply here**: {each one → the file(s) affected;
  "none" is a finding, state it}
- **Ritual**: {the row's couplings: credits, skills-lock, CSS diff,
  e2e, …}
- **Files**: {every file to touch}
- **Acceptance**: {suites green; every diff explained by the changelog;
  scope-specific checks (bundle delta, theme count, single-file dist)}
```

## Guardrails

- **User-invoked only.** Never run any part of this skill uninvited.
- **Never add a runtime dependency.** Architecture.md §14.2 allows new
  ones for spec and format work, but that is a design decision with a
  recorded rationale and a README entry behind it — this skill upgrades
  members, it never adds one.
- Majors never execute without the user's explicit go — asked in place
  when the session comes up, never inferred, never batched into an
  earlier approval. Holds and policy changes always need their
  validation too.
- Every version claim and changelog fact cites a source fetched this
  run. No upgrade content from memory.
- Never a blind snapshot regeneration; a diff the changelog doesn't
  explain blocks the session.
- Platform adoptions require the Baseline policy (architecture.md
  §14.15) and a concrete cited benefit — no fashion-driven churn.
- English everywhere (repo rule 17); the registry is tracked
  documentation, and the untracked plan is written to the same standard.
