import { describe, expect, it } from 'vitest'
import { recentCalls, topOperations } from '../src/storage/metrics.js'

// `list()` returns most recent first; the fixtures follow that order.
const entry = (over) => ({ specId: 'default', timestamp: 1_750_000_000_000, ...over })

const entries = [
  entry({ id: 6, opId: 'listPets', timestamp: 600 }),
  entry({ id: 5, opId: 'getPet', timestamp: 500 }),
  entry({ id: 4, opId: 'listPets', timestamp: 400 }),
  entry({ id: 3, opId: 'addPet', timestamp: 300 }),
  entry({ id: 2, opId: 'listPets', timestamp: 200 }),
  entry({ id: 1, opId: 'getPet', timestamp: 100 }),
]

describe('recentCalls', () => {
  it('keeps this operation only, newest first', () => {
    expect(recentCalls(entries, 'listPets').map((e) => e.id)).toEqual([6, 4, 2])
  })

  it('caps the strip', () => {
    expect(recentCalls(entries, 'listPets', { limit: 2 }).map((e) => e.id)).toEqual([6, 4])
  })

  it('gives nothing for an operation never called, or for no operation', () => {
    expect(recentCalls(entries, 'deletePet')).toEqual([])
    expect(recentCalls(entries, null)).toEqual([])
    expect(recentCalls([], 'listPets')).toEqual([])
  })

  // Unscoped multi-spec: `list()` mixes specs, and two of them can carry the
  // same opId — the strip of one API must not count the other's calls.
  it('filters by spec when asked', () => {
    const mixed = [entry({ id: 7, opId: 'listPets', specId: 'other', timestamp: 700 }), ...entries]
    expect(recentCalls(mixed, 'listPets', { specId: 'default' }).map((e) => e.id)).toEqual([
      6, 4, 2,
    ])
    expect(recentCalls(mixed, 'listPets').map((e) => e.id)).toEqual([7, 6, 4, 2])
  })
})

describe('topOperations', () => {
  it('ranks by call count', () => {
    expect(topOperations(entries)).toEqual([
      { opId: 'listPets', count: 3, lastAt: 600 },
      { opId: 'getPet', count: 2, lastAt: 500 },
      { opId: 'addPet', count: 1, lastAt: 300 },
    ])
  })

  it('breaks a tie on the most recent call', () => {
    const tied = [
      entry({ opId: 'a', timestamp: 100 }),
      entry({ opId: 'b', timestamp: 900 }),
      entry({ opId: 'a', timestamp: 200 }),
      entry({ opId: 'b', timestamp: 50 }),
    ]
    expect(topOperations(tied).map((o) => o.opId)).toEqual(['b', 'a'])
  })

  it('caps the list and filters by spec', () => {
    expect(topOperations(entries, { limit: 2 }).map((o) => o.opId)).toEqual(['listPets', 'getPet'])
    const mixed = [...entries, entry({ opId: 'other', specId: 'other' })]
    expect(topOperations(mixed, { specId: 'default' }).map((o) => o.opId)).not.toContain('other')
  })

  it('ignores entries without an operation, and an empty history', () => {
    expect(topOperations([entry({ opId: null }), entry({ opId: 'a' })])).toEqual([
      { opId: 'a', count: 1, lastAt: 1_750_000_000_000 },
    ])
    expect(topOperations([])).toEqual([])
  })
})
