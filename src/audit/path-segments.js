import { pointer } from './pointer.js'

// Shared by the rules that compare Paths keys with one another
// (`paths-identical`, `paths-ambiguous`, `path-syntax`).

// `/pets/{petId}/toys` → [{ text: 'pets', templated: false }, { text: '{petId}',
// templated: true }, …]. A segment holding any `{…}` is templated as a whole:
// `/files/{name}.{ext}` matches whatever the URL puts there.
export function pathSegments(path) {
  return String(path)
    .split('/')
    .slice(1)
    .map((text) => ({ text, templated: text.includes('{') }))
}

// What a finding about a path links to: no page renders a path on its own,
// the first routable operation declared on it is what "take me there" means;
// the label stays the path (the same choice as `path-style`).
export function pathTarget(ctx, path) {
  const declared = ctx.operations.filter(
    (entry) => entry.kind === 'operation' && entry.path === path,
  )
  return {
    op: declared.find((entry) => !entry.hidden) ?? declared[0] ?? null,
    location: path,
    dataPath: pointer('paths', path),
  }
}

// The Paths keys of the source, in document order — the keys as written, the
// `x-` extensions left out.
export function pathKeys(ctx) {
  const paths = ctx.source?.paths
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return []
  return Object.keys(paths).filter((key) => !key.startsWith('x-'))
}
