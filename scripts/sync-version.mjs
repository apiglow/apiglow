// One number, one source: package.json. Every place a reader can copy an
// install line from — the README snippet, the demo page, the docs — is rewritten
// from it, and `--check` (run in CI) fails on the first pin that drifted.
//
// Two spellings are deliberately left alone:
// - `@current`, the unmoving alias the e2e fixtures load (scripts/preview-cdn.mjs);
// - CHANGELOG.md, where a URL under an old heading documents that old version.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const check = process.argv.includes('--check')

const EXTENSIONS = ['.md', '.html', '.js', '.mjs', '.json', '.txt', '.yml', '.yaml']
const EXCLUDED = ['CHANGELOG.md']
const pin = new RegExp(`(/npm/${pkg.name}@)([^/"'\\s]+)(/)`, 'g')

const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
if (tracked.status !== 0) {
  console.error('✖ git ls-files failed')
  process.exit(1)
}

const drifted = []
const rewritten = []

for (const file of tracked.stdout.split('\n').filter(Boolean)) {
  if (EXCLUDED.includes(file) || !EXTENSIONS.some((ext) => file.endsWith(ext))) continue
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  const after = before.replace(pin, (match, head, version, tail) =>
    version === 'current' ? match : `${head}${pkg.version}${tail}`,
  )
  if (after === before) continue
  if (check) drifted.push(file)
  else {
    writeFileSync(path, after, 'utf8')
    rewritten.push(file)
  }
}

if (check && drifted.length) {
  console.error(
    `✖ ${drifted.length} file(s) pin a version other than ${pkg.version}:\n` +
      drifted.map((f) => `  ${f}`).join('\n') +
      '\n  Run: npm run sync:version',
  )
  process.exit(1)
}
if (check) console.log(`sync-version: ok (${pkg.name}@${pkg.version})`)
else console.log(`sync-version: ${rewritten.length} file(s) set to ${pkg.name}@${pkg.version}`)
