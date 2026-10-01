import { describe, expect, it } from 'vitest'
import { createAuditContext, runRule } from '../src/audit/engine.js'
import { apikeyInQuery } from '../src/audit/rules/apikey-in-query.js'
import { authSchemeWeak } from '../src/audit/rules/auth-scheme-weak.js'
import { httpSchemeRegistered } from '../src/audit/rules/http-scheme-registered.js'
import { oauthUrlTls } from '../src/audit/rules/oauth-url-tls.js'
import { serverHttps } from '../src/audit/rules/server-https.js'
import { serverPlaceholder } from '../src/audit/rules/server-placeholder.js'
import { normalizeDocument } from '../src/openapi/model.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The security rules of docs/audit.md §4.8 on transport and credentials.

const run = (rule, document) => runRule(rule, auditContext(document))
// A document whose 3.2 `$self` the loader resolved to `baseUri`.
const runAt = (rule, document, baseUri) =>
  runRule(
    rule,
    createAuditContext({
      source: document,
      document,
      model: normalizeDocument(document, { baseUri }),
    }),
  )
const op = (extra = {}) => ({ responses: okResponse, ...extra })
const schemes = (securitySchemes, extra = {}) => doc({ components: { securitySchemes }, ...extra })

describe('server-https', () => {
  it('passes https, relative and loopback servers', () => {
    const result = run(
      serverHttps,
      doc({
        servers: [
          { url: 'https://api.example.com' },
          { url: '/v1' },
          { url: 'http://localhost:8080' },
          { url: 'http://127.0.0.1' },
          { url: 'http://[::1]:3000' },
        ],
      }),
    )
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('flags an http server, at every level, with variables at their defaults', () => {
    const result = run(
      serverHttps,
      doc({
        servers: [
          { url: 'http://api.example.com' },
          {
            url: '{scheme}://{region}.example.com',
            variables: { scheme: { default: 'http' }, region: { default: 'eu' } },
          },
          { url: '{scheme}://api.example.com', variables: { scheme: { default: 'https' } } },
        ],
        paths: {
          '/a': {
            servers: [{ url: 'http://a.example.com' }],
            get: op({ servers: [{ url: 'http://get.example.com' }] }),
          },
        },
      }),
    )
    expect(result.checks).toBe(5)
    expect(result.findings.map((f) => [f.dataPath, f.params.url, f.opRef])).toEqual([
      ['/servers/0/url', 'http://api.example.com', null],
      ['/servers/1/url', 'http://eu.example.com', null],
      ['/paths/~1a/get/servers/0/url', 'http://get.example.com', 'get-a'],
      ['/paths/~1a/servers/0/url', 'http://a.example.com', null],
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'warning', location: 'servers.0' })
  })

  it("reads a Link's server, and leaves webhooks and callbacks to their receiver", () => {
    const link = { operationId: 'getA', server: { url: 'http://next.example.com' } }
    const result = run(
      serverHttps,
      doc({
        paths: {
          '/a': {
            get: op({
              operationId: 'getA',
              responses: { 200: { description: 'OK', links: { next: link } } },
              callbacks: {
                done: {
                  '{$request.body#/url}': {
                    servers: [{ url: 'http://hook.example.com' }],
                    post: op({ servers: [{ url: 'http://hook.example.com' }] }),
                  },
                },
              },
            }),
          },
        },
        webhooks: {
          ping: {
            servers: [{ url: 'http://hook.example.com' }],
            post: op({ servers: [{ url: 'http://hook.example.com' }] }),
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/responses/200/links/next/server/url',
    ])
  })

  it('gives no verdict on an undeclared host variable', () => {
    const result = run(serverHttps, doc({ servers: [{ url: 'http://{host}/v1' }] }))
    expect(result.findings).toEqual([])
  })

  it('fills a non-string default, as the try-it does', () => {
    const result = run(
      serverHttps,
      doc({
        servers: [{ url: 'http://api.example.com:{port}', variables: { port: { default: 8080 } } }],
      }),
    )
    expect(result.findings.map((f) => f.params.url)).toEqual(['http://api.example.com:8080'])
  })

  it("resolves a relative server against the document's $self, as the try-it does", () => {
    const servers = [{ url: '/v1' }, { url: 'https://api.example.com' }]
    const http = runAt(serverHttps, doc({ servers }), 'http://api.example.com/openapi.json')
    expect(http.findings.map((f) => [f.dataPath, f.params.url])).toEqual([
      ['/servers/0/url', 'http://api.example.com/v1'],
    ])
    const https = runAt(serverHttps, doc({ servers }), 'https://api.example.com/openapi.json')
    expect(https).toMatchObject({ checks: 2, findings: [] })
  })
})

describe('oauth-url-tls', () => {
  const oauth = (flows, extra = {}) => ({ type: 'oauth2', flows, ...extra })

  it('passes https, relative and loopback endpoints', () => {
    const result = run(
      oauthUrlTls,
      schemes({
        o: oauth({
          authorizationCode: {
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: '/oauth/token',
            refreshUrl: 'http://localhost:9000/refresh',
            scopes: {},
          },
        }),
        oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://id.example.com/.well-known' },
      }),
    )
    expect(result).toMatchObject({ checks: 4, findings: [] })
  })

  it('flags every cleartext endpoint, one check per URL', () => {
    const result = run(
      oauthUrlTls,
      schemes(
        {
          o: oauth(
            {
              authorizationCode: {
                authorizationUrl: 'http://auth.example.com/authorize',
                tokenUrl: 'http://auth.example.com/token',
                refreshUrl: 'http://auth.example.com/refresh',
                scopes: {},
              },
              deviceAuthorization: {
                deviceAuthorizationUrl: 'http://auth.example.com/device',
                tokenUrl: 'https://auth.example.com/token',
                scopes: {},
              },
            },
            { oauth2MetadataUrl: 'http://auth.example.com/.well-known/oauth-authorization-server' },
          ),
          oidc: { type: 'openIdConnect', openIdConnectUrl: 'http://id.example.com/.well-known' },
        },
        { openapi: '3.2.0' },
      ),
    )
    expect(result.checks).toBe(7)
    expect(result.findings.map((f) => [f.params.field, f.dataPath])).toEqual([
      ['oauth2MetadataUrl', '/components/securitySchemes/o/oauth2MetadataUrl'],
      [
        'authorizationUrl',
        '/components/securitySchemes/o/flows/authorizationCode/authorizationUrl',
      ],
      ['tokenUrl', '/components/securitySchemes/o/flows/authorizationCode/tokenUrl'],
      ['refreshUrl', '/components/securitySchemes/o/flows/authorizationCode/refreshUrl'],
      [
        'deviceAuthorizationUrl',
        '/components/securitySchemes/o/flows/deviceAuthorization/deviceAuthorizationUrl',
      ],
      ['openIdConnectUrl', '/components/securitySchemes/oidc/openIdConnectUrl'],
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'error',
      location: 'components.securitySchemes.o',
    })
  })

  it('ignores a URL nothing fetches: wrong flow, wrong scheme type', () => {
    const result = run(
      oauthUrlTls,
      schemes({
        o: oauth({
          clientCredentials: {
            authorizationUrl: 'http://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: {},
          },
        }),
        k: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Key',
          openIdConnectUrl: 'http://id.example.com',
          flows: { implicit: { authorizationUrl: 'http://auth.example.com', scopes: {} } },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('auth-scheme-weak', () => {
  const declared = {
    basic: { type: 'http', scheme: 'Basic' },
    bearer: { type: 'http', scheme: 'bearer' },
    mtls: { type: 'mutualTLS' },
    oauth: { type: 'oauth2', flows: {} },
    key: { type: 'apiKey', in: 'header', name: 'X-Key' },
  }
  const api = (servers, paths) => schemes(declared, { servers, paths })

  it('passes a credential sent over https or to loopback', () => {
    const result = run(
      authSchemeWeak,
      api([{ url: 'https://api.example.com' }], {
        '/a': {
          get: op({ security: [{ bearer: [] }] }),
          post: op({ security: [{ basic: [] }], servers: [{ url: 'http://localhost:8080' }] }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('grades each operation at its scheme: basic warning, bearer and mutualTLS error', () => {
    const result = run(
      authSchemeWeak,
      api([{ url: 'http://api.example.com' }], {
        '/basic': { get: op({ security: [{ basic: [] }] }) },
        '/bearer': { get: op({ security: [{ bearer: [] }] }) },
        '/mtls': { get: op({ security: [{ mtls: [] }] }) },
        '/oauth': { get: op({ security: [{ oauth: [] }] }) },
      }),
    )
    expect(
      result.findings.map((f) => [f.opRef, f.severity, f.params.scheme, f.params.url]),
    ).toEqual([
      ['get-basic', 'warning', 'basic', 'http://api.example.com'],
      ['get-bearer', 'error', 'bearer', 'http://api.example.com'],
      ['get-mtls', 'error', 'mtls', 'http://api.example.com'],
      ['get-oauth', 'error', 'oauth', 'http://api.example.com'],
    ])
  })

  it('reports one finding per operation, at the most severe scheme of any alternative', () => {
    const result = run(
      authSchemeWeak,
      api([{ url: 'https://api.example.com' }, { url: 'http://legacy.example.com' }], {
        '/a': { get: op({ security: [{ basic: [] }, { key: [], bearer: [] }, {}] }) },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        params: { scheme: 'bearer', url: 'http://legacy.example.com' },
      }),
    ])
  })

  it('reads the servers the operation goes to, variables at their defaults', () => {
    const result = run(
      authSchemeWeak,
      schemes(declared, {
        servers: [{ url: 'http://api.example.com' }],
        security: [{ bearer: [] }],
        paths: {
          '/own': { get: op({ servers: [{ url: 'https://api.example.com' }] }) },
          '/item': {
            servers: [{ url: '{s}://item.example.com', variables: { s: { default: 'http' } } }],
            get: op(),
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.opRef, f.params.url])).toEqual([
      ['get-item', 'http://item.example.com'],
    ])
  })

  it('skips operations without such a scheme, public ones, webhooks and undeclared schemes', () => {
    const result = run(
      authSchemeWeak,
      schemes(declared, {
        openapi: '3.1.0',
        servers: [{ url: 'http://api.example.com' }],
        paths: {
          '/key': { get: op({ security: [{ key: [] }] }) },
          '/open': { get: op({ security: [] }) },
          '/ghost': { get: op({ security: [{ ghost: [] }] }) },
          '/none': { get: op() },
        },
        webhooks: { ping: { post: op({ security: [{ bearer: [] }] }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it("reads a relative server against the document's $self", () => {
    const document = schemes(declared, {
      servers: [{ url: '/v1' }],
      paths: { '/a': { get: op({ security: [{ bearer: [] }] }) } },
    })
    const result = runAt(authSchemeWeak, document, 'http://api.example.com/openapi.json')
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        params: { scheme: 'bearer', url: 'http://api.example.com/v1' },
      }),
    ])
    expect(run(authSchemeWeak, document)).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('server-placeholder', () => {
  it("reads a relative server against the document's $self", () => {
    const document = doc({ servers: [{ url: '/v1' }] })
    expect(run(serverPlaceholder, document)).toMatchObject({ checks: 0, findings: [] })
    const result = runAt(serverPlaceholder, document, 'https://api.example.com/openapi.json')
    expect(result.findings.map((f) => f.params.url)).toEqual(['https://api.example.com/v1'])
  })
})

describe('apikey-in-query', () => {
  it('passes a key in a header or a cookie, and skips other schemes', () => {
    const result = run(
      apikeyInQuery,
      schemes({
        h: { type: 'apiKey', in: 'header', name: 'X-Key' },
        c: { type: 'apiKey', in: 'cookie', name: 'session' },
        b: { type: 'http', scheme: 'bearer' },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags a key in the query string, named by its parameter', () => {
    const result = run(
      apikeyInQuery,
      schemes({
        q: { type: 'apiKey', in: 'query', name: 'api_key' },
        anonymous: { type: 'apiKey', in: 'query' },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.name, f.severity])).toEqual([
      ['/components/securitySchemes/q/in', 'api_key', 'warning'],
      ['/components/securitySchemes/anonymous/in', 'anonymous', 'warning'],
    ])
    expect(result.findings[0].location).toBe('components.securitySchemes.q')
  })
})

describe('http-scheme-registered', () => {
  it('passes registered schemes, in any case', () => {
    const result = run(
      httpSchemeRegistered,
      schemes({
        a: { type: 'http', scheme: 'Bearer', bearerFormat: 'JWT' },
        b: { type: 'http', scheme: 'basic' },
        c: { type: 'http', scheme: 'DPoP' },
        d: { type: 'http', scheme: 'SCRAM-SHA-256' },
        e: { type: 'http', scheme: 'vapid' },
        f: { type: 'apiKey', in: 'header', name: 'JWT' },
      }),
    )
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('flags what is no IANA scheme, spaces included', () => {
    const result = run(
      httpSchemeRegistered,
      schemes({
        jwt: { type: 'http', scheme: 'JWT' },
        token: { type: 'http', scheme: 'token' },
        key: { type: 'http', scheme: 'apiKey' },
        spaced: { type: 'http', scheme: 'Bearer ' },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.scheme])).toEqual([
      ['/components/securitySchemes/jwt/scheme', 'JWT'],
      ['/components/securitySchemes/token/scheme', 'token'],
      ['/components/securitySchemes/key/scheme', 'apiKey'],
      ['/components/securitySchemes/spaced/scheme', 'Bearer '],
    ])
  })

  it('gives no verdict on an empty or missing scheme', () => {
    const result = run(
      httpSchemeRegistered,
      schemes({ empty: { type: 'http', scheme: '' }, none: { type: 'http' } }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })
})
