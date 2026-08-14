// Cross-cutting invariants of docs/registry/app-health-registry.md, the
// statically checkable ones. Run by CI (quality job) and locally via
// `npm run check:invariants`; any violation exits non-zero. This is the
// permanent guard for invariants no test suite can see — their breach
// passes every test and moves no snapshot.
import { read, walk } from './health/lib.mjs'

const violations = []
const fail = (invariant, file, line, detail) =>
  violations.push(`inv ${invariant} — ${file}:${line} — ${detail}`)

// Comments must not trip the source checks: the dynamic-class ban is cited in
// comments (`method-colors.js`, `audit-report.js`) and `settings-panel.js`
// mentions localStorage in prose. Line comments are stripped only after
// whitespace or line start so `https://` inside strings survives.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

const srcFiles = walk('src')

// --- invariant 15 — never Shadow DOM (rule 1, architecture.md §14.1) --------

for (const file of srcFiles) {
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (/\battachShadow\b|\bshadowRoot\b/.test(line)) {
      fail(15, file, i + 1, 'Shadow DOM API — components stay light DOM')
    }
  }
}

// --- invariant 2 — no dynamically built Tailwind/daisyUI class (rule 2) ------

// daisyUI component prefixes plus the color/size utility families whose
// dynamic suffix the JIT purge would delete. A miss here is a false negative,
// not a false positive — extend the list when a new component family appears.
const CLASS_PREFIXES =
  /\b(?:badge|btn|alert|card|modal|drawer|menu|tabs?|table|toast|tooltip|kbd|chat|steps|timeline|collapse|checkbox|radio|toggle|range|rating|skeleton|divider|link|mask|stack|avatar|dropdown|swap|join|navbar|footer|hero|stat|countdown|diff|carousel|breadcrumbs|pagination|dock|loading|progress|indicator|fieldset|select|input|textarea|file-input|label|status|list|text|bg|border|ring|fill|stroke|size|w|h)-\$\{/

for (const file of srcFiles) {
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (CLASS_PREFIXES.test(line)) {
      fail(2, file, i + 1, 'template-built class name — the JIT purge deletes it')
    }
  }
}

// --- invariant 3 — no unsanitized dynamic innerHTML (rule 5) -----------------

