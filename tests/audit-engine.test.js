import { describe, expect, it } from 'vitest'
import { auditSchema, createAuditContext, gradeFor, runRule } from '../src/audit/engine.js'
import { auditContext, auditInput, doc, okResponse } from './audit-context.js'

// Synthetic rules: the scoring must be verifiable without depending on what
// the real ruleset happens to find in a fixture.
const failing = (id, category, severity, count = 1) => ({
  id,
  category,
  severity,
  run(_ctx, check) {
    for (let i = 0; i < count; i += 1) check(false, { location: `${id}-${i}` })
  },
})
const passing = (id, category, severity, count = 1) => ({
  id,
  category,
  severity,
  run(_ctx, check) {
    for (let i = 0; i < count; i += 1) check(true, {})
  },
})
const inert = (id, category, severity) => ({ id, category, severity, run() {} })

const minimal = () => doc({ paths: { '/pets': { get: { responses: okResponse } } } })

describe('audit context', () => {
  it('collects operations, webhooks and their pointers', () => {
    const ctx = auditContext(
      doc({
        paths: { '/pets/{petId}': { get: { operationId: 'getPet', responses: okResponse } } },
        webhooks: { petStatus: { post: { responses: okResponse } } },
      }),
    )
    expect(ctx.operations.map((entry) => [entry.kind, entry.key, entry.pointer])).toEqual([
      ['operation', 'getPet', '/paths/~1pets~1{petId}/get'],
      ['webhook', 'webhook-post-petstatus', '/webhooks/petStatus/post'],
    ])
  })

  it('collects callback operations under their parent, one level deep', () => {
    const ctx = auditContext(
      doc({
        paths: {
          '/subscribe': {
            post: {
              operationId: 'subscribe',
              responses: okResponse,
              callbacks: {
                onEvent: {
                  '{$request.body#/callbackUrl}': {
                    post: {
                      responses: okResponse,
                      // Nesting stops here: a callback's own callbacks are not
                      // collected, and a circular $ref would make them endless.
                      callbacks: { onNested: { '{$url}': { post: { responses: okResponse } } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    expect(ctx.operations.map((entry) => [entry.kind, entry.key, entry.pointer])).toEqual([
      ['operation', 'subscribe', '/paths/~1subscribe/post'],
      [
        'callback',
        // The parent's key: a finding on a callback deep-links to the page that
        // renders it.
        'subscribe',
        '/paths/~1subscribe/post/callbacks/onEvent/{$request.body#~1callbackUrl}/post',
      ],
    ])
    expect(ctx.operations[1]).toMatchObject({
      callback: 'onEvent',
      path: '{$request.body#/callbackUrl}',
      hidden: false,
    })
  })

  it('marks a callback hidden exactly when its parent is', () => {
    const ctx = auditContext(
      doc({
        paths: {
          '/subscribe': {
            post: {
              operationId: 'subscribe',
              responses: okResponse,
              callbacks: { onEvent: { '{$url}': { post: { responses: okResponse } } } },
            },
          },
        },
      }),
      { hide: ['subscribe'] },
    )
    expect(ctx.operations.map((entry) => entry.hidden)).toEqual([true, true])
  })

  it('merges path-level parameters, the operation overriding by name and in', () => {
    const ctx = auditContext(
      doc({
        paths: {
          '/pets/{petId}': {
            parameters: [
              { name: 'petId', in: 'path', required: true },
              { name: 'verbose', in: 'query' },
            ],
            get: { parameters: [{ name: 'petId', in: 'path', required: false }], responses: {} },
          },
        },
      }),
    )
    expect(
      ctx.operations[0].parameters.map((p) => [p.param.name, p.param.required, p.dataPath]),
    ).toEqual([
      ['petId', false, '/paths/~1pets~1{petId}/get/parameters/0'],
      ['verbose', undefined, '/paths/~1pets~1{petId}/parameters/1'],
    ])
  })

  it('points at the real segment of a 3.2 additionalOperations entry', () => {
    const ctx = auditContext(
      doc({
        openapi: '3.2.0',
        paths: { '/pets': { additionalOperations: { PURGE: { responses: okResponse } } } },
      }),
    )
    expect(ctx.operations[0].pointer).toBe('/paths/~1pets/additionalOperations/PURGE')
    expect(ctx.version).toEqual({ raw: '3.2.0', major: 3, minor: 2 })
  })

  it('sees hidden operations but strips their route', () => {
    const ctx = auditContext(
      doc({
        paths: {
          '/pets': { get: { operationId: 'listPets', responses: okResponse } },
          '/admin': { post: { operationId: 'reset', responses: okResponse } },
        },
      }),
      { hide: ['reset'] },
    )
    expect(ctx.operations).toHaveLength(2)
    // A finding on the hidden operation carries no link, and says so.
    const rule = {
      id: 'target-hidden',
      category: 'correctness',
      severity: 'error',
      run(context, check) {
        for (const entry of context.operations) check(false, { op: entry })
      },
    }
    expect(runRule(rule, ctx).findings).toEqual([
      {
        ruleId: 'target-hidden',
        severity: 'error',
        category: 'correctness',
        location: 'GET /pets',
        opRef: 'listPets',
        dataPath: '/paths/~1pets/get',
        params: {},
      },
      {
        ruleId: 'target-hidden',
        severity: 'error',
        category: 'correctness',
        location: 'POST /admin',
        opRef: null,
        dataPath: '/paths/~1admin/post',
        params: {},
        hidden: true,
      },
    ])
  })

  it('collects each distinct schema once, components first', () => {
    const pet = { type: 'object', properties: { id: { type: 'integer' } } }
    const ctx = createAuditContext(
      auditInput(
        doc({
          components: { schemas: { Pet: pet } },
          // Dereferenced document: the operation points at the very same object.
          paths: {
            '/pets': {
              get: { responses: { 200: { content: { 'application/json': { schema: pet } } } } },
            },
          },
        }),
      ),
    )
    const roots = ctx.schemas.filter(({ schema }) => schema === pet)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toMatchObject({ dataPath: '/components/schemas/Pet', op: null })
  })
})

describe('audit scoring', () => {
  it('weighs a check by its rule severity', () => {
    // error (3) failed, info (1) passed → 1 point out of 4.
    const report = auditSchema(auditInput(minimal()), [
      failing('e', 'correctness', 'error'),
      passing('i', 'correctness', 'info'),
    ])
    expect(report.categories[0]).toMatchObject({ id: 'correctness', score: 25, checks: 2 })
    expect(report.counts).toEqual({ error: 1, warning: 0, info: 0, total: 1 })
  })

  it('averages the scored categories and grades the mean', () => {
    const report = auditSchema(auditInput(minimal()), [
      passing('a', 'correctness', 'error', 3),
      failing('b', 'correctness', 'error'),
      passing('c', 'consistency', 'info'),
    ])
    // correctness 75 %, consistency 100 % → 88 → B.
    expect(report.score).toBe(88)
    expect(report.grade).toBe('B')
    expect(report.openapi).toBe('3.1.0')
  })

  it('leaves a category with no applicable check out of the report', () => {
    const report = auditSchema(auditInput(minimal()), [
      passing('a', 'correctness', 'error'),
      inert('b', 'deprecation', 'info'),
    ])
    expect(report.categories.map((c) => c.id)).toEqual(['correctness'])
    expect(report.score).toBe(100)
    expect(report.grade).toBe('A')
  })

  it('sorts findings by severity, then rule, then position', () => {
    const report = auditSchema(auditInput(minimal()), [
      failing('zeta', 'correctness', 'error'),
      failing('alpha', 'correctness', 'info', 2),
      failing('beta', 'correctness', 'warning'),
    ])
    expect(report.categories[0].findings.map((f) => f.ruleId)).toEqual([
      'zeta',
      'beta',
      'alpha',
      'alpha',
    ])
    expect(report.categories[0].counts).toEqual({ error: 1, warning: 1, info: 2 })
  })

  it('maps a score onto its letter', () => {
    expect([100, 90, 89, 80, 79, 65, 64, 50, 49, 0].map(gradeFor)).toEqual([
      'A',
      'A',
      'B',
      'B',
      'C',
      'C',
      'D',
      'D',
      'F',
      'F',
    ])
  })
})

describe('audit report', () => {
  it('counts as a group only a tag that makes a navigation group', () => {
    const report = auditSchema(
      auditInput(
        doc({
          paths: { '/pets': { get: { tags: ['pets'], responses: okResponse } } },
          webhooks: { petStatus: { post: { tags: ['events'], responses: okResponse } } },
        }),
      ),
    )
    expect(report.scope).toMatchObject({ operations: 1, groups: 1, webhooks: 1 })
  })

  it('grades a clean document with the shipped ruleset', () => {
    const report = auditSchema(
      auditInput(
        doc({
          info: {
            title: 'Audit',
            version: '1',
            description: 'A tiny API that documents itself.',
            contact: { email: 'api@example.com' },
            license: { name: 'MIT' },
          },
          paths: {
            '/pets/{petId}': {
              get: {
                operationId: 'getPet',
                summary: 'Read one pet',
                tags: ['pets'],
                parameters: [
                  {
                    name: 'petId',
                    in: 'path',
                    required: true,
                    description: 'Identifier of the pet',
                    schema: { type: 'string' },
                  },
                ],
                responses: {
                  200: {
                    description: 'OK',
                    content: {
                      'application/json': { schema: { type: 'string' }, example: 'Kitty' },
                    },
                  },
                },
              },
            },
          },
        }),
      ),
    )
    expect(report.counts.total).toBe(0)
    expect(report.score).toBe(100)
    expect(report.grade).toBe('A')
    // Consistency stays out: four names are needed before a dominant convention
    // means anything, and this document has one parameter.
    expect(report.categories.map((c) => c.id)).toEqual([
      'correctness',
      'completeness',
      'deprecation',
      'readiness',
    ])
  })

  it('reports the findings of a sloppy document', () => {
    const report = auditSchema(
      auditInput(
        doc({
          servers: [],
          paths: {
            '/pets/{petId}': {
              get: { responses: { 200: { description: '' } } },
            },
          },
        }),
      ),
    )
    const ids = report.categories.flatMap((c) => c.findings.map((f) => f.ruleId))
    expect(ids).toContain('path-param-declared')
    expect(ids).toContain('response-substance')
    expect(ids).toContain('operation-id-present')
    expect(ids).toContain('operation-tagged')
    expect(ids).toContain('servers-declared')
    expect(report.grade).not.toBe('A')
  })
})
