import { describe, expect, it } from 'vitest'
import { toArazzo } from '../src/export/arazzo.js'
import { isArazzoDocument, parseArazzo } from '../src/import/arazzo.js'
import { normalizeScenario } from '../src/scenarios/model.js'

// Arazzo 1.1 → scenarios (docs/openapi-coverage.md §4.7). The operation list
// comes in as data: this module resolves references, it never sees a model.

const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    requestBody: { contents: [{ mediaType: 'application/json', schema: null }] },
  },
  {
    id: 'get-pets-petid',
    operationId: null,
    method: 'get',
    path: '/pets/{petId}',
    requestBody: null,
  },
  {
    id: 'uploadPetPhoto',
    operationId: 'uploadPetPhoto',
    method: 'post',
    path: '/pets/{petId}/photo',
    requestBody: {
      contents: [{ mediaType: 'multipart/form-data', schema: { kind: 'object' } }],
    },
  },
]

const doc = (steps, workflow = {}) => ({
  arazzo: '1.0.1',
  info: { title: 'Flow', version: '1.0.0' },
  sourceDescriptions: [{ name: 'openapi', url: 'https://api.test/openapi.json', type: 'openapi' }],
  workflows: [{ workflowId: 'flow', summary: 'A flow', steps, ...workflow }],
})

const parse = (document) => parseArazzo(document, { ops: OPS })

const one = (document) => {
  const result = parse(document)
  expect(result.errors).toEqual([])
  expect(result.scenarios).toHaveLength(1)
  return result
}

const firstStep = (document) => one(document).scenarios[0].steps[0]

const codes = (result) => result.warnings.map((warning) => warning.code)

describe('parseArazzo — document', () => {
  it('recognizes a workflow document by its version field', () => {
    expect(isArazzoDocument({ arazzo: '1.0.1' })).toBe(true)
    expect(isArazzoDocument({ format: 'apiglow-scenario' })).toBe(false)
    expect(isArazzoDocument(null)).toBe(false)
  })

  it('turns each workflow into a scenario of its own', () => {
    const result = parseArazzo(
      {
        arazzo: '1.0.1',
        workflows: [
          { workflowId: 'a', summary: 'First', description: 'One', steps: [] },
          { workflowId: 'b', steps: [] },
        ],
      },
      { ops: OPS },
    )
    expect(result.scenarios.map((scenario) => scenario.name)).toEqual(['First', 'b'])
    expect(result.scenarios[0].description).toBe('One')
    expect(result.scenarios[0].source).toBe('local')
  })

  it('rejects what is not an Arazzo document, and one with no workflow', () => {
    expect(parse({ openapi: '3.1.0' }).errors).toEqual([{ code: 'arazzo-invalid' }])
    expect(parse({ arazzo: '1.0.1', workflows: [] }).errors).toEqual([
      { code: 'arazzo-no-workflow' },
    ])
  })

  it('reads an unknown revision anyway and names it', () => {
    const result = parse({ arazzo: '2.0.0', workflows: [{ workflowId: 'a', steps: [] }] })
    expect(codes(result)).toContain('arazzo-version-unknown')
    expect(result.scenarios).toHaveLength(1)
  })

  it('takes a 1.1 document without a word, like a 1.0 one', () => {
    for (const version of ['1.0.1', '1.1.0', '1.1']) {
      const result = parse({ arazzo: version, workflows: [{ workflowId: 'a', steps: [] }] })
      expect(codes(result)).toEqual([])
      expect(result.scenarios).toHaveLength(1)
    }
  })
})

// 1.1 lets a step describe an AsyncAPI message instead of an HTTP call. There
// is no transport for it in a browser, so the degradation is deliberate — what
// matters is that the step is named rather than called malformed.
describe('parseArazzo — AsyncAPI steps', () => {
  it('names an AsyncAPI step and imports the HTTP ones around it', () => {
    const result = one(
      doc([
        { stepId: 'create', operationId: 'createPet' },
        {
          stepId: 'await-event',
          action: 'receive',
          channelPath: '{$sourceDescriptions.events.url}#/channels/petCreated',
          correlationId: '$message.header#/correlationId',
        },
        { stepId: 'read', operationId: '$sourceDescriptions.openapi.createPet' },
      ]),
    )
    expect(result.scenarios[0].steps.map((step) => step.opId)).toEqual(['createPet', 'createPet'])
    expect(result.warnings).toEqual([
      {
        code: 'arazzo-step-asyncapi',
        stepId: 'await-event',
        channel: '{$sourceDescriptions.events.url}#/channels/petCreated',
        action: 'receive',
      },
    ])
  })
})

