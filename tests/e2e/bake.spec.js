// The bake as it is actually shipped (docs/seo.md §4, phase 5): the CLI built
// into the package, run against the served fixture, and what it wrote read the
// way a crawler reads it — with JavaScript switched off. tests/bake.test.js
// checks the shape of the tree from the sources; only here is the built
// `dist/bake.js` executed, only here is a snapshot served over HTTP, and only
// here does a browser parse one.
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const run = promisify(execFile)
const repo = fileURLToPath(new URL('../../', import.meta.url))
const CLI = join(repo, 'dist/bake.js')
const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))

// One tree per worker. Under `fullyParallel` the same file can be executed by
// several workers at once, and a bake wiping a directory another worker is
// reading would be flaky for a reason no failure message would name.
let out = ''
let site = ''

// The bake writes where the CDN simulation serves it (scripts/preview-cdn.mjs),
// next to a copy of the host page: that is the layout it publishes — the
// snapshots sit beside the documentation they link back to, and their canonical
// URLs are the addresses they are served at.
test.beforeAll(async () => {
  const dir = `tests/e2e/baked/w${test.info().parallelIndex}`
  out = join(repo, dir)
  site = `http://localhost:4173/${dir}/app.html`

  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await copyFile(join(repo, 'tests/e2e/fixtures/app.html'), join(out, 'app.html'))

  const config = join(out, 'apidoc.config.json')
  await writeFile(config, await hostPageConfig(), 'utf8')
  const { stdout } = await run('node', [
    CLI,
    'bake',
    '--config',
    config,
    '--site-url',
    site,
    '--out',
    out,
  ])
  // Nothing dropped: the fixture declares a schema, a docs page and a workflow,
  // and a warning here would mean the tree below is missing one of them.
  expect(stdout).not.toContain('warning:')
})

// The very config the fixture page boots on, its site-root paths turned into
// the addresses the preview server answers at — the bake then reads the schema,
// the page and the workflow over HTTP, as it would against a deployed site.
async function hostPageConfig() {
  const host = await readFile(join(repo, 'tests/e2e/fixtures/app.html'), 'utf8')
  const inline = /<script id="api-doc-config"[^>]*>([\s\S]*?)<\/script>/.exec(host)[1]
  return inline.replaceAll('"/tests/', '"http://localhost:4173/tests/')
}

test.describe('a snapshot with JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false })

  test('carries the endpoint documentation a crawler came for', async ({ page, request }) => {
    const response = await page.goto(`${site.replace('app.html', '')}op/listPets.html`)
    expect(response.status()).toBe(200)

    await expect(page).toHaveTitle('List all pets — E2E Test API')
    await expect(page.getByRole('heading', { name: 'List all pets' })).toBeVisible()
    await expect(page.getByText('Returns the pets, optionally filtered by status.')).toBeVisible()
    // The request line, base URL included: the mirror is the documentation, not
    // a stub pointing at it.
    await expect(page.getByText('GET https://api.e2e.test/v1/pets')).toBeVisible()
    await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
      'content',
      'Returns the pets, optionally filtered by status.',
    )
    // Honest static content: the only script on the page is the JSON-LD block,
    // which renders nothing and executes nothing.
    await expect(page.locator('script:not([type="application/ld+json"])')).toHaveCount(0)

    // The canonical is the address the page answers at, which is only true if
    // the tree was deposited where `--site-url` said it would be served.
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute('href', page.url())

    // And the mirror the head declares is served too: what an agent fetches
    // instead of parsing the HTML.
    const markdown = await page.locator('head link[rel="alternate"]').getAttribute('href')
    const mirror = await request.get(markdown)
    expect(mirror.status()).toBe(200)
    // Markdown as authored, down to the emphasis the HTML rendered away.
    expect(await mirror.text()).toContain('Returns the pets, optionally filtered by **status**.')
  })

  test('is one link away from the interactive documentation', async ({ page }) => {
    await page.goto(`${site.replace('app.html', '')}page/getting-started.html`)
    await expect(page.locator('.snapshot-open a')).toHaveAttribute(
      'href',
      `${site}#/page/getting-started`,
    )
  })
})

test('hands the reader back to the app it was baked from', async ({ page }) => {
  await page.goto(`${site.replace('app.html', '')}op/listPets.html`)
  await page.locator('.snapshot-open a').click()

  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  await expect(page).toHaveTitle('List all pets — E2E Test API')
})

test('ships in the package as the apiglow bin', async ({ request }) => {
  const cdn = `/npm/${pkg.name}@${pkg.version}/`
  const manifest = await (await request.get(`${cdn}package.json`)).json()
  expect(manifest.bin).toEqual({ apiglow: 'dist/bake.js' })

  // The `files` half of the same contract: a bin the tarball does not carry is
  // a broken install, and nothing else in the suite fetches this file.
  const cli = await request.get(`${cdn}${manifest.bin.apiglow}`)
  expect(cli.status()).toBe(200)
  expect(await cli.text()).toMatch(/^#!\/usr\/bin\/env node\n/)
})

test('publishes French pages from the catalogs shipped next to it', async () => {
  // `--language` reads a catalog off the disk, and in the package that disk
  // layout is the built one (dist/i18n/), not the repo's — the resolution no
  // test running from the sources can exercise.
  const dir = await mkdtemp(join(tmpdir(), 'apiglow-bake-fr-'))
  await run('node', [
    CLI,
    'bake',
    '--config',
    join(out, 'apidoc.config.json'),
    '--site-url',
    site,
    '--out',
    dir,
    '--language',
    'fr',
  ])

  const snapshot = await readFile(join(dir, 'op/listPets.html'), 'utf8')
  expect(snapshot).toContain('<html lang="fr">')
  expect(snapshot).toContain('Ouvrir dans la documentation interactive')
  await rm(dir, { recursive: true, force: true })
})
