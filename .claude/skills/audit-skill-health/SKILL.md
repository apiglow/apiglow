---
name: audit-skill-health
description: >
  Maintain the audit-skill family itself — spec-sync, app-health,
  code-health, upgrade-code — by keeping their shared machinery coherent
  and their coverage current with what the codebase actually does. Finds
  what no audit skill watches (a new technology, paradigm, subsystem,
  rule or design decision) and plans the rule that would watch it. Run ONLY when the
  user explicitly invokes /audit-skill-health — never proactively, never
  as a side effect of another task.
disable-model-invocation: true
---

# audit-skill-health — keep the auditors worth trusting

The meta-layer of the audit family — spec-sync (the claimed specs),
app-health (the functional guard net), code-health (the code itself),
upgrade-code (the technical platform). Those four watch the codebase.
**Nothing watches them**, and they decay in two specific ways:

- **Drift.** A rule that should read identically in all four ends up
  phrased four ways, or lands in three of them. Each addition is small
  and reasonable; the divergence is what an agent then reads as licence
  to improvise.
- **Blind spots.** The codebase grows a technology, a paradigm, a
  subsystem, a rule — and no audit skill is told to watch it. Nothing
  fails: the four keep reporting "nothing to do" about the parts they
  already knew, and the new surface is simply outside everyone's map.

This skill is the recurring audit of those two failures. It is a
**documentation skill**: it edits skills, registries and its own
detector, and never touches `src/` or `tests/`.

Scope boundaries:
- A real defect in the app → the audit skill that owns it. Findings
  about the *code* are recorded in the plan's "Routed findings" and
  handed to the user, never fixed here.
- Running an audit → that skill's own `/…` invocation. This one reads
  the four; it never executes them.
- Perimeter: `.claude/skills/{spec-sync,app-health,code-health,upgrade-code,audit-skill-health}/SKILL.md`,
  the five registries in `docs/registry/`, and
  `scripts/health/audit-skills.mjs`.
  Vendored skills (`daisyui`) and non-audit skills are out.

**State lives in `docs/registry/audit-skills-registry.md`** — one row per
coherence dimension and per coverage inventory: what the detector
measures, the current baseline, the declared divergences, plus
the pointer to the active plan. The registry is what makes runs
idempotent; every run starts by reading it and ends by updating it.

## The family includes this skill

`audit-skill-health` is the fifth member, not an outside observer: it
carries the same seven sections, the same canonical sentences and the
same status vocabulary, and the detector measures it alongside the other
four. A meta-skill exempt from its own rule would be the first thing an
agent learns to ignore.

The regress stops one level up, and deliberately: nothing audits *this*
skill's judgment. What protects it is that its findings are measured, its
edits are documentation-only, and its structural moves need the user.

## Divergence is allowed, and declared

The point is not to make four files say one thing. Each skill has a
domain, and the wording that serves it is often *not* the wording that
serves its neighbour: a snapshot that moved means something in
code-health and nothing in spec-sync.

So the unit of coherence is the **shared rule**, not the paragraph. A
sentence that states a rule of the family — how a plan is closed, what a
`needs-go` session does, what makes a run idempotent — must read
identically everywhere. Everything else is free, and where a difference
is deliberate it is **declared in the registry** so no later run
re-opens it. An undeclared difference is a finding; a declared one is
settled until its rationale stops holding.

## Idempotence contract (the definition of done)

A run must end in exactly one of two states:

1. **Nothing to do** — the detector measures at or under its baseline,
   every coverage orphan is either watched or a declared non-target, the
   reading sweep of what changed since the last run found nothing above
   the bar, no active plan left with unexecuted sessions (`todo` **or**
   `needs-go`). A nothing-to-do run leaves the registry exactly as it
   found it.
2. **One active plan** — every finding is either a session in
   `docs/upgrade/skills.{YYYYMMDD-HHmm}.md` or a declared divergence
   recorded in the registry with the user's validation. No third bucket.

