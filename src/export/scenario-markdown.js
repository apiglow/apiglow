import { activeAssertions } from '../scenarios/evaluate.js'
import { scenarioVariables } from '../scenarios/model.js'
import { MASK } from './redact.js'

// A scenario as Markdown (docs/scenario-handoff.md §3.1) — the workflow
// sibling of `toEndpointMarkdown`, and the human-readable half of what
// `toArazzo` emits for a runner. Pure function, tested by snapshot (rule 12).
// Labels in English like the other exports: these are technical artifacts, not
// UI.
//
// It is written for a reader going top to bottom with no app in front of them,
// which decides two things the app never has to state: the prerequisites come
// first (the same `scenarioVariables()` computation the scenario page's panel
// displays, so both answer "why would this fail" identically), and every step
// names what it extracts, since that name is the only thing that makes the
// next step's `{{var}}` readable.

// The prefix the model itself treats as "this variable holds a credential"
// (`normalizeExtract` marks an extraction sensitive on it). Scenario inputs are
// the one place the model holds a literal value rather than a `{{var}}`
// template, so they are the one place a secret can reach this document — and
// this is what decides the mask (rule 12).
const SENSITIVE_PREFIX = 'auth.'

// `heading` overrides the H1 for a caller that concatenates this document into
// a larger one and needs the block to say what kind of thing it is
// (`llms-full.txt` prefixes "Workflow: "), the way `toEndpointMarkdown` says
// "Webhook: " for its own.
export function toScenarioMarkdown(
  scenario,
  { ops = [], baseUrl = '', redact = true, heading = '' } = {},
) {
  const opsById = new Map((ops ?? []).map((op) => [op.id, op]))
  const steps = scenario?.steps ?? []
  const lines = [`# ${heading || scenario?.name || 'Scenario'}`]
  if (scenario?.description) lines.push('', scenario.description.trim())
  lines.push('', `${steps.length} step${steps.length === 1 ? '' : 's'}, run in order.`)

  const { required } = scenarioVariables(scenario)
  if (required.length) {
    lines.push(
      '',
      '## Prerequisites',
      '',
      'These variables are referenced by the steps and produced by none of them — set them before running the scenario:',
      '',
    )
    for (const name of required) lines.push(`- \`{{${name}}}\``)
  }

  const inputs = Object.entries(scenario?.inputs ?? {})
  if (inputs.length) {
    lines.push('', '## Inputs', '', 'Values the scenario carries for its own variables:', '')
    for (const [name, value] of inputs) {
      lines.push(`- \`{{${name}}}\` = \`${inputValue(name, value, redact)}\``)
    }
  }

  steps.forEach((step, index) => {
    const op = opsById.get(step.opId) ?? null
    lines.push('', `## Step ${index + 1} — ${stepTitle(op, step)}`)
    lines.push('', ...operationBlock(op, step, baseUrl))
    if (step.note) lines.push('', step.note.trim())
    const meta = []
    if (step.timeout) meta.push(`- Timeout: ${step.timeout} ms`)
    // Stated per step rather than assumed: without it the reader reads a
    // sequence that stops at the first red step, which is the other behaviour.
    if (step.continueOnFailure) meta.push('- The scenario carries on even if this step fails.')
    if (meta.length) lines.push('', ...meta)
    lines.push(...sendsBlock(step.request, op))
    lines.push(...assertsBlock(step.expect))
    lines.push(...extractsBlock(step.extract))
  })

  lines.push('')
  return lines.join('\n')
}

function inputValue(name, value, redact) {
  return redact && name.startsWith(SENSITIVE_PREFIX) ? MASK : String(value)
}

function stepTitle(op, step) {
  if (op) return op.summary || `${op.method.toUpperCase()} ${op.path}`
  return step.opId
}

function operationBlock(op, step, baseUrl) {
  // An opId absent from the schema is a valid step the app badges "not found"
  // (`normalizeStep`): saying so beats an `http` block naming no route.
  if (!op) return [`> Operation \`${step.opId}\` is not declared in this API document.`]
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  return ['```http', `${op.method.toUpperCase()} ${base}${op.path}`, '```']
}

