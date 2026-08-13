// Exports nobody imports, split by who does consume them.
//
// Classification is deliberately conservative — a bare `\bNAME\b` match in
// another file counts as a reference, so a same-named local elsewhere hides
// a dead export rather than inventing one. False negatives are cheap here;
// false positives would make the reading untrustworthy.
import { headline, read, section, walk } from './lib.mjs'

const DECL = /^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm

const srcFiles = walk('src')
const testFiles = [...walk('tests')]

const sources = new Map(srcFiles.map((f) => [f, read(f)]))
// `scripts/` consumes `src/` without exporting anything the app imports back:
// the bake CLI pulls in generators the app never loads. It counts as a reader
// and not as a scanned module — blind to it, this check calls those generators
// dead, which is the one reading it must never produce.
const consumers = new Map(walk('scripts', '.mjs').map((f) => [f, read(f)]))
const tests = new Map(testFiles.map((f) => [f, read(f)]))

const exports = []
for (const [file, text] of sources) {
  for (const m of text.matchAll(DECL)) {
    const line = text.slice(0, m.index).split('\n').length
    exports.push({ file, line, name: m[1] })
  }
}

const countIn = (text, name) => (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length

const dead = []
const modulePrivate = []
const testOnly = []

for (const e of exports) {
  // The declaration itself is one occurrence in its own file.
  const own = countIn(sources.get(e.file), e.name) - 1
  let otherSrc = 0
  for (const [file, text] of sources) {
    if (file !== e.file) otherSrc += countIn(text, e.name)
  }
  for (const text of consumers.values()) otherSrc += countIn(text, e.name)
  if (otherSrc > 0) continue
  let inTests = 0
  for (const text of tests.values()) inTests += countIn(text, e.name)
  const where = `${e.file}:${e.line} ${e.name}`
  if (inTests > 0) testOnly.push(where)
  else if (own > 0) modulePrivate.push(where)
  else dead.push(where)
}

headline(
  'dead exports',
  dead.length,
  `dead / ${modulePrivate.length} module-private / ${testOnly.length} test-only, of ${exports.length} exports`,
)
section('dead — no reference anywhere, delete', dead)
section('module-private — used only in their own file, drop the `export`', modulePrivate)
section('test-only — accepted threshold, see the registry', testOnly)
