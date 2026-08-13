import { beforeEach, describe, expect, it } from 'vitest'
import { HistoryStore } from '../src/storage/history.js'

// The IndexedDB layer is the one place where a silent bug means the user's
// disk fills up, so it gets real tests despite Vitest being core-only: a fake
// IndexedDB is enough, no DOM environment needed (rule: vitest.config.js stays
// node-only).

const DAY = 24 * 3600 * 1000
// Timestamps must stay inside the default 30-day window: the age purge runs on
// every add and would silently delete a fixture pinned at an absolute epoch.
const NOW = Date.now()
const ago = (ms) => NOW - ms

const entry = (over = {}) => ({
  timestamp: Date.now(),
  opId: 'listPets',
  envName: 'prod',
  request: { method: 'GET', url: 'https://api.example.com/pets', headers: {}, body: null },
  response: { status: 200, headers: {}, body: '{"ok":true}' },
  duration: 12,
  ...over,
})

let store

beforeEach(async () => {
  store = new HistoryStore()
  await store.clear()
})

describe('write and read', () => {
  it('returns entries most recent first', async () => {
    await store.add(entry({ timestamp: ago(3000), opId: 'a' }))
    await store.add(entry({ timestamp: ago(1000), opId: 'c' }))
    await store.add(entry({ timestamp: ago(2000), opId: 'b' }))
    expect((await store.list()).map((e) => e.opId)).toEqual(['c', 'b', 'a'])
  })

  it('stamps the active specId and filters on it in scoped mode', async () => {
    await new HistoryStore({}, { specId: 'pets' }).add(entry({ timestamp: ago(2000), opId: 'a' }))
    await new HistoryStore({}, { specId: 'billing' }).add(
      entry({ timestamp: ago(1000), opId: 'b' }),
    )
    const scoped = new HistoryStore({}, { specId: 'pets', scoped: true })
    expect((await scoped.list()).map((e) => e.opId)).toEqual(['a'])
    expect((await store.list()).map((e) => e.specId)).toEqual(['billing', 'pets'])
  })

  it('emits change on add, remove and clear', async () => {
    let changes = 0
    store.addEventListener('change', () => changes++)
    await store.add(entry())
    const [written] = await store.list()
    await store.remove(written.id)
    await store.clear()
    expect(changes).toBe(3)
  })

  // What the retention line and the settings panel both read: a per-spec count
  // there would announce a bound the store is not applying.
  it('counts and dates the whole store, even from a scoped handle', async () => {
    const pets = new HistoryStore({}, { specId: 'pets', scoped: true })
    await pets.add(entry({ timestamp: ago(2000), opId: 'a' }))
    await new HistoryStore({}, { specId: 'billing' }).add(
      entry({ timestamp: ago(9000), opId: 'b' }),
    )
    expect(await pets.list()).toHaveLength(1)
    expect(await pets.stats()).toEqual({ count: 2, oldest: ago(9000) })
    expect(await pets.count()).toBe(2)
  })

  it('reports an empty store rather than a null oldest date', async () => {
    expect(await store.stats()).toEqual({ count: 0, oldest: null })
  })

  it('exposes retention as a copy the UI cannot mutate', () => {
    const configured = new HistoryStore({ maxEntries: 42, maxAgeDays: 7 })
    expect(configured.retention).toEqual({ maxEntries: 42, maxAgeDays: 7 })
    configured.retention.maxEntries = 1
    expect(configured.retention.maxEntries).toBe(42)
  })
})

describe('body truncation', () => {
  it('truncates beyond 256 KB and flags both directions independently', async () => {
    const huge = 'x'.repeat(300 * 1024)
    await store.add(
      entry({
        request: { method: 'POST', url: 'https://api.example.com/pets', headers: {}, body: huge },
        response: { status: 200, headers: {}, body: 'small' },
      }),
    )
    const [written] = await store.list()
    expect(written.request.body).toHaveLength(256 * 1024)
    expect(written.truncatedRequest).toBe(true)
    expect(written.response.body).toBe('small')
    expect(written.truncatedResponse).toBe(false)
  })

  it('leaves non-string bodies alone', async () => {
    await store.add(
      entry({ request: { method: 'GET', url: 'u', headers: {}, body: null }, response: null }),
    )
    const [written] = await store.list()
    expect(written.request.body).toBeNull()
    expect(written.response).toBeNull()
    expect(written.truncatedRequest).toBe(false)
  })
})

