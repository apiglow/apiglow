// Single-pass dereference for the common case: a document whose every `$ref`
// is an internal `#/…` pointer. ref-parser's crawler resolves the same
// document in ~7× the time — its generality (external URLs, files, YAML
// anchors, redirects) is bookkeeping paid per node — and on a heavy schema
// that difference is most of the boot budget (rule 14).
//
// This is NOT a second dereferencer competing with the library: ref-parser
// stays the reference implementation and the loader falls back to it whenever
// this pass declines (`DerefBailout`) — external or file `$ref`s, a pointer
// routed through another `$ref`, a pure `$ref`-to-`$ref` cycle, anything
// undecodable. Equivalence on what the pass does accept is pinned by test
// (deref.test.js compares both outputs deep-equal, cycles included).
//
// Same output contract as ref-parser: `$ref` nodes are replaced by their
// target OBJECT — not a copy — so two references to one schema share identity
// and circular schemas come out as circular JS references (what rule 7's
// cycle detection downstream relies on).

// The one signal the loader catches to fall back. Carries no detail on
// purpose: the fallback recomputes from scratch and produces the canonical
// result or the canonical error.
export class DerefBailout extends Error {}

const bail = () => {
  throw new DerefBailout()
}

// `#/a~1b/c%20d` → ['a/b', 'c d']: percent-decoding first (the fragment is a
// URI), then JSON Pointer unescaping — ref-parser's own order.
function segments(ref) {
  if (ref === '#' || ref === '#/') return []
  if (!ref.startsWith('#/')) bail()
  return ref
    .slice(2)
    .split('/')
    .map((raw) => {
      let token = raw
      if (token.includes('%')) {
        try {
          token = decodeURIComponent(token)
        } catch {
          bail()
        }
      }
      return token.replace(/~1/g, '/').replace(/~0/g, '~')
    })
}

const isRefNode = (node) =>
  node !== null && typeof node === 'object' && typeof node.$ref === 'string'

// Dereferences `root` in place and returns it. Throws DerefBailout on any
// shape outside the fast case — the caller MUST then treat `root` as
// corrupted (substitutions may have landed before the bail) and rebuild its
// document before falling back to ref-parser.
export function dereferenceInternal(root) {
  const resolved = new Map()
  const resolving = new Set()

  // A pointer is walked on the raw tree; meeting a `$ref` node mid-path
  // (a pointer THROUGH a reference) is a case ref-parser resolves by
  // following the ref — rare enough to be the crawler's job, not this one's.
  const lookup = (ref) => {
    if (resolved.has(ref)) return resolved.get(ref)
    // A `$ref` whose target chain loops back onto itself has no object to
    // point at — ref-parser diagnoses these, and its message is the error
    // the user should see.
    if (resolving.has(ref)) bail()
    resolving.add(ref)
    let node = root
    for (const key of segments(ref)) {
      if (isRefNode(node)) bail()
      node = node == null ? undefined : node[key]
      if (node === undefined) bail()
    }
    const target = isRefNode(node) ? lookup(node.$ref) : node
    resolving.delete(ref)
    resolved.set(ref, target)
    return target
  }

  const seen = new Set()
  const walk = (node) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (isRefNode(node[i])) node[i] = lookup(node[i].$ref)
        walk(node[i])
      }
      return
    }
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (isRefNode(child)) node[key] = lookup(child.$ref)
      walk(node[key])
    }
  }
  walk(root)
  return root
}
