// JSON Pointer (RFC 6901) — the extraction and assertion language of
// scenarios (docs/scenarios.md §2). Pure, tested functions.
//
// Read-only and defensive: a pointer coming from an imported file or free
// text entry must never throw, only yield `found: false`.

const NOT_FOUND = { found: false, value: undefined }

export function resolvePointer(doc, pointer) {
  if (pointer === undefined || pointer === null || pointer === '')
    return { found: true, value: doc }
  const raw = String(pointer)
  if (!raw.startsWith('/')) return NOT_FOUND
  let current = doc
  for (const token of raw.slice(1).split('/')) {
    // Order mandated by the RFC: ~1 before ~0, otherwise "~01" would
    // decode to "/" instead of "~1".
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      // "-" (next element) only makes sense on write: out of scope here.
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return NOT_FOUND
      const index = Number(key)
      if (index >= current.length) return NOT_FOUND
      current = current[index]
    } else if (current !== null && typeof current === 'object') {
      if (!Object.hasOwn(current, key)) return NOT_FOUND
      current = current[key]
    } else {
      return NOT_FOUND
    }
  }
  return { found: true, value: current }
}

// Access path (keys and indexes) → pointer. This is what turns a click on
// a response key into an extraction (§5.4).
export function pointerFrom(segments) {
  if (!segments?.length) return ''
  return segments.map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('')
}

// --- dotted notation: the form READ AND ENTERED, never the one that is stored --
//
// `/triplon/original_operator` reads as "triplon.original_operator": it's
// the notation everyone uses when designating a response field, and a
// five-step timeline displays twenty of them. Storage, though, stays JSON
// Pointer RFC 6901 — it's the format of the scenario file and the one
// Arazzo requires (§2, §8). The conversion therefore only lives at the
// edges, on display and on entry.

export function pointerToPath(pointer) {
  if (pointer === undefined || pointer === null || pointer === '') return ''
  const raw = String(pointer)
  // Still free-form entry (a field currently being filled in): rendered
  // as-is, there's nothing to translate.
  if (!raw.startsWith('/')) return raw
  const segments = raw
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
  // A key carrying a dot — or an empty key — can't be read back in dotted
  // notation: `{"a.b": 1}` and `{"a": {"b": 1}}` would be written the same
  // way. Those pointers stay displayed raw, which also keeps them
  // re-parseable.
  if (segments.some((segment) => segment === '' || segment.includes('.'))) return raw
  return segments.join('.')
}

export function pathToPointer(path) {
  const raw = String(path ?? '').trim()
  if (raw === '') return ''
  // Already a pointer: pasted from a file, or rendered raw by
  // `pointerToPath` for lack of a possible translation.
  if (raw.startsWith('/')) return raw
  return pointerFrom(raw.split('.'))
}