describe('retention purge', () => {
  it('deletes entries older than maxAgeDays', async () => {
    const old = new HistoryStore({ maxAgeDays: 30 })
    await old.clear()
    await old.add(entry({ timestamp: ago(31 * DAY), opId: 'stale' }))
    await old.add(entry({ timestamp: NOW, opId: 'fresh' }))
    expect((await old.list()).map((e) => e.opId)).toEqual(['fresh'])
  })

  it('keeps the newest maxEntries and drops the oldest', async () => {
    const capped = new HistoryStore({ maxEntries: 3 })
    await capped.clear()
    for (let i = 1; i <= 5; i++)
      await capped.add(entry({ timestamp: ago(10_000 - i * 1000), opId: `op${i}` }))
    expect((await capped.list()).map((e) => e.opId)).toEqual(['op5', 'op4', 'op3'])
  })

  it('applies whichever rule bites first', async () => {
    // The count cap alone would keep all five; the age cap alone would keep
    // three. Both run in the same purge, so only the recent ones survive.
    const both = new HistoryStore({ maxEntries: 10, maxAgeDays: 1 })
    await both.clear()
    for (let i = 0; i < 2; i++)
      await both.add(entry({ timestamp: ago((2 + i) * DAY), opId: `old${i}` }))
    for (let i = 0; i < 3; i++) await both.add(entry({ timestamp: ago(i * 1000), opId: `new${i}` }))
    const kept = (await both.list()).map((e) => e.opId)
    expect(kept).toHaveLength(3)
    expect(kept.every((id) => id.startsWith('new'))).toBe(true)
  })

  // The boundaries, where an off-by-one silently drops a request the user still
  // expects to find: exactly `maxEntries` entries, and an entry just inside the
  // age window.
  it('keeps exactly maxEntries without dropping one', async () => {
    const capped = new HistoryStore({ maxEntries: 3 })
    await capped.clear()
    for (let i = 1; i <= 3; i++)
      await capped.add(entry({ timestamp: ago(10_000 - i * 1000), opId: `op${i}` }))
    expect((await capped.list()).map((e) => e.opId)).toEqual(['op3', 'op2', 'op1'])
    // One over the cap drops the oldest, and only the oldest.
    await capped.add(entry({ timestamp: NOW, opId: 'op4' }))
    expect((await capped.list()).map((e) => e.opId)).toEqual(['op4', 'op3', 'op2'])
  })

  it('keeps an entry just inside the age window and drops the one just outside', async () => {
    const store30 = new HistoryStore({ maxAgeDays: 30 })
    await store30.clear()
    await store30.add(entry({ timestamp: ago(30 * DAY - 60_000), opId: 'inside' }))
    await store30.add(entry({ timestamp: ago(30 * DAY + 60_000), opId: 'outside' }))
    expect((await store30.list()).map((e) => e.opId)).toEqual(['inside'])
  })

  it('purges globally, not per spec — retention is an installation-level bound', async () => {
    const pets = new HistoryStore({ maxEntries: 2 }, { specId: 'pets' })
    const billing = new HistoryStore({ maxEntries: 2 }, { specId: 'billing' })
    await pets.clear()
    await pets.add(entry({ timestamp: ago(3000), opId: 'petsOld' }))
    await billing.add(entry({ timestamp: ago(2000), opId: 'billing1' }))
    await billing.add(entry({ timestamp: ago(1000), opId: 'billing2' }))
    expect((await pets.list()).map((e) => e.opId)).toEqual(['billing2', 'billing1'])
  })
})
