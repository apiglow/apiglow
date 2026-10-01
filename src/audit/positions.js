import { EVENT_ID, SCALAR_STYLE, getScalarValue, parseEvents } from 'js-yaml'
import { escapePointerToken, pointerFrom, unescapePointerToken } from '../scenarios/pointer.js'

// Where a finding sits in the file its author edits (docs/audit.md §8.1): a
// line and a column, what a terminal, an editor and every CI surface that
// annotates a diff need. The engine works on JSON pointers into the parsed
// document; this module maps them back to the text. CLI-only — the page links
// to the rendered operation instead, and never imports it.
//
// One parser for both syntaxes: JSON is YAML, and js-yaml's event stream
// (`parseEvents`) carries the source offset of every node, keys included.

// text → { find(pointer) → { offset, exact } }. The offset is the key's (or a
// sequence item's), which is where an editor puts a cursor for "this field". A
// pointer to a node the text does not hold — a missing field, a node an
// overlay added — resolves to its deepest existing ancestor, `exact: false`.
export function pointerIndex(text) {
  const offsets = new Map([['', 0]])
  const input = `${text}\0`
  const stack = []
  // Records the node starting now, under the slot its parent is filling.
  const enter = (start) => {
    const parent = stack.at(-1)
    if (!parent) return ''
    if (parent.kind === 'seq') {
      const pointer = `${parent.pointer}/${parent.index}`
      parent.index += 1
      offsets.set(pointer, start)
      return pointer
    }
    // A complex (non-scalar) key gets no pointer: JSON pointers cannot name it.
    const pointer =
      parent.key === undefined ? null : `${parent.pointer}/${escapePointerToken(parent.key)}`
    if (pointer !== null) offsets.set(pointer, parent.keyStart)
    parent.key = undefined
    parent.awaitingKey = true
    return pointer
  }
  for (const event of parseEvents(text)) {
    const parent = stack.at(-1)
    if (event.type === EVENT_ID.SCALAR && parent?.kind === 'map' && parent.awaitingKey) {
      parent.key = String(getScalarValue(input, event))
      parent.keyStart = scalarStart(event)
      parent.awaitingKey = false
      continue
    }
    if (event.type === EVENT_ID.MAPPING || event.type === EVENT_ID.SEQUENCE) {
      if (parent?.kind === 'map' && parent.awaitingKey) {
        // A collection used as a key: skip it, and the value it keys.
        stack.push({ kind: 'skip' })
        continue
      }
      const pointer = parent?.kind === 'skip' ? null : enter(event.start)
      stack.push(
        pointer === null
          ? { kind: 'skip' }
          : event.type === EVENT_ID.MAPPING
            ? { kind: 'map', pointer, awaitingKey: true }
            : { kind: 'seq', pointer, index: 0 },
      )
    } else if (event.type === EVENT_ID.SCALAR || event.type === EVENT_ID.ALIAS) {
      if (parent && parent.kind !== 'skip') enter(scalarStart(event))
    } else if (event.type === EVENT_ID.POP && stack.length) {
      stack.pop()
    } else if (event.type === EVENT_ID.DOCUMENT && stack.length) {
      // Only the first document of a stream is the description.
      break
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

// A quoted scalar's value starts after its quote, an alias's name after its
// `*`: the cursor belongs on the quote or the star.
function scalarStart(event) {
  if (event.type === EVENT_ID.ALIAS) return event.anchorStart - 1
  const quoted =
    event.style === SCALAR_STYLE.SINGLE_QUOTED || event.style === SCALAR_STYLE.DOUBLE_QUOTED
  return quoted ? event.valueStart - 1 : event.valueStart
}
