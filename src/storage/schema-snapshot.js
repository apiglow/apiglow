// Snapshot of the last schema seen, per schema URL — supports the local
// changelog. IndexedDB (rule 8: localStorage is reserved for lightweight data,
// operation fingerprints can be heavy). Database distinct from history:
// independent lifecycles (clearing history must not lose the
// changelog reference).

import { openDatabase, runTransaction } from './idb.js'

const DB_NAME = 'apidoc-schema'
// Still 2 for the same reason as `apidoc-history`: dev browsers hold a v2
// database and reopening it at 1 raises VersionError.
const DB_VERSION = 2
const STORE = 'snapshots'
// Bounded-storage policy (rule 13): this store is a cache, so it evicts.
// Eviction is by write date, not by read date — refreshing `savedAt` on every
// read would mean rewriting the whole record (100+ KB on a large schema) on
// every page load, to protect against a case that costs one missing changelog.
const MAX_RECORDS = 20
// Size guard: one record is the fingerprints of every operation — ~130 KB for a
// 1.2 MB schema. Beyond this, the schema is far outside what the changelog was
// sized for and we drop the snapshot rather than fill the user's quota.
const MAX_RECORD_BYTES = 1024 * 1024

function openDb() {
  return openDatabase(DB_NAME, DB_VERSION, (db) => {
    const store = db.createObjectStore(STORE, { keyPath: 'url' })
    store.createIndex('savedAt', 'savedAt')
  })
}

function tx(mode, fn) {
  return runTransaction(openDb(), STORE, mode, fn)
}

// The changelog is a convenience: any storage failure (private mode, quota)
// is absorbed — never blocking for the doc display.
export async function readSchemaSnapshot(url) {
  try {
    let out = null
    await tx('readonly', (store) => {
      const request = store.get(url)
      request.onsuccess = () => {
        out = request.result ?? null
      }
    })
    return out
  } catch (err) {
    console.error('[api-doc] schema snapshot read failed:', err)
    return null
  }
}

// Inventory + purge for the settings panel. A read failure reports 0 rather
// than breaking the panel: the count is informational, unlike the purge.
export async function countSchemaSnapshots() {
  try {
    let total = 0
    await tx('readonly', (store) => {
      const request = store.count()
      request.onsuccess = () => {
        total = request.result
      }
    })
    return total
  } catch (err) {
    console.error('[api-doc] schema snapshot count failed:', err)
    return 0
  }
}

// Dropping the snapshots resets the changelog baseline: the next load compares
// against nothing and flags nothing, exactly like a first visit.
export function clearSchemaSnapshots() {
  return tx('readwrite', (store) => store.clear())
}

// record: { url, savedAt, version, operations } — operations in the
// operationFingerprints() format.
export async function writeSchemaSnapshot(record) {
  try {
    // UTF-16 length as a byte approximation, same convention as the history
    // body cap — good enough for a guard, and it costs one serialization.
    if (JSON.stringify(record).length > MAX_RECORD_BYTES) {
      console.warn(
        '[api-doc] schema snapshot too large to store, changelog disabled for',
        record.url,
      )
      return
    }
    await tx('readwrite', (store) => {
      store.put(record)
      // Requests run in order, so the count already includes the put above.
      const index = store.index('savedAt')
      const countReq = index.count()
      countReq.onsuccess = () => {
        let excess = countReq.result - MAX_RECORDS
        if (excess <= 0) return
        index.openCursor().onsuccess = (e) => {
          const cursor = e.target.result
          if (cursor && excess > 0) {
            cursor.delete()
            excess--
            cursor.continue()
          }
        }
      }
    })
  } catch (err) {
    console.error('[api-doc] schema snapshot write failed:', err)
  }
}
