import { replaceVariables } from '../env/interpolate.js'
import { slugify } from '../openapi/model.js'
import { activeAssertions, statusRange } from '../scenarios/evaluate.js'
import { pointerFrom } from '../scenarios/pointer.js'

// Arazzo 1.1.0 export (docs/scenarios.md §8.3) — pure generator, tested by
// snapshot (rule 12).
//
// Our internal model was modeled on Arazzo concepts (steps, outputs,
// successCriteria, runtime expressions): the translation is mechanical, which
// is what makes it cheap. What isn't, and what's done here:
//
//   - `{{var}}` becomes runtime expressions — `$inputs.x` for what comes from
//     the environment, `$steps.<step>.outputs.x` for what a previous step
//     extracted (this is chaining, made explicit);
//   - Arazzo names (workflowId, stepId, inputs, outputs) are constrained to
//     `[A-Za-z0-9._-]`, and the dot breaks `$steps.x.outputs.y` expressions:
//     `auth.session` becomes `auth_session`.

// Exported: the About dialog states which Arazzo revision the export targets,
// and one constant is what keeps that claim true.
export const ARAZZO_VERSION = '1.1.0'

export function toArazzo(scenario, { ops = [], sourceUrl = '', sourceName = 'openapi' } = {}) {
  const opsById = new Map((ops ?? []).map((op) => [op.id, op]))
  const source = safeName(sourceName) || 'openapi'
  // Variable name → runtime expression that produces it. Whatever no step
  // produces becomes a workflow input.
  const expressions = new Map()
  const inputs = new Map()
  const usedStepIds = new Set()

  const expressionFor = (name) => {
    const known = expressions.get(name)
    if (known) return known
    const inputName = safeName(name)
    inputs.set(inputName, name)
    const expression = `$inputs.${inputName}`
    expressions.set(name, expression)
    return expression
  }

  const steps = (scenario?.steps ?? []).map((step, index) => {
    const op = opsById.get(step.opId) ?? null
    const stepId = uniqueStepId(usedStepIds, op, step, index)
    const request = step.request ?? {}
    const parameters = [
      ...Object.entries(request.path ?? {}).map(([name, value]) =>
        param(name, 'path', value, expressionFor),
      ),
      ...Object.entries(request.query ?? {}).map(([name, value]) =>
        param(name, 'query', value, expressionFor),
      ),
      // `cookie` is one of the Parameter Object's five locations, so the value
      // belongs in the document even though the browser drops the header it
      // ends up in on our side (T3): a runner reading this file is not a
      // browser, and a step it cannot reproduce is worse than one we cannot.
      ...Object.entries(request.cookie ?? {}).map(([name, value]) =>
        param(name, 'cookie', value, expressionFor),
      ),
      ...(request.headers ?? []).map((row) => param(row.name, 'header', row.value, expressionFor)),
      ...queryStringParam(op, request, expressionFor),
    ]
    const out = {
      stepId,
      ...(step.note ? { description: step.note } : {}),
      ...operationRef(op, step, source),
      ...(parameters.length ? { parameters } : {}),
      ...requestBody(op, request, expressionFor),
      ...(step.timeout ? { timeout: step.timeout } : {}),
      successCriteria: successCriteria(step.expect),
    }
    const outputs = {}
    for (const extract of step.extract ?? []) {
      const outputName = safeName(extract.name)
      // A query has no runtime-expression spelling: 1.1's Selector Object is
      // the only shape that can carry one, which is why it appears here and
      // nowhere else. Pointer and header extracts keep their expression form,
      // so an existing document exports byte-identically.
      outputs[outputName] = extract.query
        ? { context: '$response.body', selector: extract.query, type: 'jsonpath' }
        : extract.source === 'header'
          ? `$response.header.${extract.pointer}`
          : bodyExpression(extract.pointer)
      // Registered AFTER translating this step: a variable can't reference
      // itself before it exists.
      expressions.set(extract.name, `$steps.${stepId}.outputs.${outputName}`)
    }
    if (Object.keys(outputs).length) out.outputs = outputs
    return out
  })

  const workflow = {
    workflowId: safeName(slugify(scenario?.name) || scenario?.id || 'workflow'),
    ...(scenario?.name ? { summary: scenario.name } : {}),
    ...(scenario?.description ? { description: scenario.description } : {}),
    ...(inputs.size
      ? {
          inputs: {
            type: 'object',
            properties: Object.fromEntries(
              [...inputs].map(([inputName, original]) => [
                inputName,
                {
                  type: 'string',
                  // The description keeps the original name: that's what's
                  // shown in the doc's environment manager.
                  ...(inputName === original ? {} : { description: original }),
                  // Merged into the property the exporter already writes, not
                  // a property of its own: the description is what carries the
                  // dotted name home, and a second entry would lose it.
                  ...(scenario?.inputs?.[original] === undefined
                    ? {}
                    : { default: scenario.inputs[original] }),
                },
              ]),
            ),
            // A variable the scenario provides is not one the caller must:
            // exporting it as required would describe a workflow that cannot
            // run without an input it carries itself.
            required: [...inputs]
              .filter(([, original]) => scenario?.inputs?.[original] === undefined)
              .map(([inputName]) => inputName),
          },
        }
      : {}),
    steps,
  }

  return {
    arazzo: ARAZZO_VERSION,
    info: {
      title: scenario?.name || 'Scenario',
      version: '1.0.0',
      ...(scenario?.description ? { description: scenario.description } : {}),
    },
    sourceDescriptions: [{ name: source, url: sourceUrl, type: 'openapi' }],
    workflows: [workflow],
  }
}

