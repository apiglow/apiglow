import { parseJsonBody } from './evaluate.js'
import {
  chainableResponses,
  preferredResponse,
  responseLeaves,
  schemaLeaves,
  variableNameFor,
} from './inspect.js'

// "Where does this value come from?" (docs/scenarios.md §5.4) — pure functions.
//
// The reverse of the extraction gesture: instead of guessing in advance
// what will be extracted from a step, we start from the gap — a variable
// that no earlier step produces — and look for who could fill it.
// Candidates come from observed responses if they exist, from the declared
// schema otherwise: chaining becomes suggestible even before the first
// send.

const MAX_SUGGESTIONS = 8
// Below this score, the name resemblance is nothing more than a random
// substring coincidence.
const MIN_SCORE = 40

export function suggestSources(
  wanted,
  { steps = [], opFor = () => null, responseFor = () => null, limit = MAX_SUGGESTIONS } = {},
) {
  const target = normalize(wanted)
  if (!target) return []
  const suggestions = []
  steps.forEach((step, stepIndex) => {
    for (const candidate of candidatesFor(step, opFor(step), responseFor(step))) {
      const score = scoreOf(target, candidate)
      if (score < MIN_SCORE) continue
      suggestions.push({ ...candidate, stepIndex, score })
    }
  })
  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score || b.stepIndex - a.stepIndex || a.pointer.length - b.pointer.length,
    )
    .slice(0, limit)
}

function candidatesFor(step, op, response) {
  const rows = []
  const parsed = response ? parseJsonBody(response) : { ok: false }
  // An observed response always beats the schema: it knows the keys of a
  // free-form map and the real length of arrays.
  if (parsed.ok) {
    for (const leaf of responseLeaves(parsed.value).rows) {
      rows.push({
        source: 'body',
        pointer: leaf.pointer,
        preview: leaf.preview,
        container: leaf.container,
        observed: true,
      })
    }
    for (const [name] of response.headers ?? []) {
      rows.push({
        source: 'header',
        pointer: String(name),
        preview: '',
        container: false,
        observed: true,
      })
    }
    return rows.map((row) => ({ ...row, schemaName: null }))
  }
  const declared = preferredResponse(chainableResponses(op), step?.expect?.status)
  if (!declared) return rows
  const schema = declared.contents[0]?.schema ?? null
  for (const leaf of schemaLeaves(schema).rows) {
    if (!leaf.pointer) continue
    rows.push({
      source: 'body',
      pointer: leaf.pointer,
      preview: leaf.preview,
      container: leaf.container,
      observed: false,
    })
  }
  for (const header of declared.headers) {
    rows.push({
      source: 'header',
      pointer: header.name,
      preview: header.preview,
      container: false,
      observed: false,
    })
  }
  // The schema name is what makes `/id` of `Pet` a candidate for
  // `{{petId}}`: without it, the two names only have "id" in common.
  const schemaName = schema?.schemaName ?? schema?.items?.schemaName ?? null
  return rows.map((row) => ({ ...row, schemaName }))
}

function scoreOf(target, candidate) {
  const name = normalize(
    candidate.source === 'header' ? candidate.pointer : variableNameFor(candidate.pointer, ''),
  )
  if (!name) return 0
  let score = 0
  if (name === target) score = 100
  else if (candidate.schemaName && normalize(candidate.schemaName + name) === target) score = 95
  else if (target.endsWith(name) && name.length >= 2) score = 70
  else if (name.endsWith(target) && target.length >= 2) score = 60
  else if (name.length >= 3 && (target.includes(name) || name.includes(target))) score = 40
  if (!score) return 0
  // An observed value is safer than a promised value, and we rarely chain
  // an entire object.
  if (candidate.observed) score += 5
  if (candidate.container) score -= 15
  return score
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}