// Fields Arazzo 1.1 defines that an importer could walk past without a word.
// A document that imports while saying less than the file said is the failure
// this whole module is built against.
describe('parseArazzo — fields that used to be silent', () => {
  it('qualifies scenario names with the document title, but only when it disambiguates', () => {
    const many = parseArazzo(
      {
        arazzo: '1.1.0',
        info: { title: 'Petstore flows', version: '1.0.0' },
        workflows: [
          { workflowId: 'a', summary: 'Create', steps: [] },
          { workflowId: 'b', summary: 'Read', steps: [] },
        ],
      },
      { ops: OPS },
    )
    expect(many.scenarios.map((s) => s.name)).toEqual([
      'Petstore flows — Create',
      'Petstore flows — Read',
    ])
    // One workflow has nothing to be told apart from.
    const one = parseArazzo(
      {
        arazzo: '1.1.0',
        info: { title: 'Petstore flows', version: '1.0.0' },
        workflows: [{ workflowId: 'a', summary: 'Create', steps: [] }],
      },
      { ops: OPS },
    )
    expect(one.scenarios[0].name).toBe('Create')
  })

  it('names an ambiguous source description, and stays quiet when there is one', () => {
    const withSources = (sourceDescriptions) =>
      parseArazzo(
        {
          arazzo: '1.1.0',
          sourceDescriptions,
          workflows: [
            {
              workflowId: 'flow',
              steps: [{ stepId: 'create', operationId: '$sourceDescriptions.openapi.createPet' }],
            },
          ],
        },
        { ops: OPS },
      )
    expect(codes(withSources([{ name: 'openapi', url: 'a', type: 'openapi' }]))).toEqual([])
    const two = withSources([
      { name: 'openapi', url: 'a', type: 'openapi' },
      { name: 'billing', url: 'b', type: 'openapi' },
    ])
    expect(two.warnings).toEqual([
      { code: 'arazzo-source-ambiguous', stepId: 'create', source: 'openapi' },
    ])
    // Named, not dropped: the step still resolves against the loaded schema.
    expect(two.scenarios[0].steps[0].opId).toBe('createPet')
  })

  it('flags workflow-level success and failure actions, like the step-level pair', () => {
    const result = one(
      doc([{ stepId: 'create', operationId: 'createPet' }], {
        successActions: [{ name: 'go', type: 'goto', stepId: 'other' }],
      }),
    )
    expect(codes(result)).toEqual(['arazzo-workflow-actions'])
    expect(result.scenarios[0].steps).toHaveLength(1)
  })

  it('accepts a dependsOn a sequential run already satisfies, and flags one it cannot', () => {
    const result = one(
      doc([
        { stepId: 'create', operationId: 'createPet' },
        { stepId: 'read', operationId: 'createPet', dependsOn: ['create'] },
        { stepId: 'late', operationId: 'createPet', dependsOn: ['read', 'never-run'] },
        { stepId: 'ahead', operationId: 'createPet', dependsOn: ['unreached'] },
        { stepId: 'unreached', operationId: 'createPet' },
      ]),
    )
    // 'read' depends on a step that already ran: nothing to say.
    expect(result.warnings).toEqual([
      { code: 'arazzo-step-depends-on', stepId: 'late', unmet: ['never-run'] },
      { code: 'arazzo-step-depends-on', stepId: 'ahead', unmet: ['unreached'] },
    ])
    expect(result.scenarios[0].steps).toHaveLength(5)
  })

  // A named field is an honoured field: no warning, the value is on the step.
  it('carries a step timeout onto the step', () => {
    const result = one(doc([{ stepId: 'create', operationId: 'createPet', timeout: 5000 }]))
    expect(result.warnings).toEqual([])
    expect(result.scenarios[0].steps[0].timeout).toBe(5000)
  })

  it('refuses a timeout that is not a positive integer of milliseconds', () => {
    const result = one(doc([{ stepId: 'create', operationId: 'createPet', timeout: '5s' }]))
    expect(result.warnings).toEqual([
      { code: 'arazzo-step-rejected', reason: 'step-timeout-invalid', index: 0 },
    ])
    // Named, never fatal: the step is imported without the deadline.
    expect(result.scenarios[0].steps[0].timeout).toBeUndefined()
  })

  it('says nothing about $self, which changes no reading we perform', () => {
    const result = one({
      arazzo: '1.1.0',
      $self: 'https://api.test/flows.yaml',
      workflows: [{ workflowId: 'a', summary: 'A', steps: [] }],
    })
    expect(result.warnings).toEqual([])
  })
})

