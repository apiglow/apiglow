import { describe, expect, it } from 'vitest'
import { CI_PLATFORMS, CI_RUNNERS, toCiSnippet } from '../src/export/ci.js'

// One workflow, one required input, one input carrying its own default — the
// three things a job has to get right: which workflow it runs, what it must be
// given, and what it must not ask for.
const document = {
  arazzo: '1.1.0',
  info: { title: 'Create a payment', version: '1.0.0' },
  sourceDescriptions: [
    { name: 'openapi', url: 'https://api.example.com/openapi.json', type: 'openapi' },
  ],
  workflows: [
    {
      workflowId: 'create-payment',
      inputs: {
        type: 'object',
        properties: {
          'auth.token': { type: 'string' },
          currency: { type: 'string', default: 'EUR' },
        },
        required: ['auth.token'],
      },
      steps: [{ stepId: 'create', operationId: '$sourceDescriptions.openapi.createPayment' }],
    },
  ],
}

const base = { name: 'Create a payment', scenarioId: 'create-payment' }

describe('CI hand-off', () => {
  it('writes a job for every runner on every platform', () => {
    for (const runner of CI_RUNNERS) {
      for (const platform of CI_PLATFORMS) {
        expect(
          toCiSnippet(document, { ...base, runnerId: runner.id, platform }).snippet,
        ).toMatchSnapshot(`${runner.id}/${platform}`)
      }
    }
  })

  // Rule 12, and the one thing this whole panel is not allowed to get wrong: a
  // job travels as a file in a repository, and a value in it is a leak.
  it('emits input names wired to the CI secret store, never a value', () => {
    for (const runner of CI_RUNNERS) {
      for (const platform of CI_PLATFORMS) {
        const { snippet, secrets } = toCiSnippet(document, {
          ...base,
          runnerId: runner.id,
          platform,
        })
        expect(secrets).toEqual([{ input: 'auth.token', env: 'AUTH_TOKEN' }])
        expect(snippet).toContain('AUTH_TOKEN')
        expect(snippet).toContain('$AUTH_TOKEN')
        // The input the document provides itself is not one the caller must.
        expect(snippet).not.toContain('EUR')
        expect(snippet).not.toContain('currency')
      }
    }
  })

  it('names the secrets of the GitHub store, and the variables to define on GitLab', () => {
    expect(toCiSnippet(document, { ...base, platform: 'github' }).snippet).toContain(
      `AUTH_TOKEN: \${{ secrets.AUTH_TOKEN }}`,
    )
    const gitlab = toCiSnippet(document, { ...base, platform: 'gitlab' })
    expect(gitlab.snippet).toContain('#   AUTH_TOKEN')
    expect(gitlab.file).toBe('.gitlab-ci.yml')
  })

  it('tells two inputs apart when they sanitize to the same variable name', () => {
    const { secrets } = toCiSnippet(withInputs(['api.key', 'api-key']), base)
    expect(secrets).toEqual([
      { input: 'api.key', env: 'API_KEY' },
      { input: 'api-key', env: 'API_KEY_2' },
    ])
  })

  it('takes the inputs without a default when the document declares no required list', () => {
    const doc = withInputs([])
    doc.workflows[0].inputs = {
      type: 'object',
      properties: { region: { type: 'string' }, page: { type: 'string', default: '1' } },
    }
    expect(toCiSnippet(doc, base).secrets).toEqual([{ input: 'region', env: 'REGION' }])
  })

  // The revision each project's own documentation claims is the only support
  // check that is not a guess: Respect states 1.0.1, and everything 1.1
  // introduced is named one line at a time.
  it('names the gap between the document revision and the runner', () => {
    const respect = CI_RUNNERS.find((runner) => runner.arazzo)
    const { warnings } = toCiSnippet(withSelectorOutput(), { ...base, runnerId: respect.id })
    expect(warnings).toContainEqual({
      code: 'version',
      runner: respect.name,
      supported: respect.arazzo,
      document: '1.1.0',
    })
    expect(warnings).toContainEqual({
      code: 'construct',
      construct: 'selectorOutputs',
      runner: respect.name,
    })
  })

  it('says a runner states no revision rather than assuming either answer', () => {
    const unstated = CI_RUNNERS.find((runner) => !runner.arazzo)
    const { warnings } = toCiSnippet(withSelectorOutput(), { ...base, runnerId: unstated.id })
    expect(warnings).toEqual([{ code: 'versionUnstated', runner: unstated.name }])
  })

  it('reads a 1.0.1 document without a word about the revision', () => {
    const older = { ...document, arazzo: '1.0.1' }
    const respect = CI_RUNNERS.find((runner) => runner.arazzo)
    expect(toCiSnippet(older, { ...base, runnerId: respect.id }).warnings).toEqual([])
  })

  // A declared Arazzo document is checked as it stands: it may say more than
  // this documentation executes, and more than the runner does.
  it('says when the document was written by its own author', () => {
    expect(toCiSnippet(document, { ...base, authored: true }).warnings).toContainEqual({
      code: 'authored',
    })
  })

  it('selects the workflow this scenario is, entry prefix included', () => {
    const many = {
      ...document,
      workflows: [
        { workflowId: 'list-pets', steps: [] },
        { ...document.workflows[0], workflowId: 'create-then-read' },
      ],
    }
    const direct = toCiSnippet(many, { ...base, scenarioId: 'create-then-read' })
    expect(direct.workflowId).toBe('create-then-read')
    expect(direct.warnings).not.toContainEqual(expect.objectContaining({ code: 'workflowGuessed' }))
    // The loader prefixes an id claimed twice with the entry that declared it.
    expect(toCiSnippet(many, { ...base, scenarioId: 'pets.create-then-read' }).workflowId).toBe(
      'create-then-read',
    )
    // An id derived rather than claimed: the job runs the first workflow, and
    // the panel says so instead of running a workflow nobody asked for silently.
    const guessed = toCiSnippet(many, { ...base, scenarioId: 'pets-2' })
    expect(guessed.workflowId).toBe('list-pets')
    expect(guessed.warnings).toContainEqual({ code: 'workflowGuessed', workflowId: 'list-pets' })
  })

  // The single-source case (docs/scenario-handoff.md §4): the file the author
  // owns is the file the job fetches, so nothing is committed and nothing has
  // to be kept in step.
  it('fetches the served document instead of a copy, keeping its extension', () => {
    const served = toCiSnippet(document, {
      ...base,
      url: 'https://docs.example.com/flows.arazzo.yaml',
    })
    expect(served.snippet).toContain(
      "curl -fsSL 'https://docs.example.com/flows.arazzo.yaml' -o scenario.arazzo.yaml",
    )
    expect(served.snippet).toContain('scenario.arazzo.yaml')
    // Nothing of the repository is read: there is no checkout at all.
    expect(served.snippet).not.toContain('actions/checkout')
    expect(
      toCiSnippet(document, { ...base, url: 'https://docs.example.com/flows' }).snippet,
    ).toContain('-o scenario.arazzo.json')
  })

  it('points at the committed path by default, and names it back to the panel', () => {
    const committed = toCiSnippet(document, base)
    expect(committed.documentPath).toBe('arazzo/create-a-payment.arazzo.json')
    expect(committed.snippet).toContain('arazzo/create-a-payment.arazzo.json')
    expect(committed.snippet).toContain('actions/checkout')
    expect(committed.file).toBe('.github/workflows/create-a-payment.yml')
  })

  it('falls back to the default runner on an unknown id', () => {
    expect(toCiSnippet(document, { ...base, runnerId: 'nope' }).snippet).toBe(
      toCiSnippet(document, { ...base, runnerId: CI_RUNNERS[0].id }).snippet,
    )
  })

  // A GitHub job id starts with a letter or an underscore; a scenario name is
  // free text and slugifies to whatever it slugifies to.
  it('keeps the job id valid whatever the scenario is called', () => {
    expect(toCiSnippet(document, { ...base, name: '2FA login' }).snippet).toContain(
      '  run-2fa-login:',
    )
  })
})

function withInputs(names) {
  return {
    ...document,
    workflows: [
      {
        ...document.workflows[0],
        inputs: {
          type: 'object',
          properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
          required: names,
        },
      },
    ],
  }
}

function withSelectorOutput() {
  return {
    ...document,
    workflows: [
      {
        ...document.workflows[0],
        steps: [
          {
            stepId: 'create',
            operationId: '$sourceDescriptions.openapi.createPayment',
            outputs: { id: { context: '$response.body', selector: '$.id', type: 'jsonpath' } },
          },
        ],
      },
    ],
  }
}
