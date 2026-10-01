import { isAlias, isMap, isScalar, isSeq } from 'yaml'
import { readDocument } from '../openapi/read-document.js'
import { escapePointerToken, pointerFrom, unescapePointerToken } from '../scenarios/pointer.js'

// Where a finding sits in the file its author edits (docs/audit.md §8.1): a
// line and a column, what a terminal, an editor and every CI surface that
// annotates a diff need. The engine works on JSON pointers into the parsed
// document; this module maps them back to the text. CLI-only — the page links
// to the rendered operation instead, and never imports it.
//
// The text is read once, by the reader the loader falls back to
// (`read-document.js`): what a finding is placed against is what was audited,
// broken files included. JSON — every large generated description — is placed
// by a scan of its own, an order of magnitude faster than walking a YAML parse
// of it; YAML by the source ranges the `yaml` document keeps. Either index is
// built on its first use.

// text → { document, find(pointer) → { offset, exact }, locate(pointer) →
// { line, column } }. The offset is the key's (or a sequence item's), which is
// where an editor puts a cursor for "this field" — on a quoted key its quote,
// on an alias its star. A pointer to a node the text does not hold — a missing
// field, a node an overlay added — resolves to its deepest existing ancestor,
// `exact: false`. Only the first document of a stream is the description.
// Offsets count from after a byte order mark, which no editor shows as a
// column.
export function sourceIndex(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const read = readDocument(body)
  let offsets = null
  let lines = null
  const find = (pointer) => {
    offsets ??= read.ast ? yamlOffsets(read.ast) : jsonOffsets(body)
    let at = pointer
    while (!offsets.has(at)) at = at.slice(0, Math.max(0, at.lastIndexOf('/')))
    return { offset: offsets.get(at), exact: at === pointer }
  }
  return {
    document: read.document,
    find,
    locate(pointer) {
      lines ??= lineIndex(body)
      return lines(find(pointer).offset)
    },
  }
}

function yamlOffsets(doc) {
  const offsets = new Map([['', 0]])
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
  return offsets
}

// A text `JSON.parse` accepted: one pass over its tokens, each key's offset
// under its pointer, each array item's at its first character. A repeated key
// keeps its last offset, as `JSON.parse` keeps its last value.
function jsonOffsets(text) {
  const offsets = new Map([['', 0]])
  const stack = []
  let i = 0
  const skipSpace = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c !== 32 && c !== 10 && c !== 13 && c !== 9) return
      i += 1
    }
  }
  const skipString = () => {
    i += 1
    while (i < text.length) {
      const c = text.charCodeAt(i)
      i += c === 92 ? 2 : 1
      if (c === 34) return
    }
  }
  // After a value: past the comma to the next member, or past the end of
  // every container the value closes.
  const close = () => {
    for (;;) {
      skipSpace()
      if (!stack.length) return
      const c = text[i]
      i += 1
      if (c === ',') return
      stack.pop()
    }
  }
  // The value starting at `i`, whose pointer is `pointer`.
  const value = (pointer) => {
    skipSpace()
    const c = text[i]
    if (c === '{' || c === '[') {
      stack.push({ pointer, array: c === '[', index: 0 })
      i += 1
      return
    }
    if (c === '"') skipString()
    else while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1
    close()
  }
  value('')
  while (stack.length && i < text.length) {
    skipSpace()
    const top = stack.at(-1)
    if (text[i] === '}' || text[i] === ']') {
      i += 1
      stack.pop()
      close()
      continue
    }
    if (top.array) {
      const at = `${top.pointer}/${top.index}`
      top.index += 1
      offsets.set(at, i)
      value(at)
      continue
    }
    const start = i
    skipString()
    const key = JSON.parse(text.slice(start, i))
    skipSpace()
    i += 1 // the colon
    const at = `${top.pointer}/${escapePointerToken(key)}`
    offsets.set(at, start)
    value(at)
  }
  return offsets
}

// offset → { line, column }, both 1-based, as editors and CI annotations count.
function lineIndex(text) {
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
