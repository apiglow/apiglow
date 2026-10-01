import { unescapePointerToken } from '../scenarios/pointer.js'

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
