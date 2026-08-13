---
name: code-health
description: >
  Audit the code itself — dead code, obvious duplication, needless
  indirection, idiom drift, size hotspots — across src/ and tests/, then
  produce one consolidated, session-sliced cleanup plan in docs/upgrade/.
  Strictly behavior-preserving: a code-health session never changes what
  the app does. Run ONLY when the user explicitly invokes /code-health —
  never proactively, never as a side effect of another task.
disable-model-invocation: true
---

# code-health — keep the code cheap to change

Third of the four-skill audit family — spec-sync (the claimed specs),
app-health (the functional guard net), code-health (the code itself),
upgrade-code (the technical platform). The lowest, most technical layer:
this skill keeps the **code itself** cheap to read, change and delete —
no dead code, no copy-paste that should be a helper, no indirection that
serves nothing, one idiom per problem. Its findings are measured with
runnable detectors, its fixes are behavior-preserving by contract, and its
progress is a registry baseline that must never silently regress.

Scope boundaries:
- Functional regressions and missing test coverage → `app-health`.
  A bug discovered while cleaning is **never fixed here** — it is recorded
  in the plan's "Routed findings" section and handed to the user.
- Diff-scoped cleanup of code you just wrote → the `/simplify` skill.
  `/code-health` is the whole-repo, recurring counterpart. Binding
  consequence of that pairing: **every angle `/simplify` can find on a
  diff has a dimension here.** Its four angles map to reuse → *idiom
  drift* + *duplication*, simplification → *duplication* + *size /
  complexity* + *dead branches*, efficiency → *wasted work*, altitude →
  *altitude / special-casing*. If a new angle appears there with no row
  here, that defect would only ever be findable at diff time — which is
  the one thing a recurring audit exists to prevent.
- Conformance to the CLAUDE.md imperative rules → `app-health`, which
  builds its invariant table from them. This skill enforces the two rules
  that are about the code as text (18 Biome, 17 English) and cites the
  others, but never re-audits them.
- Perimeter: `src/` and `tests/` (both are maintained code). `scripts/`,
  configs and `demo/` only when a finding leads there.

**State lives in `docs/registry/code-health-registry.md`** — one row per debt
dimension: the detector command that measures it, the current baseline,
accepted thresholds, plus the pointer to the active plan. The
registry is what makes runs idempotent; every run starts by reading it
and ends by updating it.

## The baseline is the ratchet

Deliberate design choice: **no detector gates CI.**
Debt is measured only at `/code-health` runs. The ratchet is therefore the
registry baseline: each run re-executes every detector and compares to the
recorded baseline. Above baseline = new debt = a plan session. Baselines
are only ever *tightened* by a run that actually cleaned (or loosened
explicitly by the user as an accepted threshold — never silently).

Detectors live as `health:*` npm scripts so any run (or the user) can
re-measure cheaply. Dedicated dev tools (knip, jscpd, …) are sanctioned as
devDependencies when a hand-rolled script would be worse — the constraints
on shipped deps (architecture.md §14.2) never applied to tooling. A
tooling session installs and wires them; pin exact versions like the rest
of the stack.

## Idempotence contract (the definition of done)

A run must end in exactly one of two states:

1. **Nothing to do** — every detector measures at or under its baseline,
   the manual sweep of code changed since the last run found nothing above
   the bar, no active plan left with unexecuted sessions (`todo` **or**
   `needs-go`). A nothing-to-do run leaves the registry exactly as it
   found it.
2. **One active plan** — every finding is either a session in
   `docs/upgrade/code.{YYYYMMDD-HHmm}.md` or an accepted threshold
   recorded in the registry with the user's validation. No third bucket.

Corollary: once all sessions of the active plan are executed, re-invoking
`/code-health` must land in state 1. The final session of every plan is
always "update the registry baselines, clear the active-plan pointer, and
close the plan" (see **Closing a plan**).

## The bar (what counts as a finding)

Conservative by default; structural work is opt-in.

