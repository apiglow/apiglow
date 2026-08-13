// The ESM build is named rather than the package: json-p3 ships no `exports`
// map and points `browser` at an IIFE bundle, which exports nothing importable
// — so a bare `from 'json-p3'` resolves to a different file depending on who is
// asking (vite's lib build takes `browser`, vitest takes `module`). Naming it
// here makes every toolchain agree with no build config, and keeps the
// version-shaped promise next to the code that depends on it. A `resolve.alias`
// would also have matched future subpath imports by prefix, mangling the
// `json-p3/pointer` entry the spec-code inventory expects to reach for next.
import { JSONPathEnvironment } from 'json-p3/dist/json-p3.esm.js'

// OpenAPI Overlay 1.1 (docs/openapi-coverage.md §4.7) — a pure document
// transform, applied to the parsed source before anything else reads it
// (conversion included: an overlay is written against the file its author
// has, which may well be a 2.0 one).
//
// The overlay itself comes from the host config, so it is trusted the way
// `openapi.url` is trusted. What is NOT trusted is that it is well written:
// every deviation — an unsupported target syntax, a target matching nothing,
// an update that cannot be merged where it points — becomes a warning code the
// settings panel lists. An overlay never breaks a load, and never silently
// does nothing.

// Exported: the About dialog states which Overlay revision the app applies, and
// one constant is what keeps that claim true (same rule as `ARAZZO_VERSION`).
export const OVERLAY_VERSION = '1.1'
// A 1.0 document is still a valid overlay and is read with the 1.1 semantics:
// newest-wins (rule 19) says which rules we apply, not which files we refuse.
const ACCEPTED_VERSIONS = ['1.0', OVERLAY_VERSION]
const OVERLAY_VERSION_RE = new RegExp(
  `^(${ACCEPTED_VERSIONS.map((version) => version.replace('.', '\\.')).join('|')})(\\.|$)`,
)

// Guards in the spirit of rule 7, stated for what each one actually bounds —
// the hand-written traversal that used to live here counted node *visits*, and
// the engine that replaced it does not offer that.
//
//   - `MAX_QUERY_DEPTH` is json-p3's `maxRecursionDepth`: how deep a `$..`
//     descent may nest, not how many nodes it may see. Its default (50) is too
//     tight for a real schema; this is a stack bound, not a work bound.
//   - `MAX_MATCHES` caps the result set, which no engine bounds for us, and is
//     therefore the guard that actually fires.
//
// What is deliberately NOT bounded: the node count of a descent whose filter
// matches little or nothing. It walks the whole document — a document we have
// already parsed and hold in memory, so it is finite and the walk terminates.
const MAX_MATCHES = 5000
const MAX_QUERY_DEPTH = 500
const MAX_MERGE_DEPTH = 32

export function applyOverlays(doc, overlays = []) {
  let document = doc
  const warnings = []
  const infos = []
  let actions = 0
  let count = 0
  ;(overlays ?? []).forEach((overlay, index) => {
    const result = applyOverlay(document, overlay)
    for (const warning of result.warnings) warnings.push({ ...warning, overlay: index + 1 })
    if (result.info) infos.push({ overlay: index + 1, ...result.info })
    document = result.document
    actions += result.actions
    count += 1
  })
  return { document, warnings, actions, count, infos }
}

export function applyOverlay(doc, overlay) {
  const warnings = []
  // The two exits that never reach an action, in one shape: whatever was raised
  // by then is document-level by construction, and the source is handed back
  // untouched because nothing was ever cloned.
  const unapplied = (info) => ({
    document: doc,
    warnings,
    documentWarnings: warnings.slice(),
    actions: 0,
    info,
    trace: [],
  })
  if (!isPlainObject(overlay)) {
    warnings.push({ code: 'overlay-invalid' })
    return unapplied(null)
  }
  const info = overlayInfo(overlay)
  const version = trimmed(overlay.overlay)
  // Applied anyway: a document carrying `actions` is an overlay whatever it
  // calls itself, and refusing it would be stricter than the spec is.
  if (!OVERLAY_VERSION_RE.test(version)) {
    warnings.push({ code: 'overlay-version-unknown', version: version || '—' })
  }
  const declared = Array.isArray(overlay.actions) ? overlay.actions : []
  if (!declared.length) {
    warnings.push({ code: 'overlay-no-actions' })
    return unapplied(info)
  }
  // The boundary between what the document said and what its actions did: past
  // this line every warning belongs to a trace entry, so the dry run can list
  // the two apart without re-deriving the split by identity.
  const documentWarnings = warnings.slice()
  // Cloned only once there is something to do: the host page's inline schema
  // must never be edited under the integrator's feet, and neither must the
  // source the audit reads.
  const document = structuredClone(doc)
  let actions = 0
  // `trace` is the same run seen action by action, which the flat warning list
  // cannot give: an author checking a document before applying it needs to know
  // that *this* target matched nothing, or matched 400 nodes — a number no
  // warning carries, because a successful action emits none. It is a byproduct
  // of the real application, never a second, divergent pass (rule: one path):
  // each entry is measured against the document as the previous actions left it.
  const trace = []
  for (const action of declared) {
    const before = warnings.length
    const { applied, matches } = applyAction(document, action, warnings)
    if (applied) actions += 1
    trace.push({
      target: trimmed(action?.target),
      matches,
      applied,
      warnings: warnings.slice(before),
    })
  }
  return { document, warnings, documentWarnings, actions, info, trace }
}

