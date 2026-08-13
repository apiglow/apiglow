// What the local history says about this browser's own use of the API — the
// pure half, over entries the caller has already read (docs/architecture.md
// §5.6). No I/O here, so both surfaces that show these numbers derive them
// from one read.
//
// The honesty constraint is the whole point of the feature: ReadMe's
// equivalents ("Recent Requests", "Popular endpoints") are server-side
// telemetry across every reader. Ours can only ever mean "what YOU sent from
// THIS browser", which is why every label states it and why an empty history
// renders nothing at all rather than an empty chart.

// Entries of one spec, in the order `HistoryStore.list()` returns them (most
// recent first). `specId` null = don't filter: in unscoped multi-spec the list
// mixes specs, and two of them can carry the same opId.
function ofSpec(entries, specId) {
  return (entries ?? []).filter((entry) => specId == null || entry.specId === specId)
}

// The last calls of one operation, in the order they arrived — `list()` is
// already sorted newest-first, and re-sorting here would be a second, weaker
// definition of "recent". Deliberately the raw entries: the strip links back to
// the history dialog, which needs the id to open on them.
export function recentCalls(entries, opId, { specId = null, limit = 5 } = {}) {
  if (!opId) return []
  return ofSpec(entries, specId)
    .filter((entry) => entry.opId === opId)
    .slice(0, limit)
}

// Operations this browser called most, most-used first. Ties are broken by
// the most recent call: between two endpoints used three times each, the one
// still in use is the more useful suggestion.
export function topOperations(entries, { specId = null, limit = 5 } = {}) {
  const byOp = new Map()
  for (const entry of ofSpec(entries, specId)) {
    if (!entry.opId) continue
    const seen = byOp.get(entry.opId)
    if (seen) {
      seen.count += 1
      seen.lastAt = Math.max(seen.lastAt, entry.timestamp ?? 0)
    } else {
      byOp.set(entry.opId, { opId: entry.opId, count: 1, lastAt: entry.timestamp ?? 0 })
    }
  }
  return [...byOp.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt).slice(0, limit)
}