describe('parseArazzo — operation references', () => {
  it('resolves an operationId through its source description prefix', () => {
    const step = firstStep(
      doc([{ stepId: 'create', operationId: '$sourceDescriptions.openapi.createPet' }]),
    )
    expect(step.opId).toBe('createPet')
  })

  it('resolves an operationPath pointer to the internal id', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'read',
          operationPath: '{$sourceDescriptions.openapi.url}#/paths/~1pets~1{petId}/get',
        },
      ]),
    )
    expect(step.opId).toBe('get-pets-petid')
  })

  it('keeps a step whose operationId resolves nowhere — the view badges it', () => {
    const result = one(doc([{ stepId: 'x', operationId: 'deletePet' }]))
    expect(result.scenarios[0].steps[0].opId).toBe('deletePet')
    expect(codes(result)).toEqual(['arazzo-operation-unknown'])
  })

  it('drops a step whose operationPath resolves nowhere: a pointer is not an id', () => {
    const result = parse(
      doc([
        { stepId: 'x', operationPath: '{$sourceDescriptions.openapi.url}#/paths/~1orders/get' },
      ]),
    )
    expect(result.scenarios[0].steps).toEqual([])
    expect(codes(result)).toContain('arazzo-operation-unknown')
  })

  it('drops a step that calls another workflow, and says which', () => {
    const result = parse(doc([{ stepId: 'nested', workflowId: 'other' }]))
    expect(result.scenarios[0].steps).toEqual([])
    expect(result.warnings).toEqual([
      { code: 'arazzo-step-workflow', stepId: 'nested', workflowId: 'other' },
    ])
  })
})

