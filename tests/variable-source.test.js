import { describe, expect, it } from 'vitest'
import { HostCredentials } from '../src/env/host-credentials.js'
import { VariableSource } from '../src/env/variables.js'

// The real HostCredentials (pure of `window`) against a fake store: what is
// under test is the composition, and faking the overlay would fake the half
// that actually decides.
const SCHEMES = [{ name: 'bearerAuth', type: 'http', scheme: 'bearer' }]

const fakeStore = (envs = []) => {
  const store = new EventTarget()
  store.envs = envs
  store.selected = () => store.envs[0] ?? null
  store.variablesOf = (env = store.selected()) => {
    const out = {}
    for (const v of env?.variables ?? []) out[v.name] = { value: v.value, sensitive: !!v.sensitive }
    return out
  }
  return store
}

const withHost = (map, schemes = SCHEMES) => {
  const host = new HostCredentials()
  host.context = { specId: 'default', schemes }
  host.set(map)
  return host
}

const env = (name, variables) => ({ id: name, name, variables })

describe('VariableSource.for', () => {
  it('puts the host overlay under the environment, run scope on top', () => {
    const store = fakeStore([env('staging', [{ name: 'tenant', value: 'acme' }])])
    const source = new VariableSource({ envStore: store, host: withHost({ bearerAuth: 'tok' }) })
    expect(source.for()).toEqual({
      'auth.bearerAuth': { value: 'tok', sensitive: true },
      tenant: { value: 'acme', sensitive: false },
    })
    expect(source.for(store.selected(), { tenant: { value: 'run' } }).tenant).toEqual({
      value: 'run',
    })
  })

  it('lets a void environment variable fall through to the overlay', () => {
    const store = fakeStore([env('staging', [{ name: 'auth.bearerAuth', value: '' }])])
    const source = new VariableSource({ envStore: store, host: withHost({ bearerAuth: 'tok' }) })
    expect(source.for()['auth.bearerAuth'].value).toBe('tok')
  })

  it('keeps a filled environment variable over the overlay', () => {
    const store = fakeStore([env('staging', [{ name: 'auth.bearerAuth', value: 'typed' }])])
    const source = new VariableSource({ envStore: store, host: withHost({ bearerAuth: 'tok' }) })
    expect(source.for()['auth.bearerAuth'].value).toBe('typed')
  })
})

describe('VariableSource.sourceOf', () => {
  const source = () => {
    const store = fakeStore([
      env('staging', [
        { name: 'auth.bearerAuth', value: '' },
        { name: 'tenant', value: 'acme' },
      ]),
      env('prod', [{ name: 'auth.bearerAuth', value: 'prod-token' }]),
    ])
    return {
      store,
      source: new VariableSource({ envStore: store, host: withHost({ bearerAuth: 'tok' }) }),
    }
  }

  it('names the side that wins, and null when nothing resolves', () => {
    const { source: s } = source()
    expect(s.sourceOf('tenant')).toBe('env')
    // Declared but void: the overlay shows through, which is the whole point
    // of the "provided by the site" badge.
    expect(s.sourceOf('auth.bearerAuth')).toBe('host')
    expect(s.sourceOf('nothing')).toBeNull()
  })

  it('answers about an environment that is not the selected one', () => {
    const { store, source: s } = source()
    // The switcher asks this of every row in its list.
    expect(s.sourceOf('auth.bearerAuth', store.envs[1])).toBe('env')
    expect(s.sourceOf('tenant', store.envs[1])).toBeNull()
  })

  it('agrees with `for`: a named source means a resolvable value', () => {
    const { source: s } = source()
    const merged = s.for()
    for (const name of ['auth.bearerAuth', 'tenant', 'nothing']) {
      expect(s.sourceOf(name) !== null).toBe(Boolean(merged[name]?.value))
    }
  })
})

describe('VariableSource change relay', () => {
  it('carries which side moved, because the two are not interchangeable', () => {
    const store = fakeStore([env('staging', [])])
    const host = withHost({})
    const source = new VariableSource({ envStore: store, host })
    const origins = []
    source.addEventListener('change', (event) => origins.push(event.detail.origin))

    store.dispatchEvent(new Event('change'))
    host.set({ bearerAuth: 'tok' })
    expect(origins).toEqual(['env', 'host'])
  })

  it('stays quiet when the overlay is told nothing new', () => {
    const store = fakeStore([env('staging', [])])
    const host = withHost({ bearerAuth: 'tok' })
    const source = new VariableSource({ envStore: store, host })
    let changes = 0
    source.addEventListener('change', () => changes++)
    host.set({ bearerAuth: 'tok' })
    expect(changes).toBe(0)
  })
})
