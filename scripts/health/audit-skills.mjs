// Coherence of the audit-skill family, and what it does not watch.
//
// Owned by `/audit-skill-health`, not by `/code-health` — which is why it is
// deliberately absent from the `npm run health` aggregate: that aggregate is
// code-health's contract, and a run of it must not measure a dimension
// another skill owns.
//
// Three questions, all mechanical. Is the shared skeleton still shared (same
// sections, same canonical sentences, byte-identical once whitespace is
// collapsed — plus: no sentence shared by most of the family that the
// canonical list does not yet hold)? Is the plan/registry machinery sound
// (pointers resolve, no orphan plan, status vocabulary valid)? And is
// anything the repo declares — an imperative rule, a §14 design decision, a
// src/ subsystem — watched by no audit skill at all? An orphan there is not proof of a hole,
// but it is where holes are found: the skill's reading sweep starts from
// this list.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { headline, read, root, section } from './lib.mjs'

const SKILLS = ['spec-sync', 'app-health', 'code-health', 'upgrade-code', 'audit-skill-health']

// Coverage is answered by the family as a whole, and most of it lives in the
// registries rather than in the skill files: `app-health` does not name rule
// 13 anywhere, its registry has a row for it. Reading only the SKILL.md files
// would report a dozen phantom holes.
//
// `audit-skills-registry.md` is pointedly absent: it is where *gaps* are
// written down, so counting it as coverage would make every recorded finding
// erase itself the moment it was recorded.
const REGISTRIES = [
  'docs/registry/specs-registry.md',
  'docs/registry/app-health-registry.md',
  'docs/registry/code-health-registry.md',
  'docs/registry/stack-registry.md',
]

// Headings every audit skill carries. Prefix match: each skill is free to
// qualify its own ("## Idempotence contract (the definition of done)").
const SECTIONS = [
  '## Idempotence contract',
  '## Session execution',
  '## Chained execution',
  '## Asking for a go',
  '## Closing a plan',
  '## Plan file format',
  '## Guardrails',
]

