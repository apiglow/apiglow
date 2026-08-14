import { bodyKind, isFieldsKind, mediaEssence } from '../openapi/body-kind.js'
import { normalizeScenario } from '../scenarios/model.js'
import { unescapePointerToken } from '../scenarios/pointer.js'

// Arazzo 1.1 import (docs/openapi-coverage.md §4.7) — the return trip of
// `src/export/arazzo.js`, onto the scenarios model.
//
// Two things set this importer apart from the request importers next to it:
//
//   - it is NOT operation-blind. An Arazzo step names an operation, so the
//     operation list has to come in — as data (`{ ops }`), never as the model,
//     which keeps the module testable with three-field fixtures;
//   - it produces scenarios, not drafts: everything goes out through
//     `normalizeScenario`, so an imported workflow is validated by exactly the
//     same code as a file, a share link or a config declaration.
//
// Same contract as every parser here: untrusted input, never a throw. What
// Arazzo can express and our model cannot — a step calling another workflow, an
// `xpath` criterion, a `$inputs` reference in a place we have no variable for
// — comes back as a warning code, never as a silently dropped line.
//
// One 1.1 construct is a **documented degradation** rather than a gap
// (rule 19): a step whose `action` is `send`/`receive` over a `channelPath`
// describes an AsyncAPI message, and a browser HTTP client has no message
// transport to run it on. Such a step is named (`arazzo-step-asyncapi`) and
// dropped; the HTTP steps around it import normally.

export function isArazzoDocument(value) {
  return !!value && typeof value === 'object' && typeof value.arazzo === 'string'
}

// `source` / `id`: who owns the identity of the scenarios that come out. The
// file picker owns none — an imported workflow becomes a local scenario with a
// private uuid, which is the default. A `scenarios[]` entry declaring the
// document does own it: the workflows become read-only config scenarios, and
// their route ids are decided by the loader (`scenarios/loader.js`), which is
// the only place that can see the ids the other entries already claimed.
// `id` receives the `workflowId` and the workflow's position in the document.
export function parseArazzo(doc, { ops = [], source = 'local', id = null } = {}) {
  if (!isArazzoDocument(doc)) {
    return { scenarios: [], warnings: [], errors: [{ code: 'arazzo-invalid' }] }
  }
  const warnings = []
  const version = doc.arazzo.trim()
  // Read anyway: a document carrying `workflows` is a workflow document
  // whatever revision it claims, and the shapes this reads have been stable
  // since 1.0.0. 1.1 is accepted outright: everything it adds is handled
  // below, and a 1.0 document remains a valid one.
  if (!/^1\.[01](\.|$)/.test(version)) {
    warnings.push({ code: 'arazzo-version-unknown', version: version || '—' })
  }
  const workflows = Array.isArray(doc.workflows) ? doc.workflows : []
  if (!workflows.length) {
    return { scenarios: [], warnings, errors: [{ code: 'arazzo-no-workflow' }] }
  }
  // `$self` is deliberately not read and deliberately not warned about: it is
  // the document's base URI, and we resolve nothing across documents, so it
  // changes no reading performed here. Stated because a construct ignored on
  // purpose and one forgotten look identical in code.
  const index = buildIndex(ops)
  const sources = Array.isArray(doc.sourceDescriptions) ? doc.sourceDescriptions.length : 0
  // The document's own title, kept only where it disambiguates: several
  // workflows import as several scenarios, and nothing else would tie them to
  // the file they came from. One workflow has nothing to be told apart from.
  const documentTitle = workflows.length > 1 ? asText(doc.info?.title) : ''
  // Only `components.parameters` is indexed. `inputs`, `successActions` and
  // `failureActions` have no consumer here — the first is a schema we read
  // only for its names, the other two are constructs we name and refuse — and
  // indexing them would be building for a caller that does not exist.
  const components = isPlainObject(doc.components?.parameters) ? doc.components.parameters : {}
  const scenarios = []
  workflows.forEach((workflow, position) => {
    const built = buildWorkflow(workflow, index, position, { sources, documentTitle, components })
    warnings.push(...built.warnings)
    const { scenario, errors } = normalizeScenario(built.raw, {
      source,
      id: id ? id(asText(workflow?.workflowId), position) : null,
    })
    if (!scenario) {
      warnings.push({ code: 'arazzo-workflow-rejected', name: built.raw.name })
      return
    }
    for (const error of errors) {
      warnings.push({ code: 'arazzo-step-rejected', reason: error.code, index: error.index })
    }
    scenarios.push(scenario)
  })
  if (!scenarios.length)
    return { scenarios: [], warnings, errors: [{ code: 'arazzo-no-workflow' }] }
  return { scenarios, warnings, errors: [] }
}

