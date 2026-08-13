import { describe, expect, it } from 'vitest'
import { normalizeScenario } from '../src/scenarios/model.js'
import { runScenario, summarize } from '../src/scenarios/runner.js'

const OPS = [
  { id: 'post:/tokens', method: 'post', path: '/tokens', parameters: [], requestBody: null },
  {
    id: 'get:/pets/{petId}',
    method: 'get',
    path: '/pets/{petId}',
    parameters: [{ name: 'petId', in: 'path', required: true }],
    requestBody: null,
  },
  {
    id: 'post:/pets',
    method: 'post',
    path: '/pets',
    parameters: [],
    requestBody: {
      contents: [{ mediaType: 'multipart/form-data', schema: { kind: 'object', properties: [] } }],
    },
  },
]

const scenarioOf = (steps) => normalizeScenario({ name: 'S', steps }).scenario

// Fake sender: one response per call, plus a trace of what was sent.
function fakeSender(responses) {
  const calls = []
  const queue = [...responses]
  const sender = async (built) => {
    calls.push(built)
    const next = queue.shift() ?? { status: 200, body: '{}' }
    if (next.networkError)
      return {
        url: built.url,
        error: next.networkError,
        response: null,
        durationMs: 3,
        aborted: next.aborted === true,
      }
    return {
      url: built.url,
      error: null,
      durationMs: next.durationMs ?? 5,
      response: {
        status: next.status ?? 200,
        statusText: '',
        headers: next.headers ?? [['content-type', 'application/json']],
        body: next.body ?? '{}',
      },
    }
  }
  sender.calls = calls
  return sender
}

async function runAll(scenario, options) {
  const results = []
  for await (const result of runScenario(scenario, options)) results.push(result)
  return results
}

describe('chaining', () => {
  const chained = () =>
    scenarioOf([
      {
        opId: 'post:/tokens',
        extract: [{ name: 'petId', source: 'body', pointer: '/id' }],
        expect: { status: 201 },
      },
      { opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } },
    ])

  it('injects the value extracted at step 1 into the URL of step 2', async () => {
    const sender = fakeSender([{ status: 201, body: '{"id":42}' }, { status: 200 }])
    const results = await runAll(chained(), { ops: OPS, baseUrl: 'https://api.test', sender })

    expect(results.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(sender.calls[1].url).toBe('https://api.test/pets/42')
    expect(results[0].extracted[0]).toMatchObject({ name: 'petId', value: '42', ok: true })
    expect(results[1].variables.petId).toEqual({ value: '42', sensitive: false })
  })

  // A default is what is used when nothing else provides the value: it sits
  // under the environment, which sits under the run scope.
  it('uses a scenario input, and lets the environment and an extraction beat it', async () => {
    const scenario = normalizeScenario({
      name: 'S',
      inputs: { petId: '1' },
      steps: [{ opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } }],
    }).scenario
    const bare = fakeSender([{ status: 200 }])
    await runAll(scenario, { ops: OPS, baseUrl: 'https://api.test', sender: bare })
    expect(bare.calls[0].url).toBe('https://api.test/pets/1')

    const overridden = fakeSender([{ status: 200 }])
    await runAll(scenario, {
      ops: OPS,
      baseUrl: 'https://api.test',
      variables: { petId: { value: '2' } },
      sender: overridden,
    })
    expect(overridden.calls[0].url).toBe('https://api.test/pets/2')
    // And the run scope beats both, without a shadowing warning: a default
    // being covered is its normal fate.
    const extracted = fakeSender([{ status: 200 }])
    const results = await runAll(scenario, {
      ops: OPS,
      baseUrl: 'https://api.test',
      runVariables: { petId: { value: '3' } },
      sender: extracted,
    })
    expect(extracted.calls[0].url).toBe('https://api.test/pets/3')
    expect(results[0].warnings).toEqual([])
  })

  it('gives priority to the run scope over the environment, and flags it', async () => {
    const sender = fakeSender([{ status: 201, body: '{"id":42}' }, { status: 200 }])
    const results = await runAll(chained(), {
      ops: OPS,
      baseUrl: 'https://api.test',
      variables: { petId: { value: '1' } },
      sender,
    })
    expect(sender.calls[1].url).toBe('https://api.test/pets/42')
    expect(results[1].warnings).toEqual([{ code: 'variable-shadowed', name: 'petId' }])
    // Step 1 precedes any extraction: nothing to flag.
    expect(results[0].warnings).toEqual([])
  })

  it('blocks the next step when extraction has failed, without sending anything', async () => {
    const sender = fakeSender([{ status: 201, body: '{"other":42}' }])
    const results = await runAll(
      scenarioOf([
        {
          opId: 'post:/tokens',
          extract: [{ name: 'petId', pointer: '/id' }],
          expect: { status: 201 },
          continueOnFailure: true,
        },
        { opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } },
      ]),
      { ops: OPS, baseUrl: 'https://api.test', sender },
    )

    expect(results[0]).toMatchObject({ status: 'failed', reason: 'extract' })
    expect(results[0].extracted[0]).toMatchObject({ ok: false, code: 'pointer-not-found' })
    expect(results[1]).toMatchObject({
      status: 'blocked',
      reason: 'missing-variables',
      missing: ['petId'],
    })
    expect(sender.calls).toHaveLength(1)
  })
})

