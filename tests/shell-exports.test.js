// The assembly layer between the docs pages and the LLM exports
// (`src/shell/exports.js`). `llms-full.test.js` proves the concatenation from a
// `{ title, content }` written by hand; what is proved here is where that
// `content` comes from — the step that turns a declared page into the body an
// agent reads, and the one place the two exports could drift from the
// "Copy page" menu (docs/architecture.md §5.14.2).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScenario } from '../src/scenarios/model.js'
import { llmsFullExporter, llmsTextExporter } from '../src/shell/exports.js'
import { ScenarioStore } from '../src/storage/scenarios.js'

const model = {
  sourceVersion: '3.1.0',
  info: { title: 'Petstore', version: '2.0.0' },
  operations: [],
  groups: [],
}

// A body carried by the config needs no network, which is what keeps this file
// in the pure suite: only the unreachable-page case reaches for `fetch`.
const inline = (slug, title, content, format) => ({ slug, title, content, format })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('llms-full.txt assembly', () => {
  it('drops the frontmatter of a Markdown page, like the render and the menu do', async () => {
    const text = await llmsFullExporter({
      model,
      pages: [
        inline(
          'guide',
          'Guide',
          '---\ntitle: written for another tool\ndraft: true\n---\n\n# Pagination\n\nUse the cursor.\n',
        ),
      ],
      baseUrl: () => 'https://api.example.test/v1',
    })()

    expect(text).toContain('# Page: Guide')
    expect(text).toContain('# Pagination')
    expect(text).toContain('Use the cursor.')
    // The authoring metadata is the whole point: it addresses another tool, and
    // an agent reading it as prose reads a lie about the page's own title.
    expect(text).not.toContain('written for another tool')
    expect(text).not.toContain('draft: true')
  })

  it('flattens an HTML page to its text', async () => {
    const text = await llmsFullExporter({
      model,
      pages: [
        inline(
          'notes',
          'Notes',
          '<h1>Reference notes</h1>\n<p>Authored as <b>HTML</b>.</p>',
          'html',
        ),
      ],
      baseUrl: () => '',
    })()

    expect(text).toContain('Reference notes')
    // Each tag becomes a space, so an inline one leaves its gap behind — the
    // point is that the markup is gone, not that the prose is reflowed.
    expect(text).toContain('Authored as HTML')
    expect(text).not.toContain('<h1>')
    expect(text).not.toContain('<b>')
  })

  it('carries a text page verbatim, `---` line included', async () => {
    const text = await llmsFullExporter({
      model,
      pages: [inline('changes', 'Changes', '---\n2026-08-07  Added /orders.\n', 'text')],
      baseUrl: () => '',
    })()

    // A `---` opens a frontmatter block in Markdown and nothing at all in a
    // `.txt`: stripping it here would eat the first line of the file.
    expect(text).toContain('---\n2026-08-07  Added /orders.')
  })

  it('omits an unreachable page instead of failing the whole export', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    )

    const text = await llmsFullExporter({
      model,
      pages: [
        { slug: 'gone', title: 'Gone', url: 'https://docs.example.test/absent-from-llms-full.md' },
        inline('intro', 'Intro', '# Intro\n\nStill here.\n'),
      ],
      baseUrl: () => '',
    })()

    expect(text).not.toContain('# Page: Gone')
    expect(text).toContain('# Page: Intro')
    expect(text).toContain('Still here.')
  })

  it('reads the base URL at export time, not when the button was built', async () => {
    let selected = 'https://staging.example.test/v1'
    const exportText = llmsFullExporter({ model, pages: [], baseUrl: () => selected })

    expect(await exportText()).toContain('https://staging.example.test/v1')
    selected = 'https://prod.example.test/v1'
    expect(await exportText()).toContain('https://prod.example.test/v1')
  })
})

// The publishable set (docs/scenario-handoff.md §2): the exports resolve the
// config's `scenarios[]` themselves, which is the whole reason a reader's own
// cannot reach them — this layer never opens the store they live in.
const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    summary: 'Create a pet',
    parameters: [],
    requestBody: null,
    responses: [],
  },
]
const withOps = { ...model, operations: OPS }

