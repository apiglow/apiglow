// The proof that the version people will actually install works, run after the
// publish (.github/workflows/release.yml): no local tarball, no preview server —
// the bundle is fetched from jsDelivr, in a real browser, on a page that has
// nothing but a config block and one <script>. What this catches is invisible to
// every other suite, since they all run against the local pack: a file missing
// from `files`, an export map that resolves nowhere, an asset path that only
// worked because the server was ours, a CDN that never serves the version.
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

// No D-Bus session bus for headless Chromium — see playwright.config.js.
process.env.DBUS_SESSION_BUS_ADDRESS = '/dev/null'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = process.argv[2] ?? pkg.version
const cdn = `https://cdn.jsdelivr.net/npm/${pkg.name}@${version}`
const port = Number(process.env.PORT ?? 4180)

// A publish is visible to the registry in seconds and to the CDN on its first
// request, but neither is instant and neither is worth a flaky red build.
async function waitFor(url, what, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const ok = await fetch(url, { method: 'HEAD' }).then(
      (r) => r.ok,
      () => false,
    )
    if (ok) return console.log(`✓ ${what} serves ${version}`)
    if (Date.now() > deadline) {
      console.error(`✖ ${what} never served ${version}: ${url}`)
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
}

await waitFor(`https://registry.npmjs.org/${pkg.name}/${version}`, 'the npm registry')
await waitFor(`${cdn}/dist/app.js`, 'jsDelivr')

// Host page and schema served from a directory of their own: the app is the
// only thing coming from the CDN, so anything that breaks is the package's.
const dir = mkdtempSync(join(tmpdir(), 'apiglow-verify-'))

// The published bin, run the way a reader would reach it — from a directory
// that is not this repository. Run from the checkout, npx reads a package.json
// named `apiglow`, believes the project is already at hand, looks for a binary
// in its node_modules and gives up without ever fetching the published one.
console.log(`→ npx ${pkg.name}@${version} --help`)
const cli = spawnSync('npx', ['--yes', `${pkg.name}@${version}`, '--help'], {
  cwd: dir,
  encoding: 'utf8',
})
if (cli.status !== 0) {
  console.error(`✖ npx ${pkg.name}@${version} failed:\n${cli.stderr}`)
  process.exit(1)
}
writeFileSync(
  join(dir, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Release check</title></head>
  <body>
    <script id="api-doc-config" type="application/json">
    { "openapi": { "url": "/api.json" } }
    </script>
    <script src="${cdn}/dist/app.js" type="module"></script>
  </body>
</html>
`,
  'utf8',
)
writeFileSync(join(dir, 'api.json'), readFileSync(join(root, 'tests/e2e/fixtures/e2e-api.json')))

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' }
const server = createServer((req, res) => {
  const name = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const file = name === '/api.json' ? 'api.json' : 'index.html'
  res.writeHead(200, { 'content-type': TYPES[file.endsWith('.json') ? '.json' : '.html'] })
  res.end(readFileSync(join(dir, file)))
})
await new Promise((resolve) => server.listen(port, resolve))

const browser = await chromium.launch()
const problems = []
try {
  const page = await browser.newPage()
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()))
  page.on('pageerror', (error) => problems.push(error.message))
  await page.goto(`http://localhost:${port}/`)

  // Same readiness signal as the e2e suite: operation links exist in the DOM.
  await page
    .locator('api-nav a[data-op-id]')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 })
  console.log('✓ the documentation rendered from the CDN bundle')

  // A bundle whose stylesheet 404s still builds a DOM: the CSS is checked
  // separately, and it is the asset whose path resolution is most fragile.
  const styled = await page.evaluate(
    (prefix) => [...document.styleSheets].some((sheet) => sheet.href?.startsWith(prefix)),
    cdn,
  )
  if (!styled) problems.push('no stylesheet loaded from the CDN')

  // The footer names the running build: the only check that the CDN is serving
  // this version rather than a cached neighbour.
  const footer = await page.locator('footer').first().innerText()
  if (!footer.includes(`v${version}`)) problems.push(`the footer reads "${footer.trim()}"`)
} finally {
  await browser.close()
  server.close()
}

if (problems.length) {
  console.error(`✖ ${pkg.name}@${version} is published but broken:`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`\n✓ ${pkg.name}@${version} works, installed the way a reader installs it`)