// The recipe a publication surface hands out for one declared scenario — the
// LLM files (docs/scenario-handoff.md §3.3) and the bake (§3.4), which have to
// hand out the same document for the inlined copy and the served file to agree.
//
// A declared Arazzo document is published as it stands, whole: it carries its
// own `sourceDescriptions`, which it got from its author and which owe nothing
// to how this documentation loaded its schema, and nothing of it passes through
// our model on the way out — so nothing of it can be lost there. A document
// holding several workflows is therefore published once per scenario it
// declared.
//
// A generated one takes `sourceDescriptions` from the schema URL: an inline
// schema produces a document whose source no runner can fetch, so none is
// emitted — the rule the MCP export applies for the same reason
// (docs/architecture.md §5.14).
export function publishedArazzo(entry, { ops = [], specUrl = '' } = {}) {
  if (entry?.arazzo) return entry.arazzo
  if (!specUrl) return null
  return toArazzo(entry?.scenario, { ops, sourceUrl: specUrl })
}

// Operation reference: `operationId` when the schema declares one (this is
// what an Arazzo tool will be able to resolve), otherwise the path pointer —
// our internal id (`get-pets-petid`) only exists on our side.
function operationRef(op, step, source) {
  if (op?.operationId) return { operationId: `$sourceDescriptions.${source}.${op.operationId}` }
  if (op) {
    return {
      operationPath: `{$sourceDescriptions.${source}.url}#${pointerFrom(['paths', op.path, op.method.toLowerCase()])}`,
    }
  }
  // Orphaned step: the raw name, up to the author to fix it.
  return { operationId: step.opId }
}

// The whole query string as one value (`in: querystring`) has no 1.0 spelling,
// so this scenario field used to be dropped on export. Its name is the one the
// operation declares for that parameter — the schema names it, we do not. The
// fallback names one we invented, which a conformant runner has nothing to bind
// to; it is still better than dropping the value, and it is unreachable in
// practice: a scenario only carries a query string if the panel offered the
// field, which needs the operation to declare the parameter in the first place.
function queryStringParam(op, request, expressionFor) {
  const value = request.queryString
  if (!value) return []
  const declared = (op?.parameters ?? []).find((parameter) => parameter.in === 'querystring')
  return [param(declared?.name ?? 'querystring', 'querystring', value, expressionFor)]
}

function param(name, location, value, expressionFor) {
  // A structured parameter keeps its shape: Arazzo takes any JSON value, and
  // flattening here would hide the multiplicity (or the property names) from
  // the runner.
  return { name, in: location, value: paramExpression(value, expressionFor) }
}

function paramExpression(value, expressionFor) {
  if (Array.isArray(value)) return value.map((item) => toExpression(item, expressionFor))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toExpression(item, expressionFor)]),
    )
  }
  return toExpression(value, expressionFor)
}

