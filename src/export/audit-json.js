import { t } from '../i18n/index.js'

// The JSON report of `apiglow audit` (docs/audit.md §8.1): the contract a
// script or an agent parses. Versioned, because it is one — a field renamed
// under a consumer breaks it silently — so `format` and `version` say which
// shape this is, and a change of shape bumps `version`.
//
// Each finding carries the `fingerprint` the CLI gave it (`fingerprinted` in
// src/audit/baseline.js).
//
// `rules` carries, once, the texts of every rule that fired, in the report's
// language: label, why, fix. They are templates — `{name}` and the like are the
// finding's `params` — so that a consumer explaining a finding needs nothing
// but this file.

const REPORT_FORMAT = 'apiglow-audit-report'
const REPORT_VERSION = 1

// `results`: [{ id, source, passed, gates, report, fresh }] — one per spec, as
// the CLI computes them. `baseline`: whether a baseline was applied, which is
// when `newFindings` means something.
export function toAuditJson(results, { passed, baseline, tool }) {
  const fired = new Map()
  const specs = results.map(({ id, source, passed: specPassed, gates, report, fresh }) => {
    for (const category of report.categories) {
      for (const finding of category.findings) fired.set(finding.ruleId, finding)
    }
    return {
      id,
      source,
      passed: specPassed,
      gates,
      ...(baseline ? { newFindings: fresh.length } : {}),
      report,
    }
  })
  const rules = Object.fromEntries(
    [...fired.keys()].sort().map((ruleId) => {
      const { category } = fired.get(ruleId)
      // Spelled out key by key: the i18n sweep reads a dynamic suffix as "any
      // key of this family may be used", and would then never flag a stale one.
      const label = t(`audit.rule.${ruleId}.label`)
      const why = t(`audit.rule.${ruleId}.why`)
      const fix = t(`audit.rule.${ruleId}.fix`)
      return [ruleId, { category, label, why, fix }]
    }),
  )
  const report = { format: REPORT_FORMAT, version: REPORT_VERSION, tool, passed, specs, rules }
  return `${JSON.stringify(report, null, 2)}\n`
}