// --- workflow --------------------------------------------------------------

function buildWorkflow(
  workflow,
  index,
  position,
  { sources = 0, documentTitle = '', components = {} } = {},
) {
  const warnings = []
  const context = {
    index,
    sources,
    components,
    // Step ids seen so far, in document order: `dependsOn` is answered
    // against them, since our runs are sequential and "already run" is
    // exactly "appeared earlier".
    seenSteps: new Set(),
    // Applied to every step of this workflow, before the step's own.
    workflowParameters: Array.isArray(workflow?.parameters) ? workflow.parameters : [],
    // `$inputs.auth_session` back to `{{auth.session}}`: our exporter records
    // the original name in the input's description precisely because Arazzo
    // names reject the dot. Restored only when the description IS the original
    // name — a hand-written overlay's description is prose, not a variable.
    inputs: inputNames(workflow?.inputs),
    warn: (code, detail = {}) => warnings.push({ code, ...detail }),
  }
  if (workflow?.dependsOn) context.warn('arazzo-depends-on')
  // Workflow outputs re-export what steps already produced: our variables are
  // flat and live for the run, there is nothing to hand back to a caller.
  if (workflow?.outputs) context.warn('arazzo-workflow-outputs')
  // The workflow-level defaults of what `arazzo-step-actions` already names at
  // step level. Same reason: our runner has `continueOnFailure` and nothing
  // else — no retry, no goto, no branch.
  if (workflow?.successActions || workflow?.failureActions) context.warn('arazzo-workflow-actions')

  const steps = []
  for (const step of Array.isArray(workflow?.steps) ? workflow.steps : []) {
    const built = buildStep(step, context)
    if (built) steps.push(built)
  }
  const name =
    asText(workflow?.summary) || asText(workflow?.workflowId) || `Workflow ${position + 1}`
  return {
    raw: {
      name: documentTitle ? `${documentTitle} — ${name}` : name,
      description: asText(workflow?.description),
      inputs: inputDefaults(workflow?.inputs, context.inputs),
      steps,
    },
    warnings,
  }
}

function inputNames(inputs) {
  const names = new Map()
  const properties = isPlainObject(inputs?.properties) ? inputs.properties : {}
  for (const [name, schema] of Object.entries(properties)) {
    const original = asText(schema?.description)
    if (original && original !== name && safeName(original) === name) names.set(name, original)
  }
  return names
}

// A declared `default` is a value the document provides; dropping it turned a
// runnable workflow into a scenario reporting a variable the file was carrying
// all along. Read under the name the steps will actually reference — the
// dotted original where our own export recorded one — so a round trip puts the
// value back on the variable it came from. `normalizeScenario` decides what a
// usable default is; this only has to find them.
function inputDefaults(inputs, names) {
  const defaults = {}
  const properties = isPlainObject(inputs?.properties) ? inputs.properties : {}
  for (const [name, schema] of Object.entries(properties)) {
    if (schema?.default === undefined) continue
    defaults[names.get(name) ?? name] = schema.default
  }
  return defaults
}

// --- step ------------------------------------------------------------------

// The two values 1.1 gives an AsyncAPI step's `action`. Matched by value rather
// than by the field's mere presence: `action` is a common enough word that a
// step carrying a stray one — with an `operationId` that resolves perfectly
// well — should not be dropped as a message step.
const ASYNC_ACTIONS = new Set(['send', 'receive'])