// Allowed right-hand shapes, in order of appearance in the codebase:
// - `sanitize(…)` — the single DOMPurify path (`markdown.js`);
// - `highlightSource(…)` — highlight.js over text it escapes itself;
// - a SCREAMING_CASE identifier or map lookup — the static SVG constants of
//   `icons.js` and the per-module icon maps (`ICON[name]`,
//   `SCENARIO_ICONS[source] ?? SCENARIO_LOCAL_SVG`);
// - a ternary between two of those constants (`done ? CHECK_SVG : COPY_SVG`),
//   the shape the copy-confirmation grammar uses. The condition only selects,
//   it never contributes markup, so the value is one of two trusted branches.
// `outerHTML =` and `insertAdjacentHTML(` have zero sites today and stay
// banned outright — a new one must argue its way into this script.
const SAFE_RHS = /^(?:sanitize\(|highlightSource\(|[A-Z][A-Z0-9_]*(?:\[|\s*\?\?|$|\b))/

// Deliberately narrow: a `?` or `:` anywhere inside a branch fails the match
// instead of being parsed further, so a nested expression stays a violation.
const CONST_OPERAND = /^[A-Z][A-Z0-9_]*(?:\[[^\]]*\])?$/
const constTernary = (rhs) => {
  const parts = rhs.match(/^[^?]+\?([^?:]+):([^?:]+)$/)
  return (
    parts !== null && CONST_OPERAND.test(parts[1].trim()) && CONST_OPERAND.test(parts[2].trim())
  )
}

// Helper functions whose parameter is only ever fed SVG constants by their
// callers; the constants themselves are covered by the SCREAMING_CASE rule.
const INNERHTML_WHITELIST = new Set([
  'src/components/dom.js', // iconButton(classes, svg, label): shared factory
  'src/components/api-endpoint-doc.js', // item(labelKey, svg, onClick): dropdown rows
])

for (const file of srcFiles) {
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (/\bouterHTML\s*=|insertAdjacentHTML\s*\(/.test(line)) {
      fail(3, file, i + 1, 'outerHTML/insertAdjacentHTML — banned, use sanitize()')
      continue
    }
    const m = line.match(/\binnerHTML\s*=\s*(.+)$/)
    if (!m) continue
    const rhs = m[1].trim()
    if (SAFE_RHS.test(rhs) || constTernary(rhs)) continue
    if (INNERHTML_WHITELIST.has(file) && /^[a-z]\w*$/.test(rhs)) continue
    fail(3, file, i + 1, `innerHTML from "${rhs.slice(0, 40)}" — not a sanctioned shape`)
  }
}

// --- multi-spec — localStorage only through the prefs choke point ------------

// Per-spec namespacing lives in `storage/prefs.js`; a direct write elsewhere
// leaks state across specs. `maintenance.js` is the one exception (inventory
// + erase must see raw keys). `oauth-flow.js` needs none: its handshake uses
// sessionStorage, which this check deliberately leaves alone.
const STORAGE_EXCEPTIONS = new Set(['src/storage/prefs.js', 'src/storage/maintenance.js'])

for (const file of srcFiles) {
  if (STORAGE_EXCEPTIONS.has(file)) continue
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (/\blocalStorage\s*[.[]/.test(line)) {
      fail('multi-spec', file, i + 1, 'direct localStorage — go through storage/prefs.js')
    }
  }
}

// --- invariant 1 — doc↔panel mirror key parity (rule 20) ---------------------

// The panel's `currentValues()` is the mirror's entire vocabulary; a key the
// doc never consumes is a widget silently editing nothing (the drift rule 20
// calls out). Top-level keys sit at 6-space indent in the returned literal —
// nested literals (`{ name: f.name, … }`) are inline and never match.
const panelSrc = read('src/components/api-try-it-panel.js')
const docSrc = read('src/components/api-endpoint-doc.js')
const cvStart = panelSrc.indexOf('currentValues()')
const cvBody = panelSrc.slice(cvStart, panelSrc.indexOf('applyDocEdit('))
const cvKeys = [...cvBody.matchAll(/^ {6}(\w+):/gm)].map((m) => m[1])
if (cvStart === -1 || cvKeys.length === 0) {
  fail(
    1,
    'src/components/api-try-it-panel.js',
    0,
    'currentValues() parse found no keys — fix this checker',
  )
}
const consumed = new Set([...docSrc.matchAll(/\bvalues\.(\w+)/g)].map((m) => m[1]))
// `values[location]?.[name]` consumes the three param-location maps at once.
if (docSrc.includes('values[location]'))
  for (const k of ['path', 'query', 'cookie']) consumed.add(k)
for (const key of cvKeys) {
  if (!consumed.has(key)) {
    fail(
      1,
      'src/components/api-endpoint-doc.js',
      0,
      `currentValues key "${key}" has no consumer in #applyTryItValues`,
    )
  }
}

// Every `tryit-edit` kind the doc side emits must have a branch in the
// panel's `applyDocEdit` — an unhandled kind is an editor whose pushes the
// panel drops on the floor. The kind is read only inside a `tryit-edit`
// CustomEvent window: `kind:` is also an unrelated schema-node property
// (`{ kind: 'any' }` in schema-editors), which must not count as emitted.
const emitters = [
  'src/components/api-endpoint-doc.js',
  'src/components/schema-view.js',
  'src/components/schema-editors.js',
]
const emittedKinds = new Set(
  emitters.flatMap((f) =>
    [...read(f).matchAll(/CustomEvent\('tryit-edit'[\s\S]{0,200}?\bkind: '([a-z-]+)'/g)].map(
      (m) => m[1],
    ),
  ),
)
// `applyDocEdit` handles 'param' as its default branch (dispatch on
// `location`), so it has no literal test — and that is exactly why any NEW
// kind without its own branch is a bug: it would silently fall into the
// param path.
const FALLTHROUGH_KIND = 'param'
for (const kind of emittedKinds) {
  if (kind !== FALLTHROUGH_KIND && !panelSrc.includes(`kind === '${kind}'`)) {
    fail(
      1,
      'src/components/api-try-it-panel.js',
      0,
      `tryit-edit kind "${kind}" has no branch in applyDocEdit`,
    )
  }
}
if (emittedKinds.size === 0) {
  fail(
    1,
    'src/components/api-endpoint-doc.js',
    0,
    'tryit-edit kind parse found no emissions — fix this checker',
  )
}

// --- invariant 4 — every IndexedDB database is declared to the inventory ----

// A database missing from `storageInventory()` survives "erase everything"
// invisibly. The mapping module → inventory row cannot be derived, so it is
// explicit here: a NEW `DB_NAME` file fails until it gets a mapping entry AND
// its row in maintenance.js. Names keep the `apidoc` prefix
// (architecture.md §14.11).
const DB_ROW_OF = {
  'src/storage/history.js': 'history',
  'src/storage/scenarios.js': 'scenarios',
  'src/storage/schema-snapshot.js': 'snapshots',
}
const inventoryIds = new Set(
  [...read('src/storage/maintenance.js').matchAll(/\bid: '(\w+)'/g)].map((m) => m[1]),
)
for (const file of srcFiles) {
  const m = read(file).match(/\bDB_NAME = '([^']+)'/)
  if (!m) continue
  if (!m[1].startsWith('apidoc'))
    fail(4, file, 0, `DB name "${m[1]}" outside the apidoc prefix (architecture.md §14.11)`)
  const row = DB_ROW_OF[file]
  if (!row)
    fail(4, file, 0, 'IndexedDB database with no mapping here — add its storageInventory row first')
  else if (!inventoryIds.has(row))
    fail(4, file, 0, `inventory row "${row}" missing from storageInventory()`)
}

// --- invariant 6 — every export generator defaults to redact = true ----------

// Redaction is six per-generator defaults, not a choke point (registry gap):
// until that changes, the checkable truth is that the redact.js importers and
// the `redact` parameter carriers are the same files, and every default is
// `true`.
const exportFiles = walk('src/export')
for (const file of exportFiles) {
  const code = stripComments(read(file))
  const importsRedact = /from '\.\/redact\.js'/.test(code)
  const redactParams = [...code.matchAll(/[{,]\s*redact\s*(=\s*(?:true|false))?\s*[,}]/g)]
  if (redactParams.some(([, def]) => def !== '= true')) {
    fail(6, file, 0, 'redact parameter without a `= true` default')
  }
  if (redactParams.length > 0 && !importsRedact) {
    fail(6, file, 0, 'takes redact but never imports redact.js — hand-rolled redaction?')
  }
  if (importsRedact && redactParams.length === 0) {
    fail(6, file, 0, 'imports redact.js but exposes no redact option')
  }
}

// --- invariant 10 — every audit rule file is registered ----------------------

const ruleFiles = walk('src/audit/rules').filter((f) => !f.endsWith('/index.js'))
const registered = new Set(
  [...read('src/audit/rules/index.js').matchAll(/from '\.\/([\w-]+)\.js'/g)].map((m) => m[1]),
)
for (const file of ruleFiles) {
  const name = file.split('/').at(-1).replace('.js', '')
  if (!registered.has(name)) fail(10, file, 0, 'rule file not imported by rules/index.js')
}

// --- invariant 12 — architecture §6.2 matches the storage code ---------------

// The doc is the functional source of truth (invariant 16); §6.2 is its one
// mechanically checkable slice. Both directions for database and store
// names; for localStorage keys the code side is too dynamic to enumerate
// (keys flow through variables), so the check is one-way: every key the doc
// names must exist as a literal somewhere in src/ — a rename that forgets
// the doc fails here.
// §6.2 runs to the next heading of any level — which may be a `##`, so a
// `### `-only lookahead comes back empty.
const arch = read('docs/architecture.md')
const s62 = arch.indexOf('### 6.2')
const s62end = arch.slice(s62 + 1).search(/\n#{2,3} /)
const archSection = s62 === -1 ? '' : arch.slice(s62, s62end === -1 ? undefined : s62 + 1 + s62end)
if (!archSection) fail(12, 'docs/architecture.md', 0, '§6.2 not found — fix this checker')
const docDbs = new Set(
  [...archSection.matchAll(/^\| `(apidoc-[\w-]+)` \| `(\w+)` \|/gm)].map((m) => `${m[1]}/${m[2]}`),
)
const codeDbs = new Set()
for (const file of walk('src/storage')) {
  const name = read(file).match(/\bDB_NAME = '([^']+)'/)?.[1]
  const store = read(file).match(/\bSTORE = '([^']+)'/)?.[1]
  if (name && store) codeDbs.add(`${name}/${store}`)
}
for (const db of codeDbs)
  if (!docDbs.has(db))
    fail(12, 'docs/architecture.md', 0, `database ${db} missing from the §6.2 table`)
for (const db of docDbs)
  if (!codeDbs.has(db))
    fail(12, 'docs/architecture.md', 0, `§6.2 documents ${db}, the code has no such database`)

const allSrc = srcFiles.map((f) => read(f)).join('\n')
const docKeys = [
  ...archSection.matchAll(/^\| `([^`]+)`(?: \/ `([^`]+)`)? \| (?:global|per spec) \|/gm),
]
  .flatMap((m) => [m[1], m[2]])
  .filter(Boolean)