function sendsBlock(request, op) {
  const bullets = []
  const values = (label, map) =>
    Object.entries(map ?? {}).map(([name, value]) => `- ${label} \`${name}\`: \`${scalar(value)}\``)
  bullets.push(...values('Path', request?.path))
  bullets.push(...values('Query', request?.query))
  bullets.push(...values('Cookie', request?.cookie))
  if (request?.queryString) bullets.push(`- Query string: \`${request.queryString}\``)
  for (const header of request?.headers ?? []) {
    bullets.push(`- Header \`${header.name}\`: \`${header.value}\``)
  }
  for (const field of request?.formFields ?? []) {
    bullets.push(
      field.fileName !== undefined
        ? `- Form field \`${field.name}\`: the file \`${field.fileName}\`, chosen at run time`
        : `- Form field \`${field.name}\`: \`${field.value}\``,
    )
  }
  const mediaType = op?.requestBody?.contents?.[request?.mediaTypeIndex ?? 0]?.mediaType ?? ''
  if (request?.bodyFileName) {
    bullets.push(`- Body: the file \`${request.bodyFileName}\`, chosen at run time`)
  }
  const body = request?.body
    ? [
        `Body${mediaType ? ` (\`${mediaType}\`)` : ''}:`,
        '',
        `\`\`\`${/json/i.test(mediaType) ? 'json' : ''}`,
        request.body,
        '```',
      ]
    : []
  if (!bullets.length && !body.length) return []
  const separator = bullets.length && body.length ? [''] : []
  return ['', 'Sends:', '', ...bullets, ...separator, ...body]
}

// A parameter value is a scalar, a list (`tags: [cat, dog]`) or a map
// (`filter: {role: admin}`) — the structured forms are what style/explode
// serializes at send time, and flattening them here would hide the
// multiplicity the same way `toArazzo` refuses to.
function scalar(value) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
}

function assertsBlock(expect) {
  return [
    '',
    'Asserts:',
    '',
    statusBullet(expect?.status),
    ...activeAssertions(expect).map(assertionBullet),
  ]
}

function assertionBullet(assertion) {
  switch (assertion.op) {
    case 'matches':
      return `- JSONPath \`${assertion.query}\` selects at least one node in the response body`
    case 'regex':
      return `- \`${assertion.pointer}\` in the response body matches \`${assertion.value}\``
    case 'equals':
      return `- \`${assertion.pointer}\` in the response body equals \`${assertion.value}\``
    // `exists`, and with it whatever `normalizeExpect` fell back on: an op it
    // does not know becomes `exists`, so there is no fifth spelling to render.
    default:
      return `- \`${assertion.pointer}\` exists in the response body`
  }
}

// No expectation is not "no check": the run's verdict defaults to 2xx
// (`statusRange`), and a document that stayed silent here would describe a step
// that passes on anything.
function statusBullet(status) {
  if (status === undefined || status === null || status === '') {
    return '- Status in the `2xx` range (the default verdict)'
  }
  return typeof status === 'string'
    ? `- Status in the \`${status}\` range`
    : `- Status is \`${status}\``
}

function extractsBlock(extract) {
  if (!extract?.length) return []
  const bullets = extract.map((entry) => {
    const notes = []
    if (entry.persist) notes.push('saved to the environment')
    if (entry.sensitive) notes.push('sensitive, masked wherever it is shown')
    return `- \`${entry.name}\` — ${extractSource(entry)}${notes.length ? ` (${notes.join(', ')})` : ''}`
  })
  return ['', 'Extracts, under the names the later steps reference as `{{var}}`:', '', ...bullets]
}

function extractSource(entry) {
  if (entry.source === 'header') return `response header \`${entry.pointer}\``
  if (entry.query !== undefined) return `response body, JSONPath \`${entry.query}\``
  return entry.pointer ? `response body at \`${entry.pointer}\`` : 'the whole response body'
}
