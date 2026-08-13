// Request history: IndexedDB from the start (rule 8 — no
// localStorage→IndexedDB dual-path). localStorage stays reserved for
// lightweight preferences; history can grow large (bodies) and deserves a real
// indexed async store.

import { openDatabase, runTransaction } from './idb.js'

const DB_NAME = 'apidoc-history'
// Still 2 although the schema has a single shape: dev browsers hold a v2
// database, and reopening it at 1 raises VersionError. There is no v1 upgrade
// path — the project has no installation to migrate.
const DB_VERSION = 2
const STORE = 'entries'
// Storage cap (docs/architecture.md §5.6): bodies truncated beyond 256 KB.
const MAX_BODY_BYTES = 256 * 1024

function openDb() {
  return openDatabase(DB_NAME, DB_VERSION, (db) => {
    const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    store.createIndex('timestamp', 'timestamp')
    // multi-spec §4.5: every entry carries its specId.
    store.createIndex('specId', 'specId')
  })
}

function truncateBody(body) {
  if (typeof body !== 'string') return { body, truncated: false }
  // Bytes approximation = UTF-16 length; sufficient for a comfort cap.
  if (body.length <= MAX_BODY_BYTES) return { body, truncated: false }
  return { body: body.slice(0, MAX_BODY_BYTES), truncated: true }
}

export class HistoryStore extends EventTarget {
  #dbPromise = null
  #retention
  #specId
  #scoped

  // Multi-spec: `specId` (active spec) is written on each entry; `scoped`
  // filters the list on the active spec. In mono, specId 'default' is written
  // but everything displays as before.
  constructor(
    { maxEntries = 500, maxAgeDays = 30 } = {},
    { specId = 'default', scoped = false } = {},
  ) {
    super()
    this.#retention = { maxEntries, maxAgeDays }
    this.#specId = specId
    this.#scoped = scoped
  }

  // The try-it filters its own runs by spec: `list()` can mix
  // specs (unscoped mode) and two of them can carry the same opId.
  get specId() {
    return this.#specId
  }

  // Exposed so the UI can state the retention rules rather than let entries
  // silently disappear (rule 13: a bound the user can't see is a bug report).
  get retention() {
    return { ...this.#retention }
  }

  #db() {
    this.#dbPromise ??= openDb()
    return this.#dbPromise
  }

  // Writes an entry (bodies truncated), then purges according to the
  // configured retention: maxEntries AND maxAgeDays, first threshold reached (docs/architecture.md §5.6).
  async add(entry) {
    const db = await this.#db()
    const request = truncateBody(entry.request?.body)
    const response = truncateBody(entry.response?.body)
    const record = {
      ...entry,
      specId: this.#specId,
      request: { ...entry.request, body: request.body },
      response: entry.response ? { ...entry.response, body: response.body } : null,
      truncatedRequest: request.truncated,
      truncatedResponse: response.truncated,
    }
    await this.#tx('readwrite', (store) => store.add(record))
    await this.#purge(db)
    this.dispatchEvent(new Event('change'))
  }

  async list() {
    const out = []
    await this.#tx('readonly', (store) => {
      // Descending cursor on the timestamp index: most recent first. The
      // per-spec filter happens as the cursor walks — the specId index can't
      // be used here, it would lose the chronological order.
      const cursorReq = store.index('timestamp').openCursor(null, 'prev')
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (cursor) {
          if (!this.#scoped || cursor.value.specId === this.#specId) out.push(cursor.value)
          cursor.continue()
        }
      }
    })
    return out
  }

  // Whole store, every spec included — unlike `list()`, which can be scoped.
  // Both numbers describe what the retention bound acts on: the cap and the age
  // cutoff are installation-level (§14.5), so stating them next to a per-spec
  // count would tell a multi-spec user they are at 186/500 while the browser
  // holds 482 and is about to purge.
  async stats() {
    let count = 0
    let oldest = null
    await this.#tx('readonly', (store) => {
      const countReq = store.count()
      countReq.onsuccess = () => {
        count = countReq.result
      }
      const cursorReq = store.index('timestamp').openCursor()
      cursorReq.onsuccess = () => {
        oldest = cursorReq.result?.value.timestamp ?? null
      }
    })
    return { count, oldest }
  }

  async count() {
    return (await this.stats()).count
  }

  async remove(id) {
    await this.#tx('readwrite', (store) => store.delete(id))
    this.dispatchEvent(new Event('change'))
  }

  async clear() {
    await this.#tx('readwrite', (store) => store.clear())
    this.dispatchEvent(new Event('change'))
  }

  async #purge() {
    const cutoff = Date.now() - this.#retention.maxAgeDays * 24 * 3600 * 1000
    // Retention stays global to the installation (not per spec): it's a
    // browser volume cap, not a business view.
    await this.#tx('readwrite', (store) => {
      const index = store.index('timestamp')
      // Age purge: everything prior to the cutoff.
      index.openCursor(IDBKeyRange.upperBound(cutoff)).onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
      // Volume purge: beyond maxEntries, delete the oldest ones.
      const countReq = store.count()
      countReq.onsuccess = () => {
        let excess = countReq.result - this.#retention.maxEntries
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
  }

  #tx(mode, fn) {
    return runTransaction(this.#db(), STORE, mode, fn)
  }
}