// `info.description` (1.1, CommonMark, optional) is the one field that says
// *why* an overlay exists, and the settings diagnostics is the only place an
// overlay's identity is ever shown — so it travels with the result instead of
// being read and dropped. A description is what makes the record worth
// carrying: `info.title` is required by the spec, so nearly every overlay has
// one, and a title alone says nothing the "N overlays applied" line does not.
// It rides along only to label the description it came with.
function overlayInfo(overlay) {
  const description = trimmed(overlay.info?.description)
  return description ? { title: trimmed(overlay.info?.title), description } : null
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// Returns `{ applied, matches }` — `matches` is null for an action rejected
// before its target was ever resolved, which is not the same story as a target
// resolved to nothing.
function applyAction(document, action, warnings) {
  const target = trimmed(action?.target)
  if (!target) {
    warnings.push({ code: 'overlay-target-missing' })
    return REJECTED
  }
  // What the action DOES is decided before the document is touched: an action
  // that can never apply is worth naming without paying for a full traversal
  // first, and both verdicts below are readable off `action` alone.
  //
  // Precedence is the spec's, read literally: `remove: true` empties both of
  // the others, and `update` and `copy` each state they "have no impact" when
  // the other carries a value — so an action declaring both does nothing at
  // all rather than one of the two. Silently picking a winner would be the
  // worst of the three outcomes.
  const remove = action.remove === true
  const hasUpdate = !remove && 'update' in action
  const hasCopy = !remove && 'copy' in action
  if (hasUpdate && hasCopy) {
    warnings.push({ code: 'overlay-action-ambiguous', target })
    return REJECTED
  }
  if (!remove && !hasUpdate && !hasCopy) {
    warnings.push({ code: 'overlay-update-missing', target })
    return REJECTED
  }

  const query = parseTarget(target)
  if (!query) {
    warnings.push({ code: 'overlay-target-unsupported', target })
    return REJECTED
  }
  const { matches, truncated } = resolveTarget(document, query)
  const count = matches.length
  if (truncated) warnings.push({ code: 'overlay-target-truncated', target })
  if (!count) {
    // The spec makes a target matching nothing a no-op. It is still the most
    // common way for an overlay to look applied and change nothing.
    warnings.push({ code: 'overlay-target-empty', target })
    return { applied: false, matches: 0 }
  }
  let applied
  if (remove) applied = removeMatches(matches, target, warnings)
  else if (hasCopy) applied = copyMatches(document, matches, action.copy, target, warnings)
  else applied = updateMatches(matches, action.update, target, warnings)
  return { applied, matches: count }
}

const REJECTED = Object.freeze({ applied: false, matches: null })

function removeMatches(matches, target, warnings) {
  let done = false
  for (const match of matches) {
    if (!match.parent) {
      warnings.push({ code: 'overlay-remove-root' })
      continue
    }
    if (Array.isArray(match.parent)) {
      // By identity rather than by the index resolution saw: an earlier
      // removal in the same array has already shifted them.
      const index = match.parent.indexOf(match.value)
      if (index < 0) continue
      match.parent.splice(index, 1)
    } else {
      delete match.parent[match.key]
    }
    done = true
  }
  if (!done) warnings.push({ code: 'overlay-remove-failed', target })
  return done
}

function updateMatches(matches, update, target, warnings) {
  let done = false
  for (const match of matches) {
    if (mergeInto(match, update, target, warnings)) done = true
  }
  return done
}

// `copy` (1.1's third action) merges one node of the document into each target
// node, under exactly the `update` rules — hence the shared `mergeInto`, so
// the two cannot drift. The source is resolved against the document as it
// stands *at this point in the action list*: actions are ordered and each sees
// what the previous one produced, which `applyOverlay` gets for free by
// mutating a single clone.
function copyMatches(document, matches, source, target, warnings) {
  const expression = trimmed(source)
  const query = expression ? parseTarget(expression) : null
  if (!query) {
    // Its own code, not the target's: a malformed copy source and a malformed
    // target are the two ends of one action, and the panel lists them side by
    // side. Same reason `overlay-copy-empty` is not `overlay-target-empty`.
    warnings.push({ code: 'overlay-copy-unsupported', copy: expression || '—' })
    return false
  }
  const found = resolveTarget(document, query).matches
  if (!found.length) {
    warnings.push({ code: 'overlay-copy-empty', copy: expression })
    return false
  }
  // "A JSONPath selecting a single node": several is as unusable as none, and
  // picking the first would be an answer the overlay never gave.
  if (found.length > 1) {
    warnings.push({ code: 'overlay-copy-ambiguous', copy: expression, count: found.length })
    return false
  }
  // Detached before the first merge, because the source is a live node of the
  // very document the merge is about to edit — copying a node into one of its
  // own ancestors would otherwise read a value while writing it.
  const value = structuredClone(found[0].value)
  return updateMatches(matches, value, target, warnings)
}

// The 1.1 merge rules, stated per target kind: an array concatenates with an
// array and appends anything else, an object merges with an object, and a
// primitive is *replaced* by a primitive. The crossings the spec calls
// "incompatible" — object told to merge with a primitive and the reverse —
// are the documented fallback: a warning naming the target, nothing changed.
function mergeInto(match, update, target, warnings) {
  if (Array.isArray(match.value)) {
    if (Array.isArray(update)) match.value.push(...structuredClone(update))
    else match.value.push(structuredClone(update))
    return true
  }
  if (isPlainObject(match.value) && isPlainObject(update)) {
    deepMerge(match.value, update, 0)
    return true
  }
  // A primitive target is replaced, and replacing it needs the place rather
  // than the value — which is why a match carries its parent. The document
  // root has none, so `$` stays the one node no update can replace.
  if (!isPlainObject(match.value) && isPrimitive(update) && match.parent) {
    match.parent[match.key] = update
    return true
  }
  warnings.push({ code: 'overlay-update-mismatch', target })
  return false
}

function deepMerge(target, update, depth) {
  if (depth > MAX_MERGE_DEPTH) return
  for (const [key, value] of Object.entries(update)) {
    if (isPlainObject(value) && isPlainObject(target[key])) deepMerge(target[key], value, depth + 1)
    // Arrays present on both sides concatenate. 1.0 left this implicit and we
    // chose replacement, on the grounds that merging two arrays means picking
    // an identity for their entries which nothing here can know; 1.1 settles
    // it the other way — "arrays concatenate with target arrays" — and the
    // spec outranks the reasoning.
    else if (Array.isArray(value) && Array.isArray(target[key]))
      target[key].push(...structuredClone(value))
    // Everything else inserts or replaces, the incompatible crossings
    // included: nested, they carry no path to name in a warning, so the whole
    // action would have to be refused to say anything at all.
    else target[key] = structuredClone(value)
  }
}

// --- target expressions ----------------------------------------------------
//
// RFC 9535, whole, and by library. 1.1 turned the target expression from "a
// JSONPath" into a conformance requirement — *"A tool or library MUST fully
// implement RFC9535 when parsing and expanding JSONPath query expressions to
// be compliant with the Overlay specification"* — and a query language over a
// spec document is exactly the work the dependency rule (architecture.md
// §14.2) opens runtime dependencies for.
// What used to live here was a deliberate subset (root, dot/bracket children,
// index, wildcard, descent, `==`/`!=` filters); slices, unions, relational and
// logical operators, existence tests and the function extensions were all
// missing, and being subtly wrong about a query language is silent.
//
// `json-p3` is what guarantees the conformance (tested against the JSONPath
// Compliance Test Suite), and it is chosen over the other candidate for what
// it hands back: each node's **location**, an array of keys, where the others
// return values or normalized path strings to re-parse. `remove` and an
// in-place `update` need the place, not the thing.
//
// Ours are the two ends of that: turning a location into the `{parent, key,
// value}` a match is, and keeping the rule 7 bounds — delegating the traversal
// does not delegate responsibility for a document whose size we never control.

const JSONPATH = new JSONPathEnvironment({ maxRecursionDepth: MAX_QUERY_DEPTH })

// Returns the compiled query, or null for an expression that is not valid
// RFC 9535 — which is now the only thing `overlay-target-unsupported` means.
function parseTarget(expression) {
  try {
    return JSONPATH.compile(String(expression))
  } catch (err) {
    console.error('[api-doc] overlay target rejected:', expression, err)
    return null
  }
}

// --- resolution ------------------------------------------------------------
//
// A match carries its parent and key, not just its value: `remove` needs the
// place, not the thing.

function resolveTarget(root, query) {
  const matches = []
  let truncated = false
  try {
    // Lazily, so the cap costs nothing on the descent it exists for: `$..*`
    // combined with a filter is the unbounded case, and the engine's own
    // recursion limit only bounds the walk, not the result set.
    for (const node of query.lazyQuery(root)) {
      if (matches.length >= MAX_MATCHES) {
        truncated = true
        break
      }
      matches.push(toMatch(root, node.location))
    }
  } catch (err) {
    // The engine hitting its recursion limit, or an expression that only fails
    // against this particular document. Either way what was collected is what
    // the action gets, and the shortfall is named rather than swallowed.
    console.error('[api-doc] overlay target resolution stopped:', err)
    truncated = true
  }
  return { matches, truncated }
}

// A location is the list of keys walked to reach the node; the last one is the
// key inside its parent. The empty location is the document root, which has no
// parent — the one node `remove` and a primitive `update` cannot touch.
function toMatch(root, location) {
  if (!location.length) return { parent: null, key: null, value: root }
  let parent = root
  for (let i = 0; i < location.length - 1; i += 1) parent = parent[location[i]]
  const key = location[location.length - 1]
  return { parent, key, value: parent[key] }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isPrimitive(value) {
  return value === null || typeof value !== 'object'
}
