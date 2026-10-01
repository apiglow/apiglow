import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { escapePointerToken, pointerFrom, unescapePointerToken } from '../scenarios/pointer.js'

// Where a finding sits in the file its author edits (docs/audit.md §8.1): a
// line and a column, what a terminal, an editor and every CI surface that
// annotates a diff need. The engine works on JSON pointers into the parsed
// document; this module maps them back to the text. CLI-only — the page links
// to the rendered operation instead, and never imports it.
//
// One parser for both syntaxes: JSON is YAML, and the `yaml` package's
// document keeps the source range of every node, keys included.

// text → { find(pointer) → { offset, exact } }. The offset is the key's (or a
// sequence item's), which is where an editor puts a cursor for "this field" —
// on a quoted key its quote, on an alias its star. A pointer to a node the text
// does not hold — a missing field, a node an overlay added — resolves to its
// deepest existing ancestor, `exact: false`. Only the first document of a
// stream is the description.
export function pointerIndex(text) {
  const offsets = new Map([['', 0]])
  const doc = parseDocument(text, { uniqueKeys: false, logLevel: 'silent' })
  // An explicit stack: the text's nesting is the author's, not ours to bound.
  const pending = [[doc.contents, '']]
  while (pending.length) {
    const [node, pointer] = pending.pop()
    // An alias stands for a node written elsewhere: nothing below it is here.
    if (!node || isAlias(node)) continue
    if (isMap(node)) {
      for (const { key, value } of node.items) {
        // A complex (non-scalar) key gets no pointer: JSON pointers cannot
        // name it, and neither can the value it keys.
        if (!isScalar(key)) continue
        const at = `${pointer}/${escapePointerToken(key.value === null ? '' : String(key.value))}`
        offsets.set(at, key.range[0])
        pending.push([value, at])
      }
    } else if (isSeq(node)) {
      for (const [index, item] of node.items.entries()) {
        const at = `${pointer}/${index}`
        if (item?.range) offsets.set(at, item.range[0])
        pending.push([item, at])
      }
    }
  }
  return {
    find(pointer) {
      let at = pointer
      while (!offsets.has(at)) at = at.slice(0, Math.max(0, at.lastIndexOf('/')))
      return { offset: offsets.get(at), exact: at === pointer }
    },
  }
}

// offset → { line, column }, both 1-based, as editors and CI annotations count.
export function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return (offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (starts[mid] <= offset) low = mid
      else high = mid - 1
    }
    return { line: low + 1, column: offset - starts[low] + 1 }
  }
}

// A finding's pointer is into the DEREFERENCED document; the text holds the
// `$ref`s. Walks the pointer through the parsed source, following a `$ref`
// wherever the next segment is not written beside it → { file, pointer, refs }:
// `file` is the `$ref`'s file part when the walk left the document (relative
// to the file that held the `$ref`), `refs` the `$ref` sites crossed, as
// { file, pointer }. The walk stops at the deepest node that exists, and is
// bounded against `$ref` loops.
export function sourcePointer(dataPath, { document, loadDocument }) {
  const segments = dataPath.split('/').slice(1).map(unescapePointerToken)
  let file = null
  let root = document
  let node = root
  let at = []
  const refs = []
  for (let jumps = 0, i = 0; i < segments.length; ) {
    const segment = segments[i]
    if (node && typeof node === 'object' && segment in node) {
      node = node[segment]
      at.push(segment)
      i += 1
      continue
    }
    const ref = node && typeof node === 'object' && typeof node.$ref === 'string' ? node.$ref : null
    if (!ref || jumps >= MAX_JUMPS) break
    jumps += 1
    const [target, encoded = ''] = ref.split('#')
    // A `$ref` fragment is a URI fragment: `{` and `}` may come percent-encoded.
    const fragment = safeDecode(encoded)
    const loaded = target ? loadDocument(target, file) : { file, document: root }
    const targetAt = fragment.split('/').slice(1).map(unescapePointerToken)
    const targetNode = targetAt.reduce(
      (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
      loaded?.document,
    )
    // A `$ref` that leads nowhere this walk can read keeps the finding on the
    // `$ref` itself — the line the author has to look at.
    if (targetNode === undefined) break
    refs.push({ file, pointer: pointerFrom(at) })
    file = loaded.file
    root = loaded.document
    at = targetAt
    node = targetNode
  }
  return { file, pointer: pointerFrom(at), refs }
}

const MAX_JUMPS = 32

function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
