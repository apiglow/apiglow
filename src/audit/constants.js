// Report vocabulary and scoring constants (docs/audit.md §3), in one place:
// the engine, the UI and the Markdown export must never disagree on a
// category name or on where a grade boundary sits.

// Declaration order = display order of the report.
export const CATEGORIES = ['correctness', 'completeness', 'deprecation', 'consistency', 'readiness']

// Severity order, most severe first: sorting inside a category, and the order
// counts are displayed in.
export const SEVERITIES = ['error', 'warning', 'info']

// Weight of one check in its category's score. An error weighs three times an
// info: passing a pile of cosmetic checks must not compensate a schema bug.
export const SEVERITY_WEIGHT = { error: 3, warning: 2, info: 1 }

// Aggregate letter, from the mean of the scored categories. First threshold
// reached wins; below all of them, LOWEST_GRADE.
export const GRADES = [
  ['A', 90],
  ['B', 80],
  ['C', 65],
  ['D', 50],
]
export const LOWEST_GRADE = 'F'
