import { describe, expect, it } from 'vitest'
import { auditProfile, readAuditConfig, severityResolver } from '../src/audit/config.js'
import { auditSchema } from '../src/audit/engine.js'
import { resolveSpecConfig } from '../src/specs.js'
import { hostConfig } from '../src/config.js'
import { auditInput, doc, okResponse } from './audit-context.js'

// The rule configuration (docs/audit.md §2.2, §3): what it accepts, how it
// re-grades a run, and how the report says it was used.

const RULES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const read = (raw) => readAuditConfig(raw, RULES)

// A synthetic rule failing once at each pointer it is given.
const rule = (id, severity, pointers, category = 'correctness') => ({
  id,
  category,
  severity,
  run(_ctx, check) {
    for (const dataPath of pointers) check(false, { location: dataPath, dataPath })
  },
})

const minimal = () => doc({ paths: { '/pets': { get: { responses: okResponse } } } })

describe('readAuditConfig', () => {
  it('reads rules and overrides', () => {
    const { config, errors } = read({
      rules: { a: 'off', b: 'error' },
      overrides: [{ paths: ['/paths/~1legacy~1*'], rules: { c: 'info' }, reason: 'frozen' }],
    })
    expect(errors).toEqual([])
    expect(config.rules).toEqual({ a: 'off', b: 'error' })
    expect(config.overrides).toMatchObject([
      { paths: ['/paths/~1legacy~1*'], rules: { c: 'info' } },
    ])
  })

  it('names every entry it cannot read, and keeps the valid rest', () => {
    const { config, errors } = read({
      rules: { a: 'warning', nope: 'off', b: 'fatal' },
      overrides: [{ paths: ['legacy'], rules: { c: 'off' } }, 'x'],
      extra: true,
    })
    expect(errors).toEqual([
      'audit.rules: unknown rule "nope"',
      'audit.rules.b: "fatal" is not one of error, warning, info, off',
      'audit.overrides[0].paths: expected a list of JSON pointers, each starting with "/"',
      'audit.overrides[1]: expected an object',
      'audit.extra: unknown key',
    ])
    expect(config.rules).toEqual({ a: 'warning' })
    expect(config.overrides).toEqual([])
  })

  // A misspelled key inside an override would otherwise drop the whole entry
  // in silence — the config would look applied and change nothing.
  it('refuses an override that changes no rule, or carries a key it does not know', () => {
    expect(read({ overrides: [{ paths: ['/x'], rule: { a: 'off' } }] }).errors).toEqual([
      'audit.overrides[0].rules: missing — an override changes rules',
      'audit.overrides[0].rule: unknown key',
    ])
    expect(read({ overrides: [{ paths: ['/x'], rules: { a: 'off' }, reason: 3 }] }).errors).toEqual(
      ['audit.overrides[0].reason: expected text'],
    )
  })

  it('has nothing to say about an absent block', () => {
    expect(read(undefined)).toEqual({
      config: { rules: {}, overrides: [] },
      errors: [],
    })
  })

  it('takes a severity as a string, and nothing else', () => {
    const { config, errors } = read({
      rules: { c: { severity: 'warning' } },
      overrides: [{ paths: ['/x'], rules: { a: { severity: 'error' } } }],
    })
    expect(errors).toEqual([
      'audit.rules.c: {"severity":"warning"} is not one of error, warning, info, off',
      'audit.overrides[0].rules.a: {"severity":"error"} is not one of error, warning, info, off',
    ])
    expect(config.rules).toEqual({})
    expect(config.overrides).toEqual([])
  })

  it('checks rule ids against the shipped registry by default', () => {
    expect(readAuditConfig({ rules: { 'operation-described': 'info' } }).errors).toEqual([])
    expect(readAuditConfig({ rules: { 'operation-describe': 'info' } }).errors).toHaveLength(1)
  })
})

