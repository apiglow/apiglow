// Operation references in prose (docs/docs-pages.md §4.4). A docs page names
// an operation by `operationId` first, then by `"METHOD /path"` — the
// addressing the market converged on, and the only one that survives a
// document with no operationIds at all.
//
// No cross-spec references: a reference resolves against the ACTIVE spec's
// normalized model (rule 6), same stance as scenarios.

const METHOD_PATH = /^([A-Za-z]+)[ \t]+(\S.*)$/

export function buildOperationIndex(model) {
  const byOperationId = new Map()
  const byMethodPath = new Map()
  // Webhooks are addressable too: normalization gives them the same shape,
  // with the webhook name in `path`.
  for (const op of [...(model?.operations ?? []), ...(model?.webhooks ?? [])]) {
    // First declaration wins: a document with a duplicate operationId is an
    // audit finding, not a reason for a prose link to become unstable.
    if (op.operationId && !byOperationId.has(op.operationId)) byOperationId.set(op.operationId, op)
    const key = `${op.method.toLowerCase()} ${op.path}`
    if (!byMethodPath.has(key)) byMethodPath.set(key, op)
  }
  return { byOperationId, byMethodPath }
}

// `%20` because a markdown link destination carrying a space has to travel
// inside angle brackets, and marked percent-encodes what it finds there.
function decoded(ref) {
  try {
    return decodeURIComponent(ref)
  } catch {
    return ref
  }
}

export function resolveOperationRef(index, ref) {
  const cleaned = decoded(String(ref ?? '').trim())
  if (!cleaned || !index) return null
  const direct = index.byOperationId.get(cleaned)
  if (direct) return direct
  const parts = METHOD_PATH.exec(cleaned)
  if (!parts) return null
  return index.byMethodPath.get(`${parts[1].toLowerCase()} ${parts[2].trim()}`) ?? null
}

// Active index, locked once at boot by the shell — same arrangement as the
// router's spec prefix, and for the same reason: switching spec reloads the
// page, so the markdown renderer can resolve references without every call
// site having to carry the model.
let activeIndex = null

export function setOperationIndex(index) {
  activeIndex = index ?? null
}

export function lookupOperation(ref) {
  return resolveOperationRef(activeIndex, ref)
}
