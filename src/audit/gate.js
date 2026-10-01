import { GRADES, LOWEST_GRADE, SEVERITIES } from './constants.js'

// The checks `apiglow audit` turns into an exit status (docs/audit.md §8.2).
// Each is independent and reported on its own; the run fails when any of them
// does.

export const FAIL_ON = [...SEVERITIES, 'none']
export const GRADE_ORDER = [...GRADES.map(([grade]) => grade), LOWEST_GRADE]

// `findings`: what `failOn` counts — the whole report, or only the findings
// a baseline does not know. The grade and the score always read the whole
// report: they describe the document, and a baseline accepts findings, not a
// lower grade.
export function gateResults(report, { findings, failOn = 'error', minGrade, minScore }) {
  const results = []
  if (failOn !== 'none') {
    const count = atOrAbove(findings, failOn).length
    results.push({ gate: 'fail-on', threshold: failOn, actual: count, passed: count === 0 })
  }
  // A report with no scored category has nothing to grade, which is not a bad
  // grade: those two checks pass on it rather than fail on a missing value.
  if (minGrade) {
    const actual = report.grade
    const passed = !actual || GRADE_ORDER.indexOf(actual) <= GRADE_ORDER.indexOf(minGrade)
    results.push({ gate: 'min-grade', threshold: minGrade, actual, passed })
  }
  if (minScore !== undefined) {
    const actual = report.score
    results.push({
      gate: 'min-score',
      threshold: minScore,
      actual,
      passed: actual === null || actual >= minScore,
    })
  }
  return results
}

// The findings `--fail-on {severity}` counts.
export function atOrAbove(findings, severity) {
  const rank = SEVERITIES.indexOf(severity)
  return findings.filter((finding) => SEVERITIES.indexOf(finding.severity) <= rank)
}