for (const key of docKeys) {
  if (!allSrc.includes(`'${key}'`)) {
    fail(
      12,
      'docs/architecture.md',
      0,
      `§6.2 documents key \`${key}\`, no literal in src/ spells it`,
    )
  }
}

// --- invariant 11 — the CONTRIBUTING feature→test map is real ----------------

const contributing = read('CONTRIBUTING.md')
const e2eOnDisk = walk('tests/e2e')
  .filter((f) => f.endsWith('.spec.js'))
  .map((f) => f.split('/').at(-1))
for (const spec of e2eOnDisk) {
  if (!contributing.includes(spec))
    fail(11, 'CONTRIBUTING.md', 0, `e2e spec ${spec} missing from the feature→test map`)
}
const unitOnDisk = new Set(
  walk('tests')
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => f.split('/').at(-1)),
)
for (const cited of new Set(
  [...contributing.matchAll(/`([\w-]+\.(?:spec|test)\.js)`/g)].map((m) => m[1]),
)) {
  const exists = cited.endsWith('.spec.js') ? e2eOnDisk.includes(cited) : unitOnDisk.has(cited)
  if (!exists) fail(11, 'CONTRIBUTING.md', 0, `map cites ${cited}, no such file in tests/`)
}

// --- invariant 17 — CI runs every guard this repo installs -------------------

