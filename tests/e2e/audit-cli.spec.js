// `apiglow audit` as it is actually shipped (docs/audit.md §8): the built
// `dist/cli.js` run the way a CI job runs it. tests/audit-cli.test.js covers
// the command from the sources; only here does the bundle resolve its runtime
// dependencies from node_modules and its catalogs from dist/i18n/, and only
// here is the exit status a real process's.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repo, 'dist/cli.js')
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))

// → { stdout, stderr, code }, whatever the exit status: a failing check is an
// outcome under test here, not an error.
async function audit(...args) {
  try {
    const { stdout, stderr } = await exec('node', [CLI, 'audit', ...args], { cwd: repo })
    return { stdout, stderr, code: 0 }
  } catch (err) {
    return { stdout: err.stdout, stderr: err.stderr, code: err.code }
  }
}

test('passes a clean schema with exit status 0', async () => {
  const { stdout, stderr, code } = await audit('tests/e2e/fixtures/e2e-api-clean.json')
  expect(code).toBe(0)
  expect(stdout).toContain('No findings. Every applicable check passes on this schema.')
  expect(stderr).toMatch(/Audit passed\n$/)
})

test('fails a CI job with exit status 1 when a check fails', async () => {
  const { stderr, code } = await audit('tests/e2e/fixtures/e2e-api.json', '--fail-on', 'warning')
  expect(code).toBe(1)
  expect(stderr).toMatch(/^FAIL {2}--fail-on warning/)
})

test('exits 2 when it cannot run', async () => {
  const { stderr, code } = await audit('tests/e2e/fixtures/missing.json')
  expect(code).toBe(2)
  expect(stderr).toMatch(/^apiglow audit: spec "default" could not be loaded/)
})

// The bundle reads a file its strict parser refuses through the reader shipped
// next to it, dist/read-document.js, and reports on it rather than stopping.
test('reports on a file no strict parser accepts, the error at its line', async () => {
  const { stdout, stderr, code } = await audit('tests/e2e/fixtures/e2e-api-duplicate-key.yaml')
  expect(code).toBe(1)
  expect(stdout).toContain(
    'The file is not valid YAML at line 12, column 7: Map keys must be unique',
  )
  expect(stderr).toContain(
    'error document-syntax — tests/e2e/fixtures/e2e-api-duplicate-key.yaml:12:7',
  )
})

test('reports in French from the catalog shipped next to it', async () => {
  const { stdout, code } = await audit('tests/e2e/fixtures/e2e-api-clean.json', '--language', 'fr')
  expect(code).toBe(0)
  expect(stdout).toMatch(/^Audit du schéma — Clean E2E API\n/)
})

test('expands a quoted pattern and writes SARIF from the bundle', async () => {
  const { stdout, code } = await audit(
    'tests/e2e/fixtures/e2e-api-{clean,b}.json',
    '--format',
    'sarif',
    '--fail-on',
    'none',
  )
  expect(code).toBe(0)
  const sarif = JSON.parse(stdout)
  expect(sarif.version).toBe('2.1.0')
  expect(sarif.runs.map((run) => run.automationDetails.id)).toEqual([
    'apiglow-audit/tests/e2e/fixtures/e2e-api-b.json/',
    'apiglow-audit/tests/e2e/fixtures/e2e-api-clean.json/',
  ])
})

test('explains its rules from the bundle, in the shipped catalogs too', async () => {
  const listed = await audit('--list-rules')
  expect(listed.code).toBe(0)
  expect(JSON.parse(listed.stdout).rules.length).toBeGreaterThan(90)
  const explained = await audit('--explain', 'operation-id-present', '--language', 'fr')
  expect(explained.stdout).toContain('Comment corriger')
})

// The skill file an agent installs to run the audit loop (docs/audit.md §8.5)
// is part of the package: a skill the tarball does not carry is a dead link in
// the docs.
test('ships the agent skill in the package', async ({ request }) => {
  const skill = await request.get(`/npm/${pkg.name}@${pkg.version}/skills/apiglow-audit/SKILL.md`)
  expect(skill.status()).toBe(200)
  expect(await skill.text()).toMatch(/^---\nname: apiglow-audit\n/)
})
