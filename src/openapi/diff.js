// Local schema diff (competitive analysis, prio 2 — inspired by Bump.sh, no
// backend): pure functions operating on the normalized model (rule 6). The
// persisted snapshot is a list of operation fingerprints, not the raw
// schema — trivial comparison and lightweight storage.

// Fingerprint format version, stored in the snapshot. A snapshot in an
// other format isn't comparable: it gets replaced without a diff (see app.js).
// v4: cycles cut by depth budget, not by distance to the ancestor.
export const FINGERPRINT_FORMAT = 4

// 53-bit hash (cyrb53): enough for "has this operation changed" —
// a collision would only cost a missed changelog entry.
function hash53(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// Maximum expansion depth. Beyond that, the node is reduced to a marker:
// recursive schemas have no bottom, and a fingerprint must be computed in
// bounded time (rule 7 — no unbounded recursion). A change located
// below this depth isn't flagged; the changelog is a reading aid,
// not a contract audit.
const MAX_DEPTH = 24

// A node's fingerprint depends ONLY on its subtree and the remaining depth
// budget — never on the path taken to reach it. This is what
// makes the memo (one per budget) always valid, and the cost linear: each
// object is hashed at most MAX_DEPTH + 1 times, regardless of how many
// references point to it.
//
// The previous version cut cycles by distance to the ancestor node:
// a fingerprint then depended on the entry point, so it wasn't memoizable,
// and a single deep cycle disqualified all its ancestors up to the root.
// On a real recursive schema (143 operations), the shared subtrees
// were re-walked on every reference: 28M node visits, 440M
// characters hashed, 2.9s of main-thread blocking on load.
function createFingerprinter() {
  const memos = Array.from({ length: MAX_DEPTH + 1 }, () => new WeakMap())
  const walk = (value, budget) => {
    if (!value || typeof value !== 'object') return JSON.stringify(value) ?? '~'
    // The budget decreases strictly: it also terminates cycles, without a stack.
    if (budget === 0) return '⋯'
    const memo = memos[budget]
    const cached = memo.get(value)
    if (cached !== undefined) return cached
    const parts = []
    if (Array.isArray(value)) {
      parts.push('[')
      for (const item of value) parts.push(walk(item, budget - 1))
      parts.push(']')
    } else {
      parts.push('{')
      for (const [key, v] of Object.entries(value)) {
        if (v === undefined) continue
        parts.push(`${key}:`, walk(v, budget - 1))
      }
      parts.push('}')
    }
    const text = hash53(parts.join('|'))
    memo.set(value, text)
    return text
  }
  return (value) => walk(value, MAX_DEPTH)
}

// Fingerprint keys for documented fields — shared with the components, which
// rebuild them identically to look up the status of a rendered element.
export const paramFieldKey = (param) => `param:${param.in}:${param.name}`
export const bodyPropKey = (mediaType, name) => `body:${mediaType}:${name}`
export const responseFieldKey = (status) => `response:${status}`
export const responsePropKey = (status, mediaType, name) =>
  `response:${status}:${mediaType}:${name}`

// Top-level properties shown by the doc: those of the schema, or
// those of the item when the root is an array ("list of Pet" response,
// sequential media type) — this is what schema-view puts forward.
function topLevelProperties(schema) {
  const root = schema?.kind === 'array' ? schema.items : schema
  return root?.properties ?? []
}

// Badge granularity in doc content: a parameter, a top-level property
// of the body, a response status code and its top-level
// properties. Going deeper would grow the snapshot for zero reading
// gain — the operation's badge already flags the rest.
function fieldFingerprints(op, fingerprint) {
  const fields = {}
  for (const param of op.parameters ?? []) fields[paramFieldKey(param)] = fingerprint(param)
  for (const content of op.requestBody?.contents ?? []) {
    for (const prop of topLevelProperties(content.itemSchema ?? content.schema)) {
      fields[bodyPropKey(content.mediaType, prop.name)] = fingerprint(prop)
    }
  }
  for (const response of op.responses ?? []) {
    fields[responseFieldKey(response.status)] = fingerprint(response)
    for (const content of response.contents ?? []) {
      for (const prop of topLevelProperties(content.itemSchema ?? content.schema)) {
        fields[responsePropKey(response.status, content.mediaType, prop.name)] = fingerprint(prop)
      }
    }
  }
  return fields
}

// One batch of operations per step, the full list when drained — the audit
// engine's shape (auditRun), for the same reason: on a heavy schema the whole
// computation is a third of a second of frozen main thread, over the blocking
// budget of rule 14 on its own, and its idle deferral only decides WHEN that
// task runs, not how long it is. The caller gives the browser room between
// steps; the memo inside `fingerprint` spans them, so shared schemas still
// hash once.
export function* fingerprintRun(model, batchSize = 100) {
  const fingerprint = createFingerprinter()
  // Webhooks included: an added/modified event is a contract change
  // just like an endpoint (`?? []` — snapshots from older models).
  const ops = [...model.operations, ...(model.webhooks ?? [])]
  const list = []
  for (const op of ops) {
    list.push({
      id: op.id,
      method: op.method,
      path: op.path,
      summary: op.summary ?? '',
      fingerprint: fingerprint(op),
      fields: fieldFingerprints(op, fingerprint),
    })
    if (list.length % batchSize === 0) yield
  }
  return list
}

export function operationFingerprints(model) {
  const run = fingerprintRun(model)
  let step = run.next()
  while (!step.done) step = run.next()
  return step.value
}

// "Simple version" level of detail, by design: which
// operations moved, not field by field. Rendered entries are
// stripped of their fingerprint — the UI has no use for it.
export function diffOperations(oldList, newList) {
  const oldById = new Map((oldList ?? []).map((op) => [op.id, op]))
  const newById = new Map((newList ?? []).map((op) => [op.id, op]))
  const strip = ({ id, method, path, summary }) => ({ id, method, path, summary })
  const added = [...newById.values()].filter((op) => !oldById.has(op.id)).map(strip)
  const removed = [...oldById.values()].filter((op) => !newById.has(op.id)).map(strip)
  const changed = [...newById.values()]
    .filter((op) => oldById.has(op.id) && oldById.get(op.id).fingerprint !== op.fingerprint)
    .map(strip)
  // Index by operation for in-situ marking (nav and doc content). An
  // added operation is entirely new: also marking each of its
  // fields would say nothing more and would clutter the reading.
  const byOp = {}
  for (const op of added) byOp[op.id] = { status: 'added', fields: {} }
  for (const op of changed) {
    byOp[op.id] = {
      status: 'changed',
      fields: diffFields(oldById.get(op.id).fields, newById.get(op.id).fields),
    }
  }
  return {
    added,
    removed,
    changed,
    byOp,
    empty: !added.length && !removed.length && !changed.length,
  }
}

// Vanished fields are no longer rendered anywhere: nothing to mark.
function diffFields(oldFields, newFields) {
  const result = {}
  for (const [key, fingerprint] of Object.entries(newFields ?? {})) {
    const before = oldFields?.[key]
    if (before === undefined) result[key] = 'added'
    else if (before !== fingerprint) result[key] = 'changed'
  }
  return result
}
