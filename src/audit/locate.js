import { unescapePointerToken } from '../scenarios/pointer.js'
import { isObject } from './value-check.js'

// Where a finding found by pointer belongs: the innermost operation declaring
// it — a callback's pointer runs through its parent's, and the longest prefix
// is the callback's own — so the finding links to the page that shows it;
// outside any operation, the component or top-level section holding it, named
// the way the other rules name them. → { op, location } for `check()`.
export function placeOf(operations, dataPath) {
  let op = null
  for (const entry of operations) {
    if (dataPath !== entry.pointer && !dataPath.startsWith(`${entry.pointer}/`)) continue
    if (!op || entry.pointer.length > op.pointer.length) op = entry
  }
  return op ? { op, location: undefined } : { op: null, location: locationOf(dataPath) }
}

function locationOf(dataPath) {
  const segments = dataPath ? dataPath.slice(1).split('/').map(unescapePointerToken) : []
  const [root, section, name] = segments
  if (root === 'components' && name !== undefined) return `components.${section}.${name}`
  if ((root === 'paths' || root === 'webhooks') && section !== undefined) return section
  // Top-level fields (info, servers, tags…): the dotted path says which one.
  return segments.join('.')
}

// Component object → its name under `components.{section}`. The dereferenced
// document keeps one object per `$ref` target, so identity tells a use of the
// component from an inline copy; the first name wins when one component is a
// `$ref` to another.
export function componentNames(document, section) {
  const names = new Map()
  const declared = document.components?.[section]
  if (!isObject(declared)) return names
  for (const [name, component] of Object.entries(declared)) {
    if (isObject(component) && !names.has(component)) names.set(component, name)
  }
  return names
}

// Inside a webhook or a callback, Path Item level included: a request the API
// sends, rather than one a client makes.
export function sentByTheApi(dataPath) {
  return dataPath.startsWith('/webhooks/') || dataPath.includes('/callbacks/')
}
