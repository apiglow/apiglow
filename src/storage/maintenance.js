import { clearSchemaSnapshots, countSchemaSnapshots } from './schema-snapshot.js'

// Single declaration of everything the app leaves on the device, and the only
// way to take it all back off. The settings panel builds both its inventory and
// its "erase everything" from `storageInventory()`: a dataset added to the app
// but not declared here would survive a full reset while the UI claimed
// otherwise. This file and `docs/architecture.md` §6.2 move together.

const PREF_PREFIX = 'apidoc:'

// The OAuth PKCE handshake, the one sessionStorage exception (architecture
// §6). Declared here rather than in `openapi/oauth-flow.js` so that the storage
// layer holds every key the app writes; the flow imports it back.
export const OAUTH_PENDING_KEY = 'apidoc.oauth.pending'

// Preference keys are namespaced per spec (`apidoc:{specId}:{key}`), so the
// group is decided on the base key alone.
const GROUP_OF_BASE_KEY = {
  environments: 'environments',
  'environment.selected': 'environments',
  'tryit.headers': 'headers',
}

// Everything else the app owns is a small preference (theme, language, column
// widths…). Sending unknown keys there is deliberate: a key belonging to no
// group would be reachable only by the full wipe and would quietly outlive
// every targeted purge.
const DEFAULT_GROUP = 'preferences'

const PREF_GROUPS = ['environments', 'headers', 'preferences']

export function baseKeyOf(fullKey) {
  const segments = String(fullKey).slice(PREF_PREFIX.length).split(':')
  return segments[segments.length - 1]
}

export function groupOfKey(fullKey) {
  return GROUP_OF_BASE_KEY[baseKeyOf(fullKey)] ?? DEFAULT_GROUP
}

function parsed(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    // A key we own but cannot read is still a key to purge; it just counts as
    // holding nothing.
    return null
  }
}

// `entries` are the app-owned `[key, rawJson]` pairs. Pure, so the grouping and
// the counting rules are testable without a browser.
export function inspectPrefEntries(entries) {
  const groups = Object.fromEntries(PREF_GROUPS.map((name) => [name, { keys: [], count: 0 }]))
  for (const [key, raw] of entries) {
    const group = groups[groupOfKey(key)]
    group.keys.push(key)
    // The number shown next to a row has to mean something to the reader:
    // environments and remembered headers count their items across every spec,
    // not the keys holding them. `environment.selected` is a pointer, not an
    // item — it is purged with the group but adds nothing to the count.
    const base = baseKeyOf(key)
    if (base === 'environments') {
      const list = parsed(raw)
      group.count += Array.isArray(list) ? list.length : 0
    } else if (base === 'tryit.headers') {
      const memory = parsed(raw)
      group.count += memory && typeof memory === 'object' ? Object.keys(memory).length : 0
    } else if (base !== 'environment.selected') {
      group.count += 1
    }
  }
  return groups
}

export function readOwnedEntries() {
  const out = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREF_PREFIX)) out.push([key, window.localStorage.getItem(key)])
    }
  } catch {
    // Storage unavailable (private mode): nothing owned, nothing to purge.
  }
  return out
}

function removeKeys(keys) {
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // same
    }
  }
}

function prefGroupOps(group) {
  return {
    // Read at call time, never cached: a purge in another tab, or the one this
    // panel just ran, must be reflected by the next refresh.
    count: async () => inspectPrefEntries(readOwnedEntries())[group].count,
    clear: async () => removeKeys(inspectPrefEntries(readOwnedEntries())[group].keys),
  }
}

// Display order. `reload` marks a dataset the app reads once at boot and holds
// in memory: purging the keys cannot invalidate that copy, so the action has to
// end in a page reload rather than leave the UI showing data the browser no
// longer stores.
export function storageInventory({ history, scenarios }) {
  return [
    {
      id: 'history',
      reload: false,
      count: () => history.count(),
      clear: () => history.clear(),
    },
    {
      id: 'scenarios',
      reload: false,
      count: () => scenarios.count(),
      clear: () => scenarios.clear(),
    },
    {
      id: 'snapshots',
      reload: false,
      count: () => countSchemaSnapshots(),
      clear: () => clearSchemaSnapshots(),
    },
    { id: 'environments', reload: true, ...prefGroupOps('environments') },
    { id: 'headers', reload: true, ...prefGroupOps('headers') },
    { id: 'preferences', reload: true, ...prefGroupOps('preferences') },
  ]
}

// Runs every declared purge; the caller reloads afterwards. One failing row
// (database unavailable, quota) must not leave the rest of the reset undone —
// a half-erased install is worse than a reported partial failure. Returns the
// ids that failed.
export async function eraseEverything(inventory) {
  const failed = []
  await Promise.all(
    inventory.map(async (row) => {
      try {
        await row.clear()
      } catch (err) {
        console.error('[api-doc] reset failed for', row.id, err)
        failed.push(row.id)
      }
    }),
  )
  try {
    // Not a dataset — a handshake in flight. A fresh start must not resume
    // someone else's login on the next load.
    window.sessionStorage.removeItem(OAUTH_PENDING_KEY)
  } catch {
    // Storage unavailable: there was no pending handshake to drop either.
  }
  return failed
}