// Sentences that carry a shared rule and must therefore read identically
// everywhere. Divergence here is the failure mode this detector exists for:
// four files drifting into four ways of saying one thing.
//
// A string entry binds all five skills. An `{ phrase, among }` entry binds a
// declared subset — the registry's "Declared divergences" section is where
// the subset is justified (e.g. upgrade-code has no deep mode, so the
// deep-mode sentence binds only the other four). Where a shared rule ends in
// domain-specific tails ("execute it like any other session, ratchet
// requirement included" / "…, same contract, same commit"), the entry is the
// shared prefix and the tail is free.
const CANONICAL = [
  // registry & idempotence
  'every run starts by reading it and ends by updating it',
  'A run must end in exactly one of two states:',
  'no active plan left with unexecuted sessions (`todo` **or** `needs-go`)',
  'A nothing-to-do run leaves the registry exactly as it found it.',
  'No third bucket',
  'Corollary: once all sessions of the active plan are executed, re-invoking',
  'The final session of every plan is',
  // consolidation
  'A surviving `needs-go` session stays `needs-go` — rewriting a plan is never a way to launder a missing go.',
  "merging survivors with this run's findings",
  "Before writing the plan file, check the sibling registries' active plans and record in the session's Why any overlap with a session already in flight.",
  // session execution
  'take the first unexecuted session (or the named one)',
  'If it is marked `needs-go`, **ask the user before doing anything else** (see **Asking for a go**).',
  "End by flipping the session's status to `done ⟨date⟩ ⟨commit⟩` in the plan file (untracked, so no commit carries it).",
  'perform the registry-update session, close the plan (see **Closing a plan**) and tell the user a fresh',
  // chained execution
  'A `needs-go` session asks for its go at execution time.',
  'A `needs-go` session does not end the chain: it asks its question when its turn comes.',
  'A `needs-go` session does not end the chain: when its turn comes it asks its own question (see **Asking for a go**) and then proceeds on the answer.',
  "The same thing repeated: take the plan's sessions in table order",
  'execute them without asking between them — one commit and one status flip per session, never a batched commit',
  'The chain stops, cleanly and with a report of what landed, at the first of:',
  "a session too large to start with what's left of the run: finish and commit the one in progress, then hand back.",
  'Session size is what makes the chain legitimate — it is a convenience for',
  'not a licence to batch',
  'Every per-session rule of the section above binds identically',
  'If the chain reaches the registry-update session, run it too, close the plan (see **Closing a plan**) and tell the user a fresh',
  // asking for a go
  'When its turn comes — in `run` or in the middle of `run all` — put the decision to the user *there*, and let the answer decide:',
  '**Ask before touching anything.** State what is being validated:',
  '**Approved** → flip the Status to `todo` and execute it like any other session',
  '**Declined** → leave it `needs-go`, execute nothing for it, and **keep going** with the next session.',
  'A refusal is an answer about *that*',
  '**Never infer the go.**',
  'asked in place when the session comes up, never inferred, never batched into an earlier approval',
  'Consequence for the end of the run: a plan with a declined session is **not finished**. Run the registry update for what did land, but leave the active-plan pointer in place and do **not** rename the file `.done.md` — the plan still has work in it. Say so in the report, and name the session waiting on a decision.',
  // closing a plan
  'A plan whose sessions have all been executed is renamed on the spot:',
  'The `.done` is the whole point — `ls docs/upgrade/` then says at a glance which plans are behind you and which one is live, without opening a single file.',
  'Mechanics, at registry-update time:',
  'rename with a plain `mv` — `docs/upgrade/` is gitignored (plans never enter a commit, CONTRIBUTING.md doctrine), so no git history follows the file and none is expected;',
  "fix every reference to the old name — the registry's active-plan pointer (which goes back to `none`) and any prose in it that cites the plan by filename, plus cross-references from the sibling skills' registries and plans;",
  'a **superseded** plan is never renamed `.done.md`: it did not finish, it was replaced — and it was folded into its successor\'s "Superseded predecessors" section at supersede time, so no file of it remains. `.done.md` means *executed*, not merely closed.',
  // plan file format & guardrails
  'One line = one session; update Status at the end of each session.',
  '**User-invoked only.** Never run any part of this skill uninvited',
  'English everywhere (repo rule 17); the registry is tracked documentation, and the untracked plan is written to the same standard.',
  // plans live in gitignored docs/upgrade/ — the registry is the only
  // tracked artifact of a run (CONTRIBUTING.md doctrine)
  'the plan is untracked and enters no commit.',
  // deep mode — upgrade-code has none by declared divergence ("a scoped run
  // *is* the deep audit of that scope")
  {
    phrase: 'Expensive; only on explicit request.',
    among: ['spec-sync', 'app-health', 'code-health', 'audit-skill-health'],
  },
]

const skillText = Object.fromEntries(SKILLS.map((s) => [s, read(`.claude/skills/${s}/SKILL.md`)]))
const flat = Object.fromEntries(
  Object.entries(skillText).map(([s, t]) => [s, t.replace(/\s+/g, ' ')]),
)
const corpus = [
  ...Object.values(flat),
  ...REGISTRIES.filter((f) => existsSync(join(root, f))).map((f) => read(f)),
].join('\n')

// --- 1. shared skeleton -----------------------------------------------------

const missingSections = []
for (const heading of SECTIONS) {
  for (const s of SKILLS) {
    const has = skillText[s].split('\n').some((l) => l.startsWith(heading))
    if (!has) missingSections.push(`${s} — ${heading}`)
  }
}
headline(
  'audit skills, shared sections',
  `${SECTIONS.length * SKILLS.length - missingSections.length}/${SECTIONS.length * SKILLS.length}`,
  `(${SECTIONS.length} sections × ${SKILLS.length} skills)`,
)
section('missing', missingSections)