- **clean** (default kind): mechanical, obviously-right, reviewable in
  minutes — dead exports/files/keys/branches, duplication with ≥3 call
  sites factored into a helper that *removes net lines without hiding
  behavior*, needless indirection removed, drift to an existing shared
  helper (`dom.js`, `a11y.js`, `prefs.js`, …) that some call sites bypass.
- **structural** (opt-in kind): file splits, module moves, ownership
  changes — anything where the "right" shape is a judgment call (the
  ~1700-line `api-try-it-panel.js` is the canonical case). Planned like
  any session but **blocked until the user validates it at execution
  time** — the session asks for that go itself (see **Asking for a go**).
- **Wasted work** is a finding only where waste is felt: a hot path, the
  startup path, or a path a perf e2e budget covers (rule 14). Redundant
  computation, repeated I/O, independent operations run sequentially,
  long-lived objects built from closures that keep a whole enclosing
  scope alive. Micro-optimisation on a cold path is taste, not debt.
  Routing: a waste an existing perf budget already catches is
  `app-health`'s (the budget is the symptom, and it has a guard); a waste
  no budget watches is this skill's. And it is `clean` only when the
  cheaper form is observably identical — reordering independent I/O
  changes observable ordering, so it enters `needs-go`, not `clean`.
- **Altitude** — a fix implemented too shallow: special cases layered on
  shared infrastructure where the underlying mechanism should have been
  generalized. The mirror image of *needless indirection*, which removes
  a layer that serves nothing; this one names a layer that should have
  absorbed the case instead of dodging it. Evidence is a count: N call
  sites special-casing the same shared helper. Because the right shape is
  a judgment call, an altitude finding enters as `structural`.
- **Not findings**: speculative abstraction (two similar sites are not a
  pattern), style opinions (Biome is the arbiter, rule 18), renames for
  taste, reformatting untouched code, replacing a working idiom with a
  trendier one. Dead *defensive* code — guards against impossible cases,
  back-compat shims — IS a finding (the project has no users and bans
  pre-prod fallbacks), but each removal must state why the case is
  impossible, not just that it looks unreachable.

## Behavior-preservation contract

Binding on every `clean` and `structural` session:

- `npm test` green before AND after, with **zero test modifications** in
  the session — if a test must change, the change wasn't
  behavior-preserving; stop and rethink. (Exception: sessions whose target
  *is* test code — there the guard is that the suite still passes and
  still asserts the same behaviors.)
- Snapshots byte-identical. A snapshot diff in a cleanup session is a
  detected behavior change, never something to regenerate.
- e2e after anything build-affecting (repo rule).
- Existing comments are the design record: comments attached to surviving
  code are never stripped in a refactor. Comments die only with the dead
  code that carries them.

## Modes

- `/code-health` — the standard run: measure + sweep + consolidate.
- `/code-health deep <dimension>` — exhaustive audit of one registry row
  (e.g. `deep duplication`, `deep dead-code`). Expensive; only on
  explicit request.
- `/code-health run [<session>]` — execute the next session of the active
  plan (or the named one). One session = one commit. A `needs-go`
  session asks for its go at execution time.
- `/code-health run all` — chain the plan's sessions in order, one commit
  each, through to the registry update. A `needs-go` session does not
  end the chain: it asks its question when its turn comes.

## Standard run (`/code-health`)

1. **Read the registry.** If missing, bootstrap: seed the dimension list
   from this file's bar, measure initial baselines, ask the user before
   adding a dimension the registry never listed.

2. **Measure.** Run every detector command in the registry. Where a
   detector is not yet installed (tooling session still `todo`), perform
   the measurement manually this run — an uninstalled detector never
   excuses an unmeasured dimension.

