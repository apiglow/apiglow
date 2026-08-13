import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore } from '../src/storage/history.js'
import {
  baseKeyOf,
  eraseEverything,
  groupOfKey,
  inspectPrefEntries,
  readOwnedEntries,
  storageInventory,
} from '../src/storage/maintenance.js'
import { ScenarioStore } from '../src/storage/scenarios.js'
import { clearSchemaSnapshots, writeSchemaSnapshot } from '../src/storage/schema-snapshot.js'
import { fakeStorage } from './support/fake-storage.js'

// This module is what makes "erase everything" mean everything: a dataset it
// forgets survives the reset while the UI reports success. Hence real
// assertions on the grouping AND on the round trip through the three stores.

let local
let session

beforeEach(() => {
  local = fakeStorage()
  session = fakeStorage()
  globalThis.window = { localStorage: local, sessionStorage: session }
})

afterEach(() => {
  delete globalThis.window
})

describe('key classification', () => {
  it('reads the base key through the per-spec namespace', () => {
    expect(baseKeyOf('apidoc:theme')).toBe('theme')
    expect(baseKeyOf('apidoc:payments:tryit.headers')).toBe('tryit.headers')
  })

  it('groups a key the same way whatever spec it belongs to', () => {
    expect(groupOfKey('apidoc:environments')).toBe('environments')
    expect(groupOfKey('apidoc:payments:environments')).toBe('environments')
    expect(groupOfKey('apidoc:payments:environment.selected')).toBe('environments')
    expect(groupOfKey('apidoc:payments:tryit.headers')).toBe('headers')
    expect(groupOfKey('apidoc:layout.navWidth')).toBe('preferences')
  })

  // The guarantee behind DEFAULT_GROUP: a key added to the app without being
  // declared here must still land in a bucket a targeted purge reaches.
  it('sends an undeclared key to preferences rather than leaving it orphaned', () => {
    expect(groupOfKey('apidoc:someFutureKey')).toBe('preferences')
  })
})

describe('inspectPrefEntries', () => {
  it('counts items across specs, not the keys holding them', () => {
    const groups = inspectPrefEntries([
      ['apidoc:a:environments', JSON.stringify([{ name: 'dev' }, { name: 'prod' }])],
      ['apidoc:b:environments', JSON.stringify([{ name: 'staging' }])],
      ['apidoc:a:environment.selected', '"x"'],
      ['apidoc:a:tryit.headers', JSON.stringify({ 'x-key': {}, authorization: {} })],
      ['apidoc:theme', '"dark"'],
      ['apidoc:language', '"fr"'],
    ])
    expect(groups.environments.count).toBe(3)
    expect(groups.environments.keys).toHaveLength(3)
    expect(groups.headers.count).toBe(2)
    expect(groups.preferences.count).toBe(2)
  })

  it('keeps an unreadable key purgeable while counting it as empty', () => {
    const groups = inspectPrefEntries([['apidoc:environments', '{not json']])
    expect(groups.environments.count).toBe(0)
    expect(groups.environments.keys).toEqual(['apidoc:environments'])
  })
})

describe('readOwnedEntries', () => {
  it('picks up the app prefix only, leaving the host page alone', () => {
    local.setItem('apidoc:theme', '"dark"')
    local.setItem('apidoc:payments:environments', '[]')
    local.setItem('shop-cart', 'x')
    expect(readOwnedEntries().map(([k]) => k)).toEqual([
      'apidoc:theme',
      'apidoc:payments:environments',
    ])
  })
})

