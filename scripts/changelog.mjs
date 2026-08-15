// CHANGELOG.md is the single source for both the file a reader clones and the
// body of the GitHub Release (docs/release.md). Two operations on one parser:
// promote what accumulated under `Unreleased` into a numbered section, and read
// a section back out.
//
// A prerelease never consumes the Unreleased section: an `-rc.N` ships the same
// notes as the version it rehearses, and the notes stay pending until the real
// number goes out.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('..', import.meta.url)
const FILE = new URL('CHANGELOG.md', root)
const UNRELEASED = 'Unreleased'

const isPrerelease = (version) => version.includes('-')

function repoUrl() {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
  return pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')
}

// A section runs from its own `## [x]` heading to the next one, or to the link
// reference block that closes the file.
function sections(text) {
  const lines = text.split('\n')
  const heads = []
  lines.forEach((line, i) => {
    const name = /^## \[([^\]]+)\]/.exec(line)?.[1]
    if (name) heads.push({ name, start: i })
  })
  const refsAt = lines.findIndex((line) => /^\[[^\]]+\]: /.test(line))
  const end = refsAt === -1 ? lines.length : refsAt
  return heads.map((head, i) => ({
    ...head,
    // Body excludes the heading itself and stops before the next section.
    body: lines.slice(head.start + 1, heads[i + 1]?.start ?? end),
  }))
}

export function section(version) {
  const text = readFileSync(FILE, 'utf8')
  const wanted = isPrerelease(version) ? UNRELEASED : version
  const found = sections(text).find((s) => s.name === wanted)
  if (!found) throw new Error(`CHANGELOG.md has no [${wanted}] section`)
  return found.body.join('\n').trim()
}

// The reference block is rebuilt from the versions the document declares, so a
// promoted section can never leave a dangling or stale link behind.
function withRefs(lines, versions) {
  const url = repoUrl()
  const body = lines.filter((line) => !/^\[[^\]]+\]: /.test(line))
  while (body.at(-1) === '') body.pop()
  const refs = [
    versions[0]
      ? `[${UNRELEASED}]: ${url}/compare/v${versions[0]}...HEAD`
      : `[${UNRELEASED}]: ${url}/commits/main`,
    ...versions.map((v) => `[${v}]: ${url}/releases/tag/v${v}`),
  ]
  return [...body, '', ...refs, ''].join('\n')
}

export function promote(version, date) {
  const text = readFileSync(FILE, 'utf8')
  const found = sections(text)
  const unreleased = found.find((s) => s.name === UNRELEASED)
  if (!unreleased) throw new Error(`CHANGELOG.md has no [${UNRELEASED}] section`)
  const notes = unreleased.body.join('\n').trim()
  if (!notes) throw new Error(`nothing under [${UNRELEASED}] — a release needs its notes first`)
  if (found.some((s) => s.name === version))
    throw new Error(`CHANGELOG.md already has [${version}]`)

  const lines = text.split('\n')
  const head = lines.slice(0, unreleased.start + 1)
  const rest = lines.slice(unreleased.start + 1 + unreleased.body.length)
  const promoted = ['', `## [${version}] — ${date}`, '', notes, '']
  const versions = [version, ...found.filter((s) => s.name !== UNRELEASED).map((s) => s.name)]
  writeFileSync(FILE, withRefs([...head, ...promoted, ...rest], versions), 'utf8')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, version, date] = process.argv.slice(2)
  try {
    if (command === 'section') process.stdout.write(`${section(version)}\n`)
    else if (command === 'promote') promote(version, date ?? new Date().toISOString().slice(0, 10))
    else throw new Error('usage: changelog.mjs section <version> | promote <version> [date]')
  } catch (error) {
    console.error(`✖ ${error.message}`)
    process.exit(1)
  }
}