function buildStep(step, context) {
  if (!isPlainObject(step)) {
    context.warn('arazzo-step-invalid')
    return null
  }
  const stepId = asText(step.stepId)
  if (step.workflowId && !step.operationId && !step.operationPath) {
    // A step that calls another workflow: nesting is out of the scenarios
    // model (docs/scenarios.md §10), and there is no request to salvage.
    context.warn('arazzo-step-workflow', { stepId, workflowId: asText(step.workflowId) })
    return null
  }
  if (step.channelPath || ASYNC_ACTIONS.has(asText(step.action))) {
    // 1.1's AsyncAPI step: `action` (`send`/`receive`) over a `channelPath`,
    // with an optional `correlationId`. Named rather than left to fall through
    // to `arazzo-step-no-operation`, which would describe this well-formed
    // document as a malformed one.
    context.warn('arazzo-step-asyncapi', {
      stepId,
      channel: asText(step.channelPath),
      action: asText(step.action),
    })
    return null
  }
  const resolved = resolveOperation(step, context, stepId)
  if (!resolved) return null
  if (step.onSuccess || step.onFailure) context.warn('arazzo-step-actions', { stepId })
  // `dependsOn` "only establishes a prerequisite relationship … and does not
  // trigger execution". Our runs are strictly sequential (docs/scenarios.md
  // §6), so a step depending on steps that all came before it already has what
  // it asked for; only a forward reference or an unknown id is a promise we
  // will not keep. Recorded before the step is added, so a step cannot satisfy
  // its own dependency.
  const unmet = (Array.isArray(step.dependsOn) ? step.dependsOn : [asText(step.dependsOn)])
    .filter((id) => asText(id))
    .filter((id) => !context.seenSteps.has(asText(id)))
  if (unmet.length) context.warn('arazzo-step-depends-on', { stepId, unmet })
  if (stepId) context.seenSteps.add(stepId)

  return {
    opId: resolved.opId,
    note: asText(step.description),
    request: {
      ...buildParameters(step, context, stepId),
      ...buildBody(step, resolved.op, context, stepId),
    },
    expect: buildExpect(step, context, stepId),
    extract: buildExtract(step, context, stepId),
    // Carried raw: `normalizeStep` decides what a valid millisecond count is,
    // and a document writing `"5s"` gets the same `step-timeout-invalid` a
    // hand-edited scenario would.
    timeout: step.timeout,
  }
}

// `operationId` and `operationPath` are not resolved the same way when they
// resolve to nothing, and deliberately so: an operationId is a name a human
// wrote and can fix, so the step is kept and the view badges it "not found"; a
// JSON pointer is not an identifier anything can display, so the step goes,
// loudly.
function resolveOperation(step, context, stepId) {
  const raw = asText(step.operationId)
  const operationId = sourceRelative(raw)
  // A document with one source description leaves nothing to be ambiguous
  // about. With several, a step naming one of them by name still resolves
  // against the single schema the reader has loaded, which may well be another
  // one — the resolution is unavoidable, saying nothing about it is not.
  if (context.sources > 1 && operationId !== raw) {
    context.warn('arazzo-source-ambiguous', { stepId, source: sourceName(raw) })
  }
  if (operationId) {
    const op = context.index.byOperationId.get(operationId) ?? null
    if (!op) context.warn('arazzo-operation-unknown', { stepId, operationId })
    return { opId: op?.id ?? operationId, op }
  }
  const path = asText(step.operationPath)
  if (path) {
    const route = decodeOperationPath(path)
    if (!route) {
      context.warn('arazzo-operation-path-invalid', { stepId, operationPath: path })
      return null
    }
    const op = context.index.byRoute.get(routeKey(route.method, route.path)) ?? null
    if (!op) {
      context.warn('arazzo-operation-unknown', {
        stepId,
        operationId: routeKey(route.method, route.path),
      })
      return null
    }
    return { opId: op.id, op }
  }
  context.warn('arazzo-step-no-operation', { stepId })
  return null
}

// `{$sourceDescriptions.openapi.url}#/paths/~1pets~1{petId}/get` — the fragment
// is the only part that says anything: which document it points into is the
// caller's business, and a pointer into a *different* description would not
// name one of our operations anyway.
function decodeOperationPath(raw) {
  const hash = raw.indexOf('#')
  if (hash < 0) return null
  const segments = raw.slice(hash + 1).split('/')
  if (segments.length !== 4 || segments[0] !== '' || unescapeToken(segments[1]) !== 'paths') {
    return null
  }
  return { path: unescapeToken(segments[2]), method: unescapeToken(segments[3]).toUpperCase() }
}

