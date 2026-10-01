import { CATEGORIES } from '../audit/constants.js'
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
// language: label, message, why, fix. They are templates — `{name}` and the
// like are the finding's `params` — so that a consumer explaining a finding
// needs nothing but this file.

const REPORT_FORMAT = 'apiglow-audit-report'
const REPORT_VERSION = 1

// `results`: [{ id, source, passed, gates, report, fresh, omitted? }] — one per
// spec, as the CLI computes them; `omitted` counts what `--min-severity` and
// `--only-new` left out of the report's findings. `baseline`: whether a
// baseline was applied, which is when `newFindings` means something, and
// `stale` its entries no finding matched: [{ spec, ruleId, dataPath }].
export function toAuditJson(results, { passed, baseline, stale, tool }) {
  const fired = new Map()
  const specs = results.map(({ id, source, passed: specPassed, gates, report, fresh, omitted }) => {
    for (const category of report.categories) {
      for (const finding of category.findings) fired.set(finding.ruleId, finding)
    }
    return {
      id,
      source,
      passed: specPassed,
      gates,
      ...(baseline ? { newFindings: fresh.length } : {}),
      ...(omitted ? { omitted } : {}),
      report,
    }
  })
  const rules = Object.fromEntries(
    [...fired.keys()].sort().map((ruleId) => {
      const { category } = fired.get(ruleId)
      // Spelled out key by key: the i18n sweep reads a dynamic suffix as "any
      // key of this family may be used", and would then never flag a stale one.
      const label = t(`audit.rule.${ruleId}.label`)
      const message = t(`audit.rule.${ruleId}.message`)
      const why = t(`audit.rule.${ruleId}.why`)
      const fix = t(`audit.rule.${ruleId}.fix`)
      return [ruleId, { category, label, message, why, fix }]
    }),
  )
  const report = {
    format: REPORT_FORMAT,
    version: REPORT_VERSION,
    tool,
    passed,
    ...(baseline ? { staleBaseline: stale ?? [] } : {}),
    specs,
    rules,
  }
  return `${JSON.stringify(report, null, 2)}\n`
}

const RULES_FORMAT = 'apiglow-audit-rules'
const RULES_VERSION = 1

// The rule set as `apiglow audit --list-rules` prints it: every rule the
// command can report, with the same texts the report's `rules` carries for the
// ones that fired, its default severity and the options a configuration can
// set — what an agent reads to know the rules before any run, or to configure
// one. Versioned like the report, for the same reason.
export function toAuditRulesJson(rules, { tool }) {
  const list = {
    format: RULES_FORMAT,
    version: RULES_VERSION,
    tool,
    categories: CATEGORIES.map((id) => ({ id, label: t(`audit.category.${id}`) })),
    rules: rules.map((rule) => ({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
      label: t(`audit.rule.${rule.id}.label`),
      message: t(`audit.rule.${rule.id}.message`),
      why: t(`audit.rule.${rule.id}.why`),
      fix: t(`audit.rule.${rule.id}.fix`),
      ...(rule.options ? { options: rule.options } : {}),
    })),
  }
  return `${JSON.stringify(list, null, 2)}\n`
}
