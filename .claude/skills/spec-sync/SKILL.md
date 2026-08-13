---
name: spec-sync
description: >
  Audit the project's claimed spec/format support (OpenAPI, JSON Schema,
  Arazzo, HAR, Postman, llms.txt, MCP, …) against the latest published
  versions and against the codebase, then produce one consolidated,
  session-sliced upgrade plan in docs/upgrade/. Run ONLY when the user
  explicitly invokes /spec-sync — never proactively, never as a side effect
  of another task.
disable-model-invocation: true
---

# spec-sync — keep the spec claims honest

The app claims maximal support of a set of specifications (CLAUDE.md rule 19:
an unsupported construct of a supported version is a defect, not a scope
choice, unless waived with a documented rationale). This skill is the
recurring audit that keeps that claim true over time: it detects new spec
versions, confronts them with the codebase, and emits an upgrade plan that
independent agents can execute session by session.

First of the four-skill audit family — spec-sync (the claimed specs),
app-health (the functional guard net), code-health (the code itself),
upgrade-code (the technical platform).

**State lives in `docs/registry/specs-registry.md`** — one row per format: implemented
version, latest known published version, source-of-truth URL,
plus the waiver list and the pointer to the active plan. The registry is the
only thing that makes runs idempotent; every run starts by reading it and
ends by updating it.

## Idempotence contract (the definition of done)

A run must end in exactly one of two states:

1. **Nothing to do** — every format's latest published version is covered or
   waived, no drift between registry and code, no active plan left with
   unexecuted sessions (`todo` **or** `needs-go`). A nothing-to-do run
   leaves the registry exactly as it found it.
2. **One active plan** — every gap found is either a session in
   `docs/upgrade/specs.{YYYYMMDD-HHmm}.md` or a new waiver in the registry.
   No third bucket: a gap that is neither planned nor waived is a failed run.

Corollary: once all sessions of the active plan are executed, re-invoking
`/spec-sync` must land in state 1. The final session of every plan is
therefore always "update the registry (+ coverage docs) to record the new
implemented versions, clear the active-plan pointer, and close the plan"
(see **Closing a plan**).

## Modes

- `/spec-sync` — the standard run: version watch + light drift check +
  plan consolidation. Described below.
- `/spec-sync deep <format>` — exhaustive conformance audit of one format
  (e.g. `deep openapi`, `deep arazzo`). Expensive; only on explicit request.
- `/spec-sync run [<session>]` — execute the next session of the active
  plan (or the named one). One session = one commit. A `needs-go`
  session asks for its go at execution time.
- `/spec-sync run all` — chain the plan's sessions in order, one commit
  each, through to the registry update, stopping only at a session that
  fails. A `needs-go` session does not end the chain: it asks its
  question when its turn comes.

## Standard run (`/spec-sync`)

1. **Read the registry.** If `docs/registry/specs-registry.md` is missing, bootstrap
   it: enumerate every format the codebase claims (version strings in
   `src/export/*`, normalization targets in `src/openapi/`, and the scope
   of `docs/openapi-coverage.md`), seed `Latest known` as unknown, then
   continue. Ask the user before adding a format the registry never listed.

2. **Version watch.** For each registry row, fetch the source-of-truth URL
   (WebFetch/WebSearch) and determine the latest *published* version
   (releases/changelogs; ignore drafts unless the row says to watch them).
   Hard rule: **never assert a version from memory** — every "latest is X"
   claim in the run's output cites the URL it was read from, this run.
   Frozen formats (HAR 1.2, Swagger 2.0) are still fetched, but not
   expected to move.

3. **Change analysis** — only for formats where latest > implemented, or
   never checked. Fetch the changelog/diff between the implemented and the
   latest version. For each change, confront the codebase (where is the
   construct modeled, rendered, exported?) and classify it:
   - *already handled* — cite the file(s);
   - *gap* — becomes a plan session (or joins one);
   - *not applicable in a browser-only client* — becomes a waiver
     candidate; the user validates every new waiver.

   **A version that did not move ends the analysis for that format.** Do not
   go looking for constructs — not in an enumerated list of types, not in the
   field table of an object, not anywhere. That reading is `deep` mode's, and
   doing it here is what makes a run non-idempotent: there is always one more
   construct to find if each run looks one notch deeper, so the plan never
   empties and the "nothing to do" state becomes unreachable. If a format's
   construct-level coverage has never been established, say so and offer a
   `deep` run — the **Deep audits** table in the registry is what records
   whether it has. Reaching for it uninvited is not thoroughness, it is the
   contract in step 0 being broken one construct at a time.