function unescapeToken(token) {
  let decoded = token
  try {
    decoded = decodeURIComponent(token)
  } catch {
    // A pointer written with a stray `%`: read it literally rather than
    // rejecting the whole step.
  }
  return unescapePointerToken(decoded)
}

// *"A list of parameters that are applicable for all steps described under
// this workflow. These parameters can be overridden at the step level but
// cannot be removed there."* — so the workflow's come first and the step's are
// applied over them. Overriding is keyed on the `(name, in)` pair, not on the
// name: `in: query` and `in: header` may legitimately share one, and folding
// them together would drop a header because a query parameter answered to the
// same word.
function buildParameters(step, context, stepId) {
  const request = { path: {}, query: {}, cookie: {}, headers: [] }
  // A variable rather than `'queryString' in request`: every other builder of
  // this shape initializes the key (`scenarios/model.js`, `import/match.js`,
  // the try-it panel), so keying "have I seen one" on its absence would invert
  // silently the day this literal is made consistent with them.
  let queryString = null
  // Which level the query string came from: the step overriding the workflow
  // is the spec's rule, two at the same level is the document's mistake, and
  // without this they are indistinguishable once the lists are concatenated.
  let queryStringLevel = null
  const declared = [
    ...(Array.isArray(context.workflowParameters) ? context.workflowParameters : []).map(
      (parameter) => ({ parameter, level: 'workflow' }),
    ),
    ...(Array.isArray(step.parameters) ? step.parameters : []).map((parameter) => ({
      parameter,
      level: 'step',
    })),
  ]
  for (const { parameter: declaredParameter, level } of declared) {
    const parameter = resolveReusable(declaredParameter, context, stepId)
    if (!parameter) continue
    const name = asText(parameter?.name)
    if (!name) {
      context.warn('arazzo-parameter-invalid', { stepId })
      continue
    }
    const value = toTemplate(parameter.value, context, stepId)
    const where = asText(parameter.in).toLowerCase()
    if (where === 'header') {
      // The map locations override by assignment; a header list has to be told
      // to. Case-insensitively, because that is what a header name is.
      const at = request.headers.findIndex(
        (header) => header.name.toLowerCase() === name.toLowerCase(),
      )
      const header = { name, value: String(value ?? '') }
      if (at < 0) request.headers.push(header)
      else request.headers[at] = header
    } else if (where === 'querystring') {
      // 1.1, aligned with OAS 3.2: the parameter IS the whole query string, so
      // it has no per-name bucket — it is the single value the try-it panel
      // edits. Two at the same level is invalid and the first one wins, which
      // is at least a choice the document can be corrected against; a step's
      // over a workflow's is not a duplicate at all, it is the override the
      // spec grants.
      if (queryString !== null && queryStringLevel === level) {
        context.warn('arazzo-querystring-extra', { stepId, name })
      } else {
        queryString = String(value ?? '')
        queryStringLevel = level
      }
    } else if (where === 'path' || where === 'query' || where === 'cookie')
      request[where][name] = value
    else context.warn('arazzo-parameter-in', { stepId, name, in: where || '—' })
  }
  return queryString === null ? request : { ...request, queryString }
}

// A Reusable Object is `{reference, value}`, and its reference names something
// the same document carries — which is why refusing it outright was a property
// of this reader, not of the document. `$components.parameters.<key>` is the
// one map with a consumer here.
//
// `value` overrides the referenced parameter's, which is the whole point of
// reusing one: *"Sets a value of the referenced parameter"*.
//
// Resolution is single-step on purpose: a components entry that is itself a
// Reusable Object is named rather than followed. Arazzo does not forbid the
// chain, and a reader that follows one has to bound it — rule 7's spirit
// applied to a document whose shape we do not control.
const COMPONENT_PARAMETER_RE = /^\$components\.parameters\.(.+)$/

