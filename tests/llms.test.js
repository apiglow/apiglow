import { beforeEach, describe, expect, it } from 'vitest'
import { toLlmsText } from '../src/export/llms.js'
import { bakedUrls } from '../src/export/site-layout.js'
import { setRouteSpecId } from '../src/router.js'
import { normalizeScenario } from '../src/scenarios/model.js'

// Representative model: two tagged groups, one untagged operation, a webhook,
// a deprecated operation, and the `info` metadata that feeds the Optional
// section — the snapshot pins the whole file structure down.
const model = {
  sourceVersion: '3.1.0',
  info: {
    title: 'Petstore',
    version: '2.0.0',
    description: 'A sample API.\n\nManage your pets.',
    termsOfService: 'https://example.com/terms',
    license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
  },
  externalDocs: { url: 'https://example.com/guides', description: 'The integration guide' },
  operations: [
    { id: 'listPets', method: 'get', path: '/pets', summary: 'List pets', tags: ['pets'] },
    { id: 'createPet', method: 'post', path: '/pets', summary: 'Create a pet', tags: ['pets'] },
    {
      id: 'legacySearch',
      method: 'get',
      path: '/search',
      summary: 'Search everything',
      deprecated: true,
      tags: ['search'],
    },
    { id: 'ping', method: 'get', path: '/ping', description: 'Liveness probe.', tags: [] },
  ],
  groups: [
    { tag: 'pets', operationIds: ['listPets', 'createPet'] },
    { tag: 'search', operationIds: ['legacySearch'] },
    { tag: null, operationIds: ['ping'] },
  ],
  webhooks: [
    {
      id: 'webhook-post-petadopted',
      kind: 'webhook',
      name: 'petAdopted',
      method: 'post',
      summary: 'Pet adopted',
    },
  ],
  securitySchemes: [
    { name: 'bearerAuth', type: 'http', scheme: 'bearer' },
    { name: 'apiKeyAuth', type: 'apiKey', in: 'header', paramName: 'X-Api-Key' },
  ],
}

// Two declared scenarios (docs/scenario-handoff.md §3.2), one per link case:
// the first is written in our envelope and has nothing published to point at
// until the bake runs, the second is an Arazzo document the host already
// serves at the address the config states.
const scenario = (name, steps) => normalizeScenario({ name, steps }).scenario

const scenarios = [
  {
    id: 'create-pet',
    title: 'Create a pet',
    scenario: scenario('Create a pet', [
      {
        opId: 'createPet',
        request: { headers: [{ name: 'X-Api-Key', value: '{{auth.apiKey}}' }] },
        extract: [{ name: 'petId', source: 'body', pointer: '/id' }],
      },
      { opId: 'listPets', request: { query: { owner: '{{ownerId}}', pet: '{{petId}}' } } },
    ]),
    recipeUrl: '',
  },
  {
    id: 'find-a-pet',
    title: 'Find a pet',
    scenario: scenario('Find a pet', [
      { opId: 'legacySearch', request: { query: { q: '{{term}}' } } },
    ]),
    recipeUrl: 'https://docs.example.com/workflows/search.arazzo.yaml',
  },
]

const options = {
  docsUrl: 'https://docs.example.com/api/index.html',
  baseUrl: 'https://api.example.com/v1/',
  specUrl: 'https://api.example.com/openapi.json',
  scenarios,
  outline: [
    { kind: 'page', slug: 'getting-started', title: 'Getting started' },
    {
      kind: 'group',
      title: 'Concepts',
      entries: [
        { kind: 'page', slug: 'pagination', title: 'Pagination' },
        { kind: 'link', title: 'Status page', href: 'https://status.example.com' },
      ],
    },
    { kind: 'link', title: 'GitHub', href: 'https://github.com/acme/api' },
  ],
}

