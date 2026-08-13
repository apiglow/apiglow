import { describe, expect, it } from 'vitest'
import { toScenarioMarkdown } from '../src/export/scenario-markdown.js'
import { normalizeScenario } from '../src/scenarios/model.js'

// The workflow counterpart of `endpoint-markdown.test.js`: one scenario, one
// Markdown document (docs/scenario-handoff.md §3.1). The whole rendering is
// covered by the snapshot; the cases below pin the decisions a snapshot states
// without asserting.

const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    summary: 'Create a pet',
    parameters: [],
    requestBody: {
      contents: [
        { mediaType: 'application/json', schema: null },
        { mediaType: 'application/xml', schema: null },
      ],
    },
  },
  {
    id: 'get-pets-petid',
    operationId: null,
    method: 'get',
    path: '/pets/{petId}',
    summary: 'Read a pet',
    parameters: [{ name: 'petId', in: 'path', required: true }],
    requestBody: null,
  },
]

// Frozen scenario (stable step ids), like `scenario-exports.test.js`: the
// snapshot must be stable too.
const SCENARIO = normalizeScenario(
  {
    id: 'onboarding',
    name: 'Onboarding',
    description: 'Create a pet, then read it back.',
    inputs: { ownerName: 'Ada', 'auth.apiKey': 'sk-live-42' },
    steps: [
      {
        id: 'step-create',
        opId: 'createPet',
        note: 'First we create the pet.',
        request: {
          headers: [{ name: 'X-Key', value: '{{auth.apiKey}}' }],
          body: '{"name":"Rex","owner":"{{ownerName}}"}',
        },
        expect: { status: 201, assertions: [{ pointer: '/name', op: 'equals', value: 'Rex' }] },
        extract: [
          { name: 'petId', source: 'body', pointer: '/id' },
          { name: 'auth.session', source: 'header', pointer: 'X-Session', persist: true },
        ],
        timeout: 2500,
      },
      {
        id: 'step-read',
        opId: 'get-pets-petid',
        request: { path: { petId: '{{petId}}' }, query: { verbose: 'true', tags: ['cat', 'dog'] } },
        expect: { assertions: [{ pointer: '/id', op: 'exists' }] },
        continueOnFailure: true,
      },
    ],
  },
  { source: 'config', id: 'onboarding' },
).scenario

describe('toScenarioMarkdown', () => {
  it('full document: prerequisites, inputs, one section per step', () => {
    expect(
      toScenarioMarkdown(SCENARIO, { ops: OPS, baseUrl: 'https://api.example.com/v1/' }),
    ).toMatchSnapshot()
  })

  // The prerequisites panel of the scenario page and this document answer "why
  // would this fail" with the same computation, or the published page and the
  // page in the app disagree (§3.1).
  it('asks only for what no step produces and the scenario does not carry', () => {
    const markdown = toScenarioMarkdown(SCENARIO, { ops: OPS })
    // `petId` is extracted by step 1, `ownerName` and `auth.apiKey` are inputs.
    expect(markdown).not.toContain('- `{{petId}}`')
    expect(markdown).not.toContain('## Prerequisites')
  })

  it('lists a variable no step produces as a prerequisite', () => {
    const scenario = normalizeScenario({
      name: 'Read',
      steps: [{ opId: 'get-pets-petid', request: { path: { petId: '{{petId}}' } } }],
    }).scenario
    expect(toScenarioMarkdown(scenario, { ops: OPS })).toContain('- `{{petId}}`')
  })

  // Rule 12: an input is the one place the model holds a literal value, and
  // `auth.*` is the model's own name for a variable holding a credential.
  it('masks a credential carried as an input, and only that', () => {
    const markdown = toScenarioMarkdown(SCENARIO, { ops: OPS })
    expect(markdown).not.toContain('sk-live-42')
    expect(markdown).toContain('- `{{auth.apiKey}}` = `••••`')
    expect(markdown).toContain('- `{{ownerName}}` = `Ada`')
  })

  it('carries {{var}} literally', () => {
    const markdown = toScenarioMarkdown(SCENARIO, { ops: OPS })
    expect(markdown).toContain('{{auth.apiKey}}')
    expect(markdown).toContain('"owner":"{{ownerName}}"')
  })

  it('hands over the plain value when redaction is turned off', () => {
    expect(toScenarioMarkdown(SCENARIO, { ops: OPS, redact: false })).toContain(
      '- `{{auth.apiKey}}` = `sk-live-42`',
    )
  })

  it('states the default verdict rather than staying silent on it', () => {
    const scenario = normalizeScenario({
      name: 'Read',
      steps: [{ opId: 'get-pets-petid' }],
    }).scenario
    expect(toScenarioMarkdown(scenario, { ops: OPS })).toContain(
      '- Status in the `2xx` range (the default verdict)',
    )
  })

  it('names a step whose operation the document does not declare', () => {
    const scenario = normalizeScenario({ name: 'X', steps: [{ opId: 'gone' }] }).scenario
    const markdown = toScenarioMarkdown(scenario, { ops: OPS })
    expect(markdown).toContain('## Step 1 — gone')
    expect(markdown).toContain('> Operation `gone` is not declared in this API document.')
  })

  it('renders the body under the media type the step selected', () => {
    const scenario = normalizeScenario({
      name: 'XML',
      steps: [
        { opId: 'createPet', request: { body: '<pet><name>Rex</name></pet>', mediaTypeIndex: 1 } },
      ],
    }).scenario
    expect(toScenarioMarkdown(scenario, { ops: OPS })).toContain('Body (`application/xml`):')
  })

  it('does not break on an empty scenario', () => {
    expect(toScenarioMarkdown(normalizeScenario({ name: 'Empty' }).scenario, {})).toBe(
      '# Empty\n\n0 steps, run in order.\n',
    )
    expect(() => toScenarioMarkdown(null, {})).not.toThrow()
  })
})
