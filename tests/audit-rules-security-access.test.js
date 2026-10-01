import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { oauthLegacyFlows } from '../src/audit/rules/oauth-legacy-flows.js'
import { operationUnsecured } from '../src/audit/rules/operation-unsecured.js'
import { rateLimitRetryAfter } from '../src/audit/rules/rate-limit-retry-after.js'
import { securedOpErrors } from '../src/audit/rules/secured-op-errors.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

const op = (fields = {}) => ({ responses: okResponse, ...fields })
const schemes = { key: { type: 'apiKey', in: 'header', name: 'X-Key' } }

describe('operation-unsecured', () => {
  it('reports a document that documents no authentication once, not per operation', () => {
    const result = run(
      operationUnsecured,
      doc({ paths: { '/a': { get: op(), post: op() }, '/b': { delete: op() } } }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'operation-unsecured',
        category: 'security',
        severity: 'warning',
        location: 'components.securitySchemes',
        dataPath: '/components/securitySchemes',
        opRef: null,
        params: { access: 'omitted' },
      }),
    ])
  })

  it('has nothing to check on a document without operations', () => {
    expect(run(operationUnsecured, doc())).toMatchObject({ checks: 0, findings: [] })
  })

  it('passes secured operations, graded at the severity an omission would have had', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{ key: [] }],
        paths: { '/a': { get: op(), post: op() } },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
    // One info check (GET) and one warning check (POST).
    expect(result.weight).toBeGreaterThan(0)
    const getOnly = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{ key: [] }],
        paths: { '/a': { get: op() } },
      }),
    )
    const postOnly = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{ key: [] }],
        paths: { '/a': { post: op() } },
      }),
    )
    expect(getOnly.weight).toBeLessThan(postOnly.weight)
  })

  it('grades an omission by method: warning when it writes, info when it reads', () => {
    const result = run(
      operationUnsecured,
      doc({
        openapi: '3.2.0',
        components: { securitySchemes: schemes },
        paths: {
          '/a': {
            get: op(),
            head: op(),
            options: op(),
            trace: op(),
            query: op(),
            post: op(),
            put: op(),
            patch: op(),
            delete: op(),
            additionalOperations: { SEARCH: op(), PURGE: op() },
          },
          // Secured on its own: passes.
          '/b': { post: op({ security: [{ key: [] }] }) },
        },
      }),
    )
    const byLocation = Object.fromEntries(
      result.findings.map((finding) => [finding.location, finding.severity]),
    )
    expect(byLocation).toEqual({
      'GET /a': 'info',
      'HEAD /a': 'info',
      'OPTIONS /a': 'info',
      'TRACE /a': 'info',
      'QUERY /a': 'info',
      'SEARCH /a': 'info',
      'POST /a': 'warning',
      'PUT /a': 'warning',
      'PATCH /a': 'warning',
      'DELETE /a': 'warning',
      'PURGE /a': 'warning',
    })
    expect(result.checks).toBe(12)
    expect(result.findings.every((finding) => finding.params.access === 'omitted')).toBe(true)
    expect(result.findings.find((finding) => finding.location === 'PURGE /a')).toMatchObject({
      dataPath: '/paths/~1a/additionalOperations/PURGE',
    })
  })

  it('lists what is public by declaration as info, whatever the method', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{ key: [] }],
        paths: {
          '/login': { post: op({ security: [] }) },
          '/feed': { delete: op({ security: [{ key: [] }, {}] }) },
        },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        location: 'POST /login',
        dataPath: '/paths/~1login/post/security',
        params: { access: 'declared' },
      }),
      expect.objectContaining({
        severity: 'info',
        location: 'DELETE /feed',
        params: { access: 'declared' },
      }),
    ])
  })

  it('reads a root security: [] as an omission, not a statement about any operation', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [],
        paths: { '/a': { get: op(), put: op() } },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'GET /a',
        severity: 'info',
        params: { access: 'omitted' },
      }),
      expect.objectContaining({
        location: 'PUT /a',
        severity: 'warning',
        params: { access: 'omitted' },
      }),
    ])
    // With no scheme either, the document documents no authentication at all.
    const bare = run(operationUnsecured, doc({ security: [], paths: { '/a': { put: op() } } }))
    expect(bare.findings).toEqual([
      expect.objectContaining({
        dataPath: '/components/securitySchemes',
        params: { access: 'omitted' },
      }),
    ])
  })

  it('reads a root {} alternative as optional authentication, declared', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{}, { key: [] }],
        paths: { '/a': { put: op() } },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        dataPath: '/paths/~1a/put',
        params: { access: 'declared' },
      }),
    ])
  })

  it('falls back to the root on a security that is not a list', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        security: [{ key: [] }],
        paths: { '/a': { post: op({ security: {} }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('checks hidden operations, without a link, and leaves webhooks and callbacks out', () => {
    const document = doc({
      openapi: '3.1.0',
      components: { securitySchemes: schemes },
      paths: {
        '/internal': {
          post: op({
            'x-apiglow-hide': true,
            callbacks: { done: { '{$request.body#/url}': { post: op() } } },
          }),
        },
      },
      webhooks: { ping: { post: op() } },
    })
    const result = run(operationUnsecured, document)
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({ hidden: true, opRef: null, severity: 'warning' })
  })

  it('gives no verdict on a security list of malformed entries', () => {
    const result = run(
      operationUnsecured,
      doc({
        components: { securitySchemes: schemes },
        paths: { '/a': { post: op({ security: ['key'] }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('checks per operation as soon as a scheme or a security list exists', () => {
    // Schemes declared, never required: every operation is open by omission.
    const declaredOnly = run(
      operationUnsecured,
      doc({ components: { securitySchemes: schemes }, paths: { '/a': { post: op() } } }),
    )
    expect(declaredOnly.findings).toEqual([
      expect.objectContaining({ location: 'POST /a', severity: 'warning' }),
    ])
    // A requirement on one operation, no scheme: the others are omissions.
    const oneSecured = run(
      operationUnsecured,
      doc({
        paths: { '/a': { post: op({ security: [{ key: [] }] }) }, '/b': { get: op() } },
      }),
    )
    expect(oneSecured.findings).toEqual([
      expect.objectContaining({ location: 'GET /b', severity: 'info' }),
    ])
  })
})

describe('secured-op-errors', () => {
  const secured = (responses, extra = {}) =>
    doc({
      components: { securitySchemes: schemes, ...extra },
      security: [{ key: [] }],
      paths: { '/a': { get: { responses } } },
    })
  const challenge = { 'www-authenticate': { schema: { type: 'string' } } }

  it('passes a secured operation documenting a 401, a 403 or the 4XX range', () => {
    for (const status of ['401', '403', '4XX', '4xx']) {
      const response = { description: 'No', headers: challenge }
      const result = run(securedOpErrors, secured({ ...okResponse, [status]: response }))
      expect(result.findings).toEqual([])
    }
  })

  it('flags a secured operation whose only errors say nothing of credentials', () => {
    const result = run(
      securedOpErrors,
      secured({ ...okResponse, 400: { description: 'Bad' }, default: { description: 'Error' } }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'secured-op-errors',
        severity: 'info',
        location: 'GET /a',
        dataPath: '/paths/~1a/get/responses',
        params: { missing: '401 / 403' },
      }),
    ])
  })

  it('reports a document whose secured operations all stay silent once', () => {
    const silent = { get: { responses: okResponse } }
    const document = doc({
      components: { securitySchemes: schemes },
      security: [{ key: [] }],
      paths: { '/a': silent, '/b': silent, '/c': silent },
    })
    const result = run(securedOpErrors, document)
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'paths',
        dataPath: '/paths',
        params: { missing: '401 / 403' },
      }),
    ])
    // One that does document a refusal turns the others back into findings
    // of their own.
    document.paths['/c'] = { get: { responses: { ...okResponse, 403: { description: 'No' } } } }
    expect(run(securedOpErrors, document).findings.map((f) => f.location)).toEqual([
      'GET /a',
      'GET /b',
    ])
  })

  it('does not ask an open operation to document a refusal', () => {
    for (const document of [
      doc({ paths: { '/a': { get: op() } } }),
      doc({ security: [], paths: { '/a': { get: op() } } }),
      doc({ paths: { '/a': { get: op({ security: [{ key: [] }, {}] }) } } }),
      doc({ paths: { '/a': { get: op({ security: [{}] }) } } }),
    ]) {
      expect(run(securedOpErrors, document)).toMatchObject({ checks: 0, findings: [] })
    }
  })

  it('flags a 401 without WWW-Authenticate, on any tool operation', () => {
    const result = run(
      securedOpErrors,
      doc({
        paths: { '/a': { get: op({ responses: { ...okResponse, 401: { description: 'No' } } }) } },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'GET /a',
        dataPath: '/paths/~1a/get/responses/401',
        params: { missing: 'WWW-Authenticate' },
      }),
    ])
  })

  it('accepts the header in any case', () => {
    const result = run(
      securedOpErrors,
      secured({
        ...okResponse,
        401: { description: 'No', headers: { 'WWW-Authenticate': { schema: { type: 'string' } } } },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('checks a 401 shared through components.responses once, at the component', () => {
    const unauthorized = { description: 'Unauthorized' }
    const document = doc({
      components: { securitySchemes: schemes, responses: { Unauthorized: unauthorized } },
      security: [{ key: [] }],
      paths: {
        '/a': { get: { responses: { ...okResponse, 401: unauthorized } } },
        '/b': { post: { responses: { ...okResponse, 401: unauthorized } } },
        '/c': { get: { responses: { ...okResponse, 401: { description: 'Inline' } } } },
      },
    })
    const result = run(securedOpErrors, document)
    const challenges = result.findings.filter(
      (finding) => finding.params.missing === 'WWW-Authenticate',
    )
    expect(challenges).toEqual([
      expect.objectContaining({
        location: 'components.responses.Unauthorized',
        dataPath: '/components/responses/Unauthorized',
        opRef: null,
      }),
      expect.objectContaining({ location: 'GET /c', dataPath: '/paths/~1c/get/responses/401' }),
    ])
    // Three operations documenting a 401, one component check + one inline.
    expect(result.checks).toBe(5)
  })

  it('leaves webhook responses out', () => {
    const result = run(
      securedOpErrors,
      doc({
        security: [{ key: [] }],
        components: { securitySchemes: schemes },
        webhooks: { ping: { post: { responses: { 401: { description: 'No' } } } } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })
})

describe('oauth-legacy-flows', () => {
  const flow = { tokenUrl: 'https://auth.example.com/token', scopes: {} }
  const oauth = (flows, extra = {}) =>
    doc({ components: { securitySchemes: { oauth: { type: 'oauth2', flows, ...extra } } } })

  it('passes the flows the best practice keeps', () => {
    const result = run(
      oauthLegacyFlows,
      oauth({
        authorizationCode: { ...flow, authorizationUrl: 'https://auth.example.com/authorize' },
        clientCredentials: flow,
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('grades the password flow error and the implicit flow warning', () => {
    const result = run(
      oauthLegacyFlows,
      oauth({
        password: flow,
        implicit: { authorizationUrl: 'https://auth.example.com/authorize', scopes: {} },
        clientCredentials: flow,
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'oauth-legacy-flows',
        category: 'security',
        severity: 'warning',
        location: 'components.securitySchemes.oauth',
        dataPath: '/components/securitySchemes/oauth/flows/implicit',
        params: { flow: 'implicit' },
      }),
      expect.objectContaining({
        severity: 'error',
        dataPath: '/components/securitySchemes/oauth/flows/password',
        params: { flow: 'password' },
      }),
    ])
  })

  it('still reports the flows of a deprecated scheme', () => {
    const document = oauth({ password: flow }, { deprecated: true })
    document.openapi = '3.2.0'
    expect(run(oauthLegacyFlows, document).findings).toHaveLength(1)
  })

  it('ignores flows outside an oauth2 scheme, and malformed flows', () => {
    const document = doc({
      components: {
        securitySchemes: {
          key: { type: 'apiKey', in: 'header', name: 'X', flows: { password: flow } },
          broken: { type: 'oauth2', flows: { password: 'yes', implicit: null } },
          none: { type: 'oauth2' },
        },
      },
    })
    expect(run(oauthLegacyFlows, document)).toMatchObject({ checks: 0, findings: [] })
  })
})

describe('rate-limit-retry-after', () => {
  const throttled = (response) =>
    doc({ paths: { '/a': { get: op({ responses: { ...okResponse, 429: response } }) } } })

  it('passes a 429 declaring Retry-After, in any case', () => {
    for (const name of ['Retry-After', 'retry-after']) {
      const result = run(
        rateLimitRetryAfter,
        throttled({
          description: 'Slow down',
          headers: { [name]: { schema: { type: 'integer' } } },
        }),
      )
      expect(result).toMatchObject({ checks: 1, findings: [] })
    }
  })

  it('flags a 429 without it, quota headers notwithstanding', () => {
    const result = run(
      rateLimitRetryAfter,
      throttled({
        description: 'Slow down',
        headers: { 'X-RateLimit-Reset': { schema: { type: 'integer' } } },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'rate-limit-retry-after',
        category: 'security',
        severity: 'info',
        location: 'GET /a',
        dataPath: '/paths/~1a/get/responses/429',
        params: { status: '429' },
      }),
    ])
  })

  it('checks a shared 429 once, at the component, and skips webhooks', () => {
    const tooMany = { description: 'Too many requests' }
    const document = doc({
      components: { responses: { TooMany: tooMany } },
      paths: {
        '/a': { get: op({ responses: { ...okResponse, 429: tooMany } }) },
        '/b': { get: op({ responses: { ...okResponse, 429: tooMany } }) },
      },
      webhooks: { ping: { post: op({ responses: { 429: { description: 'Busy' } } }) } },
    })
    const result = run(rateLimitRetryAfter, document)
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'components.responses.TooMany',
        dataPath: '/components/responses/TooMany',
        opRef: null,
      }),
    ])
  })

  it('has nothing to check without a 429', () => {
    expect(run(rateLimitRetryAfter, throttled(undefined))).toMatchObject({ checks: 0 })
  })
})