function resolveReusable(parameter, context, stepId) {
  if (!isPlainObject(parameter) || !parameter.reference) return parameter
  const reference = asText(parameter.reference)
  const key = COMPONENT_PARAMETER_RE.exec(reference)?.[1]
  const target = key ? context.components?.[key] : undefined
  if (!isPlainObject(target)) {
    // Two different facts, and they were one code: "we do not resolve
    // references" was true of the reader, "this reference resolves to nothing"
    // is true of the document.
    context.warn(key ? 'arazzo-reference-unknown' : 'arazzo-parameter-reference', {
      stepId,
      reference,
    })
    return null
  }
  if (target.reference) {
    context.warn('arazzo-reference-unknown', { stepId, reference })
    return null
  }
  return parameter.value === undefined ? target : { ...target, value: parameter.value }
}

function buildBody(step, op, context, stepId) {
  const requestBody = step.requestBody
  if (!isPlainObject(requestBody)) return {}
  if (requestBody.replacements) {
    // Pointer-addressed patches over the payload. Applying them would be a
    // second body-editing language on top of `{{var}}`; the payload is
    // imported as declared and the patches are named as missing.
    context.warn('arazzo-replacements', { stepId })
  }
  const contentType = asText(requestBody.contentType)
  const contents = op?.requestBody?.contents ?? []
  let mediaTypeIndex = contentType
    ? contents.findIndex((entry) => mediaEssence(entry.mediaType) === mediaEssence(contentType))
    : -1
  if (contentType && mediaTypeIndex < 0 && contents.length) {
    context.warn('arazzo-content-type-unknown', { stepId, contentType })
  }
  if (mediaTypeIndex < 0) mediaTypeIndex = 0
  const payload = requestBody.payload
  if (payload === undefined) return { mediaTypeIndex }
  if (isPlainObject(payload) && isSelectorObject(payload)) {
    // The whole body being a selector: caught here rather than left to
    // `toTemplate`, which would have produced an empty body where the reader
    // deserves none at all — and, on a field-shaped media type, three form
    // fields named `context`, `selector` and `type`.
    context.warn('arazzo-selector-unsupported', { stepId, type: selectorType(payload) })
    return { mediaTypeIndex }
  }

  // The editor's shape is the OPERATION's business (rule 20): a field map goes
  // to the field list only if the media type the panel will show is one that
  // has fields.
  const content = contents[mediaTypeIndex] ?? (contentType ? { mediaType: contentType } : null)
  if (content && isFieldsKind(bodyKind(content)) && isPlainObject(payload)) {
    return {
      mediaTypeIndex,
      formFields: Object.entries(payload).map(([name, value]) =>
        formField(name, value, context, stepId),
      ),
    }
  }
  if (typeof payload === 'string') {
    return { mediaTypeIndex, body: String(toTemplate(payload, context, stepId)) }
  }
  return { mediaTypeIndex, body: JSON.stringify(toTemplate(payload, context, stepId), null, 2) }
}

// `@invoice.pdf` is what the export writes where a file was: the content never
// left the exporting machine, only the name did.
function formField(name, value, context, stepId) {
  if (typeof value === 'string' && value.startsWith('@')) {
    return { name, value: '', fileName: value.slice(1) }
  }
  const templated = toTemplate(value, context, stepId)
  // A form field is a wire value: a structured one only exists here as the
  // text it will be sent as.
  if (templated !== null && typeof templated === 'object') {
    return { name, value: JSON.stringify(templated) }
  }
  return { name, value: String(templated ?? '') }
}

// 1.1 widened `outputs` from `Map[string, {expression}]` to
// `Map[string, {expression} | Selector Object]`. Both spellings land on the
// same `{source, pointer}`; each helper names its own failure, so nothing here
// warns twice for one output.
function buildExtract(step, context, stepId) {
  const extract = []
  for (const [name, declared] of Object.entries(isPlainObject(step.outputs) ? step.outputs : {})) {
    const source = isPlainObject(declared)
      ? selectorSource(declared, context, stepId, name)
      : expressionSource(declared, context, stepId, name)
    // Neither `persist` nor `sensitive` exist in Arazzo: an imported output
    // lives for the run, which is the safer of the two defaults.
    if (source) extract.push({ name, ...source })
  }
  return extract
}

