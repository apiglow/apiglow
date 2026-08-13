import { readSpecPref, writeSpecPref } from './prefs.js'

// Memory of entered header values: test headers (app origin, API
// version, token…) are common to most endpoints — you enter them
// once and keep that context while moving from route to route.
// Key = lowercase name (HTTP semantics); clearing the field or removing the
// row = forget. {{var}} templates are memorized as-is, unresolved.
// Shared between the try-it panel and the header fields of the central content.
const HEADER_MEMORY_KEY = 'tryit.headers'
// Bounded-storage policy (rule 13). This one is written on every keystroke in a
// header field, so it needs a bound of its own: a FIFO over the remembered
// names, and a per-value ceiling. The ceiling is comfortably above a long JWT —
// what it stops is a pasted body-sized value ending up in localStorage forever.
const MAX_HEADERS = 50
const MAX_VALUE_LENGTH = 8 * 1024

export function readHeaderMemory() {
  const stored = readSpecPref(HEADER_MEMORY_KEY, {})
  return stored && typeof stored === 'object' ? stored : {}
}

export function rememberHeader(name, value) {
  if (!name) return
  const memory = readHeaderMemory()
  const key = name.toLowerCase()
  if (value === '' || value === undefined) {
    delete memory[key]
  } else {
    // An over-long value is not memorized at all rather than truncated: a
    // half-token silently reloaded into the next request would be worse than
    // an empty field.
    if (String(value).length > MAX_VALUE_LENGTH) return
    // Assigning an existing key keeps its position in the object, so the FIFO
    // is by first-seen name: editing a value doesn't make it "newer".
    memory[key] = { name, value }
    const keys = Object.keys(memory)
    // Guarded: a negative count would make slice() trim from the END, i.e.
    // evict while still under the cap.
    if (keys.length > MAX_HEADERS) {
      for (const oldest of keys.slice(0, keys.length - MAX_HEADERS)) delete memory[oldest]
    }
  }
  writeSpecPref(HEADER_MEMORY_KEY, memory)
}
