import { pathKeys, pathSegments, pathTarget } from '../path-segments.js'

// Two Paths keys a single URL can match, where concrete-first matching cannot
// pick one: `/{entity}/me` and `/books/{id}` both match `/books/me`, each
// literal where the other is templated. The specification leaves the choice to
// the tooling (OAS 3.x, Path Templating Matching) — so servers, gateways and
// generated clients each pick their own, and the same request reaches
// different operations depending on who routes it. Here, a request pasted
// into the import dialog fits both equally, and the reader has to choose.
//
// True ambiguities only: `/pets/mine` against `/pets/{id}` is ordered by the
// specification itself (concrete first) and is not reported; neither is a pair
// differing only by variable names, which is `paths-identical`'s. One finding
// per pair, on the later key. `info`: real routers mostly resolve these by
// declaration order or by the values actually sent, and a large API carries
// dozens of them (the GitHub REST description, 67).
export const pathsAmbiguous = {
  id: 'paths-ambiguous',
  category: 'correctness',
  severity: 'info',
  run(ctx, check) {
    const paths = pathKeys(ctx).map((path) => ({ path, segments: pathSegments(path) }))
    const bySize = new Map()
    for (const entry of paths) {
      const size = entry.segments.length
      if (!bySize.has(size)) bySize.set(size, [])
      bySize.get(size).push(entry)
    }
    for (const group of bySize.values()) {
      for (let j = 1; j < group.length; j += 1) {
        for (let i = 0; i < j; i += 1) {
          if (!ambiguous(group[i].segments, group[j].segments)) continue
          check(false, {
            ...pathTarget(ctx, group[j].path),
            params: { path: group[j].path, other: group[i].path },
          })
        }
      }
    }
  },
}

function ambiguous(a, b) {
  let aLiteralOnly = false
  let bLiteralOnly = false
  for (let k = 0; k < a.length; k += 1) {
    const [x, y] = [a[k], b[k]]
    if (!x.templated && !y.templated) {
      if (x.text !== y.text) return false
    } else if (!x.templated) aLiteralOnly = true
    else if (!y.templated) bLiteralOnly = true
  }
  return aLiteralOnly && bLiteralOnly
}
