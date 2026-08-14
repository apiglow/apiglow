// Same named ESM build as `src/openapi/overlay.js`, and for the same reason:
// json-p3 ships no `exports` map, so a bare specifier resolves differently
// under vite and under vitest.
import { JSONPathEnvironment } from 'json-p3/dist/json-p3.esm.js'
import { resolvePointer } from './pointer.js'

// Verdict of a scenario step (docs/scenarios.md §2/§6): extraction of values
// to chain, then success criteria. Pure, tested functions.
//
// None of these functions throw: the response comes from the network,
// anything is possible there (empty body, HTML of an error page, a pointer
// that leads nowhere). Every deviation becomes a `code` that the UI
// translates.

export const STATUS_CLASS_RE = /^([1-5])xx$/i

export function parseJsonBody(response) {
  const body = response?.body
  if (typeof body !== 'string' || body.trim() === '') return { ok: false, value: undefined }
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    return { ok: false, value: undefined }
  }
}

// Lazy, memoized read of the body: both extraction and the verdict want it,
// and a response body can weigh hundreds of KB — it must be parsed only
// once per step, and only if someone asks for it.
export function jsonBodyReader(response) {
  let parsed = null
  return () => (parsed ??= parseJsonBody(response))
}

export function headerValue(response, name) {
  const wanted = String(name ?? '')
    .trim()
    .toLowerCase()
  if (!wanted) return { found: false, value: undefined }
  for (const [key, value] of response?.headers ?? []) {
    if (String(key).toLowerCase() === wanted) return { found: true, value }
  }
  return { found: false, value: undefined }
}

// Single semantics for the "expected status": exact code, `Nxx` class, or
// the 2xx default. Both the run's verdict and the Arazzo export's
// `successCriteria` read it here — otherwise a scenario could pass on our
// side and say something else once exported.
export function statusRange(expected) {
  if (expected === undefined || expected === null || expected === '') return { min: 200, max: 299 }
  const asClass = STATUS_CLASS_RE.exec(String(expected))
  if (asClass) {
    const hundreds = Number(asClass[1]) * 100
    return { min: hundreds, max: hundreds + 99 }
  }
  const exact = Number(expected)
  return { min: exact, max: exact }
}

export function statusMatches(expected, status) {
  const { min, max } = statusRange(expected)
  return status >= min && status <= max
}

// A criteria row with an empty pointer isn't one: the editor keeps it
// visible while it's being filled in, the verdict and the export ignore
// it. Without this filter it would designate the ROOT of the body —
// "whole body = \"\"", which can only fail, on a row the user never filled in.
// A `matches` row is half-filled in the same way, in the other field.
export function activeAssertions(expect) {
  return (expect?.assertions ?? []).filter((assertion) => {
    if (assertion?.op === 'matches') return String(assertion?.query ?? '').trim() !== ''
    if (String(assertion?.pointer ?? '').trim() === '') return false
    // The empty pattern is a valid RegExp matching everything, so a `regex`
    // row still being filled in would make the step pass while checking
    // nothing — the same failure this filter exists for, in its worst form:
    // green. Not trimmed, unlike a pointer: " " is a pattern that means
    // something.
    return assertion?.op !== 'regex' || String(assertion?.value ?? '') !== ''
  })
}

// Arazzo 1.1's `jsonpath` criterion, verbatim: *"A condition passes (truthy)
// when the JSONPath expression returns a non-empty nodelist"* and *"fails
// (falsy) when [it] returns an empty nodelist"*. One node is therefore the
// whole answer — the walk stops there, which is also why no result cap is
// needed here where the overlay resolution needs one.
//
// The depth bound is this module's own on purpose: the overlay's caps a query
// over a document we parsed and hold, this one caps a query over a response
// body, and coupling them would make one guard move for the other's reasons.
const MAX_QUERY_DEPTH = 500
const JSONPATH = new JSONPathEnvironment({ maxRecursionDepth: MAX_QUERY_DEPTH })

// Never throws, like everything else here: an expression that is not valid
// RFC 9535 is a failed assertion carrying a code, not an exception escaping
// into the runner.
function queryMatches(root, expression) {
  const { found, code } = queryFirst(root, expression)
  if (code) return { ok: false, code }
  return { ok: found, code: null }
}

// The first node a query selects, and whether there was one. An extraction
// produces a value where a criterion produces a verdict, so it has to answer
// "which node" — first wins, the same rule the Overlay resolution applies when
// it needs one node from a query. The walk stops there either way, which is
// also why no result cap is needed on this side.
function queryFirst(root, expression) {
  let query
  try {
    query = JSONPATH.compile(String(expression ?? ''))
  } catch {
    return { found: false, value: undefined, code: 'query-invalid' }
  }
  try {
    for (const node of query.lazyQuery(root)) {
      return { found: true, value: node.value, code: null }
    }
  } catch {
    // The engine hitting its recursion limit on this particular body.
    return { found: false, value: undefined, code: 'query-failed' }
  }
  return { found: false, value: undefined, code: null }
}