Corollary: once all sessions of the active plan are executed, re-invoking
`/audit-skill-health` must land in state 1. The final session of every
plan is always "update the registry baselines, clear the active-plan
pointer, and close the plan" (see **Closing a plan**).

## The bar (what counts as a finding)

- **align** — a rule of the family stated differently across skills, or
  a shared section missing from one. Evidence: the detector's divergence
  list, or the two phrasings quoted side by side.
- **rule** — the codebase does something no audit skill watches, and the
  fix is a rule or guardrail added to whichever of the four owns that
  ground. Evidence: the surface (file, directory, dependency, rule,
  design decision)
  **and** the reason its absence would go unnoticed.
- **row** — the right skill watches it in prose but its registry has no
  row to measure it, so the watch depends on an agent remembering.
- **prune** — a rule that should go: contradicted by the code, made
  redundant by another rule, or aimed at a technology the repo no longer
  has. Every removal cites the evidence, the way a code-health finding
  cites `file:line`. **No evidence, no removal** — a rule that merely
  looks unused is not a finding, it is a rule that has not been needed
  yet.
- **new-skill** — a whole domain sits outside all four and does not
  belong to any of them. Planned like any session but blocked until the
  user validates it at execution time (see **Asking for a go**); the
  session states the proposed perimeter, registry and first dimensions.
- **tooling** — the detector misses a dimension the registry claims, or
  reports a false positive worth fixing.
- **Not findings**: wording preferences where no shared rule is at
  stake, symmetry for its own sake, a rule proposed without a codebase
  fact behind it ("we might one day use X"), or re-litigating a declared
  divergence whose rationale still holds.

## Modes

- `/audit-skill-health` — the standard run: measure + coverage + sweep +
  consolidate.
- `/audit-skill-health deep <skill|inventory>` — exhaustive pass over one
  audit skill (read it whole against its siblings) or one coverage
  inventory (every rule, every design decision, every subsystem, not just
  the orphans). Expensive; only on explicit request.
- `/audit-skill-health run [<session>]` — execute the next session of the
  active plan (or the named one). One session = one commit. A `needs-go`
  session asks for its go at execution time.
- `/audit-skill-health run all` — chain the plan's sessions in order, one
  commit each, through to the registry update, stopping only at a session
  that fails. A `needs-go` session does not end the chain: it asks its
  question when its turn comes.

## Standard run (`/audit-skill-health`)

1. **Read the registry.** If missing, bootstrap: seed the dimension list
   from this file's bar, measure initial baselines, ask the user before
   adding a dimension the registry never listed.

2. **Measure.** `npm run health:skills` — the shared skeleton (seven
   sections × five skills), the canonical sentences, and the three
   coverage inventories (CLAUDE.md imperative rules, the §14 design
   decisions of `docs/architecture.md`, `src/` subsystems) confronted
   with the family's skills **and registries**.
   Compare each reading to its baseline.

3. **Coverage.** Take the detector's orphan lists and judge them one by
   one — an orphan is where a hole is *found*, not proof of one. A rule
   no skill names may be genuinely covered under another name; say so
   and declare it. A rule that is neither named nor covered is a `rule`
   finding, and the session names which of the four should own it.

4. **Sweep.** What the inventories cannot name yet: read the repo's
   change since the last run (`git log` since the registry's own last
   commit) for a new technology, dependency, paradigm or convention, and ask the only
   question that matters — *if this broke or drifted, which audit run
   would notice?* No answer is a finding. Also re-read the four skills'
   diffs since the last run: a rule added to one is the most common
   source of new divergence.

5. **Judge.** Classify every finding `align`, `rule`, `row`, `prune`,
   `new-skill`, `tooling`, or `declared` (a divergence or non-target the
   user validates, recorded in the registry with its rationale). Route
   findings about the *app* to "Routed findings" — never into sessions.

