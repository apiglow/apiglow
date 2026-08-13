import { referencedVariables } from '../env/interpolate.js'
import { normalizeParamValue, paramValueTemplates } from '../openapi/params.js'
import { STATUS_CLASS_RE } from './evaluate.js'

// Internal model of scenarios (docs/scenarios.md §2) — pure, tested functions.
//
// Every input is untrusted (imported file, share link, JSON declared in
// config, IndexedDB record editable from devtools): same contract as
// `decodeShareState` — never throw, a `null` scenario or a list of
// error codes that the UI translates.

const SCENARIO_FORMAT = 'apiglow-scenario'
const SCENARIO_VERSION = 1

// A config scenario's id travels in the URL and keys its route. Two authors
// write it: the integrator, as the `[a-z0-9-]` slug of a `scenarios[]` entry,
// and Arazzo, as the `workflowId` a declared document brings with it, adopted
// as-is (docs/scenarios.md §3). This alphabet is the union of the two.
const CONFIG_ID_RE = /^[A-Za-z0-9._-]+$/

// Exported for the loader, which has to know whether a `workflowId` can serve
// as a route id before it hands it to `parseArazzo` — the alternative being a
// workflow rejected for the shape of its name.
export function isConfigScenarioId(id) {
  return typeof id === 'string' && CONFIG_ID_RE.test(id)
}
// Aligned with interpolation: an extracted variable must be referenceable.
const VAR_NAME_RE = /^[\w.-]+$/
const SOURCES = ['body', 'header']
// `matches` is Arazzo's `jsonpath` criterion: an RFC 9535 query is truthy
// when it selects at least one node — `exists` generalized from a pointer to a
// query, which is why it is an op here and not a second assertion language.
// `regex` is its `regex` criterion, and needs no such generalization: it
// compares one pointed-at value against a pattern, which is `equals` with a
// looser comparator.
const ASSERT_OPS = ['exists', 'equals', 'regex', 'matches']

export function createScenario({ name = '', description = '' } = {}) {
  return {
    id: crypto.randomUUID(),
    name: String(name),
    description: String(description),
    source: 'local',
    inputs: {},
    steps: [],
  }
}

export function createStep({ opId, request = null, note = '' } = {}) {
  return {
    id: crypto.randomUUID(),
    opId: String(opId ?? ''),
    note: String(note ?? ''),
    request: normalizeRequest(request),
    expect: null,
    extract: [],
    continueOnFailure: false,
    timeout: undefined,
  }
}

// `source: 'config'` requires a route-usable id (declared in config, it serves
// as a route); locally a uuid is manufactured if it's missing.
export function normalizeScenario(raw, { source = 'local', id = null } = {}) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { scenario: null, errors: [{ code: 'scenario-invalid' }] }
  }
  const wantedId = id ?? raw.id
  let scenarioId = typeof wantedId === 'string' ? wantedId.trim() : ''
  if (source === 'config') {
    if (!CONFIG_ID_RE.test(scenarioId)) {
      errors.push({ code: 'scenario-id-invalid', id: scenarioId })
      return { scenario: null, errors }
    }
  } else if (!scenarioId) {
    scenarioId = crypto.randomUUID()
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) errors.push({ code: 'scenario-name-missing' })

  const steps = []
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : []
  if (!Array.isArray(raw.steps) && raw.steps !== undefined)
    errors.push({ code: 'scenario-steps-invalid' })
  rawSteps.forEach((rawStep, index) => {
    const { step, errors: stepErrors } = normalizeStep(rawStep)
    for (const error of stepErrors) errors.push({ ...error, index })
    if (step) steps.push(step)
  })

  return {
    scenario: {
      id: scenarioId,
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      source: source === 'config' ? 'config' : 'local',
      inputs: normalizeInputs(raw.inputs),
      steps,
    },
    errors,
  }
}

// Values the scenario carries for its own variables (Arazzo's workflow input
// defaults, §5.2). Scalars only: a `{{var}}` substitutes text, and serializing
// an object here would invent a wire format nobody chose. A name no template
// could reference is dropped rather than stored unusable — the same alphabet
// an extraction has to satisfy.
function normalizeInputs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const inputs = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!VAR_NAME_RE.test(name)) continue
    if (value === null || value === undefined || typeof value === 'object') continue
    inputs[name] = String(value)
  }
  return inputs
}

function normalizeStep(raw) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { step: null, errors: [{ code: 'step-invalid' }] }
  const opId = typeof raw.opId === 'string' ? raw.opId.trim() : ''
  // Without opId, the step designates no request: nothing to salvage. (An
  // opId absent from the schema, though, remains a valid step — "not
  // found" badge.)
  if (!opId) return { step: null, errors: [{ code: 'step-op-missing' }] }

  const extract = []
  for (const rawExtract of Array.isArray(raw.extract) ? raw.extract : []) {
    const { value, error } = normalizeExtract(rawExtract)
    if (error) errors.push(error)
    if (value) extract.push(value)
  }

  return {
    step: {
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      opId,
      note: typeof raw.note === 'string' ? raw.note : '',
      request: normalizeRequest(raw.request),
      expect: normalizeExpect(raw.expect, errors),
      extract,
      continueOnFailure: raw.continueOnFailure === true,
      timeout: normalizeTimeout(raw.timeout, errors),
    },
    errors,
  }
}