// A guard CI quietly stopped running is a guard in name only: the workflow
// must run the unit suite, the e2e suite, and every check-*.mjs script —
// referenced either by filename or through the npm script that wraps it.
const workflow = read('.github/workflows/ci.yml')
const pkgScripts = JSON.parse(read('package.json')).scripts
if (!/npm (?:test|run test:coverage)\b/.test(workflow))
  fail(17, '.github/workflows/ci.yml', 0, 'unit suite not run by CI')
if (!/npm run test:e2e\b|playwright test\b/.test(workflow))
  fail(17, '.github/workflows/ci.yml', 0, 'e2e suite not run by CI')
// The cross-browser contract is the matrix itself (docs/cross-browser.md): a
// PR that quietly drops an engine keeps a green e2e check and stops testing a
// third of the declared support baseline. Named engine by engine, because
// "the matrix exists" is not the claim — "these three run" is.
for (const browser of ['chromium', 'firefox', 'webkit']) {
  if (!workflow.includes(`--project=${browser}`))
    fail(17, '.github/workflows/ci.yml', 0, `${browser} project not run by CI`)
}
// The syntax tripwire wraps a CLI, not a check-*.mjs file, so the loop below
// cannot see it — and it is the only guard standing between a `build.target`
// regression and a bundle no baseline browser can parse.
if (!workflow.includes('check:syntax'))
  fail(17, '.github/workflows/ci.yml', 0, 'baseline syntax check (es-check) not run by CI')
