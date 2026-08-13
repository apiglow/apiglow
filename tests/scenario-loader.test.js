import { describe, expect, it } from 'vitest'
import { loadConfigScenarios } from '../src/scenarios/loader.js'

// The declared-scenario loader (docs/scenarios.md §3): two formats × two
// carriers, and the ids the routes use. The format is never declared — every
// case below hands the loader the same kind of entry and lets the document
// say what it is.

const OPS = [
  { id: 'createPet', operationId: 'createPet', method: 'post', path: '/pets', requestBody: null },
  {
    id: 'get-pets-petid',
    operationId: 'getPet',
    method: 'get',
    path: '/pets/{petId}',
    requestBody: null,
  },
]

const ENVELOPE = {
  format: 'apiglow-scenario',
  v: 1,
  scenario: {
    name: 'Onboarding',
    description: 'Create a pet, then read it back.',
    steps: [{ id: 'step-create', opId: 'createPet' }],
  },
}

const arazzo = (workflows, extra = {}) => ({
  arazzo: '1.1.0',
  info: { title: 'Pet flows', version: '1.0.0' },
  sourceDescriptions: [{ name: 'petstore', url: 'https://api.test/openapi.json', type: 'openapi' }],
  workflows,
  ...extra,
})

const WORKFLOWS = [
  {
    workflowId: 'create-pet',
    summary: 'Create a pet',
    steps: [{ stepId: 'a', operationId: 'createPet' }],
  },
  {
    workflowId: 'read-pet',
    summary: 'Read a pet',
    steps: [{ stepId: 'b', operationId: 'getPet' }],
  },
]

// The carrier under test is the entry's, so the fetch is a fixture: a map of
// url → text, and anything else rejects the way the network would.
const fetcher = (files) => (url) =>
  url in files ? Promise.resolve(files[url]) : Promise.reject(new Error(`HTTP 404 ${url}`))

const load = (entries, files = {}) =>
  loadConfigScenarios(
    entries.map((entry) => ({ title: '', url: '', document: null, pinned: false, ...entry })),
    { ops: OPS, fetchText: fetcher(files) },
  )