describe('storageInventory', () => {
  let history
  let scenarios

  beforeEach(async () => {
    history = new HistoryStore()
    scenarios = new ScenarioStore()
    await history.clear()
    await scenarios.clear()
    await clearSchemaSnapshots()
  })

  const inventory = () => storageInventory({ history, scenarios })

  const counts = async () =>
    Object.fromEntries(
      await Promise.all(inventory().map(async (row) => [row.id, await row.count()])),
    )

  async function seed() {
    await history.add({
      timestamp: Date.now(),
      opId: 'listPets',
      request: { method: 'GET', url: 'https://api.test/pets', headers: {}, body: null },
      response: { status: 200, headers: {}, body: '{}' },
    })
    await scenarios.add({ id: 'sc-1', name: 'Happy path', steps: [] })
    await writeSchemaSnapshot({
      url: 'https://api.test/openapi.json',
      savedAt: Date.now(),
      version: '1.0.0',
      operations: {},
    })
    local.setItem('apidoc:environments', JSON.stringify([{ name: 'dev' }]))
    local.setItem('apidoc:tryit.headers', JSON.stringify({ authorization: { value: 'x' } }))
    local.setItem('apidoc:theme', '"dark"')
  }

  it('reports every declared dataset', async () => {
    await seed()
    expect(await counts()).toEqual({
      history: 1,
      scenarios: 1,
      snapshots: 1,
      environments: 1,
      headers: 1,
      preferences: 1,
    })
  })

  it('counts the whole installation, not the active spec', async () => {
    const other = new ScenarioStore({ specId: 'payments', scoped: true })
    await other.add({ id: 'sc-2', name: 'Other spec', steps: [] })
    // `scenarios` is scoped to 'default' and lists nothing here, but the panel
    // is describing the browser.
    expect(await other.list()).toHaveLength(1)
    expect((await counts()).scenarios).toBe(1)
  })

  it('clears one dataset without touching the others', async () => {
    await seed()
    await inventory()
      .find((row) => row.id === 'history')
      .clear()
    expect(await counts()).toMatchObject({ history: 0, scenarios: 1, environments: 1 })
  })

  it('marks boot-time datasets as needing a reload and the others as not', () => {
    expect(Object.fromEntries(inventory().map((row) => [row.id, row.reload]))).toEqual({
      history: false,
      scenarios: false,
      snapshots: false,
      environments: true,
      headers: true,
      preferences: true,
    })
  })
})

describe('eraseEverything', () => {
  it('empties every declared row and drops the pending OAuth handshake', async () => {
    const history = new HistoryStore()
    const scenarios = new ScenarioStore()
    await history.add({
      timestamp: Date.now(),
      opId: 'listPets',
      request: { method: 'GET', url: 'https://api.test/pets', headers: {}, body: null },
      response: { status: 200, headers: {}, body: '{}' },
    })
    await scenarios.add({ id: 'sc-3', name: 'Wipe me', steps: [] })
    await writeSchemaSnapshot({
      url: 'https://api.test/openapi.json',
      savedAt: Date.now(),
      version: '1.0.0',
      operations: {},
    })
    local.setItem('apidoc:environments', JSON.stringify([{ name: 'dev' }]))
    local.setItem('apidoc:tryit.headers', JSON.stringify({ authorization: { value: 'x' } }))
    local.setItem('apidoc:theme', '"dark"')
    local.setItem('host-page-key', 'kept')
    session.setItem('apidoc.oauth.pending', '{"state":"abc"}')

    const inventory = storageInventory({ history, scenarios })
    // Every row must hold something first: a dataset the erase never reaches
    // otherwise passes the assertion below by having been empty all along.
    for (const row of inventory) expect(await row.count()).toBeGreaterThan(0)
    expect(await eraseEverything(inventory)).toEqual([])

    for (const row of inventory) expect(await row.count()).toBe(0)
    expect(session.getItem('apidoc.oauth.pending')).toBeNull()
    // Storage the app does not own is none of its business, even on a reset.
    expect(local.getItem('host-page-key')).toBe('kept')
  })

  // A half-erased install with no report is the failure mode worth guarding:
  // one dead database must not silently spare the other five datasets.
  it('finishes the other rows and reports the failures when one purge throws', async () => {
    let cleared = false
    const inventory = [
      {
        id: 'history',
        reload: false,
        count: async () => 1,
        clear: async () => {
          throw new Error('database unavailable')
        },
      },
      {
        id: 'scenarios',
        reload: false,
        count: async () => 1,
        clear: async () => {
          cleared = true
        },
      },
    ]

    expect(await eraseEverything(inventory)).toEqual(['history'])
    expect(cleared).toBe(true)
  })
})
