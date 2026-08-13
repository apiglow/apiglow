import { buildRequest } from '../openapi/request-builder.js'
import { applyExtracts, evaluateExpect, jsonBodyReader } from './evaluate.js'
import { needsInteractive } from './model.js'

// Execution of a scenario (docs/scenarios.md §6) — pure async generator.
//
// A single orchestration code for both modes: the `sender` is injected. In
// auto run it's `openapi/send.js`, consumed in one go; in step-by-step it's
// a function that only returns control on the user's click of the real
// Send button in the try-it panel. The runner knows neither the DOM nor
// storage: it yields one result per step, the view turns it into a report.

const STEP_OK = 'ok'
// Failure after sending (status, assertion, extraction, network).
const STEP_FAILED = 'failed'
// Nothing was sent (missing variable, operation not found…).
const STEP_BLOCKED = 'blocked'
// Step never reached: a previous one stopped the run.
const STEP_SKIPPED = 'skipped'

export async function* runScenario(
  scenario,
  {
    ops = [],
    baseUrl = '',
    // Environment variables, `EnvStore.variablesOf` shape: {name: {value, sensitive}}.
    variables = {},
    // Initial run scope — non-empty when resuming step-by-step.
    runVariables = {},
    authInjectionFor = null,
    sender,
    // Step-by-step: the user is in front of the screen, they can re-choose
    // a file and correct the request before sending.
    interactive = false,
    // Resume at a given step: step-by-step restarts the generator on every
    // user decision (retry, skip, go back). Earlier steps are neither
    // replayed nor rendered — their result is already in the view's
    // report.
    fromIndex = 0,
  } = {},
) {
  const opsById = new Map((ops ?? []).map((op) => [op.id, op]))
  const runScope = { ...runVariables }
  // Shaped like the environment's variables, so the three layers merge as one
  // kind of thing. Never `sensitive`: a value written in a shared document is
  // not a secret, and marking it one would redact it out of the report that
  // has to explain where it came from.
  const defaults = Object.fromEntries(
    Object.entries(scenario?.inputs ?? {}).map(([name, value]) => [
      name,
      { value, sensitive: false },
    ]),
  )
  const steps = scenario?.steps ?? []
  let stopped = false

  for (const [index, step] of steps.entries()) {
    if (index < fromIndex) continue
    const outcome = (fields) => stepOutcome(step, index, runScope, fields)
    // A failure only stops the run if the step doesn't say otherwise.
    const halt = () => {
      stopped = !step.continueOnFailure
    }

    if (stopped) {
      yield outcome({ status: STEP_SKIPPED, reason: 'not-reached' })
      continue
    }

    const op = opsById.get(step.opId)
    if (!op) {
      halt()
      yield outcome({ status: STEP_BLOCKED, reason: 'op-not-found' })
      continue
    }

    // The run scope wins over the environment: a freshly extracted value
    // takes priority over one lingering in the env (§2). The scenario's own
    // inputs sit under both — a default is what is used when nothing else
    // provides the value, so being covered is its normal fate and not
    // something `variable-shadowed` should report.
    const warnings = Object.keys(runScope)
      .filter((name) => name in variables)
      .map((name) => ({ code: 'variable-shadowed', name }))
    const merged = { ...defaults, ...variables, ...runScope }

    // A file isn't replayable without the user: its content was never
    // stored, only its name (§2).
    if (!interactive && needsInteractive(step.request)) {
      halt()
      yield outcome({ status: STEP_BLOCKED, reason: 'needs-interactive', warnings })
      continue
    }

    const built = buildStepRequest(step, { op, baseUrl, variables: merged, authInjectionFor })
    // Rule 11: missing variable or invalid request ⇒ nothing is sent,
    // exactly the same signal as in the try-it panel.
    if (built.missing.length || built.errors.length) {
      halt()
      yield outcome({
        status: STEP_BLOCKED,
        reason: built.missing.length ? 'missing-variables' : 'invalid-request',
        built,
        missing: built.missing,
        errors: built.errors,
        warnings,
      })
      continue
    }

    const result = await sender(built, { step, index, op })
    if (!result || result.error) {
      halt()
      yield outcome({
        status: STEP_FAILED,
        // "aborting and failing the step" is the spec's own wording for a
        // timeout, and it is not a network failure: reporting it as one would
        // blame the API for a deadline we set.
        reason: result?.aborted ? 'timeout' : 'network',
        built,
        result: result ?? null,
        warnings,
      })
      continue
    }

    const judged = judgeStepResponse(step, result, runScope)
    if (judged.status !== STEP_OK) halt()
    yield outcome({ ...judged, built, result, warnings })
  }
}

