import { AMBIGUOUS, dominantStyle, nameStyle } from '../casing.js'
import { pointer } from '../pointer.js'

// URL segments are the most public surface of an API — they end up in logs,
// in bookmarks, in other people's code — and they are the hardest thing to
// rename later. `/pet-store/{id}/orderHistory` costs a consumer a lookup on
// every call.
//
// Template segments are skipped: `{petId}` is a parameter name, already covered
// by `parameter-naming`, and it does not appear in the URL a consumer types.
export const pathStyle = {
  id: 'path-style',
  category: 'consistency',
  severity: 'info',
  run(ctx, check) {
    const paths = Object.keys(ctx.document.paths ?? {})
    // The vote counts each distinct segment once: `/pet` appearing in six paths
    // is one naming decision, and letting it vote six times would make the most
    // reused resource the convention on its own.
    const styles = new Map()
    for (const path of paths) {
      for (const segment of staticSegments(path)) {
        if (!styles.has(segment)) styles.set(segment, nameStyle(segment))
      }
    }
    const dominant = dominantStyle(styles.values())
    if (!dominant) return
    for (const path of paths) {
      const outlier = staticSegments(path).find((segment) => {
        const style = styles.get(segment)
        return style && style !== AMBIGUOUS && style !== dominant
      })
      check(!outlier, {
        op: operationAt(ctx, path),
        location: path,
        dataPath: pointer('paths', path),
        params: { segment: outlier ?? '', style: outlier ? styles.get(outlier) : '', dominant },
      })
    }
  },
}

// The finding is about the URL, and no page renders a path on its own: the doc
// shows one through the operations declared on it. The first routable one is
// what "take me there" means here — the label stays the path, only the link
// target comes from the operation. All of them hidden, and the operation is
// still what says so (the badge) rather than a bare pointer.
function operationAt(ctx, path) {
  const declared = ctx.operations.filter(
    (entry) => entry.kind === 'operation' && entry.path === path,
  )
  return declared.find((entry) => !entry.hidden) ?? declared[0] ?? null
}

function staticSegments(path) {
  return String(path)
    .split('/')
    .filter((segment) => segment && !segment.includes('{'))
}