function requestBody(op, request, expressionFor) {
  const content = op?.requestBody?.contents?.[request.mediaTypeIndex ?? 0] ?? null
  if (request.formFields?.length) {
    return {
      requestBody: {
        contentType: content?.mediaType ?? 'multipart/form-data',
        payload: Object.fromEntries(
          request.formFields.map((field) => [
            field.name,
            field.fileName !== undefined
              ? `@${field.fileName}`
              : toExpression(field.value, expressionFor),
          ]),
        ),
      },
    }
  }
  if (request.body == null || request.body === '') return {}
  return {
    requestBody: {
      contentType: content?.mediaType ?? 'application/json',
      payload: jsonPayload(request.body, expressionFor),
    },
  }
}

// A JSON body is rendered as an object: runtime expressions live inside the
// strings, in the `{$inputs.x}` form Arazzo expects. A non-JSON body stays a
// string.
function jsonPayload(body, expressionFor) {
  try {
    return substituteDeep(JSON.parse(body), expressionFor)
  } catch {
    return toExpression(body, expressionFor)
  }
}

function substituteDeep(value, expressionFor) {
  if (typeof value === 'string') return toExpression(value, expressionFor)
  if (Array.isArray(value)) return value.map((item) => substituteDeep(item, expressionFor))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteDeep(item, expressionFor)]),
    )
  }
  return value
}

// `{{var}}` alone = the bare expression (the value keeps its type at
// runtime); `{{var}}` inside text = Arazzo's braced form.
function toExpression(template, expressionFor) {
  const value = String(template ?? '')
  const whole = /^\{\{\s*([\w.-]+)\s*\}\}$/.exec(value)
  if (whole) return expressionFor(whole[1])
  return replaceVariables(value, (name) => `{${expressionFor(name)}}`)
}

function successCriteria(expect) {
  const criteria = [{ condition: statusCondition(expect?.status) }]
  for (const assertion of activeAssertions(expect)) {
    if (assertion.op === 'matches') {
      // The typed criteria are the ones the spec makes `context` mandatory
      // for; `exists` and `equals` stay bare `{condition}` entries, which is
      // the Criterion Object's default type anyway.
      criteria.push({
        context: '$response.body',
        condition: assertion.query,
        type: 'jsonpath',
      })
      continue
    }
    if (assertion.op === 'regex') {
      // The one context that carries a fragment: the pattern applies to the
      // pointed-at value, not to the whole body.
      criteria.push({
        context: bodyExpression(assertion.pointer),
        condition: assertion.value,
        type: 'regex',
      })
      continue
    }
    const target = bodyExpression(assertion.pointer)
    criteria.push({
      condition:
        assertion.op === 'equals'
          ? `${target} == ${literal(assertion.value)}`
          : `${target} != null`,
    })
  }
  return criteria
}

// OpenAPI/Arazzo runtime expression: the JSON pointer lives in the fragment,
// behind a `#` — `$response.body#/id`, never `$response.body/id`.
function bodyExpression(pointer) {
  return pointer ? `$response.body#${pointer}` : '$response.body'
}

// Same semantics as the run's verdict (`statusRange`): a scenario can't
// succeed on our side and describe something else once exported.
function statusCondition(status) {
  const { min, max } = statusRange(status)
  if (min === max) return `$statusCode == ${min}`
  return `$statusCode >= ${min} && $statusCode <= ${max}`
}

function literal(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const asText = String(value ?? '')
  // A value entered as "7" is compared against the number 7 in our runner:
  // keep the same leniency here rather than quoting a number.
  if (/^-?\d+(\.\d+)?$/.test(asText)) return asText
  return `'${asText.replace(/'/g, "\\'")}'`
}

function uniqueStepId(used, op, step, index) {
  // The schema's operationId is already a readable, valid name: running it
  // through slugify would lowercase it for nothing. Orphaned step: its raw
  // opId, the same one carried by `operationId`.
  const base = safeName(op ? op.operationId || slugify(op.id) : step.opId) || `step-${index + 1}`
  let candidate = base
  for (let i = 2; used.has(candidate); i += 1) candidate = `${base}-${i}`
  used.add(candidate)
  return candidate
}

// Arazzo constrains its names to [A-Za-z0-9._-]; the dot is an expression
// separator there (`$steps.x.outputs.y`), it can't live inside a name.
function safeName(name) {
  return String(name ?? '').replace(/[^A-Za-z0-9_-]+/g, '_')
}
