import { describe, expect, it } from 'vitest'
import {
  createScenario,
  createStep,
  decodeScenarioFile,
  encodeScenarioFile,
  needsInteractive,
  normalizeRequest,
  normalizeScenario,
  scenarioVariables,
} from '../src/scenarios/model.js'

const rawScenario = (over = {}) => ({
  name: 'Onboarding',
  description: 'Create an account, then pay',
  steps: [
    {
      id: 'step-1',
      opId: 'post:/tokens',
      note: 'Ask for a token',
      request: {
        path: {},
        query: { scope: 'read' },
        headers: [{ name: 'X-Trace', value: '1' }],
        body: '{}',
      },
      extract: [{ name: 'auth.token', source: 'body', pointer: '/access_token', persist: true }],
      expect: { status: 201 },
    },
    { id: 'step-2', opId: 'get:/pets/{id}', request: { path: { id: '{{petId}}' } } },
  ],
  ...over,
})

describe('normalizeScenario', () => {
  it('normalizes a complete scenario', () => {
    const { scenario, errors } = normalizeScenario(rawScenario())
    expect(errors).toEqual([])
    expect(scenario).toMatchObject({ id: expect.any(String), name: 'Onboarding', source: 'local' })
    expect(scenario.steps).toHaveLength(2)
    expect(scenario.steps[0]).toMatchObject({
      id: 'step-1',
      opId: 'post:/tokens',
      note: 'Ask for a token',
      continueOnFailure: false,
      expect: { status: 201, assertions: [] },
    })
    expect(scenario.steps[0].request.query).toEqual({ scope: 'read' })
  })

  it('never throws on a weird input', () => {
    for (const raw of [null, undefined, 42, 'text', []]) {
      expect(normalizeScenario(raw)).toEqual({
        scenario: null,
        errors: [{ code: 'scenario-invalid' }],
      })
    }
  })

  it('reports a missing name without discarding the scenario', () => {
    const { scenario, errors } = normalizeScenario({ steps: [] })
    expect(scenario.name).toBe('')
    expect(errors).toEqual([{ code: 'scenario-name-missing' }])
  })

  it('requires a slug id for a config scenario, makes one up locally', () => {
    expect(normalizeScenario(rawScenario(), { source: 'config', id: 'Onboarding!' })).toMatchObject(
      {
        scenario: null,
        errors: [{ code: 'scenario-id-invalid' }],
      },
    )
    const fromConfig = normalizeScenario(rawScenario(), { source: 'config', id: 'onboarding' })
    expect(fromConfig.scenario).toMatchObject({ id: 'onboarding', source: 'config' })
    // Two local scenarios without an id must not collide.
    const a = normalizeScenario(rawScenario()).scenario
    const b = normalizeScenario(rawScenario()).scenario
    expect(a.id).not.toBe(b.id)
  })

  it('discards unusable steps while reporting them, keeps the others', () => {
    const { scenario, errors } = normalizeScenario(
      rawScenario({ steps: [{ opId: 'get:/pets' }, null, { note: 'no operation' }, 'text'] }),
    )
    expect(scenario.steps).toHaveLength(1)
    expect(errors).toEqual([
      { code: 'step-invalid', index: 1 },
      { code: 'step-op-missing', index: 2 },
      { code: 'step-invalid', index: 3 },
    ])
  })

  it('discards an extraction whose name is not interpolable', () => {
    const { scenario, errors } = normalizeScenario(
      rawScenario({
        steps: [{ opId: 'get:/pets', extract: [{ name: 'mon id', pointer: '/id' }] }],
      }),
    )
    expect(scenario.steps[0].extract).toEqual([])
    expect(errors).toEqual([{ code: 'extract-name-invalid', name: 'mon id', index: 0 }])
  })

  it('forces sensitive on an extraction that persists into auth.*', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          { opId: 'post:/tokens', extract: [{ name: 'auth.token', pointer: '/t', persist: true }] },
          { opId: 'post:/tokens', extract: [{ name: 'auth.token', pointer: '/t' }] },
        ],
      }),
    )
    expect(scenario.steps[0].extract[0]).toMatchObject({ sensitive: true, persist: true })
    // Without persistence, the value never leaves the run: nothing is forced.
    expect(scenario.steps[1].extract[0].sensitive).toBe(false)
  })

  it('normalizes or discards an invalid expected status', () => {
    const status = (value) =>
      normalizeScenario(rawScenario({ steps: [{ opId: 'x', expect: { status: value } }] })).scenario
        .steps[0].expect
    expect(status('201')).toMatchObject({ status: 201 })
    expect(status('2XX')).toMatchObject({ status: '2xx' })
    expect(status(999)).toBeNull()
    expect(
      normalizeScenario(rawScenario({ steps: [{ opId: 'x', expect: { status: 999 } }] })).errors,
    ).toEqual([{ code: 'expect-status-invalid', status: 999, index: 0 }])
  })

  it('does not invent an expected value for an exists assertion', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          {
            opId: 'x',
            expect: {
              assertions: [
                { pointer: '/a', op: 'exists', value: 'ignored' },
                { pointer: '/b', op: 'nawak' },
              ],
            },
          },
        ],
      }),
    )
    expect(scenario.steps[0].expect.assertions).toEqual([
      { pointer: '/a', op: 'exists', value: undefined },
      { pointer: '/b', op: 'exists', value: undefined },
    ])
  })

  // Values the scenario carries for its own variables (§5.2), from Arazzo's
  // workflow input defaults.
  it('keeps only the inputs a template could actually use', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        inputs: {
          apiKey: 'demo',
          'auth.token': 'abc',
          count: 7,
          flag: false,
          nested: { a: 1 },
          list: [1],
          empty: null,
          'not a name': 'x',
        },
        steps: [{ opId: 'x' }],
      }),
    )
    // Scalars become text — that is what interpolation substitutes.
    expect(scenario.inputs).toEqual({
      apiKey: 'demo',
      'auth.token': 'abc',
      count: '7',
      flag: 'false',
    })
  })

  it('stops asking for a variable the scenario carries itself', () => {
    const withInputs = (inputs) =>
      scenarioVariables(
        normalizeScenario(
          rawScenario({
            inputs,
            steps: [{ opId: 'x', request: { query: { key: '{{apiKey}}' } } }],
          }),
        ).scenario,
      )
    expect(withInputs({}).required).toEqual(['apiKey'])
    expect(withInputs({ apiKey: 'demo' }).required).toEqual([])
  })

  it('keeps a query extraction in its own field, and the field is the mode', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          {
            opId: 'x',
            extract: [
              { name: 'a', source: 'header', query: '$.id', pointer: '/ignored' },
              // Being filled in: still a query row across a reload.
              { name: 'b', query: '' },
              { name: 'c', pointer: '/id' },
            ],
          },
        ],
      }),
    )
    expect(scenario.steps[0].extract).toEqual([
      // A query only reads the body: `source` is not a choice beside it.
      { name: 'a', source: 'body', query: '$.id', persist: false, sensitive: false },
      { name: 'b', source: 'body', query: '', persist: false, sensitive: false },
      { name: 'c', source: 'body', pointer: '/id', persist: false, sensitive: false },
    ])
  })

  it('takes a step timeout only as a positive integer of milliseconds', () => {
    const timeoutOf = (timeout) =>
      normalizeScenario(rawScenario({ steps: [{ opId: 'x', timeout }] }))
    expect(timeoutOf(5000).scenario.steps[0].timeout).toBe(5000)
    expect(timeoutOf('5000').scenario.steps[0].timeout).toBe(5000)
    expect(timeoutOf(undefined).scenario.steps[0].timeout).toBeUndefined()
    for (const bad of ['5s', 0, -1, 1.5]) {
      const { scenario, errors } = timeoutOf(bad)
      expect(scenario.steps[0].timeout).toBeUndefined()
      expect(errors).toEqual([{ code: 'step-timeout-invalid', timeout: bad, index: 0 }])
    }
  })

  it('keeps the pattern of a regex assertion in the value slot', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          {
            opId: 'x',
            expect: { assertions: [{ pointer: '/a', op: 'regex', value: '^ab' }, { op: 'regex' }] },
          },
        ],
      }),
    )
    expect(scenario.steps[0].expect.assertions).toEqual([
      { pointer: '/a', op: 'regex', value: '^ab' },
      { pointer: '', op: 'regex', value: '' },
    ])
  })

  it('keeps a matches assertion in its own field, never in the pointer', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          {
            opId: 'x',
            expect: {
              assertions: [
                { op: 'matches', query: '$.pets[0]', pointer: '/pets/0', value: 'ignored' },
                { op: 'matches' },
              ],
            },
          },
        ],
      }),
    )
    expect(scenario.steps[0].expect.assertions).toEqual([
      { op: 'matches', query: '$.pets[0]' },
      { op: 'matches', query: '' },
    ])
  })
})