describe('parseArazzo — request', () => {
  it('places parameters by location and turns expressions into variables', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'petId', in: 'path', value: '$steps.create.outputs.petId' },
            { name: 'verbose', in: 'query', value: 'true' },
            { name: 'X-Trace', in: 'header', value: 'run-{$inputs.traceId}' },
            { name: 'session', in: 'cookie', value: '$inputs.session' },
          ],
        },
      ]),
    )
    expect(step.request.path).toEqual({ petId: '{{petId}}' })
    expect(step.request.query).toEqual({ verbose: 'true' })
    expect(step.request.headers).toEqual([{ name: 'X-Trace', value: 'run-{{traceId}}' }])
    expect(step.request.cookie).toEqual({ session: '{{session}}' })
  })

  it('maps `in: querystring` onto the whole-query-string value', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'filter', in: 'querystring', value: 'a=1&b=2' },
            { name: 'verbose', in: 'query', value: 'true' },
          ],
        },
      ]),
    )
    expect(step.request.queryString).toBe('a=1&b=2')
    expect(step.request.query).toEqual({ verbose: 'true' })
  })

  // "applicable for all steps described under this workflow … can be
  // overridden at the step level but cannot be removed there".
  it('applies workflow-level parameters to every step, the step overriding', () => {
    const result = one(
      doc(
        [
          { stepId: 'a', operationId: 'createPet' },
          {
            stepId: 'b',
            operationId: 'createPet',
            parameters: [
              { name: 'X-Key', in: 'header', value: 'step-key' },
              { name: 'page', in: 'query', value: '2' },
            ],
          },
        ],
        {
          parameters: [
            { name: 'X-Key', in: 'header', value: 'workflow-key' },
            { name: 'trace', in: 'query', value: 'on' },
          ],
        },
      ),
    )
    const [a, b] = result.scenarios[0].steps
    expect(a.request.headers).toEqual([{ name: 'X-Key', value: 'workflow-key' }])
    expect(a.request.query).toEqual({ trace: 'on' })
    // The step wins on its own name, and inherits the rest — "cannot be
    // removed there".
    expect(b.request.headers).toEqual([{ name: 'X-Key', value: 'step-key' }])
    expect(b.request.query).toEqual({ trace: 'on', page: '2' })
    expect(result.warnings).toEqual([])
  })

  it('overrides on the name AND the location, not on the name alone', () => {
    const step = firstStep(
      doc(
        [
          {
            stepId: 'a',
            operationId: 'createPet',
            parameters: [{ name: 'token', in: 'query', value: 'q' }],
          },
        ],
        { parameters: [{ name: 'token', in: 'header', value: 'h' }] },
      ),
    )
    expect(step.request.headers).toEqual([{ name: 'token', value: 'h' }])
    expect(step.request.query).toEqual({ token: 'q' })
  })

  it('lets a step override the workflow query string without calling it a duplicate', () => {
    const step = firstStep(
      doc(
        [
          {
            stepId: 'a',
            operationId: 'createPet',
            parameters: [{ name: 'filter', in: 'querystring', value: 'step=1' }],
          },
        ],
        { parameters: [{ name: 'filter', in: 'querystring', value: 'workflow=1' }] },
      ),
    )
    expect(step.request.queryString).toBe('step=1')
  })

  it('does not leak one workflow parameters into another', () => {
    const result = parseArazzo(
      {
        arazzo: '1.1.0',
        workflows: [
          {
            workflowId: 'a',
            summary: 'A',
            parameters: [{ name: 'X-Key', in: 'header', value: 'only-a' }],
            steps: [{ stepId: 's', operationId: 'createPet' }],
          },
          {
            workflowId: 'b',
            summary: 'B',
            steps: [{ stepId: 's', operationId: 'createPet' }],
          },
        ],
      },
      { ops: OPS },
    )
    expect(result.scenarios[0].steps[0].request.headers).toEqual([
      { name: 'X-Key', value: 'only-a' },
    ])
    expect(result.scenarios[1].steps[0].request.headers).toEqual([])
  })

  it('keeps the first of two query strings and says there was a second', () => {
    const result = one(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'filter', in: 'querystring', value: 'a=1' },
            { name: 'other', in: 'querystring', value: 'b=2' },
          ],
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].request.queryString).toBe('a=1')
    expect(result.warnings).toEqual([
      { code: 'arazzo-querystring-extra', stepId: 'read', name: 'other' },
    ])
  })

  // `$self` (1.1) is a base for relative references, not a value: nothing one
  // loaded document can resolve against another. It lands where every unknown
  // runtime expression lands, quoted rather than swallowed.
  it('names a $self-rooted expression instead of sending it as a value', () => {
    const result = one(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [{ name: 'ref', in: 'query', value: '$self' }],
        },
      ]),
    )
    expect(result.warnings).toEqual([
      { code: 'arazzo-expression-unsupported', stepId: 'read', expression: '$self' },
    ])
  })

  it('names a parameter it cannot place instead of guessing one', () => {
    const result = one(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'petId', value: '1' },
            // A reference into a map we do not index: still refused, and
            // refused for being unresolvable rather than for being a
            // reference.
            { reference: '$components.inputs.limit' },
          ],
        },
      ]),
    )
    expect(codes(result)).toEqual(['arazzo-parameter-in', 'arazzo-parameter-reference'])
    expect(result.scenarios[0].steps[0].request.query).toEqual({})
  })

  // A Reusable Object names something the same document carries: refusing it
  // was a property of this reader, not of the file.
  it('resolves a parameter reference into the document own components', () => {
    const withComponents = (components, parameters) =>
      parseArazzo(
        {
          arazzo: '1.1.0',
          components,
          workflows: [
            {
              workflowId: 'flow',
              summary: 'A flow',
              steps: [{ stepId: 'read', operationId: 'createPet', parameters }],
            },
          ],
        },
        { ops: OPS },
      )

    const resolved = withComponents(
      { parameters: { limit: { name: 'limit', in: 'query', value: '10' } } },
      [{ reference: '$components.parameters.limit' }],
    )
    expect(resolved.warnings).toEqual([])
    expect(resolved.scenarios[0].steps[0].request.query).toEqual({ limit: '10' })

    // "Sets a value of the referenced parameter": the Reusable Object's own
    // value wins.
    const overridden = withComponents(
      { parameters: { limit: { name: 'limit', in: 'query', value: '10' } } },
      [{ reference: '$components.parameters.limit', value: '50' }],
    )
    expect(overridden.scenarios[0].steps[0].request.query).toEqual({ limit: '50' })

    // The referenced value goes through the same expression translation as an
    // inline one.
    const templated = withComponents(
      { parameters: { key: { name: 'X-Key', in: 'header', value: '$inputs.apiKey' } } },
      [{ reference: '$components.parameters.key' }],
    )
    expect(templated.scenarios[0].steps[0].request.headers).toEqual([
      { name: 'X-Key', value: '{{apiKey}}' },
    ])
  })

  it('separates a reference we do not follow from one that leads nowhere', () => {
    const missing = parseArazzo(
      {
        arazzo: '1.1.0',
        components: { parameters: { other: { name: 'other', in: 'query', value: '1' } } },
        workflows: [
          {
            workflowId: 'flow',
            summary: 'A flow',
            steps: [
              {
                stepId: 'read',
                operationId: 'createPet',
                parameters: [{ reference: '$components.parameters.absent' }],
              },
            ],
          },
        ],
      },
      { ops: OPS },
    )
    expect(missing.warnings).toEqual([
      {
        code: 'arazzo-reference-unknown',
        stepId: 'read',
        reference: '$components.parameters.absent',
      },
    ])
    // Named, never fatal: the step is still there.
    expect(missing.scenarios[0].steps).toHaveLength(1)
  })

  it('does not follow a chained reference', () => {
    const chained = parseArazzo(
      {
        arazzo: '1.1.0',
        components: {
          parameters: {
            a: { reference: '$components.parameters.b' },
            b: { name: 'limit', in: 'query', value: '10' },
          },
        },
        workflows: [
          {
            workflowId: 'flow',
            summary: 'A flow',
            steps: [
              {
                stepId: 'read',
                operationId: 'createPet',
                parameters: [{ reference: '$components.parameters.a' }],
              },
            ],
          },
        ],
      },
      { ops: OPS },
    )
    expect(codes(chained)).toEqual(['arazzo-reference-unknown'])
    expect(chained.scenarios[0].steps[0].request.query).toEqual({})
  })

  it('restores a dotted variable name from the input description our export wrote', () => {
    const step = firstStep(
      doc(
        [
          {
            stepId: 'create',
            operationId: 'createPet',
            parameters: [{ name: 'X-Key', in: 'header', value: '$inputs.auth_apiKey' }],
          },
        ],
        {
          inputs: {
            type: 'object',
            properties: { auth_apiKey: { type: 'string', description: 'auth.apiKey' } },
          },
        },
      ),
    )
    expect(step.request.headers).toEqual([{ name: 'X-Key', value: '{{auth.apiKey}}' }])
  })

  it('reads a JSON payload as the body, expressions substituted', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          requestBody: {
            contentType: 'application/json',
            payload: { name: '{$inputs.petName}', tags: ['{$inputs.tag}'], count: 2 },
          },
        },
      ]),
    )
    expect(JSON.parse(step.request.body)).toEqual({
      name: '{{petName}}',
      tags: ['{{tag}}'],
      count: 2,
    })
    expect(step.request.mediaTypeIndex).toBe(0)
  })

  it('reads a payload as fields when the operation edits fields, file marker included', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'upload',
          operationId: 'uploadPetPhoto',
          requestBody: {
            contentType: 'multipart/form-data',
            payload: { caption: '$inputs.caption', photo: '@rex.png' },
          },
        },
      ]),
    )
    expect(step.request.formFields).toEqual([
      { name: 'caption', value: '{{caption}}' },
      { name: 'photo', value: '', fileName: 'rex.png' },
    ])
    expect(step.request.body).toBeNull()
  })

  it('flags a content type the operation does not declare, and a replacement list', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          requestBody: {
            contentType: 'application/xml',
            payload: '<pet/>',
            replacements: [{ target: '/name', value: 'Rex' }],
          },
        },
      ]),
    )
    expect(codes(result)).toEqual(['arazzo-replacements', 'arazzo-content-type-unknown'])
    expect(result.scenarios[0].steps[0].request.body).toBe('<pet/>')
  })

  it('keeps an untranslatable expression verbatim and warns', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          parameters: [{ name: 'trace', in: 'query', value: '$request.header.X-Trace' }],
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].request.query).toEqual({
      trace: '$request.header.X-Trace',
    })
    expect(codes(result)).toEqual(['arazzo-expression-unsupported'])
  })
})

