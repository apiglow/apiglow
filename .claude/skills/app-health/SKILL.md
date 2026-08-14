---
name: app-health
description: >
  Audit the guard net around the app's critical functional paths (doc↔panel
  mirror, send pipeline, sanitization, storage bounds, theming, exports, …):
  detect unguarded or thinly-guarded paths, tautological tests, and drift
  between the code's real surface and what the tests assert, then produce
  one consolidated, session-sliced fix plan in docs/upgrade/.
disable-model-invocation: true
---

# app-health — keep the critical paths guarded

The app's promise is that its critical functional paths — the ones whose
failure is *silent* for the maintainer but fatal for a user — stay
operational release after release. CI proves the existing tests pass; it
proves nothing about paths no test covers, tests that assert a fraction of
their surface, or tests that check a declaration against itself. This skill
is the recurring audit of that **guard net**: it confronts the app's real
surface with what the guards actually assert, and emits a fix plan that
independent agents can execute session by session.

Second of the four-skill audit family — spec-sync (the claimed specs),
app-health (the functional guard net), code-health (the code itself),
upgrade-code (the technical platform). This one audits **functional
health**: does the app still do what it promises, and would we notice if
it stopped. Refactors, duplication and dead code belong to `/code-health`;
dependency and platform moves to `/upgrade-code`.

**State lives in `docs/registry/app-health-registry.md`** — one row per critical
path: modules, guards, verdict, plus the cross-cutting
invariant list, the waiver list and the pointer to the active plan. The
registry is the only thing that makes runs idempotent; every run starts by
reading it and ends by updating it.

## Idempotence contract (the definition of done)

A run must end in exactly one of two states:

1. **Nothing to do** — every registry row is WELL-GUARDED or carries a
   validated waiver, every cross-cutting invariant is enforced by a
   permanent guard, no drift between registry and code, no active plan
   left with unexecuted sessions (`todo` **or** `needs-go`). A
   nothing-to-do run leaves the registry exactly as it found it.
2. **One active plan** — every gap found is either a session in
   `docs/upgrade/health.{YYYYMMDD-HHmm}.md` or a new waiver in the
   registry. No third bucket: a gap that is neither planned nor waived is a
   failed run.

Corollary: once all sessions of the active plan are executed, re-invoking
`/app-health` must land in state 1. The final session of every plan is
therefore always "update the registry to record the new guards/verdicts,
clear the active-plan pointer, and close the plan" (see **Closing a
plan**).

**The ratchet.** Findings never stay findings. Each gap becomes a plan
session that installs a *permanent* guard — a Vitest/Playwright test, a
static check in `scripts/check-invariants.mjs`, a post-build assertion, a
budget — or a waiver the user validates. Every audit therefore makes the
next one cheaper: over time the skill's job shifts from probing the app to
verifying the net has no new holes.

## Modes

- `/app-health` — the standard run: drift check + guard-quality check +
  plan consolidation. Described below. **Runs no test suite** — CI owns
  green; this skill examines the net, not the catches.
- `/app-health deep <path>` — exhaustive audit of one registry row
  (e.g. `deep doc-panel-mirror`, `deep sanitization`). The only mode
  allowed to execute targeted specs or write throwaway behavioral probes.
  Expensive; only on explicit request.
- `/app-health run [<session>]` — execute the next session of the active
  plan (or the named one). One session = one commit. A `needs-go`
  session asks for its go at execution time.
- `/app-health run all` — chain the plan's sessions in order, one commit
  each, through to the registry update, stopping only at a session that
  fails. A `needs-go` session does not end the chain: it asks its
  question when its turn comes.

## Standard run (`/app-health`)

1. **Read the registry.** If `docs/registry/app-health-registry.md` is missing,
   bootstrap it: enumerate critical paths from `docs/architecture.md`,
   the CLAUDE.md imperative rules, and the `CONTRIBUTING.md` feature→test
   map, then continue. Ask the user before adding a path the registry
   never listed.

2. **Drift check** — the code moved; did the net move with it?
   - New surface: modules, components, storage keys, export generators,
     editable widgets that no registry row covers (diff of `src/` against
     the registry's module lists; `git log` since the registry's own last
     commit names what moved).
   - Guards still real: every guard file cited in the registry exists, is
     non-empty, and its tests are not skipped or disabled.
   - Map coherence: the `CONTRIBUTING.md` feature→test map's files exist,
     and every `tests/e2e/*.spec.js` appears in the map.
   - Model-derived exports keep pace — `llms-full.txt`
     (`src/export/llms-full.js`) is the canonical case: every construct
     newly modeled or newly rendered by the doc since the last run must
     have its counterpart in the export, or the omission is a recorded
     gap. The export's snapshot only freezes what it already emits — it
     never detects what the model gained and the export ignored; that
     detection is this check's job. Same lens on `endpoint-markdown.js`
     and the other model-derived generators.
   - Docs coherence: `docs/architecture.md` is the functional source of
     truth — for every row this drift check touches, the sections its
     modules implement must still describe the code's behavior; a stale
     claim is a gap like any missing guard (registry invariant 16).
   - Waivers: rationale still holds.

