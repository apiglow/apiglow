import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  beginAuthorizationLogin,
  fetchClientCredentialsToken,
  OAuthError,
  pendingOAuthSpecId,
  resumeAuthorizationLogin,
} from '../src/openapi/oauth-flow.js'

// oauth-flow.js is the effectful half of the OAuth support: it reads
// sessionStorage, the page URL and fetch on call, so doubles on globalThis are
// enough to test it in the node environment the rest of the core uses.
const PENDING_KEY = 'apidoc.oauth.pending'

function fakeSessionStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  }
}

let storage
let assigned
let replaced

function setLocation({ search = '', hash = '' } = {}) {
  globalThis.window = {
    location: {
      origin: 'https://docs.example',
      pathname: '/api/',
      search,
      hash,
      assign: (url) => assigned.push(url),
    },
    history: { replaceState: (_state, _title, url) => replaced.push(url) },
  }
}

function pendingEntry(overrides = {}) {
  return JSON.stringify({
    state: 'st4te',
    codeVerifier: 'verifier',
    clientId: 'client-1',
    envId: 'env-1',
    schemeName: 'petstoreAuth',
    tokenUrl: 'https://auth.example/token',
    redirectUri: 'https://docs.example/api/',
    returnHash: '#/op/getPets',
    specId: 'payments',
    ...overrides,
  })
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

beforeEach(() => {
  storage = fakeSessionStorage()
  globalThis.sessionStorage = storage
  assigned = []
  replaced = []
  setLocation()
})

afterEach(() => {
  delete globalThis.sessionStorage
  delete globalThis.window
  vi.unstubAllGlobals()
})

describe('beginAuthorizationLogin', () => {
  it('stores the PKCE handshake and navigates to the authorization server', async () => {
    setLocation({ search: '?tenant=acme', hash: '#/s/payments/op/listPets' })
    await beginAuthorizationLogin({
      flow: {
        authorizationUrl: 'https://auth.example/authorize',
        tokenUrl: 'https://auth.example/token',
      },
      schemeName: 'petstoreAuth',
      clientId: 'client-1',
      scopes: ['read:pets'],
      envId: 'env-1',
    })

    const pending = JSON.parse(storage.getItem(PENDING_KEY))
    expect(pending.clientId).toBe('client-1')
    expect(pending.schemeName).toBe('petstoreAuth')
    expect(pending.envId).toBe('env-1')
    // The host page's own query survives; the hash does not (it is restored
    // from the pending entry once the flow returns).
    expect(pending.redirectUri).toBe('https://docs.example/api/?tenant=acme')
    expect(pending.returnHash).toBe('#/s/payments/op/listPets')
    // Multi-spec: the boot handling the return must land on the spec that started it.
    expect(pending.specId).toBe('payments')

    const url = new URL(assigned.at(-1))
    expect(url.origin + url.pathname).toBe('https://auth.example/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe(pending.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).not.toBe(pending.codeVerifier)
    expect(url.searchParams.get('scope')).toBe('read:pets')
  })

  it('leaves no orphaned handshake when the authorization URL is invalid', async () => {
    await expect(
      beginAuthorizationLogin({
        flow: { authorizationUrl: 'not-a-url', tokenUrl: 'https://auth.example/token' },
        schemeName: 'petstoreAuth',
        clientId: 'client-1',
        scopes: [],
        envId: 'env-1',
      }),
    ).rejects.toThrow()
    expect(storage.getItem(PENDING_KEY)).toBeNull()
    expect(assigned).toEqual([])
  })
})

describe('pendingOAuthSpecId', () => {
  it('reads the spec id without consuming the pending entry', () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    expect(pendingOAuthSpecId()).toBe('payments')
    expect(storage.getItem(PENDING_KEY)).not.toBeNull()
  })

  it('is null with no pending entry, a malformed one, or one without a spec id', () => {
    expect(pendingOAuthSpecId()).toBeNull()
    storage.setItem(PENDING_KEY, '{not json')
    expect(pendingOAuthSpecId()).toBeNull()
    storage.setItem(PENDING_KEY, pendingEntry({ specId: undefined }))
    expect(pendingOAuthSpecId()).toBeNull()
  })
})

describe('resumeAuthorizationLogin', () => {
  it('is null outside of an OAuth return', async () => {
    expect(await resumeAuthorizationLogin()).toBeNull()
  })

  it('drops a stale handshake when the page comes back without callback params', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({ search: '?tenant=acme' })
    expect(await resumeAuthorizationLogin()).toBeNull()
    expect(storage.getItem(PENDING_KEY)).toBeNull()
  })

  it('drops a malformed pending entry instead of throwing', async () => {
    storage.setItem(PENDING_KEY, '{not json')
    setLocation({ search: '?code=abc&state=st4te' })
    expect(await resumeAuthorizationLogin()).toBeNull()
    expect(storage.getItem(PENDING_KEY)).toBeNull()
  })

  it('exchanges the code, returns the token and cleans the URL', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({ search: '?tenant=acme&code=abc&state=st4te', hash: '#/op/getPets' })
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'tok-123' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await resumeAuthorizationLogin()
    expect(result).toEqual({
      schemeName: 'petstoreAuth',
      envId: 'env-1',
      returnHash: '#/op/getPets',
      token: 'tok-123',
    })
    // Consumed in all cases: a reload must not replay the exchange.
    expect(storage.getItem(PENDING_KEY)).toBeNull()
    // Only the OAuth parameters are stripped — the host page's survive.
    expect(replaced.at(-1)).toBe('/api/?tenant=acme#/op/getPets')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.example/token')
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('abc')
    expect(body.get('code_verifier')).toBe('verifier')
    expect(body.get('redirect_uri')).toBe('https://docs.example/api/')
  })

  it('reports a state mismatch without exchanging anything', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({ search: '?code=abc&state=forged' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await resumeAuthorizationLogin()
    expect(result.error).toBeInstanceOf(OAuthError)
    expect(result.error.code).toBe('state')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a denial with the server description', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({
      search: '?error=access_denied&error_description=User+said+no&state=st4te',
    })
    const result = await resumeAuthorizationLogin()
    expect(result.error.code).toBe('denied')
    expect(result.error.detail).toBe('User said no')
    expect(result.returnHash).toBe('#/op/getPets')
  })

  it('surfaces a token-endpoint rejection as a token error', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({ search: '?code=abc&state=st4te' })
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'expired' },
        { ok: false, status: 400 },
      ),
    )
    const result = await resumeAuthorizationLogin()
    expect(result.error.code).toBe('token')
    expect(result.error.detail).toBe('expired')
  })

  it('surfaces a transport failure as a network error', async () => {
    storage.setItem(PENDING_KEY, pendingEntry())
    setLocation({ search: '?code=abc&state=st4te' })
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await resumeAuthorizationLogin()
    expect(result.error.code).toBe('network')
  })
})

describe('fetchClientCredentialsToken', () => {
  it('posts the secret as form data and returns the token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'tok-cc' }))
    vi.stubGlobal('fetch', fetchMock)

    const token = await fetchClientCredentialsToken({
      flow: { tokenUrl: 'https://auth.example/token' },
      clientId: 'client-1',
      clientSecret: 's3cret',
      scopes: ['read:pets', 'write:pets'],
    })
    expect(token).toBe('tok-cc')
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body)
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_secret')).toBe('s3cret')
    expect(body.get('scope')).toBe('read:pets write:pets')
  })

  it('rejects with a token error when the response carries no access_token', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ token_type: 'bearer' }))
    await expect(
      fetchClientCredentialsToken({
        flow: { tokenUrl: 'https://auth.example/token' },
        clientId: 'client-1',
        clientSecret: 's3cret',
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: 'token', detail: 'invalid_response' })
  })

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    }))
    await expect(
      fetchClientCredentialsToken({
        flow: { tokenUrl: 'https://auth.example/token' },
        clientId: 'client-1',
        clientSecret: '',
        scopes: [],
      }),
    ).rejects.toMatchObject({ code: 'token', detail: 'HTTP 503' })
  })
})
