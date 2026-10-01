import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSchema, createAuditContext, runRule } from '../src/audit/engine.js'
import { documentOpenapi } from '../src/audit/rules/document-openapi.js'
import { documentSyntax } from '../src/audit/rules/document-syntax.js'
import { requiredFieldMissing } from '../src/audit/rules/required-field-missing.js'
import { unknownField } from '../src/audit/rules/unknown-field.js'
import { loadInlineApiModel, SchemaLoadError } from '../src/openapi/loader.js'
import { auditInput, doc } from './audit-context.js'

// The rules about the file itself (docs/audit.md §4.1), and the engine on what
// a tolerant read hands over: a document missing anything, or no mapping at all.

const run = (rule, input) => runRule(rule, createAuditContext(input))
const raw = (content, problems = []) => ({
  source: content,
  document: content,
  model: null,
  problems,
})

describe('document-syntax', () => {
  it('has no check on a text read strictly', () => {
    expect(run(documentSyntax, auditInput(doc()))).toMatchObject({ checks: 0, findings: [] })
  })

  it('fails once per reading problem, at its line and column, in its format', () => {
    const problems = [
      { code: 'json', line: 1, column: 66, detail: 'Expected double-quoted property name' },
      { code: 'DUPLICATE_KEY', line: 9, column: 7, detail: 'Map keys must be unique' },
    ]
    const result = run(documentSyntax, { ...auditInput(doc()), problems })
    expect(result.checks).toBe(2)
    expect(result.findings.map((finding) => [finding.dataPath, finding.params])).toEqual([
      ['', { line: 1, column: 66, detail: 'Expected double-quoted property name', format: 'JSON' }],
      ['', { line: 9, column: 7, detail: 'Map keys must be unique', format: 'YAML' }],
    ])
  })

  it('reports on a file that holds no mapping too', () => {
    const problem = { code: 'MISSING_CHAR', line: 1, column: 5, detail: 'Missing closing "quote' }
    expect(run(documentSyntax, raw('text', [problem])).findings).toHaveLength(1)
  })
})

describe('document-openapi', () => {
  const found = (input) => run(documentOpenapi, input).findings.map((f) => [f.dataPath, f.params])

  it('passes every version this app reads', () => {
    for (const openapi of ['3.0.4', '3.1.0', '3.2.0', '3.1']) {
      expect(run(documentOpenapi, auditInput(doc({ openapi })))).toMatchObject({
        checks: 1,
        findings: [],
      })
    }
  })

  it('names a version this app does not read', () => {
    expect(found(auditInput(doc({ openapi: '4.0.0' })))).toEqual([
      ['/openapi', { found: 'openapi: 4.0.0' }],
    ])
    expect(found(auditInput(doc({ openapi: '3.9.0' })))).toEqual([
      ['/openapi', { found: 'openapi: 3.9.0' }],
    ])
    const { openapi: _, ...swagger } = doc({ swagger: '1.2' })
    expect(found(auditInput(swagger))).toEqual([['/swagger', { found: 'swagger: 1.2' }]])
    // YAML reads an unquoted `swagger: 1.2` as a number.
    expect(found(raw({ swagger: 1.2, apis: [] }))).toEqual([
      ['/swagger', { found: 'swagger: 1.2' }],
    ])
  })

  it('leaves a missing or mistyped `openapi` to the rules that say more', () => {
    const { openapi: _, ...unversioned } = doc()
    expect(found(auditInput(unversioned))).toEqual([])
    expect(found(raw({ ...unversioned, openapi: 3.1 }))).toEqual([])
    const { findings } = run(requiredFieldMissing, auditInput(unversioned))
    expect(findings.map((f) => f.params.field)).toContain('openapi')
  })

  it('says what a file holds when it is no mapping, in a neutral notation', () => {
    expect(found(raw(undefined))).toEqual([['', { found: '(empty)' }]])
    expect(found(raw(['a', 'b']))).toEqual([['', { found: '[…]' }]])
    expect(found(raw('hello world'))).toEqual([['', { found: '"hello world"' }]])
    expect(found(raw(42))).toEqual([['', { found: '42' }]])
  })

  it('takes the version over from the rules that would repeat it', () => {
    const swagger = { swagger: '1.2', info: { title: 'T', version: '1' }, paths: {} }
    const missing = run(requiredFieldMissing, raw(swagger)).findings
    expect(missing.map((f) => f.params.field)).not.toContain('openapi')
    const unknown = run(unknownField, raw(swagger)).findings
    expect(unknown.map((f) => f.params.field)).not.toContain('swagger')
  })
})

describe('the engine on partial input', () => {
  it('reports a file holding no mapping with the file rules alone, graded F', () => {
    const report = auditSchema(raw(['a', 'b']))
    expect(report.grade).toBe('F')
    expect(report.openapi).toBe('')
    expect(report.api.title).toBe('')
    expect(report.categories.map((category) => category.id)).toEqual(['correctness'])
    expect(report.categories[0].findings.map((finding) => finding.ruleId)).toEqual([
      'document-openapi',
    ])
  })

  it('grades an unknown version with the newest rules, and shows the declared one', () => {
    const input = auditInput(doc({ openapi: '4.0.0', info: { title: 'T', version: '1', bad: 1 } }))
    const report = auditSchema(input)
    expect(report.openapi).toBe('4.0.0')
    const unknown = report.categories
      .flatMap((category) => category.findings)
      .find((finding) => finding.ruleId === 'unknown-field')
    expect(unknown.params.declared).toBe('3.2.0')
  })

  // What the CLI does with each file of the broken set: load it the audit's
  // way, fall back on what it holds when it is no mapping, and grade it.
  it('reports on every broken file without a crash', async () => {
    const dir = new URL('fixtures/broken/', import.meta.url)
    const outcomes = {}
    for (const name of readdirSync(dir).sort()) {
      const text = readFileSync(new URL(name, dir), 'utf8')
      let input
      try {
        input = await loadInlineApiModel(text, { anyVersion: true })
      } catch (err) {
        expect(err).toBeInstanceOf(SchemaLoadError)
        expect(err.detail, name).toHaveProperty('content')
        input = raw(err.detail.content, err.detail.problems)
      }
      const report = auditSchema(input)
      const fired = new Set(report.categories.flatMap((c) => c.findings.map((f) => f.ruleId)))
      outcomes[name] = ['document-syntax', 'document-openapi'].filter((id) => fired.has(id))
    }
    expect(outcomes).toEqual({
      'bad-alias.yaml': ['document-syntax'],
      'bad-indent.yaml': ['document-syntax'],
      'bom.json': [],
      'dup-key.yaml': ['document-syntax'],
      'empty.yaml': ['document-openapi'],
      'ext-ref.json': [],
      'keep-chomp.yaml': [],
      'list.yaml': ['document-openapi'],
      'no-version.json': [],
      'ref-loop.yaml': [],
      'swagger12.json': ['document-openapi'],
      'tab.yaml': ['document-syntax'],
      'text.yaml': ['document-openapi'],
      'trailing-comma.json': ['document-syntax'],
      'truncated.json': ['document-syntax'],
      'v4.json': ['document-openapi'],
    })
  })
})