3. **Guard-quality check** — for rows touched by drift or never audited
   deeply, judge the guard, not just its existence:
   - *Tautology*: a test that checks a declaration against its own
     declaration guards nothing. The model to demand instead is
     `tests/credits.test.js`, which checks `src/credits.js` against
     `package.json` + `LICENSE` — a declaration confronted with its real
     source.
   - *Thin coverage*: compare the surface (every widget, every generator,
     every rule file, every storage dataset) with what the guard actually
     asserts; a 3-test spec over a 15-widget contract is a gap.
   - *Silent-by-construction*: prefer guards positioned where the failure
     is born (normalization, a single choke point, a static check) over
     guards that need the failure to be visible in a UI.
   - *Feature switches*: a host-disabled feature (`features.scenarios`,
     `features.audit`, and any future flag) must be verified blocked at
     **every entry** — route and deep link, search index, capture and
     creation surfaces, exports, background compute and storage — not
     merely unrendered. A guard that only checks the button is thin
     coverage of the worst kind: the host's choice looks honored while
     the feature keeps running.

4. **Invariants check.** The registry lists cross-cutting invariants and
   the permanent guard enforcing each — `scripts/check-invariants.mjs`
   (run by CI via `npm run check:invariants`) is home of the statically
   checkable ones. This step verifies the script still covers the
   registry's list and the code's reality — not by re-running the
   analysis by hand. An invariant no guard enforces is a standing gap:
   it becomes a plan session, it does not get hand-checked inline as a
   substitute.

5. **Consolidate into one plan.** If the registry points at an active plan
   with unexecuted sessions, re-verify each one against the current code
   (some may have landed since), then write a **new** plan file merging
   survivors with this run's findings. A surviving `needs-go` session
   stays `needs-go` — rewriting a plan is never a way to launder a
   missing go. The old file is then **folded into the new one**, not left
   behind: its final progress table (statuses, commits) goes into the new
   plan's "Superseded predecessors" section — together with any such
   section the old file already carried — with one line on what was
   executed, carried or dropped, and the old file is then deleted. The
   fold is the only trace that survives — plans are untracked, git holds
   no copy — which is why it is never optional; what must not remain
   is a bare `.md` in `docs/upgrade/` that will never be executed. Exactly
   one active plan exists at any time; the registry's pointer is updated.
   Before writing the plan file, check the sibling registries' active
   plans and record in the session's Why any overlap with a session
   already in flight.
   Sessions come in two kinds: **fix** (a real regression or defect found)
   and **ratchet** (install a missing permanent guard). Gaps already
   covered by the active spec-sync plan are cross-referenced, **not**
   duplicated; a boundary `docs/openapi-coverage.md` §5.1 records as a
   deliberate degradation is a documented waiver, not a gap.

6. **Finish.** Update the registry (verdicts, guards, waivers,
   active-plan pointer). Commit the registry — a single
   `docs(health): …` commit, touching nothing else; the plan is untracked
   and enters no commit. Summarize for the
   user: what drifted, what's planned (fix vs ratchet), what's waived, or
   "nothing to do".

## Deep audit (`/app-health deep <path>`)

Take one registry row and enumerate its *real* surface from the source of
truth — e.g. every editable widget bound by `docs/architecture.md` §5.5.4
for the mirror, every generator in `src/export/` for redaction, every
dataset in `src/storage/` for bounds — then confront each element with an
actual assertion in the guard files (cite file:line both sides). This mode
may run the row's targeted specs and write throwaway probes to answer
"does this element actually behave" when reading is not enough; probes are
deleted afterwards — anything worth keeping becomes a ratchet session.
Findings feed step 5 of the standard run (same consolidation, same plan
format, same waiver rule). Record the audit in the row's Notes.

## Session execution (`/app-health run`)

Read the active plan, take the first unexecuted session (or the named
one). If it is marked `needs-go`, **ask the user before doing anything
else** (see **Asking for a go**).
Each session is written to be executable with no prior context; still, the
repo rules bind: `npm test` green before commit, e2e after build-affecting
changes, snapshots regenerated deliberately, one commit per session.
Ratchet sessions must leave the new guard wired into what CI runs
(`npm test`, the e2e suite, or a script invoked by CI) — a guard that only
the audit runs is not a ratchet. End by flipping the session's status
to `done ⟨date⟩ ⟨commit⟩` in the plan file (untracked, so no commit
carries it). If it was
the last session, also perform the registry-update session, close the
plan (see **Closing a plan**) and tell the user a fresh `/app-health`
should now report "nothing to do".

## Chained execution (`/app-health run all`)

