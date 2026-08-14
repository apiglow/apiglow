import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bake, main } from '../scripts/bake.mjs'

// The bake (docs/seo.md §4) run end to end on the e2e petstore fixture: the
// config goes in, the static tree comes out. Two things are worth testing here
// and nowhere else — that the tree has the shape §4 specifies, and that every
// link in the generated files names a file the same run wrote. The generators
// themselves are snapshot-tested one by one; what only this test can see is
// whether they were wired to the same layout.

const BASE = new URL('../', import.meta.url)
const SITE = 'https://docs.example.com/'

const PETSTORE = {
  openapi: { url: '/tests/e2e/fixtures/e2e-api.json' },
  environments: [{ name: 'e2e', baseUrl: 'https://api.e2e.test/v1' }],
  docsPages: [
    {
      title: 'Getting started',
      url: '/tests/e2e/fixtures/getting-started.md',
      slug: 'getting-started',
    },
  ],
  scenarios: [
    { id: 'onboarding', title: 'Onboarding', url: '/tests/e2e/fixtures/e2e-scenario.json' },
  ],
}

const run = (config, options = {}) => bake({ config, base: BASE, siteUrl: SITE, ...options })

const paths = (files) => [...files.keys()].sort()

// Every URL a generated file points at that names the baked tree — as opposed
// to the schema and the host page, which the install serves and the bake never
// writes.
const BAKED = /^(op|page|scenario)\/|^(overview\.html|llms\.txt|llms-full\.txt|sitemap\.xml)$/

// A workflow document this project did not write, declared as it stands: YAML,
// two workflows, its own `sourceDescriptions` naming a schema the bake never
// loads (docs/scenario-handoff.md §2.1).
const THIRD_PARTY = {
  ...PETSTORE,
  scenarios: [{ id: 'pets', url: '/tests/e2e/fixtures/e2e-third-party.arazzo.yaml' }],
}

// The other carrier: a document straight in the config, with no file of its own
// anywhere for the bake to copy.
const CARRIED = {
  arazzo: '1.1.0',
  info: { title: 'Carried', version: '1.0.0' },
  sourceDescriptions: [
    { name: 'petstore', url: 'https://api.production.test/openapi.json', type: 'openapi' },
  ],
  workflows: [
    {
      workflowId: 'read-account',
      summary: 'Read the account',
      steps: [{ stepId: 'account', operationId: 'getAccount' }],
    },
  ],
}

const recipeIn = (files, path) => JSON.parse(files.get(path))

