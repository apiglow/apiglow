import { describe, expect, it, vi } from 'vitest'
import { normalizeScenario } from '../src/scenarios/model.js'
import { createStepController } from '../src/scenarios/step-controller.js'

// Step-by-step driven without a browser: the panel, the banner, and the report are
// spies, and "the user sends" is a function call.

const OPS = [
  { id: 'createPet', method: 'post', path: '/pets', parameters: [], requestBody: null },
  {
    id: 'getPet',
    method: 'get',
    path: '/pets/{petId}',
    parameters: [{ name: 'petId', in: 'path', required: true }],
    requestBody: null,
  },
]

const SCENARIO = normalizeScenario({
  name: 'Onboarding',
  steps: [
    {
      id: 'a',
      opId: 'createPet',
      extract: [{ name: 'petId', pointer: '/id' }],
      expect: { status: 201 },
    },
    { id: 'b', opId: 'getPet', request: { path: { petId: '{{petId}}' } } },
  ],
}).scenario

function harness({ scenario = SCENARIO } = {}) {
  const loaded = []
  const shown = []
  const pushed = []
  const finished = []
  const controller = createStepController({
    context: () => ({
      ops: OPS,
      baseUrl: 'https://api.test',
      variables: {},
      authInjectionFor: null,
    }),
    panel: {
      snapshot: () => ({ opId: 'listPets', body: 'brouillon' }),
      setVariables: (variables) => loaded.push({ variables }),
      load: ({ op, step, variables }) => loaded.push({ opId: op?.id, stepId: step.id, variables }),
    },
    stepper: { show: (state) => shown.push(state) },
    report: { push: (result) => pushed.push(result), end: () => finished.push('report-end') },
    onFinish: (info) => finished.push(info),
    onError: (err) => finished.push(err),
  })
  // Waiting for the next state pushed to the banner: the controller is asynchronous
  // (the generator runs on microtasks), nothing is instantaneous.
  const settled = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
  }
  const state = () => shown[shown.length - 1]
  const send = async (response) => {
    const awaiting = state()
    controller.onResponse(awaiting.op.id, {
      url: 'https://api.test',
      error: null,
      durationMs: 1,
      response: { status: response?.status ?? 200, headers: [], body: response?.body ?? '{}' },
    })
    await settled()
  }
  return { controller, loaded, shown, pushed, finished, settled, state, send, scenario }
}

