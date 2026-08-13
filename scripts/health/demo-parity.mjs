// The two demo pages (root index.html, demo/cdn-install.html) carry
// hand-synced copies of the same config. Divergence is silent — both pages
// keep working, each demonstrating something slightly different — so parity
// is an invariant (19), not a review habit. The intentional deltas, and only
// these, are exempt:
//   • each spec entry's `docsPages` — the two pages deliberately demonstrate
//     different carriers (inline array with a page carried by the host
//     document vs a manifest URL);
//   • the bundle <script src> — dev sources vs the packed tarball — which
//     lives outside the JSON and is checked by preview-cdn's version guard.

export function extractDemoConfig(html) {
  const m = /<script id="api-doc-config" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (!m) throw new Error('no api-doc-config block found')
  return JSON.parse(m[1])
}

// Paths whose subtree may differ between the two pages.
const ALLOWED = /^openapi\.specs\.\d+\.docsPages\b/

export function demoConfigDelta(configA, configB) {
  const deltas = []
  walk(configA, configB, '', deltas)
  return deltas.filter((path) => !ALLOWED.test(path))
}

function walk(a, b, path, out) {
  if (Object.is(a, b)) return
  const kind = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)
  if (kind(a) !== kind(b)) {
    out.push(path || '(root)')
    return
  }
  if (kind(a) === 'object' || kind(a) === 'array') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const sub = path ? `${path}.${key}` : key
      if (!(key in a) || !(key in b)) out.push(sub)
      else walk(a[key], b[key], sub, out)
    }
    return
  }
  out.push(path || '(root)')
}
