import { judgeStepResponse, runScenario, stepOutcome } from './runner.js'

// Controller for the guided step-by-step mode (docs/scenarios.md §5.3).
//
// Same orchestration code as the auto run: it is the generator from
// `runner.js`, consumed at the pace of manual sends. The `sender` only
// returns control on a click of the REAL Send button in the panel; each user
// decision (next, retry, skip, back) restarts the generator at the wanted
// index, with the accumulated run scope — a generator can't be rewound, but
// it can be recreated, and its only state is this scope that each result
// hands back.
//
// No DOM or store here: everything arrives by injection, exactly like the
// runner — that's what makes this mechanic (the trickiest in the feature)
// testable without a browser.
//
//   context()   → { ops, baseUrl, variables, authInjectionFor } (re-read at
//                 each step: the active environment can change mid-run)
//   panel       → { load({ op, request, variables }), setVariables, snapshot }
//   stepper     → { show(state | null) }
//   report      → { push(result), end() }
//   onFinish({ scenario, draft }) → the shell stores the draft and navigates
//   onError(err)

// Interruption of a pending send: carries the decision that caused it.
class StepAbort extends Error {
  constructor(decision, index) {
    super('step-aborted')
    this.decision = decision
    this.index = index
  }
}

// Where to resume based on the decision. Absent from the table ("quit",
// "stop") or out of bounds = end of run.
const NEXT_INDEX = { retry: 0, next: 1, skip: 1, continue: 1, prev: -1 }