// Arazzo's step `timeout`, in milliseconds. Coerced like `status` rather than
// accepted loosely: a value that is not a positive integer is a mistake in the
// document, and silently reading `"5s"` as no timeout at all would leave a
// step unbounded where the file said otherwise.
function normalizeTimeout(raw, errors) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const value = Number(raw)
  if (Number.isInteger(value) && value > 0) return value
  errors.push({ code: 'step-timeout-invalid', timeout: raw })
  return undefined
}

// Same shape as the try-it panel state and as `decodeShareState`: capture,
// sharing and scenarios manipulate the same mirror (§2).
export function normalizeRequest(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  // A list (`tags: [cat, dog]`) or a map (`filter: {role: admin}`) is legal —
  // that's an array or object parameter, which style/explode serializes at
  // send time. Everything else is dropped.
  const stringMap = (obj) =>
    Object.fromEntries(
      Object.entries(obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {})
        .map(([name, value]) => [name, normalizeParamValue(value)])
        .filter(([, value]) => value !== undefined),
    )
  const formFields = Array.isArray(source.formFields)
    ? source.formFields
        .filter((f) => f && typeof f === 'object' && typeof f.name === 'string' && f.name)
        .map((f) => ({
          name: f.name,
          value: typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : '',
          // A file doesn't serialize: only its name survives, and that's
          // enough to mark the step "requires step-by-step" (§2).
          fileName: typeof f.fileName === 'string' && f.fileName ? f.fileName : undefined,
        }))
    : null
  return {
    path: stringMap(source.path),
    query: stringMap(source.query),
    // `in: cookie` parameters. Carried like any other value even though the
    // browser drops the header they end up in (T3): the step's cURL export
    // and its snippets do send it, and a captured value that silently
    // disappears is worse than one that cannot leave the tab.
    cookie: stringMap(source.cookie),
    queryString: typeof source.queryString === 'string' ? source.queryString : '',
    headers: (Array.isArray(source.headers) ? source.headers : [])
      .filter((row) => row && typeof row === 'object' && typeof row.name === 'string' && row.name)
      .map((row) => ({ name: row.name, value: typeof row.value === 'string' ? row.value : '' })),
    body: typeof source.body === 'string' ? source.body : null,
    mediaTypeIndex:
      Number.isInteger(source.mediaTypeIndex) && source.mediaTypeIndex >= 0
        ? source.mediaTypeIndex
        : 0,
    formFields: formFields?.length ? formFields : null,
    // Binary body: same story one level up — the whole body was a file, only
    // its name survives the capture.
    bodyFileName:
      typeof source.bodyFileName === 'string' && source.bodyFileName
        ? source.bodyFileName
        : undefined,
  }
}

// A step whose body carries a file can't be replayed without a human: the
// content was never stored, only the name (§2). Shared by the runner (which
// blocks) and the scenario view (which badges it).
export function needsInteractive(request) {
  return !!request?.bodyFileName || (request?.formFields ?? []).some((f) => f.fileName)
}

// Exported: the chaining editor also runs it, otherwise the rule "nothing
// to store if there's neither status nor assertion" and the status
// coercion would exist in two copies (one of which would leave '404' as a
// string where the reload yields the number 404).
export function normalizeExpect(raw, errors = []) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const assertions = []
  for (const rawAssertion of Array.isArray(raw.assertions) ? raw.assertions : []) {
    if (!rawAssertion || typeof rawAssertion !== 'object') {
      errors.push({ code: 'assertion-invalid' })
      continue
    }
    const op = ASSERT_OPS.includes(rawAssertion.op) ? rawAssertion.op : 'exists'
    if (op === 'matches') {
      // The query lives in its own field, never in `pointer`: an RFC 9535
      // query and a JSON pointer are two languages, and a slot holding either
      // is exactly the silent drift rule 20 exists against.
      assertions.push({
        op,
        query: typeof rawAssertion.query === 'string' ? rawAssertion.query : '',
      })
      continue
    }
    assertions.push({
      pointer: typeof rawAssertion.pointer === 'string' ? rawAssertion.pointer : '',
      op,
      // `exists` is the only pointer op with nothing to compare against:
      // keeping a value for it would clutter the report. `regex` carries its
      // pattern here, in the same slot `equals` carries its literal.
      value: op === 'exists' ? undefined : (rawAssertion.value ?? ''),
    })
  }
  const status = normalizeStatus(raw.status)
  if (raw.status !== undefined && status === null)
    errors.push({ code: 'expect-status-invalid', status: raw.status })
  if (status === null && !assertions.length) return null
  return { status: status ?? undefined, assertions }
}

