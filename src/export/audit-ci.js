import { findingsOf } from '../audit/baseline.js'
import { SEVERITIES } from '../audit/constants.js'
import { RULES } from '../audit/rules/index.js'
import { t } from '../i18n/index.js'

// The reports `apiglow audit` writes for a CI platform to display itself
// (docs/audit.md §8.4): SARIF for code scanning, GitHub workflow commands for
// annotations on the diff, GitLab Code Quality for the merge request widget.
// Pure functions of the CLI's results — one per spec, findings fingerprinted
// and placed — like the other generators of this directory. The messages are
// the report's, in the report's language.

// GitHub code scanning reads at most this many results per run and drops the
// upload beyond it: the cap is applied here, in a chosen order, and the CLI
// says on stderr what it left out.
export const SARIF_RESULT_CAP = 25000

// GitHub shows at most ten annotations of each type per step and drops the rest
// without a word: a summary notice has to take one of the ten notice slots to
// say how many it dropped.
export const ANNOTATIONS_PER_TYPE = 10

const SARIF_LEVEL = { error: 'error', warning: 'warning', info: 'note' }
const PROBLEM_SEVERITY = { error: 'error', warning: 'warning', info: 'recommendation' }
const ANNOTATION = { error: 'error', warning: 'warning', info: 'notice' }
const CODE_QUALITY_SEVERITY = { error: 'critical', warning: 'major', info: 'minor' }

const DEFAULT_SEVERITY = new Map(RULES.map((rule) => [rule.id, rule.severity]))
const CATEGORY = new Map(RULES.map((rule) => [rule.id, rule.category]))

// SARIF 2.1.0, one run per spec. `tool`: { name, version, homepage }.
// `baseline`: whether a baseline was applied, which is when each result can
// say whether it is new.
export function toAuditSarif(results, { tool, baseline }) {
  const runs = results.map(({ id, source, report }) => {
    const findings = ordered(findingsOf(report)).slice(0, SARIF_RESULT_CAP)
    const ruleIds = [...new Set(findings.map((finding) => finding.ruleId))].sort()
    const ruleIndex = new Map(ruleIds.map((ruleId, i) => [ruleId, i]))
    return {
      tool: {
        driver: {
          name: tool.name,
          version: tool.version,
          informationUri: tool.homepage,
          rules: ruleIds.map((ruleId) => sarifRule(ruleId, report.profile)),
        },
      },
      // The category GitHub files the run's alerts under: one per spec, so that
      // each spec's alerts close on their own when its findings are fixed.
      automationDetails: { id: `apiglow-audit/${id}/` },
      results: findings.map((finding) => ({
        ruleId: finding.ruleId,
        ruleIndex: ruleIndex.get(finding.ruleId),
        level: SARIF_LEVEL[finding.severity],
        message: { text: t(`audit.rule.${finding.ruleId}.message`, finding.params) },
        locations: [sarifLocation(finding, source)],
        ...(finding.via?.length
          ? {
              relatedLocations: finding.via.map((position, i) => ({
                id: i,
                physicalLocation: physical(position),
                message: { text: '$ref' },
              })),
            }
          : {}),
        partialFingerprints: { 'apiglowFingerprint/v1': finding.fingerprint },
        ...(baseline ? { baselineState: finding.known ? 'unchanged' : 'new' } : {}),
        properties: { pointer: finding.dataPath, params: finding.params },
      })),
      properties: { grade: report.grade, score: report.score, profile: report.profile ?? null },
    }
  })
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs,
  }
  return `${JSON.stringify(sarif, null, 2)}\n`
}

// The texts are the rule's templates — `{name}` and the like are each result's
// `properties.params` — as in the JSON report: a rule is described once, and
// its results differ by those values.
function sarifRule(ruleId, profile) {
  const configured = profile?.rules?.[ruleId]
  const severity = SEVERITIES.includes(configured) ? configured : DEFAULT_SEVERITY.get(ruleId)
  const label = t(`audit.rule.${ruleId}.label`)
  const why = t(`audit.rule.${ruleId}.why`)
  const fix = t(`audit.rule.${ruleId}.fix`)
  return {
    id: ruleId,
    shortDescription: { text: label },
    fullDescription: { text: why },
    help: {
      text: `${why}\n\n${t('audit.howToFix')} ${fix}`,
      markdown: `**${t('audit.why')}**: ${why}\n\n**${t('audit.howToFix')}** ${fix}`,
    },
    defaultConfiguration: { level: SARIF_LEVEL[severity] },
    properties: {
      category: CATEGORY.get(ruleId),
      tags: [CATEGORY.get(ruleId)],
      'problem.severity': PROBLEM_SEVERITY[severity],
    },
  }
}

