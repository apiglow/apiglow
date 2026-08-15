// `npm run release <version>` — everything that happens before a tag exists.
//
// The tag is the only publish trigger (.github/workflows/release.yml), so this
// script's whole job is to make the commit that tag will point at trustworthy:
// refuse a working tree that is not ready, promote the changelog, bump, sync
// every pinned version, run the gates that cost seconds, then commit, tag and
// push. The browser matrix is not re-run here — CI runs it on the tag, and a
// red tag publishes nothing.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { promote } from './changelog.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith('-'))
const assumeYes = args.includes('--yes')

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function die(message, hint) {
  console.error(`✖ ${message}`)
  if (hint) console.error(`  ${hint}`)
  process.exit(1)
}

function run(cmd, cmdArgs, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0 && !allowFailure) {
    die(`${cmd} ${cmdArgs.join(' ')} failed`)
  }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

const git = (...cmdArgs) => run('git', cmdArgs, { capture: true }).out

// Enough of semver to refuse going backwards; the registry is the real arbiter.
function isNewer(next, current) {
  const parse = (v) => {
    const [core, pre = ''] = v.split('-')
    return { core: core.split('.').map(Number), pre }
  }
  const a = parse(next)
  const b = parse(current)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i]
  }
  if (a.pre === b.pre) return false
  // Same core: a release outranks its own prereleases, and rc.2 outranks rc.1.
  if (!a.pre || !b.pre) return !a.pre
  return a.pre.localeCompare(b.pre, 'en', { numeric: true }) > 0
}

if (!version || !SEMVER.test(version)) {
  die('usage: npm run release <version>', 'e.g. 0.1.0-rc.1, then 0.1.0')
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const tag = `v${version}`
const distTag = version.includes('-') ? 'next' : 'latest'

// --- preconditions ----------------------------------------------------------

if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') die('not on main')
if (git('status', '--porcelain')) die('working tree is dirty', 'commit or stash first')

console.log('→ git fetch')
run('git', ['fetch', '--tags', 'origin', 'main'])
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  die('main and origin/main disagree', 'pull or push first — the tag must sit on a pushed commit')
}
if (git('tag', '--list', tag)) die(`tag ${tag} already exists`)

if (version !== pkg.version && !isNewer(version, pkg.version)) {
  die(`${version} is not newer than the current ${pkg.version}`)
}

console.log(`→ npm view ${pkg.name}@${version}`)
const published = run('npm', ['view', `${pkg.name}@${version}`, 'version'], {
  capture: true,
  allowFailure: true,
})
if (published.ok && published.out) {
  die(`${pkg.name}@${version} is already on npm`, 'npm versions are immutable — pick the next one')
}

// --- the release commit -----------------------------------------------------

// A prerelease rehearses the notes of the version it precedes: the Unreleased
// section stays where it is and is what the GitHub prerelease quotes.
if (distTag === 'latest') {
  console.log('→ CHANGELOG.md')
  try {
    promote(version, new Date().toISOString().slice(0, 10))
  } catch (error) {
    die(error.message)
  }
}

if (version !== pkg.version) {
  console.log(`→ npm version ${version}`)
  run('npm', ['version', version, '--no-git-tag-version'])
}

console.log('→ sync-version')
run('node', ['scripts/sync-version.mjs'])

// --- gates ------------------------------------------------------------------

const GATES = [
  ['npx', ['biome', 'ci']],
  ['npm', ['test']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'check:dist']],
  ['npm', ['run', 'check:surface']],
  ['npm', ['run', 'check:invariants']],
  ['npm', ['run', 'check:syntax']],
  ['npm', ['run', 'check:version']],
]
for (const [cmd, cmdArgs] of GATES) {
  console.log(`→ ${cmd} ${cmdArgs.join(' ')}`)
  const { ok } = run(cmd, cmdArgs, { allowFailure: true })
  if (!ok) die(`${cmd} ${cmdArgs.join(' ')} failed`, 'nothing was committed — `git checkout -- .`')
}

// --- commit, tag, push ------------------------------------------------------

run('git', ['add', '-u'])
run('git', ['commit', '-m', `chore(release): ${version}`])
run('git', ['tag', '-a', tag, '-m', version])

console.log(`\n${tag} is ready on ${git('rev-parse', '--short', 'HEAD')}.`)
console.log(`Pushing it runs the release workflow and publishes under \`${distTag}\`.`)

let push = assumeYes
if (!push && process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  push = /^y(es)?$/i.test((await rl.question('Push now? [y/N] ')).trim())
  rl.close()
}
if (!push) {
  console.log(`\nNot pushed. When ready:\n  git push --follow-tags origin main`)
  console.log(`To undo:\n  git tag -d ${tag} && git reset --hard HEAD~1`)
  process.exit(0)
}

run('git', ['push', '--follow-tags', 'origin', 'main'])
console.log(`\n✓ ${tag} pushed — watch it: gh run watch`)