// --- 2. canonical sentences -------------------------------------------------

const phrases = CANONICAL.map((c) => (typeof c === 'string' ? { phrase: c, among: SKILLS } : c))
const divergent = []
for (const { phrase, among } of phrases) {
  const absent = among.filter((s) => !flat[s].includes(phrase))
  // A sentence carried by none is a stale detector entry, not skill drift;
  // one carried by all but a few is the drift worth reporting.
  if (absent.length && absent.length < among.length) {
    divergent.push(`${absent.join(', ')} — "${phrase.slice(0, 60)}…"`)
  } else if (absent.length === among.length) {
    divergent.push(`ALL (stale entry?) — "${phrase.slice(0, 60)}…"`)
  }
}
headline(
  'canonical sentences',
  `${CANONICAL.length - divergent.length}/${CANONICAL.length}`,
  'identical across the family',
)
section('divergent', divergent)

// --- 3. emergent shared sentences -------------------------------------------
// A rule added to four of the five skills is the most common source of new
// divergence, and the canonical list only holds the sentences it was told
// about. So invert the question: any sentence-sized unit shared verbatim by
// four or more skills that no canonical phrase covers is either a rule that
// belongs in CANONICAL or a coincidence worth a look. Zero is the baseline.

const unitSkills = new Map()
for (const s of SKILLS) {
  // Headings out before flattening, or "## Closing a plan" fuses with the
  // sentence that follows it and produces units no canonical phrase can cover.
  const units = skillText[s]
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;:]) /)
    .map((u) => u.replace(/^[-*] /, '').trim())
    .filter((u) => u.length > 40)
  for (const u of new Set(units)) {
    if (!unitSkills.has(u)) unitSkills.set(u, [])
    unitSkills.get(u).push(s)
  }
}
const emergent = []
for (const [unit, carriers] of unitSkills) {
  if (carriers.length < 4) continue
  const covered = phrases.some(({ phrase }) => unit.includes(phrase) || phrase.includes(unit))
  if (!covered) emergent.push(`${carriers.length}/5 — "${unit.slice(0, 80)}…"`)
}
headline('emergent shared sentences not in CANONICAL', emergent.length, '(target 0)')
section('emergent', emergent)

// --- 4. plan & pointer lint -------------------------------------------------
// The mechanics every skill promises: the registry's Active-plan pointer
// resolves to a real, still-open plan; every file in docs/upgrade/ is either
// done, superseded, or the one a registry points at; an active plan's status
// column keeps to the shared vocabulary and ends on the registry-update
// session.

