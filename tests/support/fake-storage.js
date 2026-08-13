// The Web Storage double the storage tests share. `prefs.js` and
// `header-memory.js` only ever get/set/remove; `maintenance.js` enumerates,
// hence `length` and `key()`. One double covering both halves of the storage
// layer means they are held to the same object, and neither module gets to
// depend on a shape the other's test never exercises.
//
// `map` is exposed on purpose: several tests assert on what was actually
// written, not only on what reads back.
export function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  }
}