describe('llms.txt export', () => {
  beforeEach(() => setRouteSpecId(null))

  it('lays out the index: summary, guides, groups, webhooks, reference', () => {
    expect(toLlmsText(model, options)).toMatchSnapshot()
  })

  // docs-pages.md §7: the arrangement the docs author chose is information.
  it('gives a nav group its own section and sends external links to Optional', () => {
    const text = toLlmsText(model, options)
    expect(text).toContain('## Concepts\n\n- [Pagination]')
    expect(text.indexOf('## Optional')).toBeLessThan(text.indexOf('[GitHub]'))
    expect(text.indexOf('## Optional')).toBeLessThan(text.indexOf('[Status page]'))
  })

  // A map with the same heading printed twice reads as a duplicate, not as an
  // order — so an ungrouped page and a group both called "Guides" share one.
  it('merges sections that would carry the same heading', () => {
    const outline = [
      { kind: 'page', slug: 'intro', title: 'Intro' },
      { kind: 'group', title: 'Guides', entries: [{ kind: 'page', slug: 'p', title: 'P' }] },
    ]
    const text = toLlmsText(model, { ...options, outline })
    expect(text.match(/^## Guides$/gm)).toHaveLength(1)
    expect(text).toContain('- [Intro]')
    expect(text).toContain('- [P]')
  })

  // docs-pages.md §2.7: the two zones bracket the reference here as they do in
  // the nav, and the trailing ungrouped pages get their own heading — printing
  // "Guides" a second time below the endpoints would read as a duplicate.
  it('prints the trailing docs zone below the endpoints', () => {
    const outline = [
      { kind: 'page', slug: 'intro', title: 'Intro' },
      { kind: 'page', slug: 'support', title: 'Support', nav: 'bottom' },
      {
        kind: 'group',
        title: 'Legal',
        nav: 'bottom',
        entries: [
          { kind: 'page', slug: 'terms', title: 'Terms' },
          { kind: 'link', title: 'Trust center', href: 'https://trust.example.com' },
        ],
      },
    ]
    const text = toLlmsText(model, { ...options, outline })
    expect(text.indexOf('## Guides')).toBeLessThan(text.indexOf('## pets'))
    expect(text.indexOf('## Webhooks')).toBeLessThan(text.indexOf('## Resources'))
    expect(text).toContain('## Resources\n\n- [Support]')
    expect(text.indexOf('## Webhooks')).toBeLessThan(text.indexOf('## Legal'))
    // A link is a pointer out, whichever zone declared it.
    expect(text.indexOf('## Optional')).toBeLessThan(text.indexOf('[Trust center]'))
  })

  // §3.2: the position scenarios occupy in the nav, and the noun the reader
  // here already knows.
  it('puts the workflows between the guides and the endpoints', () => {
    const text = toLlmsText(model, options)
    expect(text.indexOf('## Guides')).toBeLessThan(text.indexOf('## Workflows'))
    expect(text.indexOf('## Workflows')).toBeLessThan(text.indexOf('## pets'))
    expect(text).not.toContain('## Scenarios')
  })

  it('counts the steps and what the reader has to provide for them', () => {
    // `petId` is extracted by the first step, so it is not asked for.
    expect(toLlmsText(model, options)).toContain(
      '- [Create a pet](https://docs.example.com/api/index.html#/scenario/create-pet): 2 steps, 2 inputs\n',
    )
  })

  // Without a bake there is no `.md` to fetch, so the entry links the hash
  // route; the recipe survives that fallback only where the host already
  // serves the file.
  it('links the recipe the host serves, and invents none for the others', () => {
    const text = toLlmsText(model, options)
    expect(text).toContain(
      '- [Find a pet](https://docs.example.com/api/index.html#/scenario/find-a-pet): 1 step, 1 input — the [Arazzo recipe](https://docs.example.com/workflows/search.arazzo.yaml) runs it unchanged in CI.',
    )
    expect(text).not.toContain('create-pet.arazzo')
  })

  // Doctrine §2: the feature turned off leaves nothing to publish, and an
  // empty section would claim this documentation has workflows it does not.
  it('has no Workflows section at all when no scenario is declared', () => {
    expect(toLlmsText(model, { ...options, scenarios: [] })).not.toContain('## Workflows')
  })

  it('carries the multi-spec prefix into a workflow link too', () => {
    setRouteSpecId('v2')
    expect(toLlmsText(model, options)).toContain(
      'https://docs.example.com/api/index.html#/s/v2/scenario/create-pet',
    )
  })

  // docs/seo.md §4: baked, the destinations exist as files, and llmstxt.org
  // asks that an agent be given Markdown it can fetch rather than a route it
  // cannot follow. The multi-spec prefix travels either way.
  it('links the served mirrors when the install is baked', () => {
    setRouteSpecId('v2')
    const text = toLlmsText(model, {
      ...options,
      urls: bakedUrls(options.docsUrl, { specId: 'v2' }),
    })
    expect(text).toContain('(https://docs.example.com/api/s/v2/op/listPets.md)')
    expect(text).toContain('(https://docs.example.com/api/s/v2/page/pagination.md)')
    expect(text).toContain('(https://docs.example.com/api/s/v2/scenario/create-pet.md)')
    expect(text).not.toContain('#/op/')
    // The links out are the host's own and stay untouched: an external link,
    // the recipe the host already serves, the published schema.
    expect(text).toContain('(https://status.example.com)')
    expect(text).toContain('(https://docs.example.com/workflows/search.arazzo.yaml)')
    expect(text).toContain('(https://api.example.com/openapi.json)')
  })

  it('derives llms-full.txt from the host page when no URL is given', () => {
    expect(toLlmsText(model, options)).toContain(
      '- [Full documentation (llms-full.txt)](https://docs.example.com/api/llms-full.txt)',
    )
    expect(
      toLlmsText(model, { ...options, fullUrl: 'https://cdn.example.com/llms-full.txt' }),
    ).toContain('(https://cdn.example.com/llms-full.txt)')
  })

  it('falls back to the first paragraph of the description as summary', () => {
    expect(toLlmsText(model, options)).toContain('> A sample API.')
    const withSummary = { ...model, info: { ...model.info, summary: 'Everything pet-related.' } }
    expect(toLlmsText(withSummary, options)).toContain('> Everything pet-related.')
  })

  it('marks a deprecated operation and labels the untagged group', () => {
    const out = toLlmsText(model, options)
    expect(out).toContain(
      '- [GET /search](https://docs.example.com/api/index.html#/op/legacySearch): (deprecated) Search everything',
    )
    expect(out).toContain('## Other operations')
    expect(out).toContain(
      '- [GET /ping](https://docs.example.com/api/index.html#/op/ping): Liveness probe.',
    )
  })

  it('carries the multi-spec prefix into every link', () => {
    setRouteSpecId('v2')
    expect(toLlmsText(model, options)).toContain(
      'https://docs.example.com/api/index.html#/s/v2/op/listPets',
    )
  })

  it('strips the reader current route from the link base', () => {
    const out = toLlmsText(model, {
      ...options,
      docsUrl: 'https://docs.example.com/api/index.html#/op/ping',
    })
    expect(out).toContain('(https://docs.example.com/api/index.html#/op/listPets)')
  })

  // Orientation, not the contract: the reader learns credentials are needed
  // and of what kind, and follows the Reference links for the rest.
  it('names the authentication schemes in one line', () => {
    expect(toLlmsText(model, options)).toContain(
      'Authentication: bearerAuth: http/bearer, apiKeyAuth: apiKey.',
    )
  })

  // The one link that does not lead to what this file describes: an agent
  // following it fetches the published document, not the overlaid one every
  // line above was generated from.
  it('says the spec link is not what the rest of the file describes, when overlays apply', () => {
    const out = toLlmsText(model, { ...options, overlays: 2 })
    expect(out).toContain(
      '- [OpenAPI specification](https://api.example.com/openapi.json): the machine-readable contract as published — this documentation renders it through 2 overlay(s) the file does not carry',
    )
  })

  // The other direction: hiding leaves the file saying MORE than this index,
  // and an agent that reads both has to know which way each gap runs.
  it('says the spec link declares what the index does not list, when operations are hidden', () => {
    const out = toLlmsText({ ...model, hiddenOperations: 3 }, options)
    expect(out).toContain(
      'the machine-readable contract as published — it declares 3 operation(s) this documentation does not list',
    )
  })

  it('states both gaps when the page both patches and hides', () => {
    const out = toLlmsText({ ...model, hiddenOperations: 3 }, { ...options, overlays: 2 })
    expect(out).toContain(
      'through 2 overlay(s) the file does not carry; it declares 3 operation(s)',
    )
  })

  it('leaves the spec link unqualified when nothing stands between it and the index', () => {
    expect(toLlmsText(model, options)).toContain(
      '- [OpenAPI specification](https://api.example.com/openapi.json): the machine-readable contract\n',
    )
  })

  it('omits what the document does not declare', () => {
    const bare = {
      sourceVersion: '3.0.3',
      info: { title: 'Bare', version: '' },
      operations: [],
      groups: [],
      webhooks: [],
    }
    const out = toLlmsText(bare, {})
    expect(out).toContain('# Bare')
    expect(out).not.toContain('Version ')
    expect(out).not.toContain('Base URL')
    expect(out).not.toContain('## Optional')
    expect(out).not.toContain('Authentication:')
    expect(out).not.toContain('OpenAPI specification')
    expect(out).not.toContain('## Guides')
  })
})