describe('parseArazzo — outputs', () => {
  it('maps response expressions onto extraction sources', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            petId: '$response.body#/id',
            whole: '$response.body',
            session: '$response.header.X-Session',
          },
        },
      ]),
    )
    expect(step.extract).toEqual([
      { name: 'petId', source: 'body', pointer: '/id', persist: false, sensitive: false },
      { name: 'whole', source: 'body', pointer: '', persist: false, sensitive: false },
      { name: 'session', source: 'header', pointer: 'X-Session', persist: false, sensitive: false },
    ])
  })

  it('reads a jsonpointer Selector Object as the equivalent expression', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            petId: { context: '$response.body', selector: '/id', type: 'jsonpointer' },
          },
        },
      ]),
    )
    expect(step.extract).toEqual([
      { name: 'petId', source: 'body', pointer: '/id', persist: false, sensitive: false },
    ])
  })

  it('reads a jsonpath Selector Object as a query extraction', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            petId: { context: '$response.body', selector: '$.pets[0].id', type: 'jsonpath' },
            kept: '$response.body#/name',
          },
        },
      ]),
    )
    expect(step.extract).toEqual([
      { name: 'petId', source: 'body', query: '$.pets[0].id', persist: false, sensitive: false },
      { name: 'kept', source: 'body', pointer: '/name', persist: false, sensitive: false },
    ])
  })

  it('names the type of a Selector Object it has no engine for', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            // xpath is waived, not missing: the waiver is about the language.
            petId: { context: '$response.body', selector: '/pets/id', type: 'xpath' },
            kept: '$response.body#/name',
          },
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].extract).toEqual([
      { name: 'kept', source: 'body', pointer: '/name', persist: false, sensitive: false },
    ])
    expect(result.warnings).toEqual([
      { code: 'arazzo-output-type', stepId: 'create', name: 'petId', type: 'xpath' },
    ])
  })

  it('refuses a query whose context already carries a pointer', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            petId: { context: '$response.body#/data', selector: '$.id', type: 'jsonpath' },
          },
        },
      ]),
    )
    // Composing a pointer and a query would be two languages in one address.
    expect(codes(result)).toEqual(['arazzo-output-unsupported'])
    expect(result.scenarios[0].steps[0].extract).toEqual([])
  })

  it('refuses a pointer selector over a context that is not the body', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: {
            petId: { context: '$response.header.X-Session', selector: '/id', type: 'jsonpointer' },
          },
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].extract).toEqual([])
    expect(codes(result)).toEqual(['arazzo-output-unsupported'])
  })

  it('warns on an output our extraction cannot express', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          outputs: { other: '$steps.previous.outputs.id' },
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].extract).toEqual([])
    expect(codes(result)).toEqual(['arazzo-output-unsupported'])
  })
})