export function createStepController({
  context,
  panel,
  stepper,
  report,
  onFinish,
  onError = () => {},
}) {
  // { scenario, runId, scope, draft, awaiting, decide }
  let run = null

  const opsById = () => new Map(context().ops.map((op) => [op.id, op]))

  const start = (scenario, { runId = crypto.randomUUID() } = {}) => {
    const previous = run
    // Chained restart: the original draft is kept, the panel already carries
    // a step from the previous run.
    if (previous) finish(previous, { wrapUp: false })
    run = {
      scenario,
      runId,
      scope: {},
      draft: previous?.draft ?? panel.snapshot(),
      awaiting: null,
      current: null,
      decide: null,
    }
    loop(run, 0)
  }

  const finish = (target, { wrapUp = true } = {}) => {
    if (run !== target) return
    run = null
    stepper.show(null)
    panel.setVariables({})
    if (wrapUp) report.end()
    onFinish({ scenario: target.scenario, draft: target.draft, wrapUp })
  }

  const decide = (kind, payload = null) => {
    if (!run) return
    // Resume: the user went to look elsewhere during the step. Nothing to
    // decide, we put the step back in front of them (and its request in the
    // panel) without touching the generator.
    if (kind === 'resume') {
      if (run.awaiting) present(run, run.awaiting.index, { awaiting: true })
      return
    }
    // Variables entered by hand to unblock the step (a previous one was
    // skipped, the environment doesn't carry them): they join the run scope,
    // exactly as if an extraction had produced them, and the step restarts.
    // Persisting to the environment, though, belongs to the shell.
    if (kind === 'provide') {
      Object.assign(run.scope, payload?.variables ?? {})
      kind = 'retry'
    }
    if (run.awaiting) {
      // Decision made before sending: the generator is suspended in the
      // sender, it must be released to restart it elsewhere.
      const { index, reject } = run.awaiting
      run.awaiting = null
      reject(new StepAbort(kind, index))
      return
    }
    const pending = run.decide
    run.decide = null
    pending?.(kind)
  }

  const applyDecision = (target, decision, index) => {
    const offset = NEXT_INDEX[decision]
    const next = offset === undefined ? -1 : index + offset
    if (next < 0 || next >= target.scenario.steps.length) {
      finish(target)
      return
    }
    loop(target, next)
  }

  // One iteration = one step.
  const loop = async (target, fromIndex) => {
    let result = null
    try {
      const { ops, baseUrl, variables, authInjectionFor } = context()
      for await (const yielded of runScenario(target.scenario, {
        ops,
        baseUrl,
        variables,
        runVariables: target.scope,
        authInjectionFor,
        interactive: true,
        fromIndex,
        sender: (_built, step) => sender(target, step),
      })) {
        result = yielded
        break
      }
    } catch (err) {
      if (err instanceof StepAbort) {
        applyDecision(target, err.decision, err.index)
        return
      }
      onError(err)
      finish(target)
      return
    }
    if (run !== target) return
    // No more step to play: the scenario has reached the end.
    if (!result) {
      finish(target)
      return
    }
    target.scope = result.variables
    // Step judged, but the user hasn't decided yet: it remains "the
    // current one", and a new send on its endpoint will re-judge it (cf.
    // onResponse) rather than falling into the void.
    target.current = { index: result.index, opId: result.opId }
    // The view's report is the only collection of results: the controller
    // keeps no copy of its own.
    report.push(result)
    present(target, result.index, { result })
    const decision = await new Promise((resolve) => {
      target.decide = resolve
    })
    if (run !== target) return
    applyDecision(target, decision, result.index)
  }

  // Prepares the panel then waits for the user. The request actually sent
  // is the panel's (it can be corrected before sending) — that's the whole
  // point of guided mode, and the runner doesn't need to know it.
  const sender = (target, { step, index }) =>
    new Promise((resolve, reject) => {
      target.awaiting = { index, opId: step.opId, resolve, reject }
      present(target, index, { awaiting: true })
    })

  const present = (target, index, { result = null, awaiting = false } = {}) => {
    const step = target.scenario.steps[index]
    const op = opsById().get(step?.opId) ?? null
    // The run scope overlays the env variables in the panel: the fields
    // keep their {{var}}, only the resolution changes (§2).
    if (awaiting) panel.load({ op, step, variables: target.scope })
    stepper.show({
      scenarioName: target.scenario.name,
      index,
      total: target.scenario.steps.length,
      step,
      op,
      result,
      awaiting,
      // What previous steps have produced: it's the material for the
      // current step's {{var}}, it must be readable without having to
      // reopen the report of each step.
      variables: target.scope,
    })
  }

  return {
    start,
    decide,
    get active() {
      return run !== null
    },

    // Send arriving from the panel. ANOTHER operation while the step is
    // waiting = the user went off exploring: its request has nothing to do
    // with the scenario, the run must absolutely not evaluate it as its
    // step response.
    onResponse(opId, result) {
      const awaiting = run?.awaiting
      if (awaiting) {
        if (opId !== awaiting.opId) return false
        run.awaiting = null
        awaiting.resolve(result)
        return true
      }
      // Resend of the current step, after its verdict: the user corrects a
      // parameter and presses Send again. The verdict and the extracted
      // variables must follow THIS response — otherwise step-by-step keeps
      // showing those of the first attempt. Re-judged in place rather than
      // by restarting the generator: the request sent is the panel's, not
      // the one the step has in memory.
      const current = run?.current
      if (!current || opId !== current.opId) return false
      const step = run.scenario.steps[current.index]
      const judged = judgeStepResponse(step, result, run.scope)
      const outcome = stepOutcome(step, current.index, run.scope, { ...judged, result })
      report.push(outcome)
      present(run, current.index, { result: outcome })
      return true
    },

    // Tagging of the current step's history entries (§4): the rule "is
    // this really the awaited step?" lives only here, with the waiting.
    decorateEntry(opId) {
      // Same rule as `onResponse`: the awaited step, or the one we just
      // judged and that the user is resending — otherwise a resend would
      // leave in the history an entry orphaned from the run it belongs to.
      const pending = run?.awaiting ?? run?.current
      if (!pending || opId !== pending.opId) return null
      const step = run.scenario.steps[pending.index]
      return {
        scenario: {
          id: run.scenario.id,
          runId: run.runId,
          stepId: step.id,
          stepIndex: pending.index,
        },
      }
    },
  }
}