function normalizeStatus(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599) return raw
  const asText = String(raw)
  if (STATUS_CLASS_RE.test(asText)) return asText.toLowerCase()
  if (/^[1-5][0-9]{2}$/.test(asText)) return Number(asText)
  return null
}

function normalizeExtract(raw) {
  if (!raw || typeof raw !== 'object') return { value: null, error: { code: 'extract-invalid' } }
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!VAR_NAME_RE.test(name)) return { value: null, error: { code: 'extract-name-invalid', name } }
  const persist = raw.persist === true
  // An RFC 9535 query in its own field, never in `pointer` — the same rule the
  // `matches` assertion follows, for the same reason: two addressing languages
  // sharing a slot is drift nothing can see. A query only reads the body, so
  // `source` is not a choice when one is present.
  // The presence of the field is the mode, not its content: a row being filled
  // in must stay a query row across a reload, the way a `matches` assertion
  // stays one on an explicit op.
  if (typeof raw.query === 'string') {
    return {
      value: {
        name,
        source: 'body',
        query: raw.query,
        persist,
        sensitive: raw.sensitive === true || (persist && name.startsWith('auth.')),
      },
      error: null,
    }
  }
  return {
    value: {
      name,
      source: SOURCES.includes(raw.source) ? raw.source : 'body',
      pointer: typeof raw.pointer === 'string' ? raw.pointer : '',
      persist,
      // A value that's going to be written into `auth.*` is a credential
      // by construction: marking it sensitive isn't left to choice (§2).
      sensitive: raw.sensitive === true || (persist && name.startsWith('auth.')),
    },
    error: null,
  }
}

// Editable local copy (§3: a config scenario isn't edited in place). Step
// ids are redone: they serve as keys for run reports, two scenarios can't
// share the same ones.
export function duplicateScenario(scenario, { name } = {}) {
  return {
    ...scenario,
    id: crypto.randomUUID(),
    name: name ?? scenario.name,
    source: 'local',
    steps: (scenario.steps ?? []).map((step) => ({ ...step, id: crypto.randomUUID() })),
  }
}

// Scenario prerequisites (§5.2): variables referenced by the steps, minus
// those an earlier extraction produces. It's the answer to "why is this
// going to fail" before even launching.
export function scenarioVariables(scenario) {
  // Set: insertion order is that of the steps, and deduplication is free.
  // Order matters — it's the order of the bullets in the prerequisites panel.
  const required = new Set()
  // A scenario's own inputs count as produced from the first step on: the
  // panel must not ask for a value the scenario is already carrying.
  const produced = new Set(Object.keys(scenario?.inputs ?? {}))
  for (const step of scenario?.steps ?? []) {
    for (const name of stepReferences(step)) {
      if (!produced.has(name)) required.add(name)
    }
    for (const extract of step.extract ?? []) produced.add(extract.name)
  }
  return { required: [...required], produced: [...produced] }
}

// Variables that a step consumes, across all request fields. Exported for
// the timeline: a step must say what it needs, not just what it produces —
// it's the other half of chaining, and the only one that wasn't visible
// anywhere.
export function stepReferences(step) {
  const request = step?.request ?? {}
  const templates = [
    ...paramValueTemplates(request.path),
    ...paramValueTemplates(request.query),
    ...paramValueTemplates(request.cookie),
    request.queryString,
    ...(request.headers ?? []).flatMap((h) => [h.name, h.value]),
    request.body,
    ...(request.formFields ?? []).map((f) => f.value),
  ]
  const names = new Set()
  for (const template of templates) {
    for (const name of referencedVariables(template)) names.add(name)
  }
  return names
}

// File envelope (§8.1) — it's also the format of scenarios declared in
// config: an exported local scenario is directly publishable.
export function encodeScenarioFile(scenario) {
  // Neither `id` nor `source`: the local id is a private uuid (reimporting
  // it twice would overwrite the first), the source depends on who loads
  // the file.
  const { id, source, ...rest } = scenario ?? {}
  return { format: SCENARIO_FORMAT, v: SCENARIO_VERSION, scenario: rest }
}

export function decodeScenarioFile(raw, options = {}) {
  let payload = raw
  if (typeof raw === 'string') {
    try {
      payload = JSON.parse(raw)
    } catch {
      return { scenario: null, errors: [{ code: 'file-invalid-json' }] }
    }
  }
  if (!payload || typeof payload !== 'object')
    return { scenario: null, errors: [{ code: 'file-invalid' }] }
  if (payload.format !== SCENARIO_FORMAT)
    return { scenario: null, errors: [{ code: 'file-format-unknown' }] }
  if (payload.v !== SCENARIO_VERSION)
    return { scenario: null, errors: [{ code: 'file-version-unknown', v: payload.v }] }
  return normalizeScenario(payload.scenario, options)
}
