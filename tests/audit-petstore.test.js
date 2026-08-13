import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSchema } from '../src/audit/engine.js'
import { loadInlineApiModel } from '../src/openapi/loader.js'

// End-to-end pin of the whole ruleset on the demo schema (docs/audit.md §7): the
// only test that runs every rule against a real document, `$ref`s and all, and
// the one that shows what the report actually reads like. It goes through the
// loader so the audit gets exactly the three shapes the app hands it — source,
// dereferenced document, normalized model.
//
// The snapshot moves whenever a rule or the demo schema does. Regenerate it
// deliberately and read the diff: a rule that suddenly stops finding anything
// looks exactly like a rule that got fixed.
const PETSTORE = new URL('../demo/schemas/petstore.json', import.meta.url)

describe('audit report on the demo petstore', () => {
  it('matches the recorded report', async () => {
    const input = await loadInlineApiModel(JSON.parse(readFileSync(PETSTORE, 'utf8')))
    expect(format(auditSchema(input))).toMatchSnapshot()
  })
})

function format(report) {
  const lines = [
    `OpenAPI ${report.openapi} — grade ${report.grade} (${report.score}/100)`,
    `error ${report.counts.error} · warning ${report.counts.warning} · info ${report.counts.info}`,
  ]
  for (const category of report.categories) {
    lines.push('', `## ${category.id} — ${category.score} % over ${category.checks} checks`)
    if (!category.findings.length) lines.push('  (no finding)')
    for (const finding of category.findings) {
      // Callbacks deep-link to their parent, so two of them on one operation
      // would print as two identical lines: only the location tells them apart.
      const callback = finding.dataPath.includes('/callbacks/') ? ` (${finding.location})` : ''
      const target = `${finding.opRef ?? (finding.hidden ? '(hidden)' : finding.dataPath)}${callback}`
      const params = Object.keys(finding.params).length ? ` ${JSON.stringify(finding.params)}` : ''
      lines.push(`  ${finding.severity} ${finding.ruleId} — ${target}${params}`)
    }
  }
  return lines.join('\n')
}
