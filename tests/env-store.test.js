import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envForWrite } from '../src/components/env-write.js'
import { EnvStore, normalizeConfigEnvironment } from '../src/env/store.js'

// The EnvStore class (localStorage, EventTarget) is covered by browser
// e2e; here only the pure host config → internal format normalization.
describe('normalizeConfigEnvironment', () => {
  it('converts object variables and defaultHeaders into ordered arrays', () => {
    const env = normalizeConfigEnvironment({
      name: 'prod',
      baseUrl: 'https://api.example.com',
      variables: {
        token: { value: 'abc', sensitive: true },
        locale: { value: 'fr' },
      },
      defaultHeaders: { 'X-App': 'docs', 'X-Version': 2 },
    })
    expect(env.id).toMatch(/[0-9a-f-]{36}/)
    expect(env.name).toBe('prod')
    expect(env.baseUrl).toBe('https://api.example.com')
    expect(env.variables).toEqual([
      { name: 'token', value: 'abc', sensitive: true },
      { name: 'locale', value: 'fr', sensitive: false },
    ])
    expect(env.defaultHeaders).toEqual([
      { name: 'X-App', value: 'docs' },
      { name: 'X-Version', value: '2' },
    ])
  })

  it('accepts the short scalar form for a variable (never sensitive)', () => {
    const env = normalizeConfigEnvironment({ name: 'dev', variables: { locale: 'fr', retries: 3 } })
    expect(env.variables).toEqual([
      { name: 'locale', value: 'fr', sensitive: false },
      { name: 'retries', value: '3', sensitive: false },
    ])
  })

  it('tolerates a minimal environment: every missing field has a safe default', () => {
    const env = normalizeConfigEnvironment({})
    expect(env.name).toBe('')
    expect(env.baseUrl).toBe('')
    expect(env.variables).toEqual([])
    expect(env.defaultHeaders).toEqual([])
  })

  it('only marks sensitive on the strict boolean true', () => {
    const env = normalizeConfigEnvironment({
      name: 'x',
      variables: { a: { value: '1', sensitive: 'yes' }, b: { value: '2', sensitive: 1 } },
    })
    expect(env.variables.every((v) => v.sensitive === false)).toBe(true)
  })

  it('only keeps colors from the closed palette', () => {
    expect(normalizeConfigEnvironment({ name: 'x', color: 'red' }).color).toBe('red')
    expect(normalizeConfigEnvironment({ name: 'x', color: 'magenta' }).color).toBe(null)
    expect(normalizeConfigEnvironment({ name: 'x' }).color).toBe(null)
  })
})

// Locked mode (environmentsLocked): the config is authoritative on the set
// of environments, storage only reinjects the runtime state.
describe('EnvStore locked', () => {
  let backing
  beforeEach(() => {
    backing = new Map()
    globalThis.window = {
      localStorage: {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: (k) => backing.delete(k),
      },
    }
  })
  afterEach(() => {
    delete globalThis.window
  })

  const seedStorage = (envs) => backing.set('apidoc:environments', JSON.stringify(envs))
  const configEnvs = [
    {
      name: 'staging',
      baseUrl: 'https://staging.example.com',
      color: 'blue',
      variables: { 'auth.bearerAuth': { value: '', sensitive: true } },
    },
    { name: 'prod', baseUrl: 'https://api.example.com', color: 'red' },
  ]

  it('ignores stored environments absent from the config', () => {
    seedStorage([
      { id: 'u1', name: 'perso', baseUrl: 'http://localhost', variables: [], defaultHeaders: [] },
    ])
    const store = new EnvStore(configEnvs, { locked: true })
    expect(store.list().map((e) => e.name)).toEqual(['staging', 'prod'])
    expect(store.locked).toBe(true)
  })

  it('the config is authoritative on structure, storage on runtime values', () => {
    seedStorage([
      {
        id: 'stable-id',
        name: 'staging',
        baseUrl: 'https://old-url.example.com',
        variables: [
          { name: 'auth.bearerAuth', value: 'token-oauth', sensitive: true },
          { name: 'auth.oauth2.clientId', value: 'cid', sensitive: false },
        ],
        defaultHeaders: [{ name: 'X-Perso', value: 'x' }],
      },
    ])
    const store = new EnvStore(configEnvs, { locked: true })
    const staging = store.list()[0]
    // id kept: the persisted selection stays valid across sessions.
    expect(staging.id).toBe('stable-id')
    expect(staging.baseUrl).toBe('https://staging.example.com')
    expect(staging.defaultHeaders).toEqual([])
    // Token value reapplied, runtime variable outside the config kept.
    expect(staging.variables).toEqual([
      { name: 'auth.bearerAuth', value: 'token-oauth', sensitive: true },
      { name: 'auth.oauth2.clientId', value: 'cid', sensitive: false },
    ])
  })

  it('resolves color by name (environment badges in call listings)', () => {
    const store = new EnvStore(configEnvs, { locked: true })
    expect(store.colorOfName('prod')).toBe('red')
    expect(store.colorOfName('gone')).toBe(null)
  })

  it('with no storage, exposes the config as-is and persists it', () => {
    const store = new EnvStore(configEnvs, { locked: true })
    expect(store.list().map((e) => e.color)).toEqual(['blue', 'red'])
    const persisted = JSON.parse(backing.get('apidoc:environments'))
    expect(persisted.map((e) => e.name)).toEqual(['staging', 'prod'])
  })

  // Where a credential typed in the try-it cartouche, or a token obtained from
  // an OAuth flow, lands when the host declared no environment at all.
  describe('envForWrite', () => {
    it('provisions one when nothing is selected, and selects what it made', () => {
      const store = new EnvStore([])
      expect(store.selected()).toBe(null)
      expect(store.writable).toBe(true)

      const env = envForWrite(store)
      expect(env.name).toBe('Environment 1')
      expect(store.selected()).toBe(env)
      // The second write reuses it rather than stacking a new one.
      expect(envForWrite(store)).toBe(env)
      expect(store.list()).toHaveLength(1)
    })

    it('numbers the next one after the environments already there', () => {
      const store = new EnvStore(configEnvs)
      store.select(null)
      expect(envForWrite(store).name).toBe('Environment 3')
    })

    // Locked mode is the one dead end: the config owns the set, so a write
    // with nothing declared has nowhere to go and the UI disables its controls.
    it('creates nothing when the host owns the environments', () => {
      const store = new EnvStore([], { locked: true })
      expect(store.writable).toBe(false)
      expect(envForWrite(store)).toBe(null)
      expect(store.list()).toEqual([])
    })

    it('is writable in locked mode as soon as the config declares one', () => {
      const store = new EnvStore(configEnvs, { locked: true })
      expect(store.writable).toBe(true)
      expect(envForWrite(store)).toBe(store.list()[0])
    })
  })
})
