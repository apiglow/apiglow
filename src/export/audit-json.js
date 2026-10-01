import { t } from '../i18n/index.js'

// The JSON report of `apiglow audit` (docs/audit.md §8.1): the contract a
// script or an agent parses. Versioned, because it is one — a field renamed
// under a consumer breaks it silently — so `format` and `version` say which
// shape this is, and a change of shape bumps `version`.
//
// Each finding gains a `fingerprint`: the baseline's identity (spec, rule,
// JSON pointer, and the occurrence among findings sharing those three), so a
// finding keeps its id across runs while the document around it changes. The
// hash is injected — `node:crypto` in the CLI — to keep this generator pure.
//
// `rules` carries, once, the texts of every rule that fired, in the report's
// language: label, why, fix. They are templates — `{name}` and the like are the
// finding's `params` — so that a consumer explaining a finding needs nothing
// but this file.

export const REPORT_FORMAT = 'apiglow-audit-report'
export const REPORT_VERSION = 1

// `results`: [{ id, source, passed, gates, report, fresh }] — one per spec, as
// the CLI computes them. `baseline`: whether a baseline was applied, which is
// when `newFindings` means something.
export function toAuditJson(results, { passed, baseline, tool, fingerprintOf }) {
  const fired = new Map()
  const specs = results.map(({ id, source, passed: specPassed, gates, report, fresh }) => {
    const seen = new Map()
    const categories = report.categories.map((category) => ({
      ...category,
      findings: category.findings.map((finding) => {
        fired.set(finding.ruleId, finding)
        const identity = [id, finding.ruleId, finding.dataPath].join('\u0000')
        const occurrence = seen.get(identity) ?? 0
        seen.set(identity, occurrence + 1)
        return { ...finding, fingerprint: fingerprintOf(`${identity}\u0000${occurrence}`) }
      }),
    }))
    return {
      id,
      source,
      passed: specPassed,
      gates,
      ...(baseline ? { newFindings: fresh.length } : {}),
      report: { ...report, categories },
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
