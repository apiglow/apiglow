import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  effectiveVariables,
  expandCredentialMap,
  HostCredentials,
  voidCredentials,
} from '../src/env/host-credentials.js'

// docs/host-credentials.md §9 — the pure core of the host bridge: expansion,
// merge order, single-flight, and the failure modes that must never reach the
// UI as anything but a console warning.

const bearer = { name: 'bearerAuth', type: 'http', scheme: 'bearer' }
const basic = { name: 'basicAuth', type: 'http', scheme: 'basic' }
const apiKey = { name: 'apiKeyAuth', type: 'apiKey', in: 'header', paramName: 'X-Api-Key' }
const SCHEMES = [bearer, basic, apiKey]

const env = (entries) =>
  Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, { value, sensitive: false }]),
  )

let warn
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('expandCredentialMap', () => {
  it('maps a string to auth.X and an object to auth.X.suffix', () => {
    const { values } = expandCredentialMap(
      { bearerAuth: 'eyJ', basicAuth: { username: 'u', password: 'p' } },
      SCHEMES,
    )
    expect(values).toEqual({
      'auth.bearerAuth': { value: 'eyJ', sensitive: true },
      'auth.basicAuth.username': { value: 'u', sensitive: true },
      'auth.basicAuth.password': { value: 'p', sensitive: true },
    })
  })

  it('marks every value sensitive and stringifies it', () => {
    const { values } = expandCredentialMap({ apiKeyAuth: 4242 }, SCHEMES)
    expect(values['auth.apiKeyAuth']).toEqual({ value: '4242', sensitive: true })
  })

  it('ignores an unknown scheme name', () => {
    const { values, unknown } = expandCredentialMap({ nopeAuth: 'x' }, SCHEMES)
    expect(values).toEqual({})
    expect(unknown).toEqual(['nopeAuth'])
  })

  // The promise of §3: a provider cannot invent variable names outside the
  // conventional ones — otherwise the overlay would stop being confined to
  // credentials, and the merge could no longer claim to be neutral elsewhere.
  it('refuses a suffix that is not a conventional field of the scheme', () => {
    const { values, unknown } = expandCredentialMap(
      { basicAuth: { username: 'u', role: 'admin' }, bearerAuth: { token: 'x' } },
      SCHEMES,
    )
    expect(values).toEqual({ 'auth.basicAuth.username': { value: 'u', sensitive: true } })
    expect(unknown).toEqual(['auth.basicAuth.role', 'auth.bearerAuth.token'])
  })

  it('treats null, undefined and an empty map as nothing to offer', () => {
    expect(expandCredentialMap(null, SCHEMES).values).toEqual({})
    expect(expandCredentialMap({}, SCHEMES).values).toEqual({})
    expect(expandCredentialMap({ bearerAuth: null }, SCHEMES).values).toEqual({})
  })
})

describe('effectiveVariables', () => {
  const host = { 'auth.bearerAuth': { value: 'host-token', sensitive: true } }

  it('lets a non-empty environment value win over the host', () => {
    const merged = effectiveVariables(host, env({ 'auth.bearerAuth': 'typed' }))
    expect(merged['auth.bearerAuth'].value).toBe('typed')
  })

  it('falls through to the host when the environment value is the empty string', () => {
    const merged = effectiveVariables(host, env({ 'auth.bearerAuth': '' }))
    expect(merged['auth.bearerAuth'].value).toBe('host-token')
    expect(merged['auth.bearerAuth'].sensitive).toBe(true)
  })

  it('fills a variable the environment does not declare at all', () => {
    expect(effectiveVariables(host, env({ token: 'x' }))['auth.bearerAuth'].value).toBe(
      'host-token',
    )
  })

  // Only the overlay's own names get the fall-through: an empty env variable
  // nothing covers must stay present and empty, which is how the rest of the
  // app already says "missing".
  it('keeps an empty environment variable the host does not cover', () => {
    const merged = effectiveVariables(host, env({ other: '' }))
    expect(merged.other).toEqual({ value: '', sensitive: false })
  })

  it('keeps run variables on top of everything', () => {
    const merged = effectiveVariables(host, env({ 'auth.bearerAuth': 'typed' }), {
      'auth.bearerAuth': { value: 'extracted', sensitive: false },
    })
    expect(merged['auth.bearerAuth'].value).toBe('extracted')
  })
})

describe('voidCredentials', () => {
  it('lists the conventional variables no environment value covers', () => {
    expect(
      voidCredentials(SCHEMES, env({ 'auth.bearerAuth': 'x', 'auth.basicAuth.username': '' })),
    ).toEqual(['auth.basicAuth.username', 'auth.basicAuth.password', 'auth.apiKeyAuth'])
  })

  it('is empty when every credential is already set', () => {
    expect(voidCredentials([bearer], env({ 'auth.bearerAuth': 'x' }))).toEqual([])
  })
})

