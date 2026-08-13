import { describe, expect, it } from 'vitest'
import { toLlmsFullText } from '../src/export/llms-full.js'
import { bakedUrls } from '../src/export/site-layout.js'
import { normalizeScenario } from '../src/scenarios/model.js'

// Minimal but representative model: info with description, two operations
// (one without a summary), Markdown pages — the snapshot pins down the full
// structure of the file (header, separators, order).
const model = {
  sourceVersion: '3.1.0',
  info: {
    title: 'Petstore',
    version: '2.0.0',
    description: 'A sample API.\n\nManage your pets.',
  },
  operations: [
    {
      id: 'listPets',
      method: 'get',
      path: '/pets',
      summary: 'List pets',
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { kind: 'primitive', type: 'integer', maximum: 100 },
        },
      ],
      requestBody: null,
      responses: [
        {
          status: '200',
          description: 'A list of pets',
          headers: [],
          contents: [
            {
              mediaType: 'application/json',
              schema: {
                kind: 'array',
                items: {
                  kind: 'object',
                  properties: [
                    { name: 'id', required: true, schema: { kind: 'primitive', type: 'integer' } },
                  ],
                },
              },
              examples: [],
            },
          ],
        },
      ],
    },
    {
      id: 'delete-pets-petid',
      method: 'delete',
      path: '/pets/{petId}',
      summary: '',
      parameters: [
        {
          name: 'petId',
          in: 'path',
          required: true,
          schema: { kind: 'primitive', type: 'integer' },
        },
      ],
      requestBody: null,
      responses: [{ status: '204', description: 'Deleted', headers: [], contents: [] }],
    },
  ],
}

// Two declared scenarios (docs/scenario-handoff.md §3.3), one per emission
// mode: the first is written in our envelope and its recipe is generated from
// the schema URL, the second is an Arazzo document its author wrote and which
// is published as it stands.
const DECLARED_ARAZZO = {
  arazzo: '1.1.0',
  info: { title: 'Cleanup', version: '3.2.0' },
  sourceDescriptions: [
    { name: 'petstore', url: 'https://ci.example.com/spec.yaml', type: 'openapi' },
  ],
  workflows: [
    {
      workflowId: 'cleanup',
      steps: [
        {
          stepId: 'drop',
          operationId: 'delete-pets-petid',
          parameters: [{ name: 'petId', in: 'path', value: '$inputs.petId' }],
        },
      ],
    },
  ],
}

const scenarios = [
  {
    id: 'adopt',
    title: 'Adopt a pet',
    scenario: normalizeScenario({
      name: 'Adopt a pet',
      steps: [
        {
          id: 'step-list',
          opId: 'listPets',
          note: 'Find one that is still available.',
          request: { query: { limit: '{{pageSize}}' } },
          extract: [{ name: 'petId', source: 'body', pointer: '/0/id' }],
        },
      ],
    }).scenario,
    arazzo: null,
  },
  {
    id: 'cleanup',
    title: 'Cleanup — Remove a pet',
    scenario: normalizeScenario({
      name: 'Remove a pet',
      steps: [
        { id: 'step-drop', opId: 'delete-pets-petid', request: { path: { petId: '{{petId}}' } } },
      ],
    }).scenario,
    arazzo: DECLARED_ARAZZO,
  },
]

describe('llms-full.txt export', () => {
  it('concatenates info, pages, workflows and operations with separators', () => {
    expect(
      toLlmsFullText(model, {
        baseUrl: 'https://api.example.com/v1/',
        pages: [{ title: 'Guides', content: '# Getting started\n\nRead this first.\n' }],
        scenarios,
        specUrl: 'https://api.example.com/openapi.json',
      }),
    ).toMatchSnapshot()
  })

  // The order of the map (§3.3): a workflow reads as the guide to a sequence of
  // endpoints, and the endpoints it names come after it.
  it('places the workflows after the pages and before the operations', () => {
    const out = toLlmsFullText(model, {
      pages: [{ title: 'Guides', content: '# Getting started\n' }],
      scenarios,
      specUrl: 'https://api.example.com/openapi.json',
    })
    expect(out.indexOf('# Page: Guides')).toBeLessThan(out.indexOf('# Workflow: Adopt a pet'))
    expect(out.indexOf('# Workflow: Adopt a pet')).toBeLessThan(out.indexOf('# List pets'))
  })

  // Doctrine §2: `sourceDescriptions` generated from an inline schema names a
  // document no runner can fetch, so no recipe is emitted — while a declared
  // one carries its own and was runnable before we read it.
  it('generates no recipe without a schema URL, and publishes a declared one anyway', () => {
    const out = toLlmsFullText(model, { scenarios })
    expect(out).toContain('# Workflow: Adopt a pet')
    expect(out).not.toContain('"$inputs.pageSize"')
    expect(out).toContain('"url": "https://ci.example.com/spec.yaml"')
    expect(out.match(/## Arazzo recipe/g)).toHaveLength(1)
  })

  // The authored document travels whole, whatever we made of it: what is
  // published is the file its author owns, not our reading of it.
  it('serializes a declared Arazzo document as JSON, as it stands', () => {
    const out = toLlmsFullText(model, { scenarios: [scenarios[1]] })
    expect(out).toContain(JSON.stringify(DECLARED_ARAZZO, null, 2))
  })

  it('stays valid without pages or base URL', () => {
    const out = toLlmsFullText(model)
    expect(out).toContain('# Petstore')
    expect(out).not.toContain('Base URL')
    expect(out).not.toContain('# Page:')
    expect(out).not.toContain('# Workflow:')
    expect(out.trim().endsWith('```')).toBe(false)
  })

  // docs/seo.md §4: an agent answering out of this file holds the whole
  // documentation and not one address to cite — the baked install is the only
  // one that has any, so the lines appear with the mapper and never without.
  it('names the page each section was baked to, when there is one', () => {
    const urls = bakedUrls('https://docs.example.com/api/index.html', { ext: 'html' })
    const out = toLlmsFullText(model, {
      pages: [{ slug: 'getting-started', title: 'Guides', content: '# Getting started\n' }],
      scenarios,
      urls,
    })
    expect(out).toContain(
      '# Page: Guides\n\nSource: https://docs.example.com/api/page/getting-started.html',
    )
    expect(out).toContain(
      '# Workflow: Adopt a pet\n\nSource: https://docs.example.com/api/scenario/adopt.html',
    )
    expect(out).toContain('# List pets\n\nSource: https://docs.example.com/api/op/listPets.html')
    expect(toLlmsFullText(model, { scenarios })).not.toContain('Source:')
  })

  it('adds webhooks after the operations', () => {
    const withWebhook = {
      ...model,
      webhooks: [
        {
          id: 'webhook-post-petadopted',
          kind: 'webhook',
          name: 'petAdopted',
          method: 'post',
          path: 'petAdopted',
          summary: 'Pet adopted',
          parameters: [],
          requestBody: null,
          responses: [],
        },
      ],
    }
    const out = toLlmsFullText(withWebhook)
    expect(out).toContain('# Webhook: Pet adopted')
    // Webhooks come after the last operation.
    expect(out.indexOf('# Webhook:')).toBeGreaterThan(out.indexOf('/pets/{petId}'))
  })
})