function bakedLinks(text) {
  return [...String(text).matchAll(/https:\/\/docs\.example\.com\/[^\s)<">]+/g)]
    .map((m) => m[0].slice(SITE.length))
    .filter((path) => BAKED.test(path))
}

describe('bake', () => {
  it('writes the tree of docs/seo.md §4', async () => {
    const { files, warnings } = await run(PETSTORE)
    expect(warnings).toEqual([])
    expect(paths(files)).toMatchSnapshot()
  })

  it('emits a snapshot, a mirror and a sitemap entry per route', async () => {
    const { files } = await run(PETSTORE)
    expect(files.get('sitemap.xml')).toMatchSnapshot()
    expect(files.get('op/listPets.html')).toMatchSnapshot()
    expect(files.get('page/getting-started.md')).toMatchSnapshot()
  })

  it('serves a generated recipe a runner can resolve, and links it', async () => {
    const { files } = await run(PETSTORE)
    const recipe = recipeIn(files, 'scenario/onboarding.arazzo.json')
    expect(recipe.arazzo).toBe('1.1.0')
    // Generated from the envelope, and pointed at the schema as the deployed
    // site serves it: a runner that fetches this file resolves its source.
    expect(recipe.sourceDescriptions).toEqual([
      { name: 'openapi', url: `${SITE}tests/e2e/fixtures/e2e-api.json`, type: 'openapi' },
    ])
    // Baked, the map hands an agent that file rather than the address the
    // config states (docs/scenario-handoff.md §3.2).
    expect(files.get('llms.txt')).toContain(`${SITE}scenario/onboarding.arazzo.json`)
  })

  it('copies a declared Arazzo document rather than regenerating it', async () => {
    const { files, warnings } = await run(THIRD_PARTY)
    expect(warnings).toEqual([])
    // One entry, two workflows, one triple each — and the whole document under
    // both, since it is the file its author owns that is published (§3.4).
    for (const id of ['create-then-read', 'list-pets']) {
      expect(files.has(`scenario/${id}.md`)).toBe(true)
      expect(files.has(`scenario/${id}.html`)).toBe(true)
      const recipe = recipeIn(files, `scenario/${id}.arazzo.json`)
      expect(recipe.info.title).toBe('Pet operations')
      // Its own sources, naming a schema this bake never loaded, and its own
      // workflows: nothing of it passed through our model on the way out.
      expect(recipe.sourceDescriptions.map((source) => source.name)).toEqual([
        'petstore',
        'billing',
      ])
      expect(recipe.workflows.map((workflow) => workflow.workflowId)).toEqual([
        'create-then-read',
        'list-pets',
      ])
      // Including the step no browser can execute: what the CI runner is
      // handed is not narrowed to what this documentation can run.
      expect(recipe.workflows[0].steps.at(-1)).toMatchObject({
        stepId: 'await-event',
        action: 'receive',
      })
    }
    // Authored in YAML, served as JSON: `.arazzo.json` is what an agent is told
    // to fetch, and comments are what that costs.
    expect(files.get('llms.txt')).toContain(`${SITE}scenario/list-pets.arazzo.json`)
  })

  it('publishes a recipe for a document the config carries itself', async () => {
    const { files, warnings } = await run({
      ...PETSTORE,
      scenarios: [{ id: 'carried', document: CARRIED }],
    })
    expect(warnings).toEqual([])
    // No file of its own anywhere, and the same triple: an install that serves
    // no scenario file still publishes its recipes.
    expect(recipeIn(files, 'scenario/read-account.arazzo.json')).toEqual(CARRIED)
    expect(files.has('scenario/read-account.md')).toBe(true)
  })

  it('bakes no recipe it could not point at a published schema', async () => {
    const spec = JSON.parse(
      await readFile(fileURLToPath(new URL('tests/e2e/fixtures/e2e-api.json', BASE)), 'utf8'),
    )
    const { files, warnings } = await run({ ...PETSTORE, openapi: { spec } })
    // The scenario is published — only the recipe is not, because its
    // `sourceDescriptions` would name a document nobody serves.
    expect(files.has('scenario/onboarding.md')).toBe(true)
    expect(files.has('scenario/onboarding.arazzo.json')).toBe(false)
    expect(warnings).toEqual([expect.stringContaining('no Arazzo recipe baked')])
    expect(files.get('llms.txt')).not.toContain('arazzo.json')
  })

  it('links only files it wrote', async () => {
    const { files } = await run(PETSTORE)
    const written = new Set(files.keys())
    for (const name of ['llms.txt', 'llms-full.txt', 'sitemap.xml', 'overview.html']) {
      const links = bakedLinks(files.get(name))
      expect(links.length, `${name} names nothing of the tree`).toBeGreaterThan(0)
      const dangling = links.filter((link) => !written.has(link))
      expect(dangling, `${name} points at files the bake did not write`).toEqual([])
    }
  })

  it('sends every snapshot back to its own route in the app', async () => {
    const { files } = await run(PETSTORE)
    expect(files.get('op/listPets.html')).toContain(`href="${SITE}#/op/listPets"`)
    expect(files.get('page/getting-started.html')).toContain(`href="${SITE}#/page/getting-started"`)
    expect(files.get('scenario/onboarding.html')).toContain(`href="${SITE}#/scenario/onboarding"`)
    expect(files.get('overview.html')).toContain(`href="${SITE}#/overview"`)
    // The one canonical the strategy allows: a served URL pointing at itself.
    expect(files.get('op/listPets.html')).toContain(
      `<link rel="canonical" href="${SITE}op/listPets.html">`,
    )
  })

  // llms.txt v2 discovery: a page names the map covering it, so an agent
  // landing on a snapshot finds the rest of the documentation without
  // guessing an address.
  it('declares the covering llms.txt on every page it writes', async () => {
    const { files } = await run(PETSTORE)
    const link = `<link rel="describedby" href="${SITE}llms.txt">`
    for (const [path, content] of files) {
      if (!path.endsWith('.html')) continue
      expect(content, `${path} names no covering llms.txt`).toContain(link)
    }
  })

  it('nests every spec under its route prefix, root files excepted', async () => {
    const { files } = await run({
      openapi: {
        specs: [
          {
            id: 'main',
            url: '/tests/e2e/fixtures/e2e-api.json',
            scenarios: PETSTORE.scenarios,
          },
          { id: 'other', url: '/tests/e2e/fixtures/e2e-api-b.json' },
        ],
      },
    })
    const nested = paths(files).filter((path) => !path.startsWith('s/'))
    expect(nested).toEqual(['llms-full.txt', 'llms.txt', 'sitemap.xml'])
    expect(files.has('s/main/op/listPets.md')).toBe(true)
    expect(files.has('s/other/op/listInvoices.md')).toBe(true)
    // Recipes nest with everything else — scenarios are declared inside a
    // `specs[]` entry, so this is the only place they could go.
    expect(files.has('s/main/scenario/onboarding.arazzo.json')).toBe(true)
    // One map for the whole site, covering both specs, and the app links carry
    // the prefix the router builds.
    expect(files.get('llms.txt')).toContain(`${SITE}s/other/op/listInvoices.md`)
    expect(files.get('s/main/op/listPets.html')).toContain(`href="${SITE}#/s/main/op/listPets"`)
    // A nested page is covered by that one root map, not by a per-spec one.
    expect(files.get('s/other/op/listInvoices.html')).toContain(
      `<link rel="describedby" href="${SITE}llms.txt">`,
    )
  })

  it('refuses to publish a documentation that asks not to be indexed', async () => {
    await expect(run({ ...PETSTORE, seo: { index: false } })).rejects.toThrow(/index: false/)
  })

  it('reports what it could not read instead of emitting an empty page', async () => {
    const { files, warnings } = await run({
      ...PETSTORE,
      docsPages: [
        ...PETSTORE.docsPages,
        { title: 'Gone', url: '/tests/e2e/fixtures/nowhere.md', slug: 'gone' },
        { title: 'Hosted', contentId: 'prose', slug: 'hosted' },
      ],
    })
    expect(warnings).toHaveLength(2)
    expect(files.has('page/gone.md')).toBe(false)
    expect(files.has('page/hosted.md')).toBe(false)
    // Nor is either of them listed anywhere: an entry pointing at a file nobody
    // wrote is worse than one entry fewer.
    expect(files.get('llms.txt')).not.toContain('page/gone')
    expect(files.get('sitemap.xml')).not.toContain('page/hosted')
  })

  it('takes the snapshots chrome from the selected catalog', async () => {
    const { files } = await run(PETSTORE, { language: 'fr' })
    expect(files.get('op/listPets.html')).toContain('<html lang="fr">')
    expect(files.get('op/listPets.html')).toContain('Ouvrir dans la documentation interactive')
    expect(files.get('overview.html')).toContain('<title>Schéma OpenAPI — E2E Test API</title>')
  })

  it('writes the tree to disk from the command line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apiglow-bake-'))
    const config = join(dir, 'apidoc.config.json')
    // A declaration the CLI resolves against the config file's own directory,
    // which is what lets a bake run before anything is deployed.
    const schema = relative(dir, fileURLToPath(new URL('tests/e2e/fixtures/e2e-api.json', BASE)))
    await writeFile(config, JSON.stringify({ openapi: { url: schema } }), 'utf8')
    const out = join(dir, 'public')

    const report = await main(['--config', config, '--site-url', SITE, '--out', out])

    expect(report).toMatch(/^Baked \d+ files into /m)
    expect(await readFile(join(out, 'op', 'listPets.html'), 'utf8')).toContain(
      '<title>List all pets — E2E Test API</title>',
    )
  })

  it('says what it needs rather than baking half a site', async () => {
    await expect(main(['--site-url', SITE, '--out', 'public'])).rejects.toThrow(
      /--config is required/,
    )
    await expect(
      main(['--config', 'nowhere.json', '--site-url', SITE, '--out', 'x']),
    ).rejects.toThrow(/could not be read/)
  })
})