function sarifLocation(finding, source) {
  const logical = [{ name: finding.location || undefined, fullyQualifiedName: finding.dataPath }]
  if (finding.position)
    return { physicalLocation: physical(finding.position), logicalLocations: logical }
  // A schema fetched from a URL has no line to point at, but it has an address.
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) {
    return { physicalLocation: { artifactLocation: { uri: source } }, logicalLocations: logical }
  }
  return { logicalLocations: logical }
}

function physical({ file, line, column }) {
  return {
    artifactLocation: { uri: fileUri(file) },
    region: { startLine: line, startColumn: column },
  }
}

// A relative path stays relative — code scanning resolves it against the
// checkout — and an absolute one becomes a `file:` URI.
function fileUri(file) {
  const path = file.replaceAll('\\', '/')
  if (path.startsWith('/')) return `file://${encodeURI(path)}`
  if (/^[a-z]:\//i.test(path)) return `file:///${encodeURI(path)}`
  return encodeURI(path)
}

// GitHub workflow commands, one line each: what a step prints on stdout to
// annotate the diff. New findings first, so that a baseline's known findings
// never take the slots a regression needs; at most ANNOTATIONS_PER_TYPE of each
// type, then one notice with the count left out.
export function toAuditAnnotations(results) {
  const multi = results.length > 1
  const findings = results.flatMap(({ id, report }) =>
    findingsOf(report).map((finding) => ({ id, finding })),
  )
  const sorted = [...findings].sort(
    (a, b) => Number(a.finding.known ?? false) - Number(b.finding.known ?? false),
  )
  const used = { error: 0, warning: 0, notice: 0 }
  const lines = []
  let omitted = 0
  for (const { id, finding } of sorted) {
    const type = ANNOTATION[finding.severity]
    if (used[type] === ANNOTATIONS_PER_TYPE) {
      omitted++
      continue
    }
    used[type]++
    lines.push({ type, line: annotation(type, finding, multi ? id : null) })
  }
  if (omitted && used.notice === ANNOTATIONS_PER_TYPE) {
    // The summary needs a notice slot: the last finding notice gives it up.
    const last = lines.findLastIndex((entry) => entry.type === 'notice')
    lines.splice(last, 1)
    omitted++
  }
  const out = lines.map((entry) => entry.line)
  if (omitted) out.push(`::notice::${escapeData(t('audit.annotations.omitted', { n: omitted }))}`)
  return out.length ? `${out.join('\n')}\n` : ''
}

function annotation(type, finding, spec) {
  const properties = []
  if (finding.position) {
    const { file, line, column } = finding.position
    properties.push(
      `file=${escapeProperty(file.replaceAll('\\', '/'))}`,
      `line=${line}`,
      `col=${column}`,
    )
  }
  properties.push(
    `title=${escapeProperty(`${t(`audit.rule.${finding.ruleId}.label`)} [${finding.ruleId}]`)}`,
  )
  const where = [spec && `[${spec}]`, finding.location, finding.dataPath]
    .filter(Boolean)
    .join(' · ')
  const message = [
    t(`audit.rule.${finding.ruleId}.message`, finding.params),
    where,
    `${t('audit.howToFix')} ${t(`audit.rule.${finding.ruleId}.fix`, finding.params)}`,
  ]
  return `::${type} ${properties.join(',')}::${escapeData(message.join('\n'))}`
}

// The runner's own escaping rules for workflow commands: `%`, CR and LF in the
// message; also `:` and `,` in a property, where they would end it.
function escapeData(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

function escapeProperty(text) {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C')
}

// GitLab Code Quality: the subset of the Code Climate format GitLab reads. Our
// fingerprint is what lets the merge request widget tell new findings from
// resolved ones by comparing two pipelines.
export function toAuditCodeQuality(results) {
  const issues = results.flatMap(({ source, report }) =>
    findingsOf(report).map((finding) => ({
      description: t(`audit.rule.${finding.ruleId}.message`, finding.params),
      check_name: finding.ruleId,
      fingerprint: finding.fingerprint,
      severity: CODE_QUALITY_SEVERITY[finding.severity],
      location: {
        path: finding.position ? finding.position.file.replaceAll('\\', '/') : source,
        lines: { begin: finding.position?.line ?? 1 },
      },
    })),
  )
  return `${JSON.stringify(issues, null, 2)}\n`
}

// New before known, then most severe first; report order within. The engine
// sorts by severity inside a category, not across them.
function ordered(findings) {
  const rank = (finding) =>
    (finding.known ? SEVERITIES.length : 0) + SEVERITIES.indexOf(finding.severity)
  return findings
    .map((finding, i) => ({ finding, i }))
    .sort((a, b) => rank(a.finding) - rank(b.finding) || a.i - b.i)
    .map(({ finding }) => finding)
}
