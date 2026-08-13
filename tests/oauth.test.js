import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationUrl,
  clientCredentialsBody,
  codeExchangeBody,
  drivableFlows,
  oauthSuggestedVariables,
  parseCallbackParams,
  parseTokenResponse,
  pkceChallenge,
  randomToken,
  requiredScopes,
  stripCallbackParams,
} from '../src/openapi/oauth.js'

const AUTH_CODE_FLOW = {
  key: 'authorizationCode',
  authorizationUrl: 'https://auth.example/authorize',
  tokenUrl: 'https://auth.example/token',
  scopes: { 'read:pets': 'Read', 'write:pets': 'Write' },
}

describe('drivableFlows', () => {
  it('keeps complete authorizationCode and clientCredentials with tokenUrl', () => {
    const scheme = {
      type: 'oauth2',
      flows: [
        AUTH_CODE_FLOW,
        { key: 'clientCredentials', tokenUrl: 'https://auth.example/token' },
        { key: 'implicit', authorizationUrl: 'https://auth.example/authorize' },
        { key: 'password', tokenUrl: 'https://auth.example/token' },
        { key: 'authorizationCode', tokenUrl: 'https://auth.example/token' }, // missing authorizationUrl
      ],
    }
    expect(drivableFlows(scheme).map((f) => f.key)).toEqual([
      'authorizationCode',
      'clientCredentials',
    ])
  })

  it('ignores non-oauth2 schemes and schemes without flows', () => {
    expect(drivableFlows({ type: 'http', scheme: 'bearer' })).toEqual([])
    expect(drivableFlows({ type: 'oauth2' })).toEqual([])
  })
})

describe('oauthSuggestedVariables', () => {
  it('suggests clientId, and clientSecret only with client credentials', () => {
    const base = { type: 'oauth2', name: 'oa' }
    expect(oauthSuggestedVariables({ ...base, flows: [AUTH_CODE_FLOW] })).toEqual([
      'auth.oa.clientId',
    ])
    expect(
      oauthSuggestedVariables({
        ...base,
        flows: [{ key: 'clientCredentials', tokenUrl: 'https://a/t' }],
      }),
    ).toEqual(['auth.oa.clientId', 'auth.oa.clientSecret'])
    expect(oauthSuggestedVariables({ ...base, flows: [] })).toEqual([])
  })
})

describe('pkceChallenge', () => {
  it('produces the S256 challenge for the RFC 7636 test vector (appendix B)', async () => {
    await expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('randomToken', () => {
  it('is URL-safe and varies between two calls', () => {
    const a = randomToken(48)
    const b = randomToken(48)
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('buildAuthorizationUrl', () => {
  it('sets the PKCE parameters and preserves the existing query', () => {
    const url = new URL(
      buildAuthorizationUrl(
        { ...AUTH_CODE_FLOW, authorizationUrl: 'https://auth.example/authorize?audience=api' },
        {
          clientId: 'cid',
          redirectUri: 'https://docs.example/page',
          state: 'st4te',
          codeChallenge: 'ch4llenge',
          scopes: ['read:pets', 'write:pets'],
        },
      ),
    )
    expect(url.searchParams.get('audience')).toBe('api')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://docs.example/page')
    expect(url.searchParams.get('state')).toBe('st4te')
    expect(url.searchParams.get('code_challenge')).toBe('ch4llenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toBe('read:pets write:pets')
  })

  it('omits scope with no selection', () => {
    const url = new URL(
      buildAuthorizationUrl(AUTH_CODE_FLOW, {
        clientId: 'cid',
        redirectUri: 'https://docs.example/',
        state: 's',
        codeChallenge: 'c',
      }),
    )
    expect(url.searchParams.has('scope')).toBe(false)
  })
})

describe('token request bodies', () => {
  it('code exchange: grant_type + code_verifier', () => {
    const params = new URLSearchParams(
      codeExchangeBody({
        code: 'abc',
        codeVerifier: 'ver',
        clientId: 'cid',
        redirectUri: 'https://d/p',
      }),
    )
    expect(Object.fromEntries(params)).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      redirect_uri: 'https://d/p',
      client_id: 'cid',
      code_verifier: 'ver',
    })
  })

  it('client credentials: secret as client_secret_post, optional scope', () => {
    const params = new URLSearchParams(
      clientCredentialsBody({ clientId: 'cid', clientSecret: 'sec', scopes: ['a', 'b'] }),
    )
    expect(Object.fromEntries(params)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'cid',
      client_secret: 'sec',
      scope: 'a b',
    })
    expect(clientCredentialsBody({ clientId: 'cid', clientSecret: 'sec' })).not.toContain('scope')
  })
})

describe('parseCallbackParams / stripCallbackParams', () => {
  it('null when the query does not look like an OAuth callback', () => {
    expect(parseCallbackParams('?utm_source=x')).toBeNull()
    expect(parseCallbackParams('')).toBeNull()
  })

  it('extracts code/state and errors', () => {
    expect(parseCallbackParams('?code=abc&state=st')).toEqual({
      code: 'abc',
      state: 'st',
      error: null,
      errorDescription: null,
    })
    expect(
      parseCallbackParams('?error=access_denied&error_description=nope&state=st'),
    ).toMatchObject({
      error: 'access_denied',
      errorDescription: 'nope',
    })
  })

  it('only removes OAuth parameters, the host page ones survive', () => {
    expect(stripCallbackParams('?page=2&code=abc&state=st&error_description=x')).toBe('?page=2')
    expect(stripCallbackParams('?code=abc&state=st')).toBe('')
  })
})

describe('parseTokenResponse', () => {
  it('extracts access_token', () => {
    expect(parseTokenResponse({ access_token: 'tok', token_type: 'Bearer' })).toEqual({
      accessToken: 'tok',
    })
  })

  it('reports the server error or an invalid response', () => {
    expect(parseTokenResponse({ error: 'invalid_client' })).toEqual({ error: 'invalid_client' })
    expect(parseTokenResponse(null)).toEqual({ error: 'invalid_response' })
    expect(parseTokenResponse({ access_token: 42 })).toEqual({ error: 'invalid_response' })
  })
})

describe('requiredScopes', () => {
  const model = { security: [{ oa: ['global:scope'] }] }

  it("union of the operation's security scopes for the scheme", () => {
    const op = { security: [{ oa: ['a', 'b'] }, { oa: ['b', 'c'], other: ['x'] }] }
    expect(requiredScopes(model, op, 'oa')).toEqual(['a', 'b', 'c'])
  })

  it('falls back to global security when the operation has none', () => {
    expect(requiredScopes(model, { security: null }, 'oa')).toEqual(['global:scope'])
    expect(requiredScopes(model, { security: [] }, 'oa')).toEqual([])
  })
})
