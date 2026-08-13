import { describe, expect, it } from 'vitest'
import {
  applicableSchemes,
  buildAuthInjection,
  credentialFields,
  credentialsStatus,
  suggestedVariables,
} from '../src/openapi/auth.js'

const bearer = { name: 'bearerAuth', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
const basic = { name: 'basicAuth', type: 'http', scheme: 'basic' }
const apiKeyHeader = { name: 'apiKey', type: 'apiKey', in: 'header', paramName: 'X-API-Key' }
const apiKeyQuery = { name: 'apiKey', type: 'apiKey', in: 'query', paramName: 'api_key' }
const apiKeyCookie = { name: 'apiKey', type: 'apiKey', in: 'cookie', paramName: 'session' }
const oauth = { name: 'petstore_auth', type: 'oauth2', flows: ['implicit'] }

const model = {
  securitySchemes: [bearer, basic, apiKeyHeader],
  security: [{ bearerAuth: [] }],
}

describe('suggestedVariables', () => {
  it('maps a scheme to auth.{X}', () => {
    expect(suggestedVariables(bearer)).toEqual(['auth.bearerAuth'])
    expect(suggestedVariables(apiKeyHeader)).toEqual(['auth.apiKey'])
  })

  it('derives username/password for http basic', () => {
    expect(suggestedVariables(basic)).toEqual([
      'auth.basicAuth.username',
      'auth.basicAuth.password',
    ])
  })
})

describe('credentialFields', () => {
  it('qualifies the field according to the scheme type', () => {
    expect(credentialFields(bearer)).toEqual([
      { name: 'auth.bearerAuth', kind: 'token', sensitive: true },
    ])
    expect(credentialFields(apiKeyHeader)).toEqual([
      { name: 'auth.apiKey', kind: 'apiKey', sensitive: true },
    ])
    expect(credentialFields(oauth)).toEqual([
      { name: 'auth.petstore_auth', kind: 'token', sensitive: true },
    ])
  })

  it('separates username and password for http basic, only the latter marked sensitive', () => {
    expect(credentialFields(basic)).toEqual([
      { name: 'auth.basicAuth.username', kind: 'username', sensitive: false },
      { name: 'auth.basicAuth.password', kind: 'password', sensitive: true },
    ])
  })
})

describe('applicableSchemes', () => {
  it('inherits global security when the operation does not declare any', () => {
    expect(applicableSchemes(model, { security: null })).toEqual({
      schemes: [bearer],
      optional: false,
    })
  })

  it('respects the per-operation override', () => {
    expect(applicableSchemes(model, { security: [{ apiKey: [] }] }).schemes).toEqual([apiKeyHeader])
  })

  it('security [] disables auth', () => {
    expect(applicableSchemes(model, { security: [] })).toEqual({ schemes: [], optional: false })
  })

  it('an empty requirement {} makes auth optional', () => {
    const r = applicableSchemes(model, { security: [{}, { bearerAuth: [] }] })
    expect(r.optional).toBe(true)
    expect(r.schemes).toEqual([bearer])
  })

  it('ignores undeclared schemes', () => {
    expect(applicableSchemes(model, { security: [{ ghost: [] }] }).schemes).toEqual([])
  })
})

describe('credentialsStatus', () => {
  it('resolves each conventional variable of the scheme', () => {
    expect(
      credentialsStatus(bearer, { 'auth.bearerAuth': { value: 'tok-123', sensitive: true } }),
    ).toEqual([{ name: 'auth.bearerAuth', set: true, sensitive: true, value: 'tok-123' }])
  })

  it('reports missing or empty variables as unset', () => {
    expect(
      credentialsStatus(basic, { 'auth.basicAuth.username': { value: '', sensitive: false } }),
    ).toEqual([
      { name: 'auth.basicAuth.username', set: false, sensitive: false, value: '' },
      { name: 'auth.basicAuth.password', set: false, sensitive: false, value: '' },
    ])
  })
})

describe('buildAuthInjection', () => {
  const vars = {
    'auth.bearerAuth': { value: 'tok-123', sensitive: true },
    'auth.apiKey': { value: 'key-456', sensitive: true },
    'auth.basicAuth.username': { value: 'alice', sensitive: false },
    'auth.basicAuth.password': { value: 'p@ss', sensitive: true },
  }

  it('http bearer → Authorization: Bearer {{auth.X}}', () => {
    const r = buildAuthInjection(bearer, vars)
    expect(r.headers).toEqual({ Authorization: 'Bearer tok-123' })
    expect(r.missing).toEqual([])
    expect(r.used).toEqual([{ name: 'auth.bearerAuth', value: 'tok-123', sensitive: true }])
  })

  it('missing variable → no header, blocking reported', () => {
    const r = buildAuthInjection(bearer, {})
    expect(r.headers).toEqual({})
    expect(r.missing).toEqual(['auth.bearerAuth'])
  })

  it('apiKey header / query / cookie depending on the scheme', () => {
    expect(buildAuthInjection(apiKeyHeader, vars).headers).toEqual({ 'X-API-Key': 'key-456' })
    expect(buildAuthInjection(apiKeyQuery, vars).query).toEqual({ api_key: 'key-456' })
    expect(buildAuthInjection(apiKeyCookie, vars).cookies).toEqual({ session: 'key-456' })
  })

  it('http basic → base64(user:pass), marked sensitive for redaction', () => {
    const r = buildAuthInjection(basic, vars)
    expect(r.headers.Authorization).toBe(`Basic ${btoa('alice:p@ss')}`)
    expect(r.used.at(-1)).toEqual({
      name: 'auth.basicAuth',
      value: r.headers.Authorization,
      sensitive: true,
    })
  })

  it('incomplete http basic → blocked', () => {
    const r = buildAuthInjection(basic, { 'auth.basicAuth.username': { value: 'alice' } })
    expect(r.headers).toEqual({})
    expect(r.missing).toEqual(['auth.basicAuth.password'])
  })

  it('oauth2 → manual token as Bearer', () => {
    const r = buildAuthInjection(oauth, {
      'auth.petstore_auth': { value: 'manual-token', sensitive: true },
    })
    expect(r.headers).toEqual({ Authorization: 'Bearer manual-token' })
    expect(buildAuthInjection(oauth, {}).missing).toEqual(['auth.petstore_auth'])
  })
})

// The scheme key becomes an environment variable name, so it has to survive the
// `{{var}}` grammar (`[\w.-]+`) intact. OpenAPI allows dots, dashes,
// underscores, digits and any case in `components.securitySchemes` keys; a name
// mangled on the way to the variable is silent — the credentials card offers a
// field whose value the injection then never finds.
describe('scheme names that stress the variable grammar', () => {
  const dotted = { name: 'my.api.Key', type: 'apiKey', in: 'header', paramName: 'X-Key' }
  const uppercase = { name: 'BEARER_Auth-2', type: 'http', scheme: 'bearer' }
  const dottedBasic = { name: 'corp.basic', type: 'http', scheme: 'basic' }

  it('carries the key verbatim into the suggested variables', () => {
    expect(suggestedVariables(dotted)).toEqual(['auth.my.api.Key'])
    expect(suggestedVariables(uppercase)).toEqual(['auth.BEARER_Auth-2'])
    expect(suggestedVariables(dottedBasic)).toEqual([
      'auth.corp.basic.username',
      'auth.corp.basic.password',
    ])
  })

  it('resolves the same names at injection time', () => {
    expect(
      buildAuthInjection(dotted, { 'auth.my.api.Key': { value: 'k-1', sensitive: true } }).headers,
    ).toEqual({ 'X-Key': 'k-1' })
    expect(
      buildAuthInjection(uppercase, { 'auth.BEARER_Auth-2': { value: 't-2', sensitive: true } })
        .headers,
    ).toEqual({ Authorization: 'Bearer t-2' })
    expect(
      buildAuthInjection(dottedBasic, {
        'auth.corp.basic.username': { value: 'alice' },
        'auth.corp.basic.password': { value: 'p@ss' },
      }).headers.Authorization,
    ).toBe(`Basic ${btoa('alice:p@ss')}`)
  })

  it('reports the exact name the field asks for when it is unset', () => {
    // The two sides have to agree character for character: a status naming a
    // variable the injection does not look up leaves the user filling a field
    // that changes nothing.
    for (const scheme of [dotted, uppercase, dottedBasic]) {
      expect(buildAuthInjection(scheme, {}).missing).toEqual(
        credentialFields(scheme).map((field) => field.name),
      )
    }
  })
})