// walk() defaults to '.js', which matches no .mjs file — pass the extension
// or this loop is vacuous (the negative probe caught exactly that).
for (const file of walk('scripts', '.mjs').filter((f) => /scripts\/check-[\w-]+\.mjs$/.test(f))) {
  const base = file.split('/').at(-1)
  const wrappers = Object.entries(pkgScripts)
    .filter(([, cmd]) => cmd.includes(base))
    .map(([name]) => name)
  const wired = workflow.includes(base) || wrappers.some((name) => workflow.includes(name))
  if (!wired) fail(17, file, 0, 'check script not wired into .github/workflows/ci.yml')
}

// --- invariant 5 — no hardcoded user-visible string in components ------------

// The half of invariant 5 no test can reach: `i18n-sync.test.js` checks the
// keys that ARE asked for, and is blind to text that never became a key. The
// two shapes that put words on screen without one are a literal `text('…')`
// node and a literal user-facing attribute. Both are banned outright when the
// literal contains a letter — punctuation and syntax markers (`{{`, `[…]`)
// are not translatable and pass on that rule alone, no whitelist needed.
const HAS_LETTER = /[a-zA-Z]/
// Format examples, not prose: they show the SHAPE of what to type, and
// translating them would make the example wrong.
const PLACEHOLDER_EXAMPLES = new Set([
  'https://example.com/hooks/…',
  'https://api.example.com/v1',
  'X-Header',
])

for (const file of walk('src/components')) {
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    for (const m of line.matchAll(/\btext\('([^']*)'\)/g)) {
      if (HAS_LETTER.test(m[1])) {
        fail(5, file, i + 1, `hardcoded text node "${m[1]}" — every UI string goes through t()`)
      }
    }
    const attr = line.match(
      /\.(?:title|placeholder|ariaLabel)\s*=\s*'([^']*)'|setAttribute\('(?:title|placeholder|aria-label)',\s*'([^']*)'/,
    )
    const value = attr?.[1] ?? attr?.[2]
    if (value && HAS_LETTER.test(value) && !PLACEHOLDER_EXAMPLES.has(value)) {
      fail(5, file, i + 1, `hardcoded user-visible attribute "${value}" — use t()`)
    }
  }
}

// --- invariant 18 — performance budgets only ever tighten (rule 14) ----------

// "Performance is a feature": a budget is a contract, and the cheapest way to
// break a contract is to edit the number next to the failing assertion. The
// ceilings below are that number's twin — a loosening only lands if this file
// moves in the same commit, where a reviewer sees it. Tightening is free (the
// value drops below its ceiling); the ceiling follows at the next audit.
// A constant that vanishes fails too: deleting a budget is loosening it to
// infinity.
const BUDGET_CEILINGS = {
  'tests/e2e/perf.spec.js': {
    BUDGET_MS: 1000,
    MAX_BLOCKING_TASK_MS: 500,
    SEARCH_BUDGET_MS: 400,
    DEEP_BODY_BUDGET_MS: 400,
    DOCS_PAGE_BUDGET_MS: 400,
  },
  'scripts/check-dist.mjs': {
    MAX_JS_BYTES: 1_200_000,
    MAX_CSS_BYTES: 300_000,
  },
}

for (const [file, ceilings] of Object.entries(BUDGET_CEILINGS)) {
  const code = read(file)
  for (const [name, ceiling] of Object.entries(ceilings)) {
    // Numeric separators are legal in the source and meaningless to Number().
    const m = code.match(new RegExp(`\\bconst ${name} = ([\\d_]+)\\b`))
    if (!m) {
      fail(18, file, 0, `budget constant ${name} is gone — a deleted budget is an infinite one`)
      continue
    }
    const value = Number(m[1].replaceAll('_', ''))
    if (value > ceiling) {
      fail(18, file, 0, `${name} loosened to ${value} (ceiling ${ceiling}) — raise it here too`)
    }
  }
}

// --- invariant 9 — core/shell split and version branches (rules 10, 6) -------