const POINTER_REGISTRIES = [...REGISTRIES, 'docs/registry/audit-skills-registry.md']
const lintProblems = []
const pointedPlans = new Set()
for (const reg of POINTER_REGISTRIES) {
  const line = read(reg)
    .split('\n')
    .find((l) => l.startsWith('**Active plan**:'))
  if (!line) {
    lintProblems.push(`${reg} — no "**Active plan**:" line`)
    continue
  }
  const value = line.slice('**Active plan**:'.length).trim().replace(/`/g, '')
  if (value === 'none') continue
  if (!/^docs\/upgrade\/[\w.-]+\.md$/.test(value)) {
    lintProblems.push(
      `${reg} — unparseable pointer "${value}" (expected "none" or a docs/upgrade/ path)`,
    )
    continue
  }
  if (value.endsWith('.done.md')) lintProblems.push(`${reg} — points at a closed plan: ${value}`)
  else if (!existsSync(join(root, value)))
    lintProblems.push(`${reg} — points at a missing file: ${value}`)
  else pointedPlans.add(value)
}

// docs/upgrade/ is untracked run-artifact space and may not exist on a fresh
// clone; an absent directory simply has no plans to lint.
const upgradeDir = join(root, 'docs/upgrade')
for (const name of (existsSync(upgradeDir) ? readdirSync(upgradeDir) : []).sort()) {
  if (!name.endsWith('.md')) continue
  const rel = `docs/upgrade/${name}`
  if (name.endsWith('.done.md') || pointedPlans.has(rel)) continue
  if (!read(rel).includes('Superseded by')) {
    lintProblems.push(`${rel} — neither .done, nor superseded, nor pointed at by any registry`)
  }
}

for (const rel of pointedPlans) {
  const lines = read(rel).split('\n')
  const rows = lines.filter((l) => /^\|\s*\d+\s*\|/.test(l))
  if (!rows.length) {
    lintProblems.push(`${rel} — no session rows found in the progress table`)
    continue
  }
  for (const row of rows) {
    const status = row.split('|').at(-2).trim()
    if (!/^(todo|needs-go|done\b.*|declared\b.*)$/.test(status)) {
      lintProblems.push(`${rel} — status "${status}" outside the shared vocabulary`)
    }
  }
  if (!rows.at(-1).includes('Registry update')) {
    lintProblems.push(`${rel} — final session is not "Registry update"`)
  }
}
headline('plan & pointer lint', lintProblems.length, 'problems')
section('problems', lintProblems)

// --- 5. what no audit skill names -------------------------------------------

const claudeMd = read('CLAUDE.md')
const ruleNumbers = [...claudeMd.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]))
// A row often guards several rules at once, and grouping them is the natural
// way to write it: "rules 6/7/19", "rules 4/8", "rules 1, 7 and 8". Asking
// `\brules?\s+N\b` per rule reads only the first number of such a run and
// stops — which under-reports exactly the best-guarded rules. So collect every
// number of every citation run instead, and ask set membership.
const watchedRules = new Set()
for (const [, run] of corpus.matchAll(/\brules?\s+(\d+(?:\s*(?:[/,]|and)\s*\d+)*)/gi)) {
  for (const n of run.match(/\d+/g)) watchedRules.add(Number(n))
}
const unwatchedRules = ruleNumbers.filter((n) => !watchedRules.has(n))
headline(
  'CLAUDE.md rules watched by no audit skill',
  unwatchedRules.length,
  `of ${ruleNumbers.length}`,
)
section(
  'unwatched',
  unwatchedRules.map((n) => {
    // Rule titles can wrap before their closing `**` (rule 20 does).
    const m = claudeMd.match(new RegExp(`^${n}\\. \\*\\*([\\s\\S]+?)\\*\\*`, 'm'))
    return `rule ${n} — ${m ? m[1].replace(/\s+/g, ' ') : '?'}`
  }),
)

// Design decisions live as the §14 subsections of docs/architecture.md; a
// watch cites one as "§14.N" (with or without a space).
const rationale = [...read('docs/architecture.md').matchAll(/^### (14\.\d+) (.+)$/gm)].map((m) => ({
  n: m[1],
  title: m[2],
}))
const unnamedRationale = rationale.filter(
  ({ n }) => !new RegExp(`§\\s?${n.replace('.', '\\.')}(?!\\d)`).test(corpus),
)
headline(
  'architecture.md §14 decisions watched by no audit skill',
  unnamedRationale.length,
  `of ${rationale.length}`,
)
section(
  'unnamed',
  unnamedRationale.map(({ n, title }) => `§${n} — ${title}`),
)

const subsystems = readdirSync(join(root, 'src')).filter((d) =>
  statSync(join(root, 'src', d)).isDirectory(),
)
const unnamedSubsystems = subsystems.filter(
  (d) => !new RegExp(`\\bsrc/${d}\\b`).test(corpus) && !corpus.includes(`\`${d}/\``),
)
headline(
  'src/ subsystems watched by no audit skill',
  unnamedSubsystems.length,
  `of ${subsystems.length}`,
)
section(
  'unnamed',
  unnamedSubsystems.map((d) => `src/${d}/`),
)
