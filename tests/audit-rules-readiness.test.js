import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { oauthFlowUrls } from '../src/audit/rules/oauth-flow-urls.js'
import { operationIdPresent } from '../src/audit/rules/operation-id-present.js'
import { operationTagged } from '../src/audit/rules/operation-tagged.js'
import { securitySchemeDescribed } from '../src/audit/rules/security-scheme-described.js'
import { serversDeclared } from '../src/audit/rules/servers-declared.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

describe('operation-id-present', () => {
  it('passes on a declared operationId', () => {
    const result = run(
      operationIdPresent,
      doc({ paths: { '/pets': { get: { operationId: 'listPets', responses: okResponse } } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags the operation and names the fallback route id', () => {
    const result = run(
      operationIdPresent,
      doc({ paths: { '/pets/{petId}': { get: { responses: okResponse } } } }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'operation-id-present',
      severity: 'warning',
      category: 'readiness',
      location: 'GET /pets/{petId}',
      opRef: 'get-pets-petid',
      params: { fallbackId: 'get-pets-petid' },
    })
  })
})

describe('operation-tagged', () => {
  it('passes on a tagged operation', () => {
    const result = run(
      operationTagged,
      doc({ paths: { '/pets': { get: { tags: ['pets'], responses: okResponse } } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags an operation carrying only a 3.2 label tag', () => {
    const result = run(
      operationTagged,
      doc({
        tags: [{ name: 'partner', kind: 'audience' }],
        paths: { '/pets': { get: { tags: ['partner'], responses: okResponse } } },
      }),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('flags an untagged operation, and an empty tag list', () => {
    const result = run(
      operationTagged,
      doc({
        paths: {
          '/pets': { get: { responses: okResponse } },
          '/owners': { get: { tags: [], responses: okResponse } },
          '/vets': { get: { tags: ['vets'], responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.location, f.params])).toEqual([
      ['GET /pets', { count: 1 }],
      ['GET /owners', { count: 1 }],
    ])
    expect(result.findings[0].severity).toBe('info')
  })

  it('reports a document tagging nothing once, as one decision', () => {
    const result = run(
      operationTagged,
      doc({
        paths: {
          '/pets': { get: { responses: okResponse } },
          '/owners': { get: { responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({ location: 'paths', dataPath: '/paths', params: { count: 2 } }),
    ])
  })

  it('ignores webhooks, which the nav never groups by tag', () => {
    const result = run(
      operationTagged,
      doc({
        paths: { '/pets': { get: { tags: ['pets'], responses: okResponse } } },
        webhooks: { petStatus: { post: { responses: okResponse } } },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('servers-declared', () => {
  it('passes on a server with a URL', () => {
    const result = run(serversDeclared, doc())
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a document with no usable server', () => {
    const result = run(serversDeclared, doc({ servers: [{ description: 'no url' }] }))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'servers-declared',
      severity: 'warning',
      location: 'servers',
      dataPath: '/servers',
      opRef: null,
    })
  })
})

describe('security-scheme-described', () => {
  const withSchemes = (securitySchemes) => doc({ components: { securitySchemes } })

  it('passes on a described scheme', () => {
    const result = run(
      securitySchemeDescribed,
      withSchemes({
        apiKey: { type: 'apiKey', in: 'header', name: 'X-Key', description: 'Ask us' },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a scheme with no description', () => {
    const result = run(
      securitySchemeDescribed,
      withSchemes({ apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'security-scheme-described',
      severity: 'info',
      location: 'components.securitySchemes.apiKey',
      dataPath: '/components/securitySchemes/apiKey',
      params: { name: 'apiKey' },
    })
  })
})

describe('oauth-flow-urls', () => {
  const withFlows = (flows) =>
    doc({ components: { securitySchemes: { oauth: { type: 'oauth2', flows } } } })

  it('passes on a complete authorizationCode flow', () => {
    const result = run(
      oauthFlowUrls,
      withFlows({
        authorizationCode: {
          authorizationUrl: 'https://example.com/authorize',
          tokenUrl: 'https://example.com/token',
          scopes: {},
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags the missing URL of each flow', () => {
    const result = run(
      oauthFlowUrls,
      withFlows({
        authorizationCode: { authorizationUrl: 'https://example.com/authorize', scopes: {} },
        clientCredentials: { scopes: {} },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((finding) => finding.params)).toEqual([
      { name: 'oauth', flow: 'authorizationCode', url: 'tokenUrl' },
      { name: 'oauth', flow: 'clientCredentials', url: 'tokenUrl' },
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      location: 'components.securitySchemes.oauth.flows.authorizationCode',
      dataPath: '/components/securitySchemes/oauth/flows/authorizationCode/tokenUrl',
    })
  })

  it('ignores a scheme that is not oauth2', () => {
    const result = run(
      oauthFlowUrls,
      doc({ components: { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } } }),
    )
    expect(result.checks).toBe(0)
  })
})