describe('guided step-by-step', () => {
  it('presents the step, waits for the send, then renders a verdict', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()

    // Step 1 loaded into the panel, waiting for the user.
    expect(h.state()).toMatchObject({ index: 0, total: 2, awaiting: true, op: { id: 'createPet' } })
    expect(h.loaded[0]).toMatchObject({ opId: 'createPet', stepId: 'a' })
    expect(h.pushed).toHaveLength(0)

    await h.send({ status: 201, body: '{"id":42}' })
    expect(h.state()).toMatchObject({ index: 0, awaiting: false })
    expect(h.state().result).toMatchObject({ status: 'ok', stepId: 'a' })
    expect(h.pushed).toHaveLength(1)
  })

  it('injects the extracted value into the scope of the next step', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    await h.send({ status: 201, body: '{"id":42}' })

    h.controller.decide('next')
    await h.settled()
    expect(h.state()).toMatchObject({ index: 1, awaiting: true, op: { id: 'getPet' } })
    // The panel receives the run scope: the {{petId}} of step 2 resolves.
    expect(h.loaded.at(-1).variables).toEqual({ petId: { value: '42', sensitive: false } })
  })

  it('replays the same step on "retry", without advancing', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    await h.send({ status: 500 })
    expect(h.state().result).toMatchObject({ status: 'failed', reason: 'status' })

    h.controller.decide('retry')
    await h.settled()
    expect(h.state()).toMatchObject({ index: 0, awaiting: true })
    await h.send({ status: 201, body: '{"id":7}' })
    expect(h.state().result).toMatchObject({ status: 'ok' })
  })

  it('skips a step awaiting a send, without sending anything', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()

    h.controller.decide('skip')
    await h.settled()
    // Step 2 was waiting for the value extracted by the one we just skipped:
    // it is blocked, and says so, rather than proceeding with a literal (§11).
    expect(h.state()).toMatchObject({ index: 1, awaiting: false })
    expect(h.state().result).toMatchObject({ status: 'blocked', reason: 'missing-variables' })
    // No result for the skipped step itself: it was never run.
    expect(h.pushed.map((r) => r.stepId)).toEqual(['b'])
  })

  it('goes back to the previous step and keeps the acquired scope', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    await h.send({ status: 201, body: '{"id":42}' })
    h.controller.decide('next')
    await h.settled()

    h.controller.decide('prev')
    await h.settled()
    expect(h.state()).toMatchObject({ index: 0, awaiting: true })
    expect(h.loaded.at(-1).variables).toEqual({ petId: { value: '42', sensitive: false } })
  })

  it('finishes after the last step, with the summary and the draft', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    await h.send({ status: 201, body: '{"id":42}' })
    h.controller.decide('next')
    await h.settled()
    await h.send({ status: 200 })

    expect(h.controller.active).toBe(true)
    h.controller.decide('next')
    await h.settled()
    expect(h.controller.active).toBe(false)
    expect(h.shown.at(-1)).toBeNull()
    expect(h.finished).toContain('report-end')
    // The draft snapshotted at launch is returned to the shell.
    expect(h.finished.at(-1)).toMatchObject({ draft: { opId: 'listPets' }, wrapUp: true })
  })

  it('quits at any time, including while awaiting a send', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    h.controller.decide('quit')
    await h.settled()
    expect(h.controller.active).toBe(false)
    expect(h.shown.at(-1)).toBeNull()
  })

  it('blocks a step whose variable is missing, without sending anything', async () => {
    const h = harness()
    // Step 2 alone: {{petId}} is produced by no one.
    const orphanScope = normalizeScenario({
      name: 'X',
      steps: [{ id: 'b', opId: 'getPet', request: { path: { petId: '{{petId}}' } } }],
    }).scenario
    h.controller.start(orphanScope)
    await h.settled()
    // Nothing was loaded for sending: the result arrives directly.
    expect(h.state()).toMatchObject({ awaiting: false })
    expect(h.state().result).toMatchObject({ status: 'blocked', reason: 'missing-variables' })
  })

  it('accepts manually entered variables and replays the blocked step', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    h.controller.decide('skip')
    await h.settled()
    expect(h.state().result).toMatchObject({ status: 'blocked', missing: ['petId'] })

    h.controller.decide('provide', { variables: { petId: { value: '77', sensitive: false } } })
    await h.settled()
    // The step starts over, and the panel receives the entered value as if
    // it were an extraction.
    expect(h.state()).toMatchObject({ index: 1, awaiting: true })
    expect(h.loaded.at(-1).variables).toEqual({ petId: { value: '77', sensitive: false } })
  })

  it('re-judges the current step when it is resent from the panel', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    await h.send({ status: 201, body: '{"id":42}' })
    expect(h.state().variables).toEqual({ petId: { value: '42', sensitive: false } })

    // Resending the same step with a different body, with no decision in between.
    await h.send({ status: 201, body: '{"id":99}' })
    expect(h.state()).toMatchObject({ index: 0, awaiting: false })
    expect(h.state().result).toMatchObject({ status: 'ok', stepId: 'a' })
    expect(h.state().variables).toEqual({ petId: { value: '99', sensitive: false } })
    // Only one result per step in the report: the second replaces the first.
    expect(h.pushed.map((r) => r.stepId)).toEqual(['a', 'a'])
    // And the resend's history entry still belongs to the run.
    expect(h.controller.decorateEntry('createPet')).toMatchObject({
      scenario: { stepId: 'a', stepIndex: 0 },
    })

    h.controller.decide('next')
    await h.settled()
    expect(h.loaded.at(-1).variables).toEqual({ petId: { value: '99', sensitive: false } })
  })

  it('ignores a send that is not the one for the awaited step', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()

    const foreign = h.controller.onResponse('listPets', {
      response: { status: 200, headers: [], body: '{}' },
    })
    await h.settled()
    expect(foreign).toBe(false)
    expect(h.state()).toMatchObject({ index: 0, awaiting: true })
    expect(h.pushed).toHaveLength(0)
    // And nothing about that send gets tagged with the run.
    expect(h.controller.decorateEntry('listPets')).toBeNull()
    expect(h.controller.decorateEntry('createPet')).toMatchObject({
      scenario: { stepId: 'a', stepIndex: 0 },
    })
  })

  it('has nothing left to tag once the run is finished', async () => {
    const h = harness()
    h.controller.start(h.scenario)
    await h.settled()
    h.controller.decide('quit')
    await h.settled()
    expect(h.controller.decorateEntry('createPet')).toBeNull()
  })

  it('reports an orchestration failure and yields control back', async () => {
    const boom = new Error('boom')
    const controller = createStepController({
      context: () => {
        throw boom
      },
      panel: { snapshot: () => null, setVariables: () => {}, load: () => {} },
      stepper: { show: () => {} },
      report: { push: () => {}, end: () => {} },
      onFinish: () => {},
      onError: vi.fn(),
    })
    controller.start(SCENARIO)
    for (let i = 0; i < 20; i += 1) await Promise.resolve()
    expect(controller.active).toBe(false)
  })
})