describe('loadConfigScenarios — formats', () => {
  it('reads our envelope from a fetched file, under the entry id', async () => {
    const records = await load([{ id: 'onboarding', title: 'Onboarding', url: '/s/on.json' }], {
      '/s/on.json': JSON.stringify(ENVELOPE),
    })
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('onboarding')
    expect(records[0].title).toBe('Onboarding')
    expect(records[0].scenario.source).toBe('config')
    expect(records[0].scenario.name).toBe('Onboarding')
    expect(records[0].warnings).toEqual([])
    expect(records[0].error).toBe(null)
  })

  it('sniffs an Arazzo document and declares one scenario per workflow', async () => {
    const records = await load([{ id: 'flows', title: 'Flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(arazzo(WORKFLOWS)),
    })
    expect(records.map((record) => record.id)).toEqual(['create-pet', 'read-pet'])
    // A declared title names one scenario, not two: each workflow keeps its
    // own name, prefixed by the document's.
    expect(records.map((record) => record.title)).toEqual([
      'Pet flows — Create a pet',
      'Pet flows — Read a pet',
    ])
    expect(records.every((record) => record.scenario.source === 'config')).toBe(true)
    expect(records[0].entryId).toBe('flows')
  })

  it('lets the declared title name a document holding a single workflow', async () => {
    const records = await load([{ id: 'flows', title: 'Flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(arazzo([WORKFLOWS[0]])),
    })
    expect(records.map((record) => [record.id, record.title])).toEqual([['create-pet', 'Flows']])
  })

  it('reads an Arazzo document written in YAML', async () => {
    const yaml = [
      'arazzo: 1.1.0',
      'info:',
      '  title: Pet flows',
      '  version: 1.0.0',
      'workflows:',
      '  - workflowId: create-pet',
      '    summary: Create a pet',
      '    steps:',
      '      - stepId: a',
      '        operationId: createPet',
    ].join('\n')
    const records = await load([{ id: 'flows', url: '/s/flows.yaml' }], {
      '/s/flows.yaml': yaml,
    })
    expect(records.map((record) => record.id)).toEqual(['create-pet'])
    expect(records[0].scenario.steps.map((step) => step.opId)).toEqual(['createPet'])
  })
})

describe('loadConfigScenarios — carriers', () => {
  it('takes the document straight from the config, with no fetch', async () => {
    const records = await loadConfigScenarios(
      [{ id: 'flows', title: '', url: '', document: arazzo(WORKFLOWS), pinned: true }],
      {
        ops: OPS,
        fetchText: () => Promise.reject(new Error('the carried document must not be fetched')),
      },
    )
    expect(records.map((record) => record.id)).toEqual(['create-pet', 'read-pet'])
    expect(records.every((record) => record.pinned)).toBe(true)
  })

  it('takes a carried envelope too — the two axes are independent', async () => {
    const records = await load([{ id: 'onboarding', document: ENVELOPE }])
    expect(records.map((record) => record.id)).toEqual(['onboarding'])
    expect(records[0].scenario.steps).toHaveLength(1)
  })

  it('keeps a record for an unreachable file, so the route can say so', async () => {
    const records = await load([{ id: 'gone', title: 'Gone', url: '/s/gone.json' }])
    expect(records).toHaveLength(1)
    expect(records[0].scenario).toBe(null)
    expect(records[0].error.code).toBe('scenario-unreachable')
    expect(records[0].title).toBe('Gone')
  })

  it('keeps a record for a file that is not a scenario at all', async () => {
    const records = await load([{ id: 'nope', url: '/s/nope.json' }], {
      '/s/nope.json': JSON.stringify({ openapi: '3.1.0' }),
    })
    expect(records[0].scenario).toBe(null)
    expect(records[0].error.code).toBe('file-format-unknown')
  })
})

describe('loadConfigScenarios — identifiers', () => {
  it('disambiguates two documents claiming the same workflowId by their entry', async () => {
    const workflow = {
      workflowId: 'create-pet',
      steps: [{ stepId: 'a', operationId: 'createPet' }],
    }
    const records = await load(
      [
        { id: 'first', url: '/s/a.json' },
        { id: 'second', url: '/s/b.json' },
      ],
      {
        '/s/a.json': JSON.stringify(arazzo([workflow])),
        '/s/b.json': JSON.stringify(arazzo([workflow])),
      },
    )
    // First claimant keeps the bare id: declaration order decides, and reading
    // the config is enough to know which route is which.
    expect(records.map((record) => record.id)).toEqual(['create-pet', 'second.create-pet'])
  })

  it('never lets a workflow take the route of another entry', async () => {
    const records = await load(
      [
        { id: 'onboarding', url: '/s/flows.json' },
        { id: 'create-pet', url: '/s/on.json' },
      ],
      {
        '/s/flows.json': JSON.stringify(arazzo([WORKFLOWS[0]])),
        '/s/on.json': JSON.stringify(ENVELOPE),
      },
    )
    expect(records.map((record) => record.id)).toEqual(['onboarding.create-pet', 'create-pet'])
  })

  it('leaves a workflow named after its own entry where it is', async () => {
    const records = await load([{ id: 'create-pet', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(arazzo([WORKFLOWS[0]])),
    })
    expect(records.map((record) => record.id)).toEqual(['create-pet'])
  })

  it('falls back on the entry when a workflowId cannot be a route', async () => {
    const records = await load([{ id: 'flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(
        arazzo([
          { workflowId: 'create a pet', steps: [{ stepId: 'a', operationId: 'createPet' }] },
        ]),
      ),
    })
    expect(records.map((record) => record.id)).toEqual(['flows-1'])
  })
})

describe('loadConfigScenarios — degraded rendering', () => {
  // The rule this phase turns on: a workflow this app cannot fully execute is
  // rendered anyway, and what it cannot execute is named.
  it('keeps a partially supported workflow and names what it cannot run', async () => {
    const records = await load([{ id: 'flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(
        arazzo([
          {
            workflowId: 'create-pet',
            steps: [
              {
                stepId: 'a',
                operationId: 'createPet',
                onFailure: [{ name: 'retry', type: 'retry' }],
              },
              { stepId: 'b', action: 'receive', channelPath: '/pets/events' },
            ],
          },
        ]),
      ),
    })
    expect(records).toHaveLength(1)
    expect(records[0].scenario.steps.map((step) => step.opId)).toEqual(['createPet'])
    expect(records[0].warnings.map((warning) => warning.code)).toEqual([
      'arazzo-step-actions',
      'arazzo-step-asyncapi',
    ])
  })

  // The loaded model wins: a document written for CI names its own sources,
  // and the operations resolve against the schema in front of the reader.
  it('flags a step that names one source among several', async () => {
    const records = await load([{ id: 'flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(
        arazzo(
          [
            {
              workflowId: 'create-pet',
              steps: [{ stepId: 'a', operationId: '$sourceDescriptions.prod.createPet' }],
            },
          ],
          {
            sourceDescriptions: [
              { name: 'prod', url: 'https://api.test/openapi.json', type: 'openapi' },
              { name: 'staging', url: 'https://staging.test/openapi.json', type: 'openapi' },
            ],
          },
        ),
      ),
    })
    expect(records[0].warnings).toContainEqual({
      code: 'arazzo-source-ambiguous',
      stepId: 'a',
      source: 'prod',
    })
    expect(records[0].scenario.steps.map((step) => step.opId)).toEqual(['createPet'])
  })

  it('carries the document warnings onto every scenario it declares', async () => {
    const records = await load([{ id: 'flows', url: '/s/flows.json' }], {
      '/s/flows.json': JSON.stringify(
        arazzo([
          {
            workflowId: 'a',
            outputs: { done: '$steps.a.outputs.x' },
            steps: [{ stepId: 'a', operationId: 'createPet' }],
          },
          { workflowId: 'b', steps: [{ stepId: 'b', operationId: 'getPet' }] },
        ]),
      ),
    })
    expect(records).toHaveLength(2)
    for (const record of records) {
      expect(record.warnings.map((warning) => warning.code)).toEqual(['arazzo-workflow-outputs'])
    }
  })

  // Non-fatal discrepancies in our own envelope travel the same way: the
  // reader sees that a step is missing rather than a shorter scenario.
  it('reports what an envelope file lost without discarding it', async () => {
    const records = await load([{ id: 'onboarding', url: '/s/on.json' }], {
      '/s/on.json': JSON.stringify({
        ...ENVELOPE,
        scenario: { ...ENVELOPE.scenario, steps: [{ id: 'orphan' }, { id: 'ok', opId: 'getPet' }] },
      }),
    })
    expect(records[0].scenario.steps.map((step) => step.opId)).toEqual(['getPet'])
    expect(records[0].warnings).toEqual([{ code: 'step-op-missing', index: 0 }])
  })
})
