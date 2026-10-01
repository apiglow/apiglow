import { unescapePointerToken } from '../scenarios/pointer.js'

// The node at a finding's `dataPath` (an RFC 6901 pointer from the root), in a
// document that may be dereferenced and therefore cyclic: a pointer is walked,
// never the document. → undefined where it leads nowhere.
export function nodeAt(root, dataPath) {
  let node = root
  if (!dataPath) return node
  for (const token of dataPath.slice(1).split('/')) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[unescapePointerToken(token)]
  }
  return node
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
