import { unescapePointerToken } from '../scenarios/pointer.js'

// The node at a finding's `dataPath` (an RFC 6901 pointer from the root), in a
// document that may be dereferenced and therefore cyclic: a pointer is walked,
// never the document. → undefined where it leads nowhere — own keys only, so
// `#/components/schemas/constructor` designates no inherited function.
export function nodeAt(root, dataPath) {
  let node = root
  if (!dataPath) return node
  for (const token of dataPath.slice(1).split('/')) {
    const key = unescapePointerToken(token)
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

// The last token of a pointer, unescaped: the key the node sits under.
export function lastToken(dataPath) {
  return unescapePointerToken(dataPath.slice(dataPath.lastIndexOf('/') + 1))
}

// A `$ref` pointing inside this document → the `dataPath` of its target, in
// the form the typed walk gives its entries (`walkObjects`): the fragment,
// percent-decoded, its tokens still escaped. Anything else — another file, a
// URL, an undecodable fragment — → null.
export function internalTarget(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) return null
  if (ref === '#') return ''
  if (!ref.startsWith('#/')) return null
  try {
    return decodeURIComponent(ref.slice(1))
  } catch {
    return null
  }
}