3. **Sweep.** For the fuzzy dimensions no detector can judge (needless
   indirection, idiom drift, bypassed helpers, dead defensive branches,
   wasted work, altitude), read the code changed since the last run
   (`git log` since the registry's own last commit) rather than the whole
   repo;
   the whole-repo pass is `deep`'s job. Every finding cites file:line.
   The last two are the angles inherited from `/simplify`; take them one
   at a time and against the bar above, not as a general invitation to
   improve the code.

4. **Judge.** Diff measurements against baselines; classify every finding
   `clean`, `structural`, or `accepted` (threshold the user validates,
   recorded in the registry with its rationale). Route behavioral bugs
   discovered en route to "Routed findings" — never into sessions.

5. **Consolidate into one plan.** Same mechanics as the sibling skills:
   re-verify the active plan's unexecuted sessions, write a new plan file
   merging survivors with this run's findings, fold the old one into it
   (final progress table into the new plan's "Superseded predecessors"
   section, then `git rm` — no bare `.md` that will never be executed may
   outlive its replacement), keep exactly one active plan. A surviving
   `needs-go` session stays `needs-go` — rewriting a plan is never a way
   to launder a missing go.
   Before writing the plan file, check the sibling registries' active
   plans and record in the session's Why any overlap with a session
   already in flight. Cleanups
   already implied by an `app-health` or coverage session are
   cross-referenced, not duplicated.

6. **Finish.** Update the registry (measurements, dates, thresholds,
   pointer). Commit registry + plan together in a single `docs(code): …`
   commit, touching nothing else. Summarize: what regressed vs baseline,
   what's planned (clean vs structural), what's accepted, routed
   findings, or "nothing to do".

## Deep audit (`/code-health deep <dimension>`)

Whole-perimeter pass of one dimension: enumerate every instance (every
export, every repeated pattern, every helper-bypass), not just code
changed since last run. May prototype a detector to do it; a prototype
worth keeping becomes a tooling session. Findings feed step 5. Record the
reading in the row's Notes.

## Session execution (`/code-health run`)

Read the active plan, take the first unexecuted session (or the named
one). If it is marked `needs-go`, **ask the user before doing anything
else** (see **Asking for a go**). Each session is
independently executable; the behavior-preservation contract above binds.
One session = one commit (`refactor(…)`, `chore(…)` for tooling). End by
flipping the session's status to `done ⟨date⟩ ⟨commit⟩` in the plan file
(same commit). If it was the last session, perform the registry-update
session, close the plan (see **Closing a plan**) and tell the user a
fresh `/code-health` should report "nothing to do".

## Chained execution (`/code-health run all`)

The same thing repeated: take the plan's sessions in table order and
execute them without asking between them — one commit and one status
flip per session, never a batched commit. A `needs-go` session does not
end the chain: when its turn comes it asks its own question (see
**Asking for a go**) and then proceeds on the answer. The chain stops,
cleanly and with a report of what landed, at the first of:

- a session that breaks the behavior-preservation contract — a test that
  would have to change, a snapshot that moved, a detector reading that
  didn't improve — or whose execution shows the plan's analysis is stale
  (the code is already gone, the duplication already factored). Report
  it, never work around it; a moved snapshot is a detected behavior
  change, not something to regenerate to keep the chain going.
- a behavioral bug discovered en route: it is routed to the user, as
  ever, and the chain does not fix it;
- a session too large to start with what's left of the run: finish and
  commit the one in progress, then hand back.

Session size is what makes the chain legitimate — it is a convenience for
small `clean` sessions, not a licence to batch. Every per-session rule of
the section above binds identically. If the chain reaches the
registry-update session, run it too, close the plan (see **Closing a
plan**) and tell the user a fresh `/code-health` should now report
"nothing to do".

## Asking for a go

A `needs-go` session carries its own question rather than delegating it
to the user's next invocation. When its turn comes — in `run` or in the
middle of `run all` — put the decision to the user *there*, and let the
answer decide:

- **Ask before touching anything.** State what is being validated: the
  target shape, what moves where, the expected diff surface. "Split the
  file" is not a question; "extract the response area into
  `try-it/response-view.js`, ~570 lines, panel keeps the state" is.
- **Approved** → flip the Status to `todo` and execute it like any other
  session, same contract, same commit.
- **Declined** → leave it `needs-go`, execute nothing for it, and **keep
  going** with the next session. A refusal is an answer about *that*
  session, not a stop signal for the plan.
- **Never infer the go.** Silence, an ambiguous reply, or a plausible
  guess about what the user would want are all "not approved". The one
  thing this skill must never do is execute a structural session the
  user did not agree to.

Consequence for the end of the run: a plan with a declined session is
**not finished**. Run the registry update for what did land, but leave
the active-plan pointer in place and do **not** rename the file
`.done.md` — the plan still has work in it. Say so in the report, and
name the session waiting on a decision.

## Closing a plan

A plan whose sessions have all been executed is renamed on the spot:
`docs/upgrade/code.{YYYYMMDD-HHmm}.md` →
`docs/upgrade/code.{YYYYMMDD-HHmm}.done.md`. The `.done` is the whole
point — `ls docs/upgrade/` then says at a glance which plans are behind
you and which one is live, without opening a single file.

Mechanics, all inside the registry-update commit:

- `git mv` the file, so its history follows it;
- fix every reference to the old name in the same commit — the
  registry's active-plan pointer (which goes back to `none`) and any
  prose in it that cites the plan by filename, plus cross-references
  from the sibling skills' registries and plans;
- a **superseded** plan is never renamed `.done.md`: it did not finish,
  it was replaced — and it was folded into its successor's "Superseded
  predecessors" section at supersede time, so no file of it remains.
  `.done.md` means *executed*, not merely closed.

## Plan file format

`docs/upgrade/code.{YYYYMMDD-HHmm}.md` while it still has unexecuted
sessions, `docs/upgrade/code.{YYYYMMDD-HHmm}.done.md` once they are all
executed:

```markdown
# Code health plan — {date}

Produced by /code-health. Supersedes: {previous file or "none"}.
Baseline snapshot: {dimension → measured vs baseline, one line per
regressed or newly-measured row}.

## Superseded predecessors

{Only when Supersedes ≠ "none": one subsection per folded plan — its
filename, its final "Execution order & progress" table (statuses,
commits), and one line on what was executed, carried or dropped.}

## Routed findings

Behavioral bugs or coverage gaps noticed during the audit — NOT sessions
of this plan. Each goes to the user and/or the app-health registry.

## Execution order & progress

One line = one session; update Status at the end of each session. Most
sessions enter as `todo`; `structural` ones enter as `needs-go` and ask
for that go when they execute (see **Asking for a go**).

| # | Session | Kind | Dimension | Scope | Status |
|---|---|---|---|---|---|
| 1 | …       | clean / structural / tooling | … | … | todo / needs-go |
| n | Registry update | — | all | Tighten baselines in docs/registry/code-health-registry.md, clear active-plan pointer. | todo |

## Sessions

### 1. {title}
- **Why**: {the debt, with file:line evidence from this run's measurement}
- **Kind**: clean | structural | tooling
- **Files**: {every file to touch}
- **Change**: {precise enough to execute without re-deriving the analysis;
  for structural: the target shape and what moves where}
- **Acceptance**: {detector reading after; tests green with zero test
  edits; snapshots byte-identical}
```

`clean` sessions are sized for one focused agent run. `structural`
sessions additionally state what the user is validating (the target
shape, not just "split the file") and enter the table with Status
`needs-go`. Write that "what" well: it is the raw material of the
question the session asks when it executes, and a vague plan makes an
unanswerable question.

## Guardrails

- **User-invoked only.** Never run any part of this skill uninvited.
- **An audit run never fixes anything.** `/simplify` finds and applies in
  one pass; here, finding and fixing are different invocations
  (`/code-health` vs `/code-health run`) and the audit's only commit is
  registry + plan. Borrowing its angles never means borrowing its apply
  phase — a fix landed during a run has no session, no go, and no place
  in the idempotence contract.
- Strictly behavior-preserving — the contract above is the definition of
  this skill; a session that can't satisfy it doesn't belong here.
- Structural sessions never execute without the user's explicit go —
  asked in place when the session comes up, never inferred, never
  batched into an earlier approval.
- Baselines never loosen silently; accepted thresholds carry the user's
  validation and a rationale.
- Every finding cites file:line evidence measured this run. No findings
  from memory.
- Biome is the style arbiter; this skill never argues formatting.
- English everywhere (repo rule 17); the plan and registry are part of
  the codebase.