// Skeleton of a step result: every field the view knows how to read,
// including those that don't apply to the rendered case — a report should
// never have to test whether a key exists. `variables` is set last: the
// caller may have just enriched the scope right before (extractions).
export function stepOutcome(step, index, runScope, fields) {
  return {
    index,
    stepId: step.id,
    opId: step.opId,
    reason: null,
    built: null,
    result: null,
    checks: [],
    extracted: [],
    missing: [],
    errors: [],
    warnings: [],
    ...fields,
    variables: { ...runScope },
  }
}

// Verdict of a step whose response has arrived: extraction THEN success
// criteria — an error response can carry the value we were looking for (an
// id, a code), and the report must show it. Both read the body through the
// same reader: a single parse per step. `runScope` is enriched in place.
//
// Exported because step-by-step also judges outside the generator:
// resending a step from the panel after its verdict must produce exactly
// the same judgment as the run.
export function judgeStepResponse(step, result, runScope) {
  if (!result || result.error) {
    return { status: STEP_FAILED, reason: 'network', checks: [], extracted: [] }
  }
  const readBody = jsonBodyReader(result.response)
  const extracted = applyExtracts(step.extract, result.response, readBody)
  Object.assign(runScope, extracted.values)
  const expect = evaluateExpect(step.expect, result.response, readBody)
  // A failed extraction is a step failure, not just a warning: without it
  // the chain is broken and this is where it must be read, not three steps
  // further down in the form of a missing variable.
  const ok = expect.ok && extracted.ok
  return {
    status: ok ? STEP_OK : STEP_FAILED,
    reason: ok ? null : expect.ok ? 'extract' : failureReason(expect.checks),
    checks: expect.checks,
    extracted: extracted.results,
  }
}

// `authInjectionFor` receives the MERGED variables (env + run scope): a
// step that extracts a token makes it usable by the following ones without
// waiting for persistence to the environment — it's the "log in then call"
// scenario (§6).
function buildStepRequest(step, { op, baseUrl = '', variables = {}, authInjectionFor = null }) {
  const request = step.request
  const content = op.requestBody?.contents?.[request.mediaTypeIndex] ?? null
  return buildRequest({
    op,
    baseUrl,
    pathValues: request.path,
    queryValues: request.query,
    cookieValues: request.cookie,
    queryString: request.queryString,
    headerRows: request.headers,
    body: request.body ?? '',
    formFields: request.formFields,
    mediaType: content?.mediaType ?? null,
    bodySchema: content?.schema ?? null,
    // Same serialization as the panel: without it a captured urlencoded body
    // would be replayed in a shape the step never sent.
    encodings: content?.encodings ?? null,
    authInjection: authInjectionFor?.(op, variables) ?? null,
    variables,
  })
}

// Summary of a run from the results accumulated by the view: the generator
// doesn't yield one, the same function serves the auto run and the
// interrupted step-by-step.
export function summarize(results) {
  const counts = { ok: 0, failed: 0, blocked: 0, skipped: 0 }
  const persist = []
  let durationMs = 0
  for (const result of results ?? []) {
    counts[result.status] = (counts[result.status] ?? 0) + 1
    durationMs += result.result?.durationMs ?? 0
    for (const extract of result.extracted ?? []) {
      if (extract.ok && extract.persist) persist.push(extract)
    }
  }
  return {
    counts,
    total: (results ?? []).length,
    ok: counts.failed === 0 && counts.blocked === 0,
    durationMs,
    persist,
  }
}

function failureReason(checks) {
  return checks.find((c) => !c.ok)?.kind === 'status' ? 'status' : 'assertion'
}
