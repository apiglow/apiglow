// Files under src/ unreachable from the two things the repo builds: the app
// (dist/app.js) and the CLI (dist/cli.js), which walks into export generators
// the app itself never loads.
import { headline, read, section, walk } from './lib.mjs'

const ENTRIES = ['src/app.js', 'scripts/cli.mjs']

function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null
  const dir = fromRel.slice(0, fromRel.lastIndexOf('/'))
  const parts = `${dir}/${spec}`.split('/')
  const stack = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

const seen = new Set(ENTRIES)
const queue = [...ENTRIES]
while (queue.length) {
  const file = queue.shift()
  const src = read(file)
  // Static `import … from '…'`, side-effect `import '…'` and dynamic
  // `import('…')` — the three forms the codebase uses.
  for (const m of src.matchAll(
    /(?:^|[^\w.])import\s*(?:[^'"]*?from\s*)?[('\s]*['"]([^'"]+)['"]/gm,
  )) {
    const target = resolveImport(file, m[1])
    // `.mjs` too: the CLI entry reaches src/ through its command modules.
    if (!/\.m?js$/.test(target ?? '') || seen.has(target)) continue
    seen.add(target)
    queue.push(target)
  }
}

const all = walk('src')
const orphans = all.filter((f) => !seen.has(f))

headline(
  'orphan files',
  orphans.length,
  `(${all.length - orphans.length}/${all.length} reachable from ${ENTRIES.join(' + ')})`,
)
section('unreachable', orphans)
