# Audit-skill registry — coherence and coverage of the audit family

Maintained by the `/audit-skill-health` skill
(`.claude/skills/audit-skill-health/SKILL.md`). One row per coherence
dimension and per coverage inventory. Every run re-measures each row and
compares to `Baseline`; above baseline = drift or a new blind spot = a
plan session. Baselines only tighten through actual work — never loosen
silently (a declared divergence carries the user's validation and a
rationale).

The family is five skills: `spec-sync`, `app-health`, `code-health`,
`upgrade-code`, and `audit-skill-health` itself. Vendored skills
(`daisyui`) and non-audit skills are out of perimeter.

Detector: `npm run health:skills`
(`scripts/health/audit-skills.mjs`). Deliberately **not** part of
`npm run health` — that aggregate is code-health's contract, and a run of
it must not measure a dimension another skill owns.

**Active plan**: `docs/upgrade/skills.20260814-1608.md`

| Dimension | Detector | Baseline | Severity |
|---|---|---|---|
| Shared sections | `npm run health:skills` | **35/35** — 7 sections × 5 skills | none — hold it |
| Canonical sentences | `npm run health:skills` | **44/44** identical across the family (whitespace-normalized). The list holds the whole shared skeleton, and an entry may bind a declared subset (`among`) when a divergence below justifies it | none — hold it |
| Emergent shared sentences | `npm run health:skills` | **0** — no sentence-sized unit shared verbatim by ≥4 skills sits outside CANONICAL. This is what catches a rule added to four of five, the most common source of new divergence | none — hold it at 0 |
| Plan & pointer lint | `npm run health:skills` | **0 problems** — every registry's Active-plan pointer resolves (`none` or a real, still-open plan), `docs/upgrade/` holds no orphan, active plans keep the status vocabulary and end on the registry-update session. Replaces the manual "Sibling active plans" row for *state*; whether an edit invalidates a session in flight stays the run's judgment | none — hold it at 0 |
| Coverage — CLAUDE.md rules | `npm run health:skills` | **0** of 20 | none — hold it at 0 |
| Coverage — design decisions (architecture.md §14) | `npm run health:skills` | **{§14.3, §14.4, §14.5, §14.6, §14.7, §14.8, §14.10, §14.13, §14.14}** — 9 of 15, stored as a set, not a count: a swap (one declared entry leaving while a new unwatched one arrives) keeps the count at 9 and must still read as drift. All nine watched through the rule or row that implements them, declared non-targets below. A **new** entry appearing here is a finding until triaged | none at this set — any change to it is a finding |
| Coverage — `src/` subsystems | `npm run health:skills` | **0** of 13 | none — hold it at 0 |
| New tech / paradigms | manual sweep | surfaces outside `src/` confronted with the family — `demo/`, `scripts/`, `.github/workflows/`, `dist/`, `docs/`, `tests/` all named by at least one skill or registry | none — the next sweep reads `git log` since the registry's last commit |

## What the detector measures, and what it cannot

The three coverage rows confront the repo's own inventories with the
family's **skills and the four domain registries** — most coverage lives
in a registry row, not in the skill's prose, so reading only the
`SKILL.md` files reports phantom holes.

**This registry is excluded from that corpus**, and must stay excluded:
it is where gaps are written down, so counting it as coverage would make
every finding erase itself the moment it was recorded. A rule this file
names as *unwatched* must not come out watched for having been named
here.

A name is not a guarantee: the detector answers "is this named
anywhere?", never "is it watched *well*". A rule named once in passing
counts as watched here and may still be a gap — that judgment is the
run's step 3, and `deep` mode is where it is done exhaustively.

## Recorded findings (unplanned — every run must plan or declare each)

*No unplanned findings.*

## Declared divergences and non-targets

Differences between skills that are deliberate, and inventory entries
the family is not meant to watch — with the user's validation and a
rationale; re-checked each run that the rationale still holds.

### Divergences between skills

- **upgrade-code has no deep mode**: a scoped run
  (`app`, `build`, `platform`) *is* the deep audit of that scope, as its
  own prose states. The deep-mode canonical sentence therefore binds
  only the other four, via the detector's `among` scoping. Reopens if
  upgrade-code ever gains a standard run shallow enough to need a
  separate deep mode.