describe('normalizeRequest', () => {
  it('renders the try-it panel shape even for an empty input', () => {
    expect(normalizeRequest(undefined)).toEqual({
      path: {},
      query: {},
      cookie: {},
      queryString: '',
      headers: [],
      body: null,
      mediaTypeIndex: 0,
      formFields: null,
    })
  })

  it('accepts a list or a map of values (array and object parameters)', () => {
    const request = normalizeRequest({
      query: { tags: ['cat', 3], filter: { role: 'admin', level: 2 }, bad: [{ a: 1 }] },
    })
    expect(request.query).toEqual({ tags: ['cat', '3'], filter: { role: 'admin', level: '2' } })
  })

  it('filters out non-scalar values and rows without a name', () => {
    const request = normalizeRequest({
      path: { id: 7, bad: { a: { deep: 1 } } },
      query: { q: 'x', nope: null },
      headers: [{ name: 'A', value: 'b' }, { value: 'orphelin' }, null],
      body: 42,
      mediaTypeIndex: -1,
    })
    expect(request.path).toEqual({ id: '7' })
    expect(request.query).toEqual({ q: 'x' })
    expect(request.headers).toEqual([{ name: 'A', value: 'b' }])
    expect(request.body).toBeNull()
    expect(request.mediaTypeIndex).toBe(0)
  })

  it('keeps a file’s name, never its content', () => {
    const request = normalizeRequest({
      formFields: [
        { name: 'avatar', fileName: 'cat.png', file: 'content' },
        { name: 'label', value: 'photo' },
      ],
    })
    expect(request.formFields).toEqual([
      { name: 'avatar', value: '', fileName: 'cat.png' },
      { name: 'label', value: 'photo', fileName: undefined },
    ])
  })

  it('keeps the name of a whole-file body, and only the name', () => {
    const request = normalizeRequest({ bodyFileName: 'cat.png', body: null })
    expect(request.bodyFileName).toBe('cat.png')
    expect(request.body).toBeNull()
    expect(normalizeRequest({}).bodyFileName).toBeUndefined()
  })

  it('marks as interactive any step whose body carries a file', () => {
    expect(needsInteractive(normalizeRequest({ bodyFileName: 'cat.png' }))).toBe(true)
    expect(
      needsInteractive(normalizeRequest({ formFields: [{ name: 'a', fileName: 'cat.png' }] })),
    ).toBe(true)
    expect(needsInteractive(normalizeRequest({ body: '{"a":1}' }))).toBe(false)
  })
})