4. **Drift check** (light, every run):
   - registry vs code: `npm run health:specs` compares the version
     strings in `src/` (`ARAZZO_VERSION`, Postman `SCHEMA_URL`, HAR
     `version`, …) to the `Implemented` column;
   - existing waivers: rationale still holds (a platform limitation may
     have been lifted);
   - `docs/openapi-coverage.md` status table: sessions marked done are
     actually merged;
   - the registry's **Inventory verdicts that can go stale** table: one
     `npm view <pkg> version` per row against the version weighed. A
     verdict that kept in-house code because a library lacked something
     is a claim about that library, and it rots silently — only these
     rows are checked, because the other verdicts rest on our own rules
     and a rule moves by decision, not by drift. A version that moved
     means re-reading what changed; a row that reopens becomes a plan
     session and an amendment to the spec-code inventory
     (`docs/openapi-coverage.md` §6), never a silent swap.
   This is not a conformance audit — construct-by-construct verification
   is `deep` mode's job.

5. **Consolidate into one plan.** If the registry points at an active plan
   with unexecuted sessions, re-verify each one against the current code
   (some may have landed since), then write a **new** plan file merging
   survivors with this run's findings. A surviving `needs-go` session
   stays `needs-go` — rewriting a plan is never a way to launder a
   missing go. The old file is then **folded into the new one**, not left
   behind: its final progress table (statuses, commits) goes into the new
   plan's "Superseded predecessors" section — together with any such
   section the old file already carried — with one line on what was
   executed, carried or dropped, and the old file is `git rm`-ed in the
   same commit. Its full text stays in git history; what must not remain
   is a bare `.md` in `docs/upgrade/` that will never be executed. Exactly
   one active plan exists at any time; the registry's pointer is updated.
   Before writing the plan file, check the sibling registries' active
   plans and record in the session's Why any overlap with a session
   already in flight.
   Gaps already covered by a `todo` session of `docs/openapi-coverage.md`
   are cross-referenced, **not** duplicated into the plan.

6. **Finish.** Update the registry (`Latest known`, waivers,
   active-plan pointer). Commit the registry + plan together in a single
   `docs(specs): …` commit, touching nothing else. Summarize for the user:
   what moved, what's planned, what's waived, or "nothing to do".

## Deep audit (`/spec-sync deep <format>`)

Fetch the full spec text of the *implemented* version and walk it section
by section, building a construct checklist. For each construct, verify the
whole chain that applies to the format's role: normalization
(`src/openapi/model.js` — never the raw schema, rule 6), rendering,
try-it/send, exports, audit rules. Findings feed step 5 of the standard run
(same consolidation, same plan file format, same waiver rule).

**Exhaustive means exhaustive**: walk every object's full field table, not the
fields the code happens to read. A field that is neither used nor named is the
worst finding there is — the document imports, the step looks fine, and the
request is wrong. Enumerate first, confront second, so that a construct
missing from the checklist is a mistake you can see rather than one you never
made.

Record the audit in the registry's **Deep audits** table: the spec revision
walked. That row is what lets a later
standard run answer "has this ever been checked construct by construct?"
without checking again — and it is what keeps step 3 honest, since a format
with a fresh deep audit has no excuse for construct-hunting and one with none
gets an offer instead of a raid.

## Session execution (`/spec-sync run`)

Read the active plan, take the first unexecuted session (or the named
one). If it is marked `needs-go`, **ask the user before doing anything
else** (see **Asking for a go**).
Each session is written to be executable with no prior context; still, the
repo rules bind: `npm test` green before commit, snapshots regenerated
deliberately, e2e after build-affecting changes, one commit per session.
End by flipping the session's status to `done ⟨date⟩ ⟨commit⟩` in the
plan file (same commit). If it was the last session, also perform
the registry-update session, close the plan (see **Closing a plan**) and
tell the user a fresh `/spec-sync` should now report "nothing to do".

## Chained execution (`/spec-sync run all`)

The same thing repeated: take the plan's sessions in table order and
execute them without asking between them — one commit and one status
flip per session, never a batched commit. A `needs-go` session does not
end the chain: when its turn comes it asks its own question (see
**Asking for a go**) and then proceeds on the answer. The chain stops,
cleanly and with a report of what landed, at the first of:

- a session that fails its acceptance, or whose execution shows the
  plan's analysis is stale (the spec changed, the code moved): report it,
  never work around it;
- a session too large to start with what's left of the run: finish and
  commit the one in progress, then hand back.

Session size is what makes the chain legitimate — it is a convenience for
small sessions, not a licence to batch. Every per-session rule of the
section above binds identically. If the chain reaches the registry-update
session, run it too, close the plan (see **Closing a plan**) and tell the
user a fresh `/spec-sync` should now report "nothing to do".

## Asking for a go

A `needs-go` session carries its own question rather than delegating it
to the user's next invocation. When its turn comes — in `run` or in the
middle of `run all` — put the decision to the user *there*, and let the
answer decide:

- **Ask before touching anything.** State what is being validated: the
  construct to support, the semantics chosen when versions conflict, the
  surface it touches, and the alternative if there is one (support it,
  or degrade with a documented fallback under rule 19).
- **Approved** → flip the Status to `todo` and execute it like any other
  session.
- **Declined** → leave it `needs-go`, execute nothing for it, and **keep
  going** with the next session. A refusal is an answer about *that*
  session, not a stop signal for the plan. If the user's reason amounts
  to "not this construct", that is a waiver — record it in the registry
  with its rationale.
- **Never infer the go.** Silence, an ambiguous reply, or a guess about
  what the user would probably accept are all "not approved".

Consequence for the end of the run: a plan with a declined session is
**not finished**. Run the registry update for what did land, but leave
the active-plan pointer in place and do **not** rename the file
`.done.md` — the plan still has work in it. Say so in the report, and
name the session waiting on a decision.

## Closing a plan

A plan whose sessions have all been executed is renamed on the spot:
`docs/upgrade/specs.{YYYYMMDD-HHmm}.md` →
`docs/upgrade/specs.{YYYYMMDD-HHmm}.done.md`. The `.done` is the whole
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

`docs/upgrade/specs.{YYYYMMDD-HHmm}.md` while it still has unexecuted
sessions, `docs/upgrade/specs.{YYYYMMDD-HHmm}.done.md` once they are all
executed. Modeled on `docs/openapi-coverage.md` (the proven
agent-executable format here):

```markdown
# Spec upgrade plan — {date}

Produced by /spec-sync. Supersedes: {previous file or "none"}.
Registry snapshot: {format → implemented → latest, one line each, with the
source URLs actually fetched}.

## Superseded predecessors

{Only when Supersedes ≠ "none": one subsection per folded plan — its
filename, its final "Execution order & progress" table (statuses,
commits), and one line on what was executed, carried or dropped.}

## Execution order & progress

One line = one session; update Status at the end of each session. Most
sessions enter as `todo`. A session enters as `needs-go` when it commits
the project to something the user should weigh — waiving a construct
instead of supporting it, or widening scope to a format the registry
never listed — and it asks for that go when it executes (see **Asking
for a go**).

| # | Session | Format | Scope | Status |
|---|---|---|---|---|
| 1 | …       | …      | …     | todo / needs-go |
| n | Registry update | all | Record new implemented versions in docs/registry/specs-registry.md (+ docs/openapi-coverage.md if touched), clear active-plan pointer. | todo |

## Sessions

### 1. {title}
- **Why**: {the spec change or gap, with the citation URL}
- **Files**: {every file to touch}
- **Behavior**: {model shapes, rendering, exports — precise enough to
  implement without re-reading the spec}
- **Acceptance**: {tests to add/extend, per rule 16; observable outcomes}
```

Sessions must be independently executable and ordered so that no session
depends on a later one. Slice by format first, then by subsystem, sized for
one focused agent run each.

## Guardrails

- **User-invoked only.** Never run any part of this skill uninvited, and
  ask the user before anything beyond reading, fetching, and writing the
  registry/plan (waivers and scope changes always need their validation).
- A `needs-go` session never executes without the user's explicit go —
  asked in place when the session comes up, never inferred, never batched
  into an earlier approval.
- Every version claim and every change analysed cites a URL fetched during
  the run. No plan content from memory.
- English everywhere (repo rule 17); the plan and registry are part of the
  codebase.
- Newest-wins normalization (rule 19) shapes every plan session: model the
  newest semantics, convert older spellings into it.