// The Selector Object is legal at four sites; `outputs` is the one we read.
// At the other three it used to be walked as an ordinary object and land in
// the request as data — a wrong request built without a word.
describe('parseArazzo — Selector Objects outside outputs', () => {
  const selector = { context: '$response.body', selector: '$.id', type: 'jsonpath' }

  it('refuses one as a parameter value instead of sending the object', () => {
    const result = one(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'petId', in: 'query', value: selector },
            { name: 'X-Trace', in: 'header', value: selector },
          ],
        },
      ]),
    )
    const { request } = result.scenarios[0].steps[0]
    expect(request.query).toEqual({ petId: '' })
    // Never "[object Object]".
    expect(request.headers).toEqual([{ name: 'X-Trace', value: '' }])
    expect(result.warnings).toEqual([
      { code: 'arazzo-selector-unsupported', stepId: 'read', type: 'jsonpath' },
      { code: 'arazzo-selector-unsupported', stepId: 'read', type: 'jsonpath' },
    ])
  })

  it('refuses one buried in a payload, and keeps the rest of the body', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          requestBody: {
            contentType: 'application/json',
            payload: { name: 'Rex', owner: { id: selector } },
          },
        },
      ]),
    )
    expect(JSON.parse(step.request.body)).toEqual({ name: 'Rex', owner: { id: '' } })
  })

  it('refuses a payload that is itself a selector, leaving no body at all', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          requestBody: { contentType: 'application/json', payload: selector },
        },
      ]),
    )
    expect(result.scenarios[0].steps[0].request.body).toBeNull()
    expect(codes(result)).toEqual(['arazzo-selector-unsupported'])
  })

  it('names the type even when the document omitted it', () => {
    const result = one(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [
            { name: 'petId', in: 'query', value: { context: '$response.body', selector: '$.id' } },
          ],
        },
      ]),
    )
    expect(result.warnings).toEqual([
      { code: 'arazzo-selector-unsupported', stepId: 'read', type: '—' },
    ])
  })

  it('leaves a genuine object parameter alone — the predicate is not greedy', () => {
    const step = firstStep(
      doc([
        {
          stepId: 'read',
          operationId: 'createPet',
          parameters: [{ name: 'filter', in: 'query', value: { role: 'admin', active: 'yes' } }],
        },
      ]),
    )
    expect(step.request.query).toEqual({ filter: { role: 'admin', active: 'yes' } })
  })
})