describe('scenarioVariables', () => {
  it('separates prerequisites from variables produced by the scenario', () => {
    const { scenario } = normalizeScenario(rawScenario())
    expect(scenarioVariables(scenario)).toEqual({ required: ['petId'], produced: ['auth.token'] })
  })

  it('does not require a variable that an earlier step produces', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          { opId: 'a', extract: [{ name: 'petId', pointer: '/id' }] },
          {
            opId: 'b',
            request: { path: { id: '{{petId}}' }, headers: [{ name: 'X', value: '{{apiKey}}' }] },
          },
        ],
      }),
    )
    expect(scenarioVariables(scenario)).toEqual({ required: ['apiKey'], produced: ['petId'] })
  })

  it('requires a variable produced too late', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          { opId: 'a', request: { path: { id: '{{petId}}' } } },
          { opId: 'b', extract: [{ name: 'petId', pointer: '/id' }] },
        ],
      }),
    )
    expect(scenarioVariables(scenario).required).toEqual(['petId'])
  })

  it('scans every editable area of the request', () => {
    const { scenario } = normalizeScenario(
      rawScenario({
        steps: [
          {
            opId: 'a',
            request: {
              query: { q: '{{a}}' },
              queryString: 'x={{b}}',
              headers: [{ name: 'H', value: '{{c}}' }],
              body: '{"k":"{{d}}"}',
              formFields: [{ name: 'f', value: '{{e}}' }],
            },
          },
        ],
      }),
    )
    expect(scenarioVariables(scenario).required).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('scenario file', () => {
  it('round-trips without carrying over the local id', () => {
    const { scenario } = normalizeScenario(rawScenario())
    const file = encodeScenarioFile(scenario)
    expect(file).toMatchObject({ format: 'apiglow-scenario', v: 1 })
    expect(file.scenario.id).toBeUndefined()
    expect(file.scenario.source).toBeUndefined()

    const decoded = decodeScenarioFile(JSON.stringify(file))
    expect(decoded.errors).toEqual([])
    expect(decoded.scenario.name).toBe('Onboarding')
    expect(decoded.scenario.steps).toHaveLength(2)
    // A re-import must not overwrite the original scenario.
    expect(decoded.scenario.id).not.toBe(scenario.id)
  })

  it('rejects an unknown envelope without throwing', () => {
    expect(decodeScenarioFile('{not json')).toMatchObject({
      errors: [{ code: 'file-invalid-json' }],
    })
    expect(decodeScenarioFile({ scenario: {} })).toMatchObject({
      errors: [{ code: 'file-format-unknown' }],
    })
    expect(decodeScenarioFile({ format: 'apiglow-scenario', v: 9 })).toMatchObject({
      errors: [{ code: 'file-version-unknown', v: 9 }],
    })
    expect(decodeScenarioFile(null).scenario).toBeNull()
  })

  it('loads a file as a config scenario with the declared id', () => {
    const file = encodeScenarioFile(normalizeScenario(rawScenario()).scenario)
    const { scenario } = decodeScenarioFile(file, { source: 'config', id: 'onboarding' })
    expect(scenario).toMatchObject({ id: 'onboarding', source: 'config' })
  })
})

describe('local creation', () => {
  it('creates an empty scenario ready to receive captures', () => {
    const scenario = createScenario({ name: 'Mon test' })
    expect(scenario).toMatchObject({ name: 'Mon test', source: 'local', steps: [] })
    expect(scenario.id).toEqual(expect.any(String))
  })

  it('creates a step from an operation and a panel state', () => {
    const step = createStep({ opId: 'get:/pets', request: { query: { limit: '10' } } })
    expect(step).toMatchObject({
      opId: 'get:/pets',
      note: '',
      expect: null,
      extract: [],
      continueOnFailure: false,
    })
    expect(step.request.query).toEqual({ limit: '10' })
  })
})