describe('stop and continue', () => {
  const twoSteps = (over = {}) =>
    scenarioOf([
      { opId: 'post:/tokens', expect: { status: 201 }, ...over },
      { opId: 'post:/tokens' },
      { opId: 'post:/tokens' },
    ])

  it('stops the run at the first failing step, the following ones are not reached', async () => {
    const sender = fakeSender([{ status: 500, body: '{}' }])
    const results = await runAll(twoSteps(), { ops: OPS, sender })
    expect(results.map((r) => r.status)).toEqual(['failed', 'skipped', 'skipped'])
    expect(results[0]).toMatchObject({ reason: 'status' })
    expect(results[1]).toMatchObject({ reason: 'not-reached', result: null })
    expect(sender.calls).toHaveLength(1)
  })

  it('continues when the step requests it', async () => {
    const sender = fakeSender([{ status: 500, body: '{}' }])
    const results = await runAll(twoSteps({ continueOnFailure: true }), { ops: OPS, sender })
    expect(results.map((r) => r.status)).toEqual(['failed', 'ok', 'ok'])
    expect(sender.calls).toHaveLength(3)
  })

  it('distinguishes assertion failure from status failure', async () => {
    const sender = fakeSender([{ status: 200, body: '{"state":"pending"}' }])
    const results = await runAll(
      scenarioOf([
        {
          opId: 'post:/tokens',
          expect: { assertions: [{ pointer: '/state', op: 'equals', value: 'done' }] },
        },
      ]),
      { ops: OPS, sender },
    )
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'assertion' })
    expect(results[0].checks[1]).toMatchObject({ ok: false, expected: 'done', actual: 'pending' })
  })

  it('treats a network failure as a step failure', async () => {
    const sender = fakeSender([{ networkError: 'TypeError: Failed to fetch' }])
    const results = await runAll(twoSteps(), { ops: OPS, sender })
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'network' })
    expect(results[0].result.error).toBe('TypeError: Failed to fetch')
  })

  // "aborting and failing the step" is the spec's own wording, and it is not
  // a network failure: the API was never given the time to answer.
  it('separates a step that ran out of time from one the network failed', async () => {
    const sender = fakeSender([{ networkError: 'TimeoutError: signal timed out', aborted: true }])
    const results = await runAll(twoSteps(), { ops: OPS, sender })
    expect(results[0]).toMatchObject({ status: 'failed', reason: 'timeout' })
  })
})

describe('non-executable steps', () => {
  it('blocks a step whose operation has disappeared from the schema', async () => {
    const sender = fakeSender([])
    const results = await runAll(scenarioOf([{ opId: 'get:/gone' }, { opId: 'post:/tokens' }]), {
      ops: OPS,
      sender,
    })
    expect(results[0]).toMatchObject({ status: 'blocked', reason: 'op-not-found', built: null })
    expect(results[1].status).toBe('skipped')
    expect(sender.calls).toHaveLength(0)
  })

  it('sends nothing when an environment variable is missing (rule 11)', async () => {
    const sender = fakeSender([])
    const results = await runAll(
      scenarioOf([{ opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } }]),
      { ops: OPS, baseUrl: 'https://api.test', sender },
    )
    expect(results[0]).toMatchObject({
      status: 'blocked',
      reason: 'missing-variables',
      missing: ['petId'],
    })
    expect(sender.calls).toHaveLength(0)
  })

  it('blocks an invalid request without confusing it with a missing variable', async () => {
    const sender = fakeSender([])
    const results = await runAll(
      scenarioOf([{ opId: 'get:/pets/{petId}', request: { path: {} } }]),
      {
        ops: OPS,
        sender,
      },
    )
    expect(results[0]).toMatchObject({ status: 'blocked', reason: 'invalid-request' })
    expect(results[0].errors[0]).toMatchObject({ code: 'path-param-missing', name: 'petId' })
  })

  it('reserves a step whose whole body is a file for step-by-step mode', async () => {
    const withFile = scenarioOf([{ opId: 'post:/pets', request: { bodyFileName: 'cat.png' } }])
    const auto = fakeSender([])
    expect(await runAll(withFile, { ops: OPS, sender: auto })).toMatchObject([
      { status: 'blocked', reason: 'needs-interactive' },
    ])
    expect(auto.calls).toHaveLength(0)
  })

  it('reserves a step that sends a file for step-by-step mode', async () => {
    const withFile = scenarioOf([
      { opId: 'post:/pets', request: { formFields: [{ name: 'avatar', fileName: 'cat.png' }] } },
    ])
    const auto = fakeSender([])
    expect(await runAll(withFile, { ops: OPS, sender: auto })).toMatchObject([
      { status: 'blocked', reason: 'needs-interactive' },
    ])
    expect(auto.calls).toHaveLength(0)

    const guided = fakeSender([{ status: 200 }])
    const results = await runAll(withFile, { ops: OPS, sender: guided, interactive: true })
    expect(results[0].status).toBe('ok')
  })
})