describe('severityResolver', () => {
  const resolve = (raw, id = 'a', severity = 'warning') =>
    severityResolver(read(raw).config)({ id, severity })

  it("keeps a rule's own severity by default, and drops a rule off everywhere", () => {
    expect(resolve({})('/x')).toBe('warning')
    expect(resolve({ rules: { a: 'error' } })('/x')).toBe('error')
    expect(resolve({ rules: { a: 'off' } })).toBeNull()
  })

  it('lets the last matching override win, under the pointers it covers', () => {
    const at = resolve({
      rules: { a: 'error' },
      overrides: [
        { paths: ['/paths/~1legacy~1*'], rules: { a: 'off' } },
        { paths: ['/paths/~1legacy~1kept'], rules: { a: 'info' } },
      ],
    })
    expect(at('/paths/~1pets/get')).toBe('error')
    expect(at('/paths/~1legacy~1old/get/parameters/0')).toBeNull()
    expect(at('/paths/~1legacy~1kept/get')).toBe('info')
  })

  it('reads `**` as any depth and `*` as one segment', () => {
    const deep = resolve({
      overrides: [{ paths: ['/components/**/properties'], rules: { a: 'off' } }],
    })
    expect(deep('/components/schemas/Pet/properties/name')).toBeNull()
    expect(deep('/components/schemas/Pet')).toBe('warning')
    const one = resolve({ overrides: [{ paths: ['/components/*/Pet'], rules: { a: 'off' } }] })
    expect(one('/components/schemas/Pet/properties/name')).toBeNull()
    expect(one('/components/schemas/Petal')).toBe('warning')
  })

  it("keeps a check's own severity unless the configuration sets one", () => {
    expect(resolve({})('/x', 'info')).toBe('info')
    expect(resolve({ rules: { a: 'error' } })('/x', 'info')).toBe('error')
    const at = resolve({ overrides: [{ paths: ['/legacy'], rules: { a: 'off' } }] })
    expect(at('/x', 'info')).toBe('info')
    expect(at('/legacy/get', 'info')).toBeNull()
  })

  it('can switch a rule back on under a path it was switched off for', () => {
    const at = resolve({
      rules: { a: 'off' },
      overrides: [{ paths: ['/paths/~1new'], rules: { a: 'error' } }],
    })
    expect(at('/paths/~1old')).toBeNull()
    expect(at('/paths/~1new/get')).toBe('error')
  })
})

describe('a configured run', () => {
  const run = (raw, rules) =>
    auditSchema({ ...auditInput(minimal()), config: read(raw).config }, rules)

  it('regrades the findings and the score at the configured severity', () => {
    const rules = [
      rule('a', 'info', ['/x']),
      { ...rule('b', 'error', []), run: (_c, check) => check(true, {}) },
    ]
    const plain = run({}, rules)
    const raised = run({ rules: { a: 'error' } }, rules)
    expect(plain.categories[0].findings[0].severity).toBe('info')
    expect(raised.categories[0].findings[0].severity).toBe('error')
    // info failed (1) + error passed (3) → 75; error failed (3) + error passed (3) → 50.
    expect(plain.score).toBe(75)
    expect(raised.score).toBe(50)
  })

  it('counts nothing a rule checks where it is switched off', () => {
    const report = run({ overrides: [{ paths: ['/paths/~1legacy'], rules: { a: 'off' } }] }, [
      rule('a', 'warning', ['/paths/~1pets/get', '/paths/~1legacy/get']),
    ])
    expect(report.categories[0]).toMatchObject({
      checks: 1,
      findings: [{ dataPath: '/paths/~1pets/get' }],
    })
  })

  it('does not run a rule switched off everywhere', () => {
    let ran = false
    const spy = { id: 'a', category: 'correctness', severity: 'error', run: () => (ran = true) }
    run({ rules: { a: 'off' } }, [spy, rule('b', 'info', [])])
    expect(ran).toBe(false)
  })

  it('says it was graded under a custom profile, and when it was not', () => {
    expect(run({}, [rule('a', 'info', ['/x'])]).profile).toEqual({
      custom: false,
      rules: {},
      overrides: 0,
    })
    expect(
      run({ rules: { a: 'error' }, overrides: [{ paths: ['/x'], rules: { b: 'off' } }] }, [
        rule('a', 'info', ['/x']),
      ]).profile,
    ).toEqual({ custom: true, rules: { a: 'error' }, overrides: 1 })
  })

  it('leaves nothing to grade when every rule is off, rather than inventing a grade', () => {
    const report = run({ rules: { a: 'off' } }, [rule('a', 'error', ['/x'])])
    expect(report).toMatchObject({ score: null, grade: null, categories: [] })
  })
})

describe('auditProfile', () => {
  it('is the default profile without a configuration', () => {
    expect(auditProfile(undefined)).toEqual({ custom: false, rules: {}, overrides: 0 })
  })
})

// The `audit` block of a multi-spec install: the spec's rules win by id, the
// overrides accumulate, root first.
describe('per-spec rule configuration', () => {
  it('merges the root block with the spec one', () => {
    const config = hostConfig({
      audit: {
        rules: { a: 'off', b: 'info' },
        overrides: [{ paths: ['/x'], rules: { c: 'off' } }],
      },
    })
    const spec = {
      id: 'billing',
      audit: { rules: { b: 'error' }, overrides: [{ paths: ['/y'], rules: { a: 'info' } }] },
    }
    const { audit } = resolveSpecConfig(config, spec, { multi: true }).config
    expect(audit.rules).toEqual({ a: 'off', b: 'error' })
    expect(audit.overrides.map((entry) => entry.paths[0])).toEqual(['/x', '/y'])
  })
})