- **Evidence discipline is phrased per domain**:
  app-health cites file:line gathered this run, code-health file:line
  measured this run, spec-sync and upgrade-code cite URLs/sources
  fetched this run, audit-skill-health cites detector readings or quoted
  phrasings. The shared substance — no findings from memory, evidence
  from *this* run — is domain-typed on purpose; flattening it would blur
  what counts as evidence where. Reopens if a skill starts accepting
  evidence its own wording excludes.
- **Each skill's `needs-go` trigger differs**:
  `code-health` a structural split, `upgrade-code` a major bump,
  `spec-sync` waiving instead of supporting or widening scope,
  `app-health` a guard with a lasting cost or a path left unguarded,
  `audit-skill-health` a new audit skill. What is shared is the
  *mechanism* — the session asks, a refusal does not stop the chain —
  and the detector holds that. What triggers it is domain knowledge and
  flattening it would make all five vaguer. Reopens if two skills ever
  claim the same trigger.
- **Stop conditions of `run all` differ**: a moved
  snapshot stops `code-health` and means nothing in `spec-sync`; an
  unexplained changelog diff stops `upgrade-code` alone; "never weaken a
  guard to pass" is `app-health`'s. Only the *shape* is shared — a
  bulleted list ending in "a session too large … then hand back".
- **Each registry has its own object**: formats,
  critical paths, debt dimensions, pinned versions, coherence
  dimensions. The pointer, the `Active plan` line and the closing
  session are shared; the rows are not, and never should be.

### Non-targets

- **Nine §14 design decisions watched through their implementing rule or
  row**: §14.3 (normalized model) → rule 6; §14.4 (storage split) →
  rules 4/8; §14.5 (history retention) → the app-health history row;
  §14.6 (Arazzo alignment) → the spec-sync Arazzo row; §14.7 (lazy
  i18n) → rule 9; §14.8 (single-file bundle) → app-health invariant 8
  and the `upgrade-code` vite ritual; §14.10 (declarative scenarios),
  §14.13 (audit reads the raw document) and §14.14 (in-house swagger2
  converter) → their app-health critical-path rows (scenarios, audit
  engine, Swagger 2.0). A §14 entry records *why* a decision was taken;
  the standing watch belongs on the rule or row that implements it, and
  duplicating it into the entry's name buys nothing. Reopens per entry
  if its implementing rule or row is ever removed.
  The row itself stays: a **new** §14 entry will surface here and must
  be triaged the same way — "who watches this decision?" is the
  question worth re-asking each time, even when the answer is usually
  "the rule it created".
- **§14.19 (a workflow is published, never re-authored) watched through
  its implementing rows**: the specs-registry Arazzo row names the whole
  hand-off surface — export (`src/export/arazzo.js`), import
  (`src/import/arazzo.js`) and the CI hand-off (`src/export/ci.js`,
  `CI_RUNNERS`) — and app-health's scenarios and export rows guard the
  behavior. The out-bound boundary (reader scenarios never reach a
  generated file) is structural: the bake cannot open IndexedDB.
  Validation: delegated by the user to the run's judgment. Reopens if
  the Arazzo row stops naming import, export or the CI hand-off.
- **§14.20 (staged boot pipeline) watched through the perf-budgets row
  and invariant 9**: app-health's performance-budgets row (rule 14)
  holds the boot budget, measured in-page, over the pipeline's hot
  code; un-staging the loader fails it on a heavy document. The one
  structural exception the entry creates — `src/boot-prefetch.js` reads
  the host config — is named by `scripts/check-invariants.mjs`
  (`HOST_CONFIG_READERS`), so invariant 9 (rule 10) already knows it.
  Validation: delegated by the user to the run's judgment. Reopens if
  the boot budget or invariant 9 disappears, or if a staged surface
  gains no budget covering it.
- **Markdown documentation pages — not a target**: `docs-pages/` is demo
  markdown shown in dev and on the two demo pages; no host contract
  rests on it today, so the family owes it no critical-path row of its
  own. The *feature* is guarded anyway inside the routing row —
  `navigation.spec.js:17,65,94,108`, `bootstrap.spec.js:122,136`,
  `specs.test.js:241-274`. Its one uncovered branch is the failed-fetch
  alert (`md-page.js:50-61`). Reopens if hosts start shipping their own
  pages, which turns `docsPages` into a published contract.

<!-- Template:
- **{skill A} vs {skill B} — {what differs}**: {why the difference
  serves comprehension; what would reopen it}.
- **{inventory entry} — not a target**: {why nothing in the family
  should watch it}.
-->