// Rule 10: the host config enters the app in exactly one place. A module that
// reads it directly makes the core depend on the integrator's JSON, which no
// test sees — the app still works on the maintainer's own config.
// `boot-prefetch.js` is the one shell sibling: it fires the schema fetch
// before the bundle's libraries evaluate, which is only possible OUTSIDE
// app.js — module order puts the entry's own body last. It stays shell, not
// core: nothing imports it but app.js, and the loader receives the Response,
// never the config.
const HOST_CONFIG_READERS = new Set(['src/app.js', 'src/boot-prefetch.js'])
const HOST_CONFIG_RE = /['"`]api-doc-config['"`]|\bAPI_DOC_CONFIG\b/

for (const file of srcFiles) {
  if (HOST_CONFIG_READERS.has(file)) continue
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (HOST_CONFIG_RE.test(line)) {
      fail(9, file, i + 1, 'host config read outside app.js — the core never sees it (rule 10)')
    }
  }
}

// Rule 6: version differences are absorbed by normalization and by the 2.0
// converter. Everywhere else the model is the only truth — a branch on the
// document's version outside these three files is a second pipeline growing.
// Reading `sourceVersion` to DISPLAY it stays legitimate: only comparisons and
// version-flag names are caught.
const NORMALIZATION = new Set([
  'src/openapi/model.js',
  'src/openapi/loader.js',
  'src/openapi/swagger2.js',
])
const VERSION_BRANCH_RE =
  /\bisV3\d?\b|\bisSwagger2\b|\bsourceVersion\s*(?:===|!==|==|!=|>=|<=|>|<|\.startsWith|\.match)|\bopenapi\s*(?:===|!==)\s*['"`]3|['"`]3\.[012]['"`]\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\s*['"`]3\.[012]/

for (const file of srcFiles) {
  if (NORMALIZATION.has(file)) continue
  const code = stripComments(read(file))
  for (const [i, line] of code.split('\n').entries()) {
    if (VERSION_BRANCH_RE.test(line)) {
      fail(9, file, i + 1, 'version branch outside normalization — absorb it in model.js (rule 6)')
    }
  }
}

// --- invariant 19 — the two demo pages carry the same config -----------------
//
// index.html and demo/cdn-install.html hand-sync their inline configs; a
// drifted copy demonstrates the wrong thing silently. Intentional deltas
// (each spec's docsPages carrier) are exempted inside demo-parity.mjs.
{
  const { extractDemoConfig, demoConfigDelta } = await import('./health/demo-parity.mjs')
  try {
    const dev = extractDemoConfig(read('index.html'))
    const cdn = extractDemoConfig(read('demo/cdn-install.html'))
    for (const path of demoConfigDelta(dev, cdn)) {
      fail(19, 'demo/cdn-install.html', 0, `config diverges from index.html at \`${path}\``)
    }
  } catch (err) {
    fail(19, 'index.html', 0, `demo config unreadable: ${err.message}`)
  }
}

// --- invariant 20 — the runtime dependency set is exactly the five pinned ----
//
// §14.2 makes adding a runtime dep a human decision; this makes the decision
// a two-file commit. Recording the names, not a count, so a swap (drop one,
// add another) cannot slide through as "still five". Dev dependencies stay
// unconstrained — they ship nothing.
{
  const PINNED_RUNTIME_DEPS = [
    '@apidevtools/json-schema-ref-parser',
    'dompurify',
    'highlight.js',
    'json-p3',
    'marked',
  ]
  const actual = Object.keys(JSON.parse(read('package.json')).dependencies ?? {}).sort()
  if (actual.join(' ') !== PINNED_RUNTIME_DEPS.join(' ')) {
    fail(
      20,
      'package.json',
      0,
      `runtime dependencies are [${actual.join(', ')}] — the pinned set is [${PINNED_RUNTIME_DEPS.join(', ')}]; changing it is a human checkpoint (§14.2), recorded here`,
    )
  }
}

// --- report ------------------------------------------------------------------

if (violations.length) {
  console.error(`check-invariants: ${violations.length} violation(s)`)
  for (const v of violations) console.error(`  ${v}`)
  process.exitCode = 1
} else {
  console.log('check-invariants: ok')
}
