import { t } from '../i18n/index.js'

// Markdown of the schema audit report (docs/audit.md §5): the shape an author
// pastes into a ticket, a PR description or a commit message. Function of the
// report the engine returns and of the active language, nothing else — tested
// by snapshot like the other generators.
//
// One deliberate difference with them: this one is NOT English-only. The other
// exports carry requests and schemas, whose labels are structural; here the
// substance — every message and every rationale — exists only as an i18n
// string, so the report travels in the language it was read in. No redaction
// path either: a report names schema constructs, never a value the user typed.

// `at` is the moment the report is handed over, injected rather than read here:
// the generator stays a pure function of its arguments, which is what makes it
// snapshot-testable like the others.
export function toAuditMarkdown(report, { at = new Date() } = {}) {
  const title = report.api.title
  const lines = [`# ${t('audit.title')}${title ? ` — ${title}` : ''}`, '']

  const grade = [
    report.grade ? `**${t('audit.gradeOf', { grade: report.grade })}**` : null,
    report.score === null ? null : t('audit.score', { score: report.score }),
  ]
    .filter(Boolean)
    .join(' — ')
  lines.push(
    [
      grade,
      report.api.version && t('audit.api.version', { version: report.api.version }),
      report.openapi && `OpenAPI ${report.openapi}`,
    ]
      .filter(Boolean)
      .join(' · '),
    // A pasted report outlives the schema it graded: without a date, a reader
    // finding it in a ticket cannot tell whether it still describes anything.
    t('audit.generatedAt', { timestamp: formatTimestamp(at) }),
    '',
  )

  lines.push(...identityLines(report), ...scopeLines(report))

  const counts = severityLine(report.counts)
  lines.push(counts || t('audit.noFinding'), '')

  for (const category of report.categories) {
    const scored = t('audit.scoreOf', {
      category: t(`audit.category.${category.id}`),
      score: category.score,
    })
    const categoryCounts = severityLine(category.counts)
    lines.push(`- ${scored}${categoryCounts ? ` — ${categoryCounts}` : ''}`)
  }

  if (!report.counts.total) {
    lines.push('', `> ${t('audit.empty.title')} ${t('audit.empty.hint')}`)
    return `${lines.join('\n')}\n`
  }

  for (const category of report.categories) {
    if (!category.findings.length) continue
    const heading = [
      `${t(`audit.category.${category.id}`)} — ${category.score} %`,
      severityLine(category.counts),
    ]
      .filter(Boolean)
      .join(' · ')
    lines.push('', `## ${heading}`, '')
    for (const finding of category.findings) lines.push(...findingLines(finding))
  }

  return `${lines.join('\n')}\n`
}

// Local time, not `toISOString()`: unlike the other exports, which stamp a
// request that happened at a recorded instant, this one stamps "when I ran
// this", and the reader who pasted it thinks in their own clock.
function formatTimestamp(at) {
  const pad = (n) => String(n).padStart(2, '0')
  const date = [at.getFullYear(), pad(at.getMonth() + 1), pad(at.getDate())].join('-')
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map(pad).join(':')
  return `${date} ${time}`
}

// `contact` and `license` are what the `info-metadata` rule grades: a report
// that flags them missing should show them when they are there.
function identityLines({ api }) {
  const contact = [api.contact?.name, api.contact?.email, api.contact?.url].filter(Boolean)
  const license = [api.license?.name || api.license?.identifier, api.license?.url].filter(Boolean)
  const parts = [
    contact.length ? `${t('audit.api.contact')}: ${contact.join(' · ')}` : null,
    license.length ? `${t('audit.api.license')}: ${license.join(' · ')}` : null,
  ].filter(Boolean)
  return parts.length ? [parts.join(' — '), ''] : []
}

// The perimeter, in the same units as the page's stats — the figures a reader
// needs to weigh a percentage: 46 % over four operations is not 46 % over a
// hundred and forty.
function scopeLines({ scope }) {
  const stats = ['operations', 'groups', 'webhooks', 'securitySchemes', 'schemas']
    .filter((key) => scope[key] != null)
    .map((key) => `${t(`welcome.${key}`)}: ${scope[key]}`)
  return stats.length ? [stats.join(' · '), ''] : []
}

function severityLine(counts) {
  return ['error', 'warning', 'info']
    .filter((severity) => counts[severity])
    .map((severity) => t(`audit.count.${severity}`, { n: counts[severity] }))
    .join(' · ')
}

// One list item per finding: verdict, where it applies, and the rationale as a
// continuation line — the "why" is the actionable half of the report (§3), so
// it travels with the finding rather than being dropped for compactness.
function findingLines(finding) {
  const item = [
    `- **${t(`audit.severity.${finding.severity}`)}** — ${t(`audit.rule.${finding.ruleId}.message`, finding.params)}`,
  ]
  const where = []
  if (finding.location) where.push(`\`${finding.location}\``)
  if (finding.hidden) where.push(`(${t('audit.hidden')})`)
  // Unlike the page, which turns a routable finding into a link, a pasted
  // report has no app to link into: the JSON pointer is what locates the
  // finding in the file the reader is about to edit.
  if (finding.dataPath) where.push(`\`${finding.dataPath}\``)
  if (where.length) item.push(`  ${where.join(' · ')}`)
  item.push(`  *${t('audit.why')}*: ${t(`audit.rule.${finding.ruleId}.why`, finding.params)}`)
  return item
}