6. **Consolidate into one plan.** Same mechanics as the sibling skills:
   re-verify the active plan's unexecuted sessions, write a new plan file
   merging survivors with this run's findings, fold the old one into it
   (final progress table into the new plan's "Superseded predecessors"
   section, then `git rm` — no bare `.md` that will never be executed may
   outlive its replacement), keep exactly one active plan. A surviving
   `needs-go` session stays `needs-go` — rewriting a plan is never a way
   to launder a missing go.
   Before writing the plan file, check the sibling registries' active
   plans and record in the session's Why any overlap with a session
   already in flight.

7. **Finish.** Update the registry (measurements, dates, declared
   divergences, pointer). Commit registry + plan together in a single
   `docs(skills): …` commit, touching nothing else. Summarize: what
   drifted, what's uncovered, what's planned, what's declared, routed
   findings, or "nothing to do".

## Deep audit (`/audit-skill-health deep <skill|inventory>`)

For a skill: read it end to end against its four siblings, section by
section, and judge every difference — shared rule or legitimate domain
wording. For an inventory: walk **every** entry, not the detector's
orphans, and name the audit skill that watches it; the entries nothing
watches, orphan or not, are the findings. Feeds step 6. Record the
reading in the row's Notes.

## Session execution (`/audit-skill-health run`)

Read the active plan, take the first unexecuted session (or the named
one). If it is marked `needs-go`, **ask the user before doing anything
else** (see **Asking for a go**). Each session is independently
executable; the documentation-only perimeter above binds. One session =
one commit (`docs(skills): …`, `chore(…)` for tooling). End by flipping
the session's status to `done ⟨date⟩ ⟨commit⟩` in the plan file (same
commit). If it was the last session, perform the registry-update session,
close the plan (see **Closing a plan**) and tell the user a fresh
`/audit-skill-health` should report "nothing to do".

A session that edits another skill carries one extra duty: check that
skill's **active plan** before committing. Changing the rules under a
plan mid-flight is how a session written last week becomes unexecutable
without anyone noticing — if the change invalidates a `todo` session
there, say so in the report and let the user decide.

## Chained execution (`/audit-skill-health run all`)

The same thing repeated: take the plan's sessions in table order and
execute them without asking between them — one commit and one status
flip per session, never a batched commit. A `needs-go` session does not
end the chain: when its turn comes it asks its own question (see
**Asking for a go**) and then proceeds on the answer. The chain stops,
cleanly and with a report of what landed, at the first of:

- a session that fails its acceptance — the detector reading did not
  improve, or the edit would have to reach outside the
  documentation-only perimeter;
- a session whose execution shows the plan's analysis is stale (the rule
  is already aligned, the surface already watched, the skill rewritten
  since): report it, never work around it;
- a finding about the app discovered en route: it is routed to the user,
  as ever, and the chain does not fix it;
- a session too large to start with what's left of the run: finish and
  commit the one in progress, then hand back.

Session size is what makes the chain legitimate — it is a convenience for
small `align` and `row` sessions, not a licence to batch. Every
per-session rule of the section above binds identically. If the chain
reaches the registry-update session, run it too, close the plan (see
**Closing a plan**) and tell the user a fresh `/audit-skill-health`
should now report "nothing to do".

## Asking for a go

A `needs-go` session — in practice a new audit skill — carries its own
question rather than delegating it to the user's next invocation. When
its turn comes — in `run` or in the middle of `run all` — put the
decision to the user *there*, and let the answer decide:

- **Ask before touching anything.** State what is being validated: the
  domain that sits outside all four, why it cannot simply become a rule
  inside one of them, and the proposed perimeter, registry and first
  dimensions. "The family should cover X" is not a question; "X is
  watched by none, does not belong to code-health because …, and would
  need its own registry with these three rows" is.
- **Approved** → flip the Status to `todo` and execute it like any other
  session, same perimeter, same commit.
- **Declined** → leave it `needs-go`, execute nothing for it, and **keep
  going** with the next session. A refusal is an answer about *that*
  session, not a stop signal for the plan. If the user's reason amounts
  to "this domain is not ours to watch", that is a declared non-target —
  record it in the registry with its rationale.