describe('parseArazzo — success criteria', () => {
  const withCriteria = (successCriteria) =>
    firstStep(doc([{ stepId: 'create', operationId: 'createPet', successCriteria }])).expect

  it('reads an exact status and a status class', () => {
    expect(withCriteria([{ condition: '$statusCode == 201' }])).toEqual({
      status: 201,
      assertions: [],
    })
    expect(withCriteria([{ condition: '$statusCode >= 400 && $statusCode <= 499' }])).toEqual({
      status: '4xx',
      assertions: [],
    })
  })

  it('treats the 2xx range as our default verdict, not as an expectation', () => {
    expect(withCriteria([{ condition: '$statusCode >= 200 && $statusCode <= 299' }])).toBeNull()
  })

  it('reads equality and existence on the body', () => {
    expect(
      withCriteria([
        { condition: '$statusCode == 200' },
        { condition: "$response.body#/name == 'Rex'" },
        { condition: '$response.body#/id != null' },
        { condition: '$response.body#/tags' },
      ]),
    ).toEqual({
      status: 200,
      assertions: [
        { pointer: '/name', op: 'equals', value: 'Rex' },
        { pointer: '/id', op: 'exists', value: undefined },
        { pointer: '/tags', op: 'exists', value: undefined },
      ],
    })
  })

  it('names every criterion it cannot express instead of failing the step', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          successCriteria: [
            { context: '$response.body', condition: '/pets[1]/id', type: 'xpath' },
            { context: '$response.body', condition: '$.id' },
            { condition: '$response.body#/count > 3' },
            { condition: '$statusCode == 201' },
            { condition: '$statusCode == 204' },
          ],
        },
      ]),
    )
    expect(codes(result)).toEqual([
      'arazzo-criterion-type',
      'arazzo-criterion-context',
      'arazzo-criterion-unsupported',
      'arazzo-criterion-status-extra',
    ])
    expect(result.scenarios[0].steps[0].expect).toEqual({ status: 201, assertions: [] })
  })

  it('reads a jsonpath criterion as a query assertion', () => {
    // The spec's own example (spec.openapis.org/arazzo/v1.1.0.html).
    expect(
      withCriteria([
        { context: '$response.body', condition: '$[?count(@.pets) > 0]', type: 'jsonpath' },
      ]),
    ).toEqual({
      status: undefined,
      assertions: [{ op: 'matches', query: '$[?count(@.pets) > 0]' }],
    })
  })

  it('accepts the expression-type spelling of the criterion type', () => {
    expect(
      withCriteria([
        { context: '$response.body', condition: '$.pets[0]', type: { type: 'jsonpath' } },
      ]),
    ).toEqual({ status: undefined, assertions: [{ op: 'matches', query: '$.pets[0]' }] })
  })

  it('reads a regex criterion as a pattern on the pointed-at value', () => {
    expect(
      withCriteria([{ context: '$response.body#/status', condition: '^avail', type: 'regex' }]),
    ).toEqual({
      status: undefined,
      assertions: [{ pointer: '/status', op: 'regex', value: '^avail' }],
    })
  })

  it('keeps a pattern exactly as written, spaces included', () => {
    expect(
      withCriteria([{ context: '$response.body#/name', condition: ' Rex', type: 'regex' }]),
    ).toEqual({
      status: undefined,
      assertions: [{ pointer: '/name', op: 'regex', value: ' Rex' }],
    })
  })

  it('warns on a regex criterion with no value to point at', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          successCriteria: [
            { condition: '^a', type: 'regex' },
            // The whole body: our runner drops such a row, so importing it
            // would show a check that never runs.
            { context: '$response.body', condition: '^a', type: 'regex' },
            { context: '$response.header.etag', condition: '^a', type: 'regex' },
            { context: '$response.body#/id', condition: '', type: 'regex' },
          ],
        },
      ]),
    )
    expect(codes(result)).toEqual([
      'arazzo-criterion-context',
      'arazzo-criterion-context',
      'arazzo-criterion-context',
      'arazzo-criterion-unsupported',
    ])
    expect(result.scenarios[0].steps[0].expect).toBeNull()
  })

  it('names the context, not the type, when a jsonpath criterion targets something else', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          successCriteria: [
            { condition: '$.pets', type: 'jsonpath' },
            { context: '$response.header.x-total', condition: '$.pets', type: 'jsonpath' },
            { context: '$response.body#/data', condition: '$.pets', type: 'jsonpath' },
          ],
        },
      ]),
    )
    expect(codes(result)).toEqual([
      'arazzo-criterion-context',
      'arazzo-criterion-context',
      'arazzo-criterion-context',
    ])
    expect(result.scenarios[0].steps[0].expect).toBeNull()
  })

  it('flags step actions, which our runner has no equivalent for', () => {
    const result = one(
      doc([
        {
          stepId: 'create',
          operationId: 'createPet',
          onFailure: [{ name: 'retry', type: 'retry', retryAfter: 1 }],
        },
      ]),
    )
    expect(codes(result)).toEqual(['arazzo-step-actions'])
  })
})

