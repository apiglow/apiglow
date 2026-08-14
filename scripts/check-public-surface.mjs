// Frozen public surfaces (CLAUDE.md "Good enough" rules): the names a host
// page or a returning user can depend on — custom element tags, emitted
// events, storage names, i18n keys. A rename here is a breaking change for
// every CDN install, so drift from the committed snapshot fails CI. This is
// what stops a refactor pass from renaming surface "for consistency".
//
//   npm run check:surface              # verify against public-surface.json
//   npm run check:surface -- --update  # accept the new surface
//
// Updating the snapshot is a deliberate act: the diff shows up in review,
// and whether it needs a migration path is a human decision.
//
// Extraction is assumed pattern matching, not an AST walk: it must be obvious
// why a name is in the snapshot. Dynamically built names don't register —
// they are already banned for tags and classes, and storage keys funnel
// through the prefix constants this file does capture.
import { writeFileSync } from 'node:fs'
import { read, walk } from './health/lib.mjs'

const SNAPSHOT = 'public-surface.json'

// Same guard as check-invariants.mjs: prose citing a name must not freeze it.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

const grab = (source, re) => [...source.matchAll(re)].map((m) => m[1])

const merged = { tags: [], events: [], apidocNames: [], idbStores: [] }
for (const file of walk('src')) {
  const code = stripComments(read(file))
  merged.tags.push(...grab(code, /customElements\.define\(\s*'([^']+)'/g))
  merged.events.push(...grab(code, /new CustomEvent\(\s*'([^']+)'/g))
  // The name-neutral `apidoc` prefix (rule 8, architecture.md §14.11) is the
  // repo's own marker for names meant to outlive a session: localStorage
  // prefixes, IndexedDB database names, the docs-page fence, stable DOM ids.
  // Storage names never reach the API calls as literals — they are built from
  // these constants — so the prefix sweep is what actually freezes them.
  merged.apidocNames.push(...grab(code, /'(apidoc[.:-][^']*)'/g))
  merged.idbStores.push(...grab(code, /\bconst STORE = '([^']+)'/g))
}

// `apidoc:ready` is an event — it matched both patterns.
const events = new Set(merged.events)
merged.apidocNames = merged.apidocNames.filter((name) => !events.has(name))

// The i18n contract is the source locale's key set, not code literals.
merged.i18nKeys = Object.keys(JSON.parse(read('src/i18n/en.json')))

const current = Object.fromEntries(
  Object.entries(merged).map(([k, v]) => [k, [...new Set(v)].sort()]),
)

if (process.argv.includes('--update')) {
  writeFileSync(SNAPSHOT, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`check-public-surface: snapshot updated (${SNAPSHOT})`)
  process.exit(0)
}

let previous
try {
  previous = JSON.parse(read(SNAPSHOT))
} catch {
  console.error(
    `check-public-surface: no ${SNAPSHOT} — create it once with\n  npm run check:surface -- --update`,
  )
  process.exit(1)
}

const problems = []
for (const key of Object.keys(current)) {
  const before = new Set(previous[key] ?? [])
  const after = new Set(current[key])
  for (const item of [...before].filter((x) => !after.has(x)))
    problems.push(`- removed ${key}: ${item}`)
  for (const item of [...after].filter((x) => !before.has(x)))
    problems.push(`+ added ${key}: ${item}`)
}

if (problems.length === 0) {
  const total = Object.values(current).reduce((n, list) => n + list.length, 0)
  console.log(`check-public-surface: ok (${total} frozen names)`)
} else {
  console.error(`check-public-surface: surface changed (${problems.length})`)
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nRemovals and renames are breaking changes: migration path + human decision.' +
      '\nAdditions are new commitments. Once decided:  npm run check:surface -- --update',
  )
  process.exitCode = 1
}
