// Report vocabulary and scoring constants (docs/audit.md §3), in one place:
// the engine, the UI and the Markdown export must never disagree on a
// category name or on where a grade boundary sits.

// Declaration order = display order of the report.
export const CATEGORIES = [
  'correctness',
  'security',
  'completeness',
  'deprecation',
  'consistency',
  'readiness',
  'agent',
]

// Severity order, most severe first: sorting inside a category, and the order
// counts are displayed in.
export const SEVERITIES = ['error', 'warning', 'info']

// Weight of one check in its category's score. An error weighs three times an
// info: passing a pile of cosmetic checks must not compensate a schema bug.
export const SEVERITY_WEIGHT = { error: 3, warning: 2, info: 1 }

// The credit of a check standing for several items — a schema's properties,
// an enum's values, an operation's inputs — `failing` of them `of` wrong: in
// between failing the whole unit on one item and counting every item alone,
// and degressive — the first wrong item costs the most, each next one less.
// One of fifteen costs a quarter of the check, five a little over a half, ten
// four-fifths, all fifteen the whole of it.
export function shareCredit(failing, of) {
  return of > 0 ? 1 - Math.sqrt(Math.min(failing, of) / of) : 1
}

// Aggregate letter, from the mean of the scored categories. First threshold
// reached wins; below all of them, LOWEST_GRADE.
export const GRADES = [
  ['A', 90],
  ['B', 80],
  ['C', 65],
  ['D', 50],
]
export const LOWEST_GRADE = 'F'

// Here rather than in the engine: the page colors a category by its grade, and
// the page is in the app bundle while the engine loads with the audit
// (docs/architecture.md §14.8).
export function gradeFor(score) {
  for (const [grade, threshold] of GRADES) if (score >= threshold) return grade
  return LOWEST_GRADE
}