// Arazzo's `regex` criterion: *"the condition passes (truthy) when the regex
// pattern matches the `context` value"*. Unanchored — "matches" is a search,
// not a full match, and a scenario wanting anchors writes `^…$`. No flags and
// no `/…/` delimiters either: the spec says the condition IS the pattern, so a
// condition written with delimiters is a pattern that will not match, which is
// the document's error and reads as a plain failure.
//
// The bound is on the SUBJECT, not on the pattern. A pattern comes from an
// imported document and native `RegExp` offers no step or time limit, so the
// only lever against catastrophic backtracking is how much text it can
// backtrack over. Refusing a pattern instead would mean deciding which regexes
// are legitimate, which nothing here can do correctly.
const MAX_REGEX_SUBJECT = 100_000

function regexMatches(value, pattern) {
  let expression
  try {
    expression = new RegExp(String(pattern ?? ''))
  } catch {
    return { ok: false, code: 'pattern-invalid' }
  }
  const subject = valueText(value)
  if (subject.length > MAX_REGEX_SUBJECT) return { ok: false, code: 'value-too-long' }
  return { ok: expression.test(subject), code: null }
}

// The text a value is tested as — the same stringification `looseEquals` uses
// on its actual side, so `regex` and `equals` never disagree about what the
// value under the pointer *is*.
function valueText(value) {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

// Deliberately loose comparison: the expected value is entered in a text
// field, it's "7" where the JSON carries the number 7. Objects and arrays
// are compared on their serialized form.
function looseEquals(actual, expected) {
  if (actual !== null && typeof actual === 'object') {
    try {
      return JSON.stringify(actual) === JSON.stringify(expected)
    } catch {
      return false
    }
  }
  if (expected !== null && typeof expected === 'object') return false
  return String(actual) === String(expected)
}

// `expect` absent = expected status 2xx, the SPEC's default. `readBody` is
// injected by the runner to share parsing with extraction.
export function evaluateExpect(expect, response, readBody = jsonBodyReader(response)) {
  const checks = [
    {
      kind: 'status',
      expected: expect?.status ?? '2xx',
      actual: response?.status ?? null,
      ok: statusMatches(expect?.status, response?.status ?? 0),
    },
  ]
  const assertions = activeAssertions(expect)
  if (assertions.length) {
    const parsed = readBody()
    for (const assertion of assertions) {
      const check = {
        kind: 'assertion',
        pointer: assertion.pointer,
        op: assertion.op,
        expected: assertion.value,
        query: assertion.query,
      }
      if (!parsed.ok) {
        checks.push({ ...check, ok: false, actual: undefined, code: 'body-not-json' })
        continue
      }
      if (assertion.op === 'matches') {
        // No `actual`: a nodelist is not a value to show, and the query is
        // already in the check.
        const { ok, code } = queryMatches(parsed.value, assertion.query)
        checks.push({ ...check, ok, actual: undefined, ...(code ? { code } : {}) })
        continue
      }
      const { found, value } = resolvePointer(parsed.value, assertion.pointer)
      if (!found) {
        checks.push({ ...check, ok: false, actual: undefined, code: 'pointer-not-found' })
        continue
      }
      if (assertion.op === 'regex') {
        const { ok, code } = regexMatches(value, assertion.value)
        checks.push({ ...check, ok, actual: value, ...(code ? { code } : {}) })
        continue
      }
      const ok = assertion.op === 'equals' ? looseEquals(value, assertion.value) : true
      checks.push({ ...check, ok, actual: value })
    }
  }
  return { ok: checks.every((c) => c.ok), checks }
}

// Value of a run scope variable: always a string (it's what interpolation
// substitutes). An empty, null or absent value isn't one — sending "null"
// in a URL would hide the broken link.
function variableValue(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') {
    try {
      return JSON.stringify(raw)
    } catch {
      return null
    }
  }
  const value = String(raw)
  return value === '' ? null : value
}

export function applyExtracts(extracts, response, readBody = jsonBodyReader(response)) {
  const results = []
  const values = {}
  const parsed = (extracts ?? []).some((e) => e.source !== 'header') ? readBody() : { ok: false }
  for (const extract of extracts ?? []) {
    // `sensitive` stays carried by the extraction: it's what hides the
    // value in the report and makes it join the redacted values in the
    // history.
    const base = {
      name: extract.name,
      source: extract.source,
      pointer: extract.pointer,
      query: extract.query,
      persist: extract.persist === true,
      sensitive: extract.sensitive === true,
    }
    let entry
    if (extract.source === 'header') {
      const { found, value } = headerValue(response, extract.pointer)
      entry = finish(base, found ? value : undefined, found ? null : 'header-missing')
    } else if (!parsed.ok) {
      entry = finish(base, undefined, 'body-not-json')
    } else if (extract.query) {
      const { found, value, code } = queryFirst(parsed.value, extract.query)
      // An empty nodelist is the query's equivalent of a pointer leading
      // nowhere: a failed extraction, and the variable stays missing.
      entry = finish(base, found ? value : undefined, code ?? (found ? null : 'query-no-match'))
    } else {
      const { found, value } = resolvePointer(parsed.value, extract.pointer)
      entry = finish(base, found ? value : undefined, found ? null : 'pointer-not-found')
    }
    results.push(entry)
    if (entry.ok) values[entry.name] = { value: entry.value, sensitive: entry.sensitive }
  }
  return { values, results, ok: results.every((r) => r.ok) }
}

function finish(result, raw, code) {
  if (code) return { ...result, ok: false, code, raw: undefined, value: undefined }
  const value = variableValue(raw)
  if (value === null) return { ...result, ok: false, code: 'value-empty', raw, value: undefined }
  return { ...result, ok: true, code: null, raw, value }
}