describe('HostCredentials', () => {
  const made = () => {
    const host = new HostCredentials()
    host.context = { specId: 'default', schemes: SCHEMES }
    return host
  }

  it('has no provider and an empty overlay out of the box', () => {
    const host = made()
    expect(host.hasProvider).toBe(false)
    expect(host.values()).toEqual({})
    expect(host.covers('auth.bearerAuth')).toBe(false)
  })

  it('fills the overlay from a push and reports the change', () => {
    const host = made()
    const changes = []
    host.addEventListener('change', () => changes.push(host.values()))
    expect(host.set({ bearerAuth: 'tok' })).toBe(true)
    expect(host.covers('auth.bearerAuth')).toBe(true)
    expect(changes).toHaveLength(1)
    // Same value again: no event, so nothing downstream re-renders for nothing.
    expect(host.set({ bearerAuth: 'tok' })).toBe(false)
    expect(changes).toHaveLength(1)
  })

  // Per-scheme replace: a host that stops sending the password must not leave
  // the previous one behind.
  it('replaces a scheme wholesale and leaves the others alone', () => {
    const host = made()
    host.set({ bearerAuth: 'tok', basicAuth: { username: 'u', password: 'p' } })
    host.set({ basicAuth: { username: 'u2' } })
    expect(host.values()).toEqual({
      'auth.bearerAuth': { value: 'tok', sensitive: true },
      'auth.basicAuth.username': { value: 'u2', sensitive: true },
    })
  })

  it('warns and keeps the last provider when one is registered twice', () => {
    const host = made()
    host.registerProvider(() => ({ bearerAuth: 'a' }))
    host.registerProvider(() => ({ bearerAuth: 'b' }))
    expect(warn).toHaveBeenCalledWith('[api-doc] credentials provider replaced')
    return host.request('initial').then(() => {
      expect(host.values()['auth.bearerAuth'].value).toBe('b')
    })
  })

  it('announces a registration so the shell can schedule its fill pass', () => {
    const host = made()
    const seen = []
    host.addEventListener('provider', () => seen.push(true))
    host.registerProvider(() => null)
    expect(seen).toHaveLength(1)
  })

  it('passes spec, reason, scheme and the credential descriptors to the provider', async () => {
    const host = made()
    host.context = { specId: 'petstore', schemes: [bearer, basic] }
    let seen = null
    host.registerProvider((ctx) => {
      seen = ctx
      return null
    })
    await host.request('expired', 'bearerAuth')
    expect(seen).toEqual({
      specId: 'petstore',
      reason: 'expired',
      schemeName: 'bearerAuth',
      schemes: [
        { name: 'bearerAuth', type: 'http', field: 'auth.bearerAuth' },
        { name: 'basicAuth', type: 'http', field: 'auth.basicAuth.username' },
        { name: 'basicAuth', type: 'http', field: 'auth.basicAuth.password' },
      ],
    })
  })

  it('shares one provider call between concurrent requests', async () => {
    const host = made()
    let calls = 0
    host.registerProvider(async () => {
      calls += 1
      await Promise.resolve()
      return { bearerAuth: 'tok' }
    })
    const [a, b] = await Promise.all([host.request('initial'), host.request('manual')])
    expect(calls).toBe(1)
    expect([a, b]).toEqual([true, true])
    // Once settled, the next need starts a fresh call.
    await host.request('manual')
    expect(calls).toBe(2)
  })

  it('treats a rejected provider as an empty result and never throws', async () => {
    const host = made()
    host.registerProvider(async () => {
      throw new Error('boom')
    })
    await expect(host.request('initial')).resolves.toBe(false)
    expect(host.values()).toEqual({})
    expect(warn).toHaveBeenCalledWith('[api-doc] credentials provider failed:', expect.any(Error))
  })

  it('resolves to false without a provider', async () => {
    await expect(made().request('initial')).resolves.toBe(false)
  })

  it('rejects a provider that is not a function', () => {
    const host = made()
    host.registerProvider('nope')
    expect(host.hasProvider).toBe(false)
  })

  it('reports no change when the provider returns the value already held', async () => {
    const host = made()
    host.set({ bearerAuth: 'tok' })
    host.registerProvider(() => ({ bearerAuth: 'tok' }))
    await expect(host.request('expired', 'bearerAuth')).resolves.toBe(false)
  })

  it('empties the overlay on clear without unregistering the provider', () => {
    const host = made()
    host.registerProvider(() => ({ bearerAuth: 'tok' }))
    host.set({ bearerAuth: 'tok' })
    expect(host.clear()).toBe(true)
    expect(host.values()).toEqual({})
    expect(host.hasProvider).toBe(true)
    // Already empty: nothing changed, nothing to announce.
    expect(host.clear()).toBe(false)
  })

  it('warns and ignores a scheme name the spec does not declare', () => {
    const host = made()
    expect(host.set({ ghostAuth: 'tok' })).toBe(false)
    expect(host.values()).toEqual({})
    expect(warn).toHaveBeenCalledWith(
      '[api-doc] host credentials: "ghostAuth" names no credential of this spec',
    )
  })
})
