import { duplicateScenario, normalizeScenario } from '../scenarios/model.js'
import { StorageLimitError } from './errors.js'
import { openDatabase, runTransaction } from './idb.js'

// Local scenarios (docs/scenarios.md §4): dedicated IndexedDB database, not one more
// store in `apidoc-history`. Opposite lifecycle — history purges by
// retention, a scenario never evaporates.

const DB_NAME = 'apidoc-scenarios'
const DB_VERSION = 1
const STORE = 'scenarios'
// Bounded-storage policy (rule 13). Scenarios are user artifacts: eviction is
// out of the question, so the cap is a hard refusal the UI reports. Per spec
// and not global — a spec's scenarios are useless to another one, so one busy
// API must not lock the others out.
export const MAX_SCENARIOS_PER_SPEC = 200

function openDb() {
  return openDatabase(DB_NAME, DB_VERSION, (db) => {
    if (db.objectStoreNames.contains(STORE)) return
    // keyPath without autoIncrement: the id is built by the model (uuid), it
    // must survive an export/import and a database change.
    const store = db.createObjectStore(STORE, { keyPath: 'id' })
    store.createIndex('specId', 'specId')
    store.createIndex('createdAt', 'createdAt')
  })
}

export class ScenarioStore extends EventTarget {
  #dbPromise = null
  #specId
  #scoped

  // Same multi-spec contract as `HistoryStore`: `specId` is written on each
  // record, `scoped` filters the list. A scenario is only valid for its
  // spec (opIds are only unique per spec, §9).
  constructor({ specId = 'default', scoped = false } = {}) {
    super()
    this.#specId = specId
    this.#scoped = scoped
  }

  get specId() {
    return this.#specId
  }

  #db() {
    this.#dbPromise ??= openDb()
    return this.#dbPromise
  }

  async list() {
    const out = []
    await this.#tx('readonly', (store) => {
      const cursorReq = store.index('createdAt').openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        if (!this.#scoped || cursor.value.specId === this.#specId) out.push(cursor.value)
        cursor.continue()
      }
    })
    // Reading from a database is an untrusted input like any other (§2): the
    // store shares an origin with the host page and is editable from devtools.
    return out.map((record) => this.#fromRecord(record)).filter(Boolean)
  }

  async get(id) {
    let record = null
    await this.#tx('readonly', (store) => {
      const req = store.get(id)
      req.onsuccess = () => {
        record = req.result ?? null
      }
    })
    return record ? this.#fromRecord(record) : null
  }

  async add(scenario) {
    const now = Date.now()
    // Count and write in the SAME transaction: a count read outside it could
    // be stale by the time the write lands (two tabs, an import loop).
    let refused = false
    await this.#tx('readwrite', (store) => {
      const countReq = store.index('specId').count(this.#specId)
      countReq.onsuccess = () => {
        if (countReq.result >= MAX_SCENARIOS_PER_SPEC) {
          refused = true
          return
        }
        store.add({
          ...scenario,
          source: 'local',
          specId: this.#specId,
          createdAt: now,
          updatedAt: now,
        })
      }
    })
    if (refused) throw new StorageLimitError(MAX_SCENARIOS_PER_SPEC)
    this.#emit()
    return scenario.id
  }

  // Full write: the view edits an entire scenario (steps included), not
  // isolated fields. `createdAt` is preserved to keep nav order.
  async update(scenario) {
    // Read and write in the SAME transaction: two round-trips just to
    // preserve `createdAt`/`specId` is one too many.
    await this.#tx('readwrite', (store) => {
      const read = store.get(scenario.id)
      read.onsuccess = () => {
        const existing = read.result
        store.put({
          ...scenario,
          source: 'local',
          specId: existing?.specId ?? this.#specId,
          createdAt: existing?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        })
      }
    })
    this.#emit()
  }

  async remove(id) {
    await this.#tx('readwrite', (store) => store.delete(id))
    this.#emit()
  }

  // Whole store, every spec included — same contract as `HistoryStore.count()`:
  // the settings inventory describes the browser, not the active spec.
  async count() {
    let total = 0
    await this.#tx('readonly', (store) => {
      const request = store.count()
      request.onsuccess = () => {
        total = request.result
      }
    })
    return total
  }

  // Only the settings panel's reset calls this: deleting every scenario is data
  // loss, so it exists behind an explicit confirmation and nowhere else.
  async clear() {
    await this.#tx('readwrite', (store) => store.clear())
    this.#emit()
  }

  // Editable local copy: this is the only editing path for a scenario provided
  // by the config (§3).
  async duplicate(scenario, { name } = {}) {
    const copy = duplicateScenario(scenario, { name })
    await this.add(copy)
    return copy
  }

  #fromRecord(record) {
    const { scenario } = normalizeScenario(record, { source: 'local', id: record.id })
    if (!scenario) return null
    return { ...scenario, createdAt: record.createdAt ?? 0, updatedAt: record.updatedAt ?? 0 }
  }

  #emit() {
    this.dispatchEvent(new Event('change'))
  }

  #tx(mode, fn) {
    return runTransaction(this.#db(), STORE, mode, fn)
  }
}
