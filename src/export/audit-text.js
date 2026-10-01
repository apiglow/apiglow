import { t } from '../i18n/index.js'
import { identityLines, scopeLines, severityLine } from './audit-markdown.js'

// The audit report as `apiglow audit` prints it in a terminal or a CI log
// (docs/audit.md §8). Folded by rule like the page rather than listed like the
// Markdown export: the same omission repeated over a large schema is one
// decision, so its rationale is printed once, above its occurrences, and a
// log of two thousand findings stays two thousand lines rather than six.
// Resolved through `t()` for the same reason as the Markdown export: every
// message and every rationale exists only as an i18n string.
export function toAuditText(report) {
  const title = report.api.title
  const lines = [`${t('audit.title')}${title ? ` — ${title}` : ''}`]
  lines.push(
    [
      report.grade ? t('audit.gradeOf', { grade: report.grade }) : null,
      report.score === null ? null : t('audit.score', { score: report.score }),
      report.api.version && t('audit.api.version', { version: report.api.version }),
      report.openapi && `OpenAPI ${report.openapi}`,
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    ...identityLines(report),
    ...scopeLines(report),
    severityLine(report.counts) || t('audit.noFinding'),
    '',
  )

  for (const category of report.categories) {
    const counts = severityLine(category.counts)
    lines.push(
      `  ${t('audit.scoreOf', { category: t(`audit.category.${category.id}`), score: category.score })}${counts ? ` — ${counts}` : ''}`,
    )
  }

  if (!report.counts.total) {
    lines.push('', `${t('audit.empty.title')} ${t('audit.empty.hint')}`)
    return `${lines.join('\n')}\n`
  }

  for (const category of report.categories) {
    if (!category.findings.length) continue
    lines.push('', `${t(`audit.category.${category.id}`)} — ${category.score} %`)
    for (const group of byRule(category.findings)) {
      const [first] = group
      lines.push(
        '',
        `  ${t(`audit.severity.${first.severity}`)} · ${t(`audit.rule.${first.ruleId}.label`)} (${group.length}) [${first.ruleId}]`,
        // The rationale with the first occurrence's values, as the page shows
        // it: hoisted to the group, stated once.
        `    ${t('audit.why')}: ${t(`audit.rule.${first.ruleId}.why`, first.params)}`,
        `    ${t('audit.howToFix')} ${t(`audit.rule.${first.ruleId}.fix`, first.params)}`,
      )
      for (const finding of group) lines.push(...occurrenceLines(finding))
    }
  }
  return `${lines.join('\n')}\n`
}

// The engine sorts a category's findings by severity, then rule: one rule's
// occurrences are already contiguous.
function byRule(findings) {
  const groups = []
  for (const finding of findings) {
    const last = groups.at(-1)
    if (last?.[0].ruleId === finding.ruleId) last.push(finding)
    else groups.push([finding])
  }
  return groups
}

// Where, then what: the JSON pointer is what locates the finding in the file
// the reader is about to edit, and there is no app to link into from a log.
function occurrenceLines(finding) {
  const where = [
    finding.location,
    finding.hidden ? `(${t('audit.hidden')})` : null,
    finding.dataPath,
  ]
    .filter(Boolean)
    .join(' · ')
  return [
    `    - ${t(`audit.rule.${finding.ruleId}.message`, finding.params)}`,
    ...(where ? [`      ${where}`] : []),
  ]
}
