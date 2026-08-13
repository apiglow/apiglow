import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSchemaSnapshot, writeSchemaSnapshot } from '../src/storage/schema-snapshot.js'

// The module opens its own connection per transaction and exposes no listing:
// counting records means opening the database the same way it does.
function allRecords() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('apidoc-schema')
    request.onsuccess = () => {
      const db = request.result
      const getAll = db.transaction('snapshots', 'readonly').objectStore('snapshots').getAll()
      getAll.onsuccess = () => {
        db.close()
        resolve(getAll.result)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

const snapshot = (url, savedAt, over = {}) => ({
  url,
  format: 1,
  savedAt,
  version: '1.0.0',
  operations: [
    { id: 'listPets', method: 'get', path: '/pets', summary: '', fingerprint: 'abc', fields: {} },
  ],
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('read and write', () => {
  it('round-trips a record keyed by schema URL', async () => {
    await writeSchemaSnapshot(snapshot('https://api.example.com/openapi.json', 1000))
    const read = await readSchemaSnapshot('https://api.example.com/openapi.json')
    expect(read.version).toBe('1.0.0')
    expect(read.operations).toHaveLength(1)
  })

  it('returns null for an unknown URL rather than throwing', async () => {
    expect(await readSchemaSnapshot('https://unknown.example.com/openapi.json')).toBeNull()
  })
})

describe('bounded storage', () => {
  it('evicts the least recently written beyond 20 records', async () => {
    for (let i = 0; i < 25; i++)
      await writeSchemaSnapshot(snapshot(`https://api${i}.example.com`, 1000 + i))
    const kept = await allRecords()
    expect(kept).toHaveLength(20)
    // The five oldest by savedAt are the ones gone.
    expect(kept.map((r) => r.savedAt).sort((a, b) => a - b)[0]).toBe(1005)
    expect(await readSchemaSnapshot('https://api0.example.com')).toBeNull()
    expect(await readSchemaSnapshot('https://api24.example.com')).not.toBeNull()
  })

  it('refuses an oversized record and leaves the previous one in place', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const url = 'https://big.example.com/openapi.json'
    await writeSchemaSnapshot(snapshot(url, 2000, { version: '1.0.0' }))
    await writeSchemaSnapshot(
      snapshot(url, 3000, {
        version: '2.0.0',
        operations: [{ id: 'x', fingerprint: 'y'.repeat(1024 * 1024) }],
      }),
    )
    expect(warn).toHaveBeenCalled()
    // Falling back to the older snapshot only costs a stale diff; storing an
    // unbounded record would cost the user's quota.
    expect((await readSchemaSnapshot(url)).version).toBe('1.0.0')
  })
})