describe('auth injection and initial scope', () => {
  it('delegates auth injection to the shell, per operation', async () => {
    const sender = fakeSender([{ status: 200 }])
    await runAll(scenarioOf([{ opId: 'post:/tokens' }]), {
      ops: OPS,
      baseUrl: 'https://api.test',
      sender,
      authInjectionFor: (op) =>
        op.id === 'post:/tokens' ? { headers: { Authorization: 'Bearer x' } } : null,
    })
    expect(sender.calls[0].headers.Authorization).toBe('Bearer x')
  })

  it('starts over from a provided run scope (step-by-step resume)', async () => {
    const sender = fakeSender([{ status: 200 }])
    await runAll(
      scenarioOf([{ opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } }]),
      {
        ops: OPS,
        baseUrl: 'https://api.test',
        runVariables: { petId: { value: '9' } },
        sender,
      },
    )
    expect(sender.calls[0].url).toBe('https://api.test/pets/9')
  })

  it('resolves auth against the merged variables, including run scope', async () => {
    const sender = fakeSender([{ status: 200, body: '{"access_token":"s3cr3t"}' }, { status: 200 }])
    await runAll(
      scenarioOf([
        { opId: 'post:/tokens', extract: [{ name: 'auth.api', pointer: '/access_token' }] },
        { opId: 'post:/tokens' },
      ]),
      {
        ops: OPS,
        baseUrl: 'https://api.test',
        sender,
        // What the shell does: injection built from the received variables.
        authInjectionFor: (_op, variables) => ({
          headers: { Authorization: `Bearer ${variables['auth.api']?.value ?? 'none'}` },
        }),
      },
    )
    expect(sender.calls[0].headers.Authorization).toBe('Bearer none')
    // Step 2 benefits from the token extracted at step 1, without persisting it to the environment.
    expect(sender.calls[1].headers.Authorization).toBe('Bearer s3cr3t')
  })

  it('resumes at a given step without replaying the previous ones (step-by-step)', async () => {
    const sender = fakeSender([{ status: 200 }])
    const results = await runAll(
      scenarioOf([
        { opId: 'post:/tokens' },
        { opId: 'get:/pets/{petId}', request: { path: { petId: '{{petId}}' } } },
      ]),
      {
        ops: OPS,
        baseUrl: 'https://api.test',
        fromIndex: 1,
        runVariables: { petId: { value: '7' } },
        sender,
      },
    )
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ index: 1, status: 'ok' })
    expect(sender.calls).toHaveLength(1)
    expect(sender.calls[0].url).toBe('https://api.test/pets/7')
  })

  it('marks the extracted value that is sensitive as sensitive, all the way into the build', async () => {
    const sender = fakeSender([{ status: 200, body: '{"access_token":"s3cr3t"}' }, { status: 200 }])
    const results = await runAll(
      scenarioOf([
        {
          opId: 'post:/tokens',
          extract: [{ name: 'auth.token', pointer: '/access_token', persist: true }],
        },
        {
          opId: 'post:/tokens',
          request: { headers: [{ name: 'Authorization', value: 'Bearer {{auth.token}}' }] },
        },
      ]),
      { ops: OPS, baseUrl: 'https://api.test', sender },
    )
    expect(results[0].extracted[0].sensitive).toBe(true)
    // The next step's build files it among the values to hide.
    expect(sender.calls[1].used).toContainEqual({
      name: 'auth.token',
      value: 's3cr3t',
      sensitive: true,
    })
  })
})

describe('summarize', () => {
  it('counts steps, sums durations, and lists what remains to be persisted', async () => {
    const sender = fakeSender([
      { status: 200, body: '{"id":1,"t":"x"}', durationMs: 10 },
      { status: 500, body: '{}', durationMs: 20 },
      {},
    ])
    const results = await runAll(
      scenarioOf([
        {
          opId: 'post:/tokens',
          extract: [
            { name: 'auth.token', pointer: '/t', persist: true },
            { name: 'petId', pointer: '/id' },
          ],
        },
        { opId: 'post:/tokens' },
        { opId: 'post:/tokens' },
      ]),
      { ops: OPS, sender },
    )
    const summary = summarize(results)
    expect(summary).toMatchObject({
      total: 3,
      ok: false,
      durationMs: 30,
      counts: { ok: 1, failed: 1, skipped: 1 },
    })
    expect(summary.persist.map((p) => p.name)).toEqual(['auth.token'])
  })

  it('renders an all-green run', async () => {
    const results = await runAll(scenarioOf([{ opId: 'post:/tokens' }]), {
      ops: OPS,
      sender: fakeSender([{}]),
    })
    expect(summarize(results)).toMatchObject({ ok: true, counts: { ok: 1, failed: 0 } })
  })
})
