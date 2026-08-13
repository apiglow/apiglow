import {
  createStep,
  normalizeExpect,
  normalizeRequest,
  normalizeScenario,
} from '../../src/scenarios/model.js'

// The scenario model's own surface, walked by the two guards built on it:
// `scenario-completeness.test.js` (every key the exports emit or waive) and
// `scenario-roundtrip.test.js` (every key the corpus exercises). One walk
// between them is what makes a key the model gains appear in both at once —
// two hand-kept copies would let a kind be added to one and forgotten in the
// other, which is the silence these guards exist to break.
//
// Every kind of record the model holds, with an "empty" prototype beside the
// instances: a key the normalizers always assign is on the prototype, one only
// some shapes carry (a `query` extraction against a `pointer` one) comes from
// the instances.
export function scenarioModelKinds(scenarios) {
  const steps = scenarios.flatMap((scenario) => scenario.steps)
  const requests = steps.map((step) => step.request)
  return {
    scenario: { instances: scenarios, empty: normalizeScenario({ name: 'x' }).scenario },
    step: { instances: steps, empty: createStep({ opId: 'x' }) },
    request: { instances: requests, empty: normalizeRequest({}) },
    'request.headers': {
      instances: requests.flatMap((request) => request.headers),
      empty: normalizeRequest({ headers: [{ name: 'x' }] }).headers[0],
    },
    'request.formFields': {
      instances: requests.flatMap((request) => request.formFields ?? []),
      empty: normalizeRequest({ formFields: [{ name: 'x' }] }).formFields[0],
    },
    expect: {
      instances: steps.map((step) => step.expect).filter(Boolean),
      empty: normalizeExpect({ status: 200 }),
    },
    'expect.assertions': {
      instances: steps.flatMap((step) => step.expect?.assertions ?? []),
      empty: normalizeExpect({ assertions: [{ op: 'exists' }] }).assertions[0],
    },
    extract: {
      instances: steps.flatMap((step) => step.extract),
      empty: normalizeScenario({ name: 'x', steps: [{ opId: 'x', extract: [{ name: 'x' }] }] })
        .scenario.steps[0].extract[0],
    },
  }
}

export function recordKeys({ instances, empty }) {
  return [
    ...new Set([...Object.keys(empty), ...instances.flatMap((instance) => Object.keys(instance))]),
  ]
}