const ENVELOPE = JSON.stringify({
  format: 'apiglow-scenario',
  v: 1,
  scenario: { name: 'Onboarding', steps: [{ id: 'step-create', opId: 'createPet' }] },
})

const ARAZZO = JSON.stringify({
  arazzo: '1.1.0',
  info: { title: 'Pet flows', version: '1.0.0' },
  sourceDescriptions: [{ name: 'petstore', url: 'https://ci.test/openapi.json', type: 'openapi' }],
  workflows: [{ workflowId: 'create-pet', steps: [{ stepId: 'a', operationId: 'createPet' }] }],
})

const entry = (fields) => ({ id: '', title: '', url: '', document: null, pinned: false, ...fields })

const fetcher = (files) => (url) =>
  url in files ? Promise.resolve(files[url]) : Promise.reject(new Error(`HTTP 404 ${url}`))

const exportBoth = (scenarios, files = {}) => {
  const shared = {
    model: withOps,
    ops: OPS,
    fetchText: fetcher(files),
    scenarios,
    baseUrl: () => '',
  }
  return Promise.all([
    llmsFullExporter({ ...shared, pages: [], specUrl: 'https://api.test/openapi.json' })(),
    llmsTextExporter({
      ...shared,
      outline: [],
      docsUrl: 'https://docs.test/index.html',
      specUrl: 'https://api.test/openapi.json',
    })(),
  ])
}

describe('the publishable set', () => {
  it('publishes the declared scenarios and never a reader own', async () => {
    const store = new ScenarioStore({ specId: 'default' })
    await store.add(createScenario({ name: 'My own experiment' }))

    const [full, index] = await exportBoth(
      [entry({ id: 'onboarding', title: 'Onboarding', url: '/s/onboarding.json' })],
      { '/s/onboarding.json': ENVELOPE },
    )

    expect(full).toContain('# Workflow: Onboarding')
    expect(index).toContain('## Workflows')
    expect(full).not.toContain('My own experiment')
    expect(index).not.toContain('My own experiment')
    // Still whole on the reader's side: this is a rule about publication and
    // nothing else.
    expect(await store.list()).toHaveLength(1)
  })

  it('omits an unreachable scenario instead of failing the whole export', async () => {
    const [full, index] = await exportBoth(
      [
        entry({ id: 'gone', title: 'Gone', url: '/s/absent.json' }),
        entry({ id: 'onboarding', title: 'Onboarding', url: '/s/onboarding.json' }),
      ],
      { '/s/onboarding.json': ENVELOPE },
    )

    expect(full).not.toContain('# Workflow: Gone')
    expect(index).not.toContain('[Gone]')
    expect(full).toContain('# Workflow: Onboarding')
    expect(index).toContain('[Onboarding]')
  })

  // §3.2: the recipe link survives the absence of a bake for exactly one case —
  // an Arazzo document the host already serves, at the address the config
  // states. Nothing else has a published file to point at.
  it('links the Arazzo file the host already serves, and invents no other', async () => {
    const [, index] = await exportBoth(
      [
        entry({ id: 'flows', url: '/s/flows.arazzo.json' }),
        entry({ id: 'onboarding', title: 'Onboarding', url: '/s/onboarding.json' }),
        entry({ id: 'carried', title: 'Carried', document: JSON.parse(ARAZZO) }),
      ],
      { '/s/flows.arazzo.json': ARAZZO, '/s/onboarding.json': ENVELOPE },
    )

    expect(index).toContain('[Arazzo recipe](/s/flows.arazzo.json)')
    expect(index.match(/Arazzo recipe/g)).toHaveLength(1)
  })
})

describe('llms.txt assembly', () => {
  it('reads the base URL at export time too', async () => {
    let selected = 'https://staging.example.test/v1'
    const exportText = llmsTextExporter({
      model,
      outline: [],
      docsUrl: 'https://docs.example.test/api/index.html',
      specUrl: 'https://api.example.test/openapi.json',
      baseUrl: () => selected,
    })

    expect(await exportText()).toContain('Base URL: https://staging.example.test/v1')
    selected = 'https://prod.example.test/v1'
    expect(await exportText()).toContain('Base URL: https://prod.example.test/v1')
  })
})