function expressionSource(declared, context, stepId, name) {
  const expression = asText(declared)
  const source = responseSource(expression)
  if (!source) context.warn('arazzo-output-unsupported', { stepId, name, expression })
  return source
}

// The Selector Object is `{context, selector, type}`. `jsonpointer` and
// `jsonpath` both land on the response body — the first in the `pointer` slot,
// the second in `query`, never sharing one. `xpath` is named by type, and it
// is waived rather than missing: the waiver was written about the language,
// and a selector is that language at another site
// (`docs/registry/specs-registry.md`).
function selectorSource(selector, context, stepId, name) {
  const type = asText(selector.type).toLowerCase()
  if (type !== 'jsonpointer' && type !== 'jsonpath') {
    context.warn('arazzo-output-type', { stepId, name, type: type || '—' })
    return null
  }
  const expression = asText(selector.context)
  const base = responseSource(expression)
  // Neither addressing language means anything outside a structured value: a
  // header is a string, and our header extract already spends its pointer slot
  // on the header's name.
  if (base?.source !== 'body') {
    context.warn('arazzo-output-unsupported', { stepId, name, expression })
    return null
  }
  if (type === 'jsonpath') {
    // A query is absolute over what its `context` designates, so a context
    // carrying a fragment would mean composing a pointer and a query — two
    // languages in one address, which is exactly what the separate slots
    // exist to prevent.
    if (base.pointer) {
      context.warn('arazzo-output-unsupported', { stepId, name, expression })
      return null
    }
    return { source: 'body', query: asText(selector.selector) }
  }
  return { source: 'body', pointer: `${base.pointer}${asText(selector.selector)}` }
}