The same thing repeated: take the plan's sessions in table order and
execute them without asking between them — one commit and one status
flip per session, never a batched commit. A `needs-go` session does not
end the chain: when its turn comes it asks its own question (see
**Asking for a go**) and then proceeds on the answer. The chain stops,
cleanly and with a report of what landed, at the first of:

- a session that fails its acceptance, or whose execution shows the
  plan's analysis is stale (the guard already exists, the gap it
  described is gone): report it, never work around it — and never make it
  pass by weakening a guard;
- a session too large to start with what's left of the run: finish and
  commit the one in progress, then hand back.

Session size is what makes the chain legitimate — it is a convenience for
small sessions, not a licence to batch. Every per-session rule of the
section above binds identically, including the ratchet requirement that a
new guard ends up wired into what CI runs. If the chain reaches the
registry-update session, run it too, close the plan (see **Closing a
plan**) and tell the user a fresh `/app-health` should now report
"nothing to do".

## Asking for a go

A `needs-go` session carries its own question rather than delegating it
to the user's next invocation. When its turn comes — in `run` or in the
middle of `run all` — put the decision to the user *there*, and let the
answer decide:

- **Ask before touching anything.** State what is being validated: the
  guard to add and what it would gate, the cost it puts on every future
  run, and what it means for CI (a ratchet has to end up wired into what
  CI runs, so the user is agreeing to that too).
- **Approved** → flip the Status to `todo` and execute it like any other
  session, ratchet requirement included.
- **Declined** → leave it `needs-go`, execute nothing for it, and **keep
  going** with the next session. A refusal is an answer about *that*
  guard, not a stop signal for the plan. If it amounts to "this path
  stays unguarded", that is a waiver — record it in the registry with
  its rationale.
- **Never infer the go.** Silence, an ambiguous reply, or a guess about
  what the user would probably accept are all "not approved". And a
  declined guard is never replaced by a weaker one to look productive —
  that is the "never make a run green by weakening a guard" rule.

Consequence for the end of the run: a plan with a declined session is
**not finished**. Run the registry update for what did land, but leave
the active-plan pointer in place and do **not** rename the file
`.done.md` — the plan still has work in it. Say so in the report, and
name the session waiting on a decision.

## Closing a plan

A plan whose sessions have all been executed is renamed on the spot:
`docs/upgrade/health.{YYYYMMDD-HHmm}.md` →
`docs/upgrade/health.{YYYYMMDD-HHmm}.done.md`. The `.done` is the whole
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

`docs/upgrade/health.{YYYYMMDD-HHmm}.md` while it still has unexecuted
sessions, `docs/upgrade/health.{YYYYMMDD-HHmm}.done.md` once they are all
executed:

```markdown
# App health plan — {date}

Produced by /app-health. Supersedes: {previous file or "none"}.
Registry snapshot: {path → verdict, one line per non-green row}.

## Superseded predecessors

{Only when Supersedes ≠ "none": one subsection per folded plan — its
filename, its final "Execution order & progress" table (statuses,
commits), and one line on what was executed, carried or dropped.}

## Execution order & progress

One line = one session; update Status at the end of each session. Most
sessions enter as `todo`. A session enters as `needs-go` when it commits
the project to something the user should weigh — a guard that puts a
lasting cost on every future run, or accepting that a path stays
unguarded — and it asks for that go when it executes (see **Asking for a
go**).

| # | Session | Kind | Path | Scope | Status |
|---|---|---|---|---|---|
| 1 | …       | fix / ratchet | … | … | todo / needs-go |
| n | Registry update | — | all | Record new guards and verdicts in docs/registry/app-health-registry.md, clear active-plan pointer. | todo |

## Sessions

### 1. {title}
- **Why**: {the gap or regression, with file:line evidence from this run}
- **Kind**: fix | ratchet
- **Files**: {every file to touch}
- **Guard**: {for ratchet sessions: the exact permanent check to install,
  where it lives, and what CI entry point runs it}
- **Acceptance**: {observable outcome; for ratchet sessions, the guard
  demonstrably fails when the defect is reintroduced}
```

Sessions must be independently executable and ordered so that no session
depends on a later one. Fix sessions come before the ratchet session that
would guard the same path (land the fix, then lock it). Sized for one
focused agent run each.

## Guardrails

- **User-invoked only.** Never run any part of this skill uninvited, and
  ask the user before anything beyond reading, analysing, and writing the
  registry/plan (waivers and scope changes always need their validation).
- **No suite execution in the standard run.** Behavioral probing belongs
  to `deep` mode and to plan sessions.
- A `needs-go` session never executes without the user's explicit go —
  asked in place when the session comes up, never inferred, never batched
  into an earlier approval.
- Every finding cites file:line evidence gathered during this run. No
  findings from memory, no verdict without having read the guard.
- Never make a run green by weakening a guard — loosening a budget,
  skipping a test, or shrinking an assertion is a regression, not a fix
  (rule 14 applies to the net itself).
- English everywhere (repo rule 17); the registry is tracked
  documentation, and the untracked plan is written to the same standard.
