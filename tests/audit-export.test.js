import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSchema } from '../src/audit/engine.js'
import { toAuditMarkdown } from '../src/export/audit-markdown.js'
import { loadInlineApiModel } from '../src/openapi/loader.js'

// Markdown export of the audit report (docs/audit.md §5). The synthetic report
// below is what pins the format — it carries every case the generator branches
// on, which no real schema is guaranteed to produce at once.

const REPORT = {
  openapi: '3.1.0',
  api: {
    title: 'Swagger Petstore',
    version: '1.0.11',
    contact: { name: 'API team', email: 'api@petstore.test' },
    license: { name: 'Apache 2.0', url: 'https://apache.org/licenses/LICENSE-2.0' },
  },
  scope: { operations: 19, groups: 3, webhooks: 2, securitySchemes: 2, schemas: 64 },
  score: 78,
  grade: 'C',
  counts: { error: 1, warning: 1, info: 1, total: 3 },
  categories: [
    {
      id: 'correctness',
      score: 60,
      checks: 5,
      counts: { error: 1, warning: 0, info: 0 },
      findings: [
        {
          ruleId: 'duplicate-operation-id',
          severity: 'error',
          category: 'correctness',
          location: 'GET /pet/{petId}',
          opRef: 'getPet',
          dataPath: '/paths/~1pet~1{petId}/get',
          params: { operationId: 'getPet' },
        },
      ],
    },
    {
      id: 'completeness',
      score: 100,
      checks: 3,
      counts: { error: 0, warning: 0, info: 0 },
      findings: [],
    },
    {
      id: 'readiness',
      score: 74,
      checks: 9,
      counts: { error: 0, warning: 1, info: 1 },
      findings: [
        {
          ruleId: 'security-scheme-described',
          severity: 'warning',
          category: 'readiness',
          location: 'components.securitySchemes.apiKey',
          opRef: null,
          dataPath: '/components/securitySchemes/apiKey',
          params: { name: 'apiKey' },
        },
        {
          ruleId: 'operation-tagged',
          severity: 'info',
          category: 'readiness',
          location: 'DELETE /admin/reset',
          opRef: null,
          dataPath: '/paths/~1admin~1reset/delete',
          params: {},
          hidden: true,
        },
      ],
    },
  ],
}

const PETSTORE = new URL('../demo/schemas/petstore.json', import.meta.url)

// The moment the report is handed over is an argument, not a call to the clock:
// that is what keeps the generator snapshot-testable.
const AT = new Date(2026, 7, 5, 19, 42, 7)

describe('audit Markdown export', () => {
  it('renders grade, scores and findings', () => {
    expect(toAuditMarkdown(REPORT, { at: AT })).toMatchSnapshot()
  })

  it('states the empty case rather than showing an empty list', () => {
    const perfect = {
      openapi: '3.1.0',
      api: { title: '', version: '', contact: null, license: null },
      scope: { operations: 4, groups: 1, webhooks: 0, securitySchemes: 1, schemas: 3 },
      score: 100,
      grade: 'A',
      counts: { error: 0, warning: 0, info: 0, total: 0 },
      categories: [
        {
          id: 'correctness',
          score: 100,
          checks: 4,
          counts: { error: 0, warning: 0, info: 0 },
          findings: [],
        },
      ],
    }
    const markdown = toAuditMarkdown(perfect, { at: AT })
    expect(markdown).toMatchSnapshot()
    // No API title given: the heading stays the report's own, no dangling dash.
    expect(markdown.split('\n')[0]).toBe('# Schema audit')
  })

  // A pasted report outlives the schema it graded: the stamp is what tells a
  // reader finding it in a ticket whether it still describes anything. Local
  // time, since it answers "when did I run this", not "when did this happen".
  it('stamps the moment it was handed over, to the second', () => {
    const markdown = toAuditMarkdown(REPORT, { at: new Date(2026, 0, 9, 4, 5, 6) })
    expect(markdown).toContain('Generated on 2026-01-09 04:05:06')
  })

  it('defaults the stamp to now, so the page passes nothing', () => {
    expect(toAuditMarkdown(REPORT)).toMatch(/Generated on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/)
  })

  // The generator resolves `audit.rule.{id}.message` / `.why` for whatever the
  // engine emits: a rule shipped without its two English strings shows up here
  // as a leaked key, on a document that exercises the whole ruleset.
  it('resolves every rule string the demo petstore produces', async () => {
    const input = await loadInlineApiModel(JSON.parse(readFileSync(PETSTORE, 'utf8')))
    const markdown = toAuditMarkdown(auditSchema(input), { at: AT })
    expect(markdown).not.toMatch(/audit\.(rule|category|severity)\./)
    // The heading names the audited API, which the report itself carries: the
    // caller passes nothing beyond the report.
    expect(markdown).toContain('# Schema audit — Petstore (demo)')
  })
})
