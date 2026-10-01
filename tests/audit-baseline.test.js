import { describe, expect, it } from 'vitest'
import { BASELINE_FORMAT, applyBaseline, readBaseline, toBaseline } from '../src/audit/baseline.js'
import { gateResults } from '../src/audit/gate.js'

// What `apiglow audit` gates a CI job on (docs/audit.md §8.2–§8.3): the
// baseline that separates new findings from accepted ones, and the checks
// that turn a report into a pass or a fail.

const finding = (ruleId, dataPath, severity = 'warning') => ({
  ruleId,
  severity,
  category: 'completeness',
  location: '',
  opRef: null,
  dataPath,
  params: {},
})

const reportOf = (findings, { score = 70, grade = 'C' } = {}) => ({
  score,
  grade,
  categories: [{ id: 'completeness', score, findings }],
})

describe('audit baseline', () => {
  it('records every finding by rule and pointer, sorted', () => {
    const report = reportOf([
      finding('parameter-described', '/paths/~1pets/get/parameters/1'),
      finding('operation-described', '/paths/~1pets/post'),
      finding('parameter-described', '/paths/~1pets/get/parameters/0'),
    ])
    expect(toBaseline([{ id: 'default', report }])).toEqual({
      format: BASELINE_FORMAT,
      version: 1,
      specs: {
        default: {
          'operation-described': ['/paths/~1pets/post'],
          'parameter-described': [
            '/paths/~1pets/get/parameters/0',
            '/paths/~1pets/get/parameters/1',
          ],
        },
      },
    })
  })

  it('marks the known findings and returns the new ones', () => {
    const report = reportOf([
      finding('operation-described', '/paths/~1pets/post'),
      finding('operation-described', '/paths/~1pets/delete'),
    ])
    const { report: marked, fresh } = applyBaseline(report, {
      'operation-described': ['/paths/~1pets/post'],
    })
    expect(fresh.map((f) => f.dataPath)).toEqual(['/paths/~1pets/delete'])
    expect(marked.categories[0].findings.map((f) => f.known ?? false)).toEqual([true, false])
    // Every finding is still in the report: a baseline is not an ignore list.
    expect(marked.categories[0].findings).toHaveLength(2)
  })

  it('counts occurrences, so a second one on the same node is new', () => {
    const report = reportOf([
      finding('version-construct', '/components/schemas/Pet'),
      finding('version-construct', '/components/schemas/Pet'),
    ])
    expect(
      applyBaseline(report, { 'version-construct': ['/components/schemas/Pet'] }).fresh,
    ).toHaveLength(1)
  })

  it('knows nothing for a spec the baseline does not list', () => {
    const report = reportOf([finding('operation-described', '/paths/~1pets/post')])
    expect(applyBaseline(report).fresh).toHaveLength(1)
  })

  it('round-trips through the file it writes', () => {
    const report = reportOf([finding('operation-described', '/paths/~1pets/post')])
    const written = JSON.parse(JSON.stringify(toBaseline([{ id: 'default', report }])))
    expect(applyBaseline(report, readBaseline(written).default).fresh).toEqual([])
  })

  it('refuses a document that is not a baseline it can trust', () => {
    expect(() => readBaseline({ specs: {} })).toThrow(/not an audit baseline/)
    expect(() => readBaseline({ format: BASELINE_FORMAT, version: 2, specs: {} })).toThrow(
      /unsupported baseline version 2/,
    )
    expect(() =>
      readBaseline({ format: BASELINE_FORMAT, version: 1, specs: { default: { rule: '/x' } } }),
    ).toThrow(/malformed baseline/)
  })
})

describe('audit gates', () => {
  const findings = [
    finding('operation-described', '/a', 'warning'),
    finding('property-described', '/b', 'info'),
  ]
  const report = reportOf(findings, { score: 72, grade: 'C' })

  it('fails on findings at or above the threshold, errors by default', () => {
    expect(gateResults(report, { findings })).toEqual([
      { gate: 'fail-on', threshold: 'error', actual: 0, passed: true },
    ])
    expect(gateResults(report, { findings, failOn: 'warning' })[0]).toMatchObject({
      actual: 1,
      passed: false,
    })
    expect(gateResults(report, { findings, failOn: 'info' })[0]).toMatchObject({ actual: 2 })
    expect(gateResults(report, { findings, failOn: 'none' })).toEqual([])
  })

  it('compares the grade and the score with the whole report', () => {
    const [, grade, score] = gateResults(report, { findings: [], minGrade: 'B', minScore: 70 })
    expect(grade).toEqual({ gate: 'min-grade', threshold: 'B', actual: 'C', passed: false })
    expect(score).toEqual({ gate: 'min-score', threshold: 70, actual: 72, passed: true })
    expect(gateResults(report, { findings: [], minGrade: 'C' })[1].passed).toBe(true)
    expect(
      gateResults(reportOf([], { grade: 'F' }), { findings: [], minGrade: 'D' })[1].passed,
    ).toBe(false)
  })

  it('passes a report with nothing to grade', () => {
    const empty = reportOf([], { score: null, grade: null })
    const results = gateResults(empty, { findings: [], minGrade: 'A', minScore: 100 })
    expect(results.every((r) => r.passed)).toBe(true)
  })
})
