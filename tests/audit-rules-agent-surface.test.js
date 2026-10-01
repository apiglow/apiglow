import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { bridgeDegradation } from '../src/audit/rules/bridge-degradation.js'
import { operationIdToolName } from '../src/audit/rules/operation-id-tool-name.js'
import { operationsIndistinct } from '../src/audit/rules/operations-indistinct.js'
import { summaryLength } from '../src/audit/rules/summary-length.js'
import { toolSurfaceSize } from '../src/audit/rules/tool-surface-size.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) =>
  options === undefined
    ? runRule(rule, auditContext(document))
    : runRule(rule, auditContext(document), undefined, options)

const op = (fields = {}) => ({ responses: okResponse, ...fields })

describe('operation-id-tool-name', () => {
  it('passes on a name every platform accepts', () => {
    const result = run(
      operationIdToolName,
      doc({
        paths: {
          '/pets': { get: op({ operationId: 'list_pets-v2' }), post: op({ operationId: '_add' }) },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags a slash, a leading digit, a dot, and names the default limit', () => {
    const result = run(
      operationIdToolName,
      doc({
        paths: {
          '/': { get: op({ operationId: 'meta/root' }) },
          '/a': { get: op({ operationId: '2fa' }) },
          '/b': { get: op({ operationId: 'pets.list' }) },
        },
      }),
    )
    expect(result.findings).toHaveLength(3)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'operation-id-tool-name',
      category: 'agent',
      severity: 'info',
      location: 'GET /',
      dataPath: '/paths/~1/get/operationId',
      params: { operationId: 'meta/root', maxLength: 64 },
    })
  })

  it('caps the length at 64 by default, and at the configured maxLength', () => {
    const document = doc({
      paths: {
        '/a': { get: op({ operationId: 'a'.repeat(64) }) },
        '/b': { get: op({ operationId: 'b'.repeat(65) }) },
        '/c': { get: op({ operationId: 'c'.repeat(129) }) },
      },
    })
    expect(run(operationIdToolName, document).findings.map((f) => f.location)).toEqual([
      'GET /b',
      'GET /c',
    ])
    const raised = run(operationIdToolName, document, { maxLength: 128 })
    expect(raised.findings.map((f) => f.location)).toEqual(['GET /c'])
    expect(raised.findings[0].params.maxLength).toBe(128)
  })

  it('leaves a missing or blank operationId to operation-id-present, and spares webhooks', () => {
    const result = run(
      operationIdToolName,
      doc({
        paths: { '/a': { get: op() }, '/b': { get: op({ operationId: ' ' }) } },
        webhooks: { ping: { post: op({ operationId: 'ping/hook' }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })
})

describe('summary-length', () => {
  it('passes at 300 characters, counted as characters rather than UTF-16 units', () => {
    const result = run(
      summaryLength,
      doc({ paths: { '/a': { get: op({ summary: '😀'.repeat(300) }) } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a summary over 300 characters', () => {
    const result = run(
      summaryLength,
      doc({ paths: { '/a': { get: op({ summary: 'x'.repeat(301) }) } } }),
    )
    expect(result.findings[0]).toMatchObject({
      dataPath: '/paths/~1a/get/summary',
      params: { length: 301, limit: 300 },
    })
  })

  it('has no check without a summary, and never grades the description', () => {
    const result = run(
      summaryLength,
      doc({ paths: { '/a': { get: op({ description: 'x'.repeat(400) }) } } }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('operations-indistinct', () => {
  it('passes on distinct tool descriptions', () => {
    const result = run(
      operationsIndistinct,
      doc({
        paths: {
          '/pets': { get: op({ summary: 'List pets' }) },
          '/owners': { get: op({ summary: 'List owners' }) },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags every later operation saying the same, ignoring case and whitespace', () => {
    const result = run(
      operationsIndistinct,
      doc({
        paths: {
          '/a': { get: op({ summary: 'Get an item' }) },
          '/b': { get: op({ summary: '  get   an\nITEM ' }) },
          '/c': { delete: op({ summary: 'Get an item' }) },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.location, f.params.other])).toEqual([
      ['GET /b', 'GET /a'],
      ['DELETE /c', 'GET /a'],
    ])
    expect(result.findings[0].dataPath).toBe('/paths/~1b/get/summary')
  })

  it('compares the description a tool carries, falling back to the summary', () => {
    const result = run(
      operationsIndistinct,
      doc({
        paths: {
          // Distinct summaries, but the tools carry the same description.
          '/a': { get: op({ summary: 'One', description: 'Shared text.' }) },
          '/b': { get: op({ summary: 'Two', description: 'Shared text.' }) },
          // Same summary as /a, but its tool carries its own description.
          '/c': { get: op({ summary: 'One', description: 'Its own text.' }) },
          // No description: the summary is the tool's, and it matches /a's description.
          '/d': { get: op({ summary: 'Shared text.', description: '  ' }) },
        },
      }),
    )
    expect(result.findings.map((f) => [f.location, f.dataPath])).toEqual([
      ['GET /b', '/paths/~1b/get/description'],
      ['GET /d', '/paths/~1d/get/summary'],
    ])
  })

  it('has no check for an operation whose tool has no description', () => {
    const result = run(
      operationsIndistinct,
      doc({ paths: { '/a': { get: op() }, '/b': { get: op({ summary: 42 }) } } }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('tool-surface-size', () => {
  const withOperations = (count) =>
    doc({
      paths: Object.fromEntries(Array.from({ length: count }, (_, i) => [`/r${i}`, { get: op() }])),
    })

  it('passes at 30 operations', () => {
    expect(run(toolSurfaceSize, withOperations(30))).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags 31 operations against the GPT Actions limit', () => {
    const [finding] = run(toolSurfaceSize, withOperations(31)).findings
    expect(finding).toMatchObject({
      location: 'paths',
      dataPath: '/paths',
      opRef: null,
      params: { count: 31, limit: 30 },
    })
  })

  it('names the 128-tool limit once it is crossed too', () => {
    expect(run(toolSurfaceSize, withOperations(128)).findings[0].params.limit).toBe(30)
    expect(run(toolSurfaceSize, withOperations(129)).findings[0].params).toEqual({
      count: 129,
      limit: 128,
    })
  })

  it('counts hidden operations, never webhooks, and has no check on an empty document', () => {
    const hidden = doc({
      paths: Object.fromEntries(
        Array.from({ length: 31 }, (_, i) => [`/r${i}`, { get: op({ 'x-apiglow-hide': true }) }]),
      ),
    })
    expect(auditContext(hidden).operations.every((entry) => entry.hidden)).toBe(true)
    expect(run(toolSurfaceSize, hidden).findings).toHaveLength(1)
    const webhooks = doc({
      webhooks: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`h${i}`, { post: op() }])),
    })
    expect(run(toolSurfaceSize, webhooks).checks).toBe(0)
  })
})

describe('bridge-degradation', () => {
  const schemes = {
    bearer: { type: 'http', scheme: 'bearer' },
    headerKey: { type: 'apiKey', in: 'header', name: 'X-Key' },
    queryKey: { type: 'apiKey', in: 'query', name: 'key' },
    cookieKey: { type: 'apiKey', in: 'cookie', name: 'sid' },
    tls: { type: 'mutualTLS' },
    oauth: { type: 'oauth2', flows: {} },
  }
  const secured = (security, extra = {}) =>
    doc({
      components: { securitySchemes: schemes },
      paths: { '/a': { get: op({ security, ...extra }) } },
    })

  it('passes on header credentials, anonymous access, and no security at all', () => {
    for (const security of [
      [{ bearer: [] }],
      [{ headerKey: [], bearer: [] }],
      [{ queryKey: [] }, {}],
      [{ tls: [] }, { bearer: [] }],
      [],
    ]) {
      expect(run(bridgeDegradation, secured(security))).toMatchObject({ checks: 1, findings: [] })
    }
  })

  it('flags a credential with no header form, naming the schemes', () => {
    const result = run(bridgeDegradation, secured([{ queryKey: [] }, { bearer: [], tls: [] }]))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'bridge-degradation',
      location: 'GET /a',
      dataPath: '/paths/~1a/get',
      params: { names: 'queryKey, tls' },
    })
  })

  it('counts a deprecated scheme as not carried: the export leaves it out', () => {
    const document = doc({
      components: { securitySchemes: { old: { ...schemes.bearer, deprecated: true } } },
      paths: { '/a': { get: op({ security: [{ old: [] }] }) } },
    })
    expect(run(bridgeDegradation, document).findings[0].params).toEqual({ names: 'old' })
  })

  it('counts a scheme whose header an earlier one took as not carried: the config holds one', () => {
    const document = (security) =>
      doc({
        components: {
          securitySchemes: {
            basic: { type: 'http', scheme: 'basic' },
            token: { type: 'http', scheme: 'bearer' },
            oauth: { type: 'oauth2', flows: {} },
          },
        },
        paths: { '/a': { get: op({ security }) } },
      })
    for (const [security, names] of [
      [[{ token: [] }], 'token'],
      [[{ basic: [], token: [] }], 'token'],
      [[{ oauth: ['read'] }], 'oauth'],
    ]) {
      expect(run(bridgeDegradation, document(security)).findings[0].params).toEqual({ names })
    }
    expect(run(bridgeDegradation, document([{ token: [] }, { basic: [] }])).findings).toEqual([])
  })

  it("inherits the document's security, and lets the operation's override it", () => {
    const document = doc({
      security: [{ cookieKey: [] }],
      components: { securitySchemes: schemes },
      paths: {
        '/a': { get: op() },
        '/b': { get: op({ security: [{ bearer: [] }] }) },
        '/c': { get: op({ security: [] }) },
      },
    })
    const result = run(bridgeDegradation, document)
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.location, f.params.names])).toEqual([
      ['GET /a', 'cookieKey'],
    ])
  })

  it('flags a cookie parameter, path-level ones included', () => {
    const result = run(
      bridgeDegradation,
      doc({
        paths: {
          '/a': {
            parameters: [{ name: 'session', in: 'cookie', schema: { type: 'string' } }],
            get: op({ parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }] }),
          },
        },
      }),
    )
    expect(result.findings[0].params).toEqual({ names: 'session' })
  })

  it('leaves an undeclared scheme to security-scheme-declared', () => {
    expect(run(bridgeDegradation, secured([{ nowhere: [] }])).findings).toEqual([])
  })

  it('spares webhooks: the API sends them, no agent calls them', () => {
    const result = run(
      bridgeDegradation,
      doc({
        webhooks: {
          ping: { post: op({ parameters: [{ name: 's', in: 'cookie', schema: {} }] }) },
        },
      }),
    )
    expect(result.checks).toBe(0)
  })
})
