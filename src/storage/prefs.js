// Lightweight preferences: localStorage only (rule 8 — history, on the
// other hand, lives in IndexedDB). Namespaced to avoid colliding with the host
// page. Any storage error (private mode, quota) is non-blocking.

const PREFIX = 'apidoc:'

export function readPref(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writePref(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage unavailable: the preference won't survive a refresh, too bad.
  }
}

// Removal rather than writing `null`: a stored `null` reads back as the
// fallback, but keeps a key the storage inventory would still count and purge.
function removePref(key) {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // Storage unavailable: there was nothing stored to remove either.
  }
}

// Per-spec keys (multi-spec, docs/multi-spec.md §5): namespace
// apidoc:{specId}:{key}, locked once at boot like the route prefix — a
// spec change reloads the page. In mono-spec (null scope) the key stays bare:
// a single-spec install has nothing to disambiguate, and a namespace would
// only make the stored keys harder to read.
let specScope = ''

export function setSpecScope(specId) {
  specScope = specId ? `${specId}:` : ''
}

export function readSpecPref(key, fallback = null) {
  return readPref(specScope + key, fallback)
}

export function writeSpecPref(key, value) {
  writePref(specScope + key, value)
}

export function removeSpecPref(key) {
  removePref(specScope + key)
}