describe('round trip', () => {
  // Everything Arazzo can carry: a dotted input name (restored through the
  // input description), a JSON body, parameters, an extraction, assertions.
  const SCENARIO = normalizeScenario({
    id: 'onboarding',
    name: 'Onboarding',
    description: 'Create a pet, then read it back.',
    steps: [
      {
        id: 'step-create',
        opId: 'createPet',
        note: 'First we create the pet.',
        request: {
          headers: [{ name: 'X-Key', value: '{{auth.apiKey}}' }],
          body: JSON.stringify({ name: 'Rex', owner: '{{ownerName}}' }, null, 2),
        },
        expect: { status: 201, assertions: [{ pointer: '/name', op: 'equals', value: 'Rex' }] },
        extract: [{ name: 'petId', source: 'body', pointer: '/id' }],
      },
      {
        id: 'step-read',
        opId: 'get-pets-petid',
        request: { path: { petId: '{{petId}}' }, query: { verbose: 'true' } },
        expect: { status: 404 },
      },
    ],
  }).scenario

  // The querystring parameter is 1.1's only new *emission*: the round trip is
  // what proves the two halves agree on it, not the shapes taken separately.
  it('round-trips a whole query string through the querystring parameter', () => {
    const ops = [
      {
        ...OPS[1],
        parameters: [{ name: 'filter', in: 'querystring' }],
      },
    ]
    const scenario = normalizeScenario({
      id: 'search',
      name: 'Search',
      steps: [
        {
          id: 'step-read',
          opId: 'get-pets-petid',
          request: { path: { petId: '7' }, queryString: 'sort=name&limit=10' },
        },
      ],
    }).scenario
    const result = parseArazzo(toArazzo(scenario, { ops, sourceUrl: '' }), { ops })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  // The construct the 2026-08-07 plan exists for: an assertion whose language
  // is a query, and whose criterion is the only one we emit with a `type`.
  it('round-trips a jsonpath assertion', () => {
    const scenario = normalizeScenario({
      id: 'has-pets',
      name: 'Has pets',
      steps: [
        {
          id: 'step-read',
          opId: 'get-pets-petid',
          request: { path: { petId: '7' } },
          expect: { assertions: [{ op: 'matches', query: '$[?count(@.pets) > 0]' }] },
        },
      ],
    }).scenario
    const exported = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(exported.workflows[0].steps[0].successCriteria[1]).toEqual({
      context: '$response.body',
      condition: '$[?count(@.pets) > 0]',
      type: 'jsonpath',
    })
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  it('round-trips a regex assertion', () => {
    const scenario = normalizeScenario({
      id: 'available',
      name: 'Available',
      steps: [
        {
          id: 'step-read',
          opId: 'get-pets-petid',
          request: { path: { petId: '7' } },
          expect: { assertions: [{ pointer: '/status', op: 'regex', value: '^avail' }] },
        },
      ],
    }).scenario
    const exported = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(exported.workflows[0].steps[0].successCriteria[1]).toEqual({
      context: '$response.body#/status',
      condition: '^avail',
      type: 'regex',
    })
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  it('round-trips the values a scenario carries for its own variables', () => {
    const scenario = normalizeScenario({
      id: 'seeded',
      name: 'Seeded',
      // A dotted name and a plain one: the dotted one only survives because
      // the exported input keeps the original in its description.
      inputs: { 'auth.apiKey': 'demo', region: 'eu-west-1' },
      steps: [
        {
          id: 'step-create',
          opId: 'createPet',
          request: {
            headers: [{ name: 'X-Key', value: '{{auth.apiKey}}' }],
            body: JSON.stringify({ region: '{{region}}' }, null, 2),
          },
        },
      ],
    }).scenario
    const exported = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(exported.workflows[0].inputs.properties).toEqual({
      auth_apiKey: { type: 'string', description: 'auth.apiKey', default: 'demo' },
      region: { type: 'string', default: 'eu-west-1' },
    })
    // A variable the scenario provides is not one the caller must supply.
    expect(exported.workflows[0].inputs.required).toEqual([])
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  it('round-trips a query extraction through the Selector Object spelling', () => {
    const scenario = normalizeScenario({
      id: 'first-pet',
      name: 'First pet',
      steps: [
        {
          id: 'step-create',
          opId: 'createPet',
          extract: [{ name: 'petId', source: 'body', query: '$.pets[0].id' }],
        },
      ],
    }).scenario
    const exported = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(exported.workflows[0].steps[0].outputs).toEqual({
      petId: { context: '$response.body', selector: '$.pets[0].id', type: 'jsonpath' },
    })
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  it('round-trips a step timeout', () => {
    const scenario = normalizeScenario({
      id: 'timed',
      name: 'Timed',
      steps: [
        {
          id: 'step-read',
          opId: 'get-pets-petid',
          request: { path: { petId: '7' } },
          timeout: 2500,
        },
      ],
    }).scenario
    const exported = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(exported.workflows[0].steps[0].timeout).toBe(2500)
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(scenario))
  })

  it('exports to Arazzo and reads back the same scenario', () => {
    const exported = toArazzo(SCENARIO, { ops: OPS, sourceUrl: 'https://api.test/openapi.json' })
    const result = parseArazzo(exported, { ops: OPS })
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(withoutIds(result.scenarios[0])).toEqual(withoutIds(SCENARIO))
  })
})

// Ids are regenerated on import (a uuid is private to the browser that made
// it): everything else has to come back identical.
function withoutIds(scenario) {
  const { id, steps, ...rest } = scenario
  return { ...rest, steps: steps.map(({ id: stepId, ...step }) => step) }
}