- **Never infer the go.** Silence, an ambiguous reply, or a plausible
  guess about what the user would want are all "not approved". A new
  skill is a standing cost on every future run of the family; it is
  exactly the kind of thing that must not appear by accident.

Consequence for the end of the run: a plan with a declined session is
**not finished**. Run the registry update for what did land, but leave
the active-plan pointer in place and do **not** rename the file
`.done.md` — the plan still has work in it. Say so in the report, and
name the session waiting on a decision.

## Closing a plan

A plan whose sessions have all been executed is renamed on the spot:
`docs/upgrade/skills.{YYYYMMDD-HHmm}.md` →
`docs/upgrade/skills.{YYYYMMDD-HHmm}.done.md`. The `.done` is the whole
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

`docs/upgrade/skills.{YYYYMMDD-HHmm}.md` while it still has unexecuted
sessions, `docs/upgrade/skills.{YYYYMMDD-HHmm}.done.md` once they are all
executed:

```markdown
# Audit-skill health plan — {date}

Produced by /audit-skill-health. Supersedes: {previous file or "none"}.
Detector snapshot: {dimension → measured vs baseline, one line per
regressed or newly-measured row}.

## Superseded predecessors

{Only when Supersedes ≠ "none": one subsection per folded plan — its
filename, its final "Execution order & progress" table (statuses,
commits), and one line on what was executed, carried or dropped.}

## Routed findings

Defects or gaps in the *app* noticed during the audit — NOT sessions of
this plan. Each goes to the user and/or the owning audit skill.

## Execution order & progress

One line = one session; update Status at the end of each session. Most
sessions enter as `todo`; `new-skill` ones enter as `needs-go` and ask
for that go when they execute (see **Asking for a go**).

| # | Session | Kind | Target | Scope | Status |
|---|---|---|---|---|---|
| 1 | …       | align / rule / row / prune / new-skill / tooling | … | … | todo / needs-go |
| n | Registry update | — | all | Tighten baselines in docs/registry/audit-skills-registry.md, clear active-plan pointer, close the plan. | todo |

## Sessions

### 1. {title}
- **Why**: {the drift or blind spot, with the detector reading or the
  quoted phrasings; for a `rule`, the surface and why its absence would
  go unnoticed}
- **Kind**: align | rule | row | prune | new-skill | tooling
- **Files**: {every file to touch — skills, registries, detector}
- **Change**: {precise enough to execute without re-deriving the
  analysis; for `align`, the exact sentence that must appear everywhere}
- **Acceptance**: {detector reading after; the edit stayed inside the
  documentation-only perimeter; no sibling skill's active plan
  invalidated}
```

`align` and `row` sessions are sized for one focused agent run.
`new-skill` sessions additionally state what the user is validating (the
domain and its proposed perimeter, not just "we need a skill") and enter
the table with Status `needs-go`. Write that "what" well: it is the raw
material of the question the session asks when it executes, and a vague
plan makes an unanswerable question.

## Guardrails

- **User-invoked only.** Never run any part of this skill uninvited.
- **Documentation-only.** This skill edits audit skills, their
  registries, its plan and its own detector. It never touches `src/` or
  `tests/`, and it never runs another audit skill.
- A `needs-go` session never executes without the user's explicit go —
  asked in place when the session comes up, never inferred, never batched
  into an earlier approval.
- **Never force similarity.** A shared rule must read identically; a
  domain-specific formulation must not be flattened into its neighbours'.
  When in doubt, declare the divergence rather than erase it — the
  registry is the place where "these two differ on purpose" is settled.
- Every finding cites evidence measured this run: a detector reading, a
  quoted pair of phrasings, or a path in the codebase. No findings from
  memory, and no rule added without a fact behind it.
- Never remove a rule without stating why it is dead — the same standard
  code-health holds for dead defensive code.
- Baselines never loosen silently; declared divergences and non-targets
  carry the user's validation and a rationale.
- English everywhere (repo rule 17); the plan and registry are part of
  the codebase.
