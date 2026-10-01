// Post-build invariants of docs/registry/app-health-registry.md (7 and 8):
// what must be true of dist/ itself, checked right after `npm run build` in
// CI (quality job) and locally via `npm run check:dist`. These are the
// regressions no test suite sees — the suites run against a bundle that
// loaded fine on the CI box and say nothing about the artifact's shape.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const problems = []

// Rule 8 (architecture.md §14.8): one script tag, one file — plus the files it
// fetches itself, by name, next to it. A chunk means code splitting crept into
// the lib build, and its hashed name is one no CDN install can be told about.
// (An accidental `undici` re-inline lands in the same single file; the size
// budget below is what catches it.)
// `audit.js` is the schema audit, which app.js imports on the first visit to
// #/audit (vite.audit.config.js).
// `cli.js` is the author-side CLI (`apiglow bake`, docs/seo.md §4), built for
// Node by vite.cli.config.js and exposed as the `apiglow` bin: no browser ever
// fetches it, which is also why no budget below counts it.
const EXPECTED_JS = ['app.js', 'audit.js', 'cli.js']
const jsFiles = readdirSync(dist)
  .filter((f) => f.endsWith('.js'))
  .sort()
if (jsFiles.join(' ') !== EXPECTED_JS.join(' ')) {
  problems.push(
    `dist/ holds ${jsFiles.length} JS files (${jsFiles.join(', ')}) — expected exactly ${EXPECTED_JS.join(', ')}`,
  )
}

// A `bin` file npm links as `apiglow`: without its shebang the command is only
// executable through `node dist/cli.js`, which is exactly how every test runs
// it — the one break the suites cannot see.
// Guarded on the check above rather than assumed: an absent CLI is already
// reported there, and reading it anyway would bury that line under a stack.
if (jsFiles.includes('cli.js')) {
  const cli = readFileSync(join(dist, 'cli.js'), 'utf8')
  if (!cli.startsWith('#!/usr/bin/env node\n')) {
    problems.push('dist/cli.js does not open with a node shebang — the `apiglow` bin needs one')
  }
}

// Rule 4: `document.currentScript` is null in an ES module — its presence
// means an asset path stopped resolving via `new URL(…, import.meta.url)`
// and every CDN install gets a broken css/i18n URL.
const bundle = readFileSync(join(dist, 'app.js'), 'utf8')
for (const file of ['app.js', 'audit.js']) {
  if (readFileSync(join(dist, file), 'utf8').includes('document.currentScript')) {
    problems.push(
      `document.currentScript found in dist/${file} — rule 4 forbids it (null in an ES module)`,
    )
  }
}

// The audit stays out of the app bundle (§14.8): a static import of the engine,
// or the rule texts left in the app's slice of the catalog, would put every rule
// back on every reader's download without failing anything else.
if (/"audit\.rule\.[\w-]+\.why"/.test(bundle) || bundle.includes('field-without-value')) {
  problems.push('dist/app.js carries the schema audit — it ships in dist/audit.js (§14.8)')
}

// Rule 3: the built CSS ships every standard daisyUI theme, or
// `theme.available` silently breaks at the host. 35 is the daisyUI 5.7 set,
// plus the signature pair (apiglow / apiglow-dark) compiled next to it;
// a daisyUI bump that changes the set updates this constant deliberately —
// the upgrade-code ritual already re-checks the count.
const EXPECTED_THEMES = 37
const css = readFileSync(join(dist, 'app.css'), 'utf8')
const themes = new Set(css.match(/\[data-theme=[^\]]*\]/g))
if (themes.size !== EXPECTED_THEMES) {
  problems.push(
    `dist/app.css carries ${themes.size} distinct [data-theme=…] themes — expected ${EXPECTED_THEMES}`,
  )
}

// The display font ships as a file next to app.css (vite.config.js
// `display-font` plugin). Two ways this silently breaks: the copy stops
// happening (404 → system serif, no test notices), or the bundler starts
// resolving the URL again and re-inlines the woff2 as base64 into app.css.
const FONT_URL = 'url(./fonts/source-serif-4-latin-wght-normal.woff2)'
if (!css.includes(FONT_URL)) {
  problems.push(`dist/app.css lost its relative font URL ${FONT_URL} (inlined or renamed?)`)
}
try {
  statSync(join(dist, 'fonts/source-serif-4-latin-wght-normal.woff2'))
} catch {
  problems.push('dist/fonts/source-serif-4-latin-wght-normal.woff2 is missing')
}

// Rule 14 applied to weight: the whole product is one `<script>` on someone
// else's page, so bytes are a user-facing cost the suites cannot see. The
// caps sit above today's build (823 kB / 273 kB at install) with room for
// normal growth — what they stop is the accidental order of magnitude, the
// shape of the `undici` re-inlining that once added 460 kB without a single
// test noticing. Raising one is a deliberate act: check-invariants.mjs records
// these constants and refuses a loosening that does not touch it too.
const MAX_JS_BYTES = 1_200_000
const MAX_CSS_BYTES = 300_000
// Fetched by authors only, on the audit page — still bytes on their wire, and
// the file every new rule grows.
const MAX_AUDIT_JS_BYTES = 340_000
for (const [file, cap] of [
  ['app.js', MAX_JS_BYTES],
  ['app.css', MAX_CSS_BYTES],
  ['audit.js', MAX_AUDIT_JS_BYTES],
]) {
  const size = statSync(join(dist, file)).size
  if (size > cap) {
    problems.push(`dist/${file} is ${size} bytes — over the ${cap} budget by ${size - cap}`)
  }
}

if (problems.length) {
  console.error(`check-dist: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  ${p}`)
  process.exitCode = 1
} else {
  console.log(
    `check-dist: ok (app.js, audit.js and the CLI, no currentScript, ${themes.size} themes)`,
  )
}