const RESPONSE_BODY_RE = /^\$response\.body(?:#(.*))?$/
const RESPONSE_HEADER_RE = /^\$response\.header\.(.+)$/

function responseSource(expression) {
  const body = RESPONSE_BODY_RE.exec(expression)
  if (body) return { source: 'body', pointer: body[1] ?? '' }
  const header = RESPONSE_HEADER_RE.exec(expression)
  if (header) return { source: 'header', pointer: header[1] }
  return null
}

// --- success criteria ------------------------------------------------------

const STATUS_EQUALS_RE = /^\$statusCode\s*==\s*(\d{3})$/
const STATUS_RANGE_RE = /^\$statusCode\s*>=\s*(\d{3})\s*&&\s*\$statusCode\s*<=\s*(\d{3})$/
const BODY_CONDITION_RE = /^\$response\.body(#[^\s=!<>]*)?\s*(?:(==|!=)\s*(.+))?$/

function buildExpect(step, context, stepId) {
  let status
  const assertions = []
  for (const criterion of Array.isArray(step.successCriteria) ? step.successCriteria : []) {
    const condition = typeof criterion === 'string' ? criterion : asText(criterion?.condition)
    const type = criterionType(criterion)
    if (type === 'jsonpath') {
      const assertion = jsonPathAssertion(criterion, condition, context, stepId)
      if (assertion) assertions.push(assertion)
      continue
    }
    if (type === 'regex') {
      const assertion = regexAssertion(criterion, condition, context, stepId)
      if (assertion) assertions.push(assertion)
      continue
    }
    if (type && type !== 'simple') {
      // Only `xpath` reaches here now, and it is waived rather than missing:
      // it means XPath 3.1, which the browser does not give us
      // (docs/registry/specs-registry.md).
      context.warn('arazzo-criterion-type', { stepId, type, condition })
      continue
    }
    if (isPlainObject(criterion) && criterion.context) {
      context.warn('arazzo-criterion-context', { stepId, condition })
      continue
    }
    const parsed = parseCondition(condition)
    if (!parsed) {
      context.warn('arazzo-criterion-unsupported', { stepId, condition })
      continue
    }
    if (parsed.status !== undefined) {
      // `2xx` IS our default verdict (`statusRange`), so re-importing it as an
      // explicit expectation would make an exported scenario differ from the
      // one it came from.
      if (parsed.status === '2xx') continue
      if (status === undefined) status = parsed.status
      else context.warn('arazzo-criterion-status-extra', { stepId, condition })
      continue
    }
    assertions.push(parsed.assertion)
  }
  if (status === undefined && !assertions.length) return null
  return { status, assertions }
}

// 1.1's `jsonpath` criterion is truthiness over a nodelist, which is our
// `exists` with a query where the pointer was — so it imports as an assertion
// rather than as a warning, since `ab016eb` bundled the RFC 9535 engine that
// used to be missing.
//
// `context` is a MUST for this type, and the whole response body is the only
// one our assertions have a place for: a context naming something else is
// named by the context, not by the type, because the type is supported.
function jsonPathAssertion(criterion, condition, context, stepId) {
  if (!condition) {
    context.warn('arazzo-criterion-unsupported', { stepId, condition })
    return null
  }
  const expression = asText(criterion.context)
  const source = responseSource(expression)
  if (source?.source !== 'body' || source.pointer) {
    context.warn('arazzo-criterion-context', { stepId, condition, context: expression || '—' })
    return null
  }
  return { op: 'matches', query: condition }
}

// The `regex` criterion is a comparison of one value against a pattern, which
// is `{pointer, op, value}` exactly — the pattern goes in the slot `equals`
// spends on its literal. `context` is a MUST for this type and must point
// *inside* the body: over the whole body it would be the row
// `activeAssertions` drops, and a header has no assertion to land on.
function regexAssertion(criterion, condition, context, stepId) {
  const expression = asText(criterion.context)
  const source = responseSource(expression)
  if (source?.source !== 'body' || !source.pointer) {
    context.warn('arazzo-criterion-context', { stepId, condition, context: expression || '—' })
    return null
  }
  // Untrimmed, unlike everything else read here: a pattern is text, and
  // ` foo` is not the same regular expression as `foo`.
  const pattern = typeof criterion.condition === 'string' ? criterion.condition : ''
  if (!pattern) {
    context.warn('arazzo-criterion-unsupported', { stepId, condition })
    return null
  }
  return { pointer: source.pointer, op: 'regex', value: pattern }
}

function criterionType(criterion) {
  if (!isPlainObject(criterion)) return ''
  // The Criterion Object's `type` is a string or an expression-type object.
  return typeof criterion.type === 'string' ? criterion.type : asText(criterion.type?.type)
}

function parseCondition(condition) {
  const source = condition.trim()
  if (!source) return null
  const equals = STATUS_EQUALS_RE.exec(source)
  if (equals) return { status: Number(equals[1]) }
  const range = STATUS_RANGE_RE.exec(source)
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (min % 100 === 0 && max === min + 99) return { status: `${min / 100}xx` }
    return null
  }
  const body = BODY_CONDITION_RE.exec(source)
  if (!body) return null
  const [, fragment, operator, literal] = body
  const pointer = fragment ? fragment.slice(1) : ''
  // An assertion on the whole body is one our runner drops anyway
  // (`activeAssertions`): importing it would show a row that never runs.
  if (!pointer) return null
  if (!operator) return { assertion: { pointer, op: 'exists' } }
  const value = parseLiteral(literal)
  // `!= null` is how the exporter writes "exists"; any other inequality has no
  // operator on our side, and `== null` even less.
  if (operator === '!=') return value === null ? { assertion: { pointer, op: 'exists' } } : null
  if (value === undefined || value === null) return null
  return { assertion: { pointer, op: 'equals', value: String(value) } }
}

function parseLiteral(raw) {
  const source = raw.trim()
  if ((source[0] === "'" || source[0] === '"') && source[source.length - 1] === source[0]) {
    return source.slice(1, -1).replace(/\\(['"])/g, '$1')
  }
  if (source === 'null') return null
  if (source === 'true' || source === 'false') return source
  if (/^-?\d+(\.\d+)?$/.test(source)) return source
  return undefined
}

// --- runtime expressions → {{variables}} ------------------------------------

const INPUT_RE = /^\$inputs\.([\w.-]+)$/
const STEP_OUTPUT_RE = /^\$steps\.([\w.-]+)\.outputs\.([\w.-]+)$/
const EMBEDDED_RE = /\{(\$[^{}]+)\}/g

function toTemplate(value, context, stepId) {
  if (Array.isArray(value)) return value.map((item) => toTemplate(item, context, stepId))
  if (isPlainObject(value)) {
    if (isSelectorObject(value)) {
      // Before the recursion, which is what used to walk a Selector Object as
      // if it were data and land it in the request. `''` rather than the
      // object: a value we cannot build must not be replaced by the
      // description of how to build it.
      context.warn('arazzo-selector-unsupported', { stepId, type: selectorType(value) })
      return ''
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toTemplate(item, context, stepId)]),
    )
  }
  if (typeof value !== 'string') return value
  if (value.startsWith('$')) {
    const name = variableName(value, context)
    if (name) return `{{${name}}}`
    context.warn('arazzo-expression-unsupported', { stepId, expression: value })
    return value
  }
  return value.replace(EMBEDDED_RE, (whole, expression) => {
    const name = variableName(expression, context)
    if (name) return `{{${name}}}`
    context.warn('arazzo-expression-unsupported', { stepId, expression })
    return whole
  })
}

// A Selector Object (`{context, selector, type}`) is legal in four places:
// step `outputs`, a Parameter Object's `value`, a Request Body Object's
// `payload`, and a Payload Replacement's `value`. `selectorSource()` reads the
// first; here we recognize the other three, where none of them can be
// *resolved* — a selector picks a value out of a runtime structure, and a
// parameter value of ours is a `{{var}}` template fed by a named extraction.
// Even a `jsonpointer` selector has nowhere to land.
//
// Detection deliberately does not require `type`, which the spec makes
// mandatory: a Selector Object written without one is still a Selector Object,
// and reading it as data is the failure being fixed. The false positive that
// costs is an object parameter whose two keys happen to be `context` and
// `selector`, both strings — which is the trade, stated rather than left to be
// rediscovered.
function isSelectorObject(value) {
  return typeof value.context === 'string' && typeof value.selector === 'string'
}

function selectorType(selector) {
  const type = typeof selector.type === 'string' ? selector.type : asText(selector.type?.type)
  return type || '—'
}

// A step output and the variable it becomes carry the same name: our extract
// names it after the Arazzo output, so a reference to it needs no step index —
// which is also why a forward reference (a chaining Arazzo allows and we do
// not) still lands on a name, and fails as a missing variable at run time.
function variableName(expression, context) {
  const input = INPUT_RE.exec(expression)
  if (input) return context.inputs.get(input[1]) ?? input[1]
  const output = STEP_OUTPUT_RE.exec(expression)
  if (output) return output[2]
  return null
}

// --- operation index -------------------------------------------------------

function buildIndex(ops) {
  const byOperationId = new Map()
  const byRoute = new Map()
  for (const op of ops ?? []) {
    if (op?.operationId && !byOperationId.has(op.operationId)) byOperationId.set(op.operationId, op)
    const key = routeKey(op?.method, op?.path)
    if (key && !byRoute.has(key)) byRoute.set(key, op)
  }
  return { byOperationId, byRoute }
}

function routeKey(method, path) {
  if (!method || !path) return ''
  return `${String(method).toUpperCase()} ${path}`
}

// `$sourceDescriptions.openapi.getPetById` → `getPetById`. Which description it
// names is not something we can check: one document is loaded, and it is the
// one the reader is importing into.
function sourceRelative(operationId) {
  const match = SOURCE_PREFIX_RE.exec(operationId)
  return match ? match[2] : operationId
}

function sourceName(operationId) {
  return SOURCE_PREFIX_RE.exec(operationId)?.[1] ?? ''
}

// The name alphabet is the spec's own (`[A-Za-z0-9_\-]+`), which excludes the
// dot — and that matters now that the name is captured rather than skipped: a
// pattern allowing dots in it splits `$sourceDescriptions.api.get.Pet` after
// `api.get`, naming a source nobody declared and an operation nobody wrote.
const SOURCE_PREFIX_RE = /^\$sourceDescriptions\.([\w-]+)\.(.+)$/

function safeName(name) {
  return String(name ?? '').replace(/[^A-Za-z0-9_-]+/g, '_')
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
