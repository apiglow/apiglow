// A value against the schema it illustrates — an example, a default — for the
// rules that must say "this value breaks that keyword" (`example-type-mismatch`,
// `default-allowed`). Not a JSON Schema validator: the dependency rule
// (docs/architecture.md §14.2) refuses one, and an audit cannot afford the false
// `error` a half-validator claiming completeness would emit. So it is
// three-valued: a keyword it reads either definitely fails, or the value is not
// contradicted — a keyword it does not read (`not`, `if`/`then`/`else`,
// `unevaluated*`, `dependent*`, a `$ref` the loader left unresolved, an invalid
// `pattern`, a format outside the list below) gives no verdict, never a
// failure.
//
// Read: `type` (3.0's `nullable` adding `null` in every version: from 3.1 the
// spelling is `version-legacy`'s, and the author's intent is plain), `enum`,
// `const`, string lengths in code points, `pattern` (ECMA-262 with `u`), both
// spellings of the numeric bounds, `multipleOf`, array and object sizes,
// `uniqueItems`, `required`, `properties`, `patternProperties`,
// `additionalProperties`, `items`, `prefixItems`, `allOf` (every member),
// `oneOf` / `anyOf` (failing only when every branch fails — the "exactly one"
// of `oneOf` is not judged), and `format` for the RFC 3339 dates and times,
// `uuid`, `ipv4`, `ipv6`, `email`, `uri`, `int32`, `int64`. A format failure is
// a `warning`: JSON Schema 2020-12 §7.2.1 makes format assertion "MUST be
// disabled by default", so a validator lets it through while a reader or a
// generated client trips on it. Every other failure is an `error`.
//
// `required` knows the direction of the value: a `readOnly` property is not
// required in a request, a `writeOnly` one not in a response, and a value with
// no direction (a component's own example) owes neither. The flag counts
// wherever the property is declared among the schemas applied to the same
// value through `allOf`: `required` beside an `allOf` names what a member
// declares.
//
// A `null` where `nullable: true` stands gets no verdict: whether the rest of
// the schema then rejects it is `nullable-enum-null`'s and, without a `type`,
// `constraint-type-mismatch`'s.

import { compilePattern, declaredTypes } from './schema-keywords.js'
import { isAbsoluteUri, isEmail } from './uri.js'
import { deepEqual, isObject, numericBounds, valueIsType } from './value-check.js'

// Nesting of value and schema together. A real example is a few levels deep;
// the cap bounds a composition that refers to itself.
const MAX_DEPTH = 32
// Schema nodes visited per value: a composition fanning out over shared
// branches stays linear in the document, but no example may cost more.
const BUDGET = 50_000

const NONE = { checked: false, failure: null }
const PASS = { checked: true, failure: null }
const NO_EXEMPTION = new Set()

// → { checked, failure } — `checked` false when no keyword gave a verdict (the
// caller then counts no check), `failure` `{ keyword, at, severity }` with `at`
// the JSONPath of the offending place (`$`, `$.tags[0].name`; for `required`,
// the missing member).
export function validateValue(value, schema, { side = null } = {}) {
  const state = { side, budget: BUDGET }
  const { checked, failure } = walk(value, schema, ROOT, 0, state, null, [], NO_EXEMPTION)
  if (!failure) return { checked, failure }
  const { keyword, at, severity } = failure
  return { checked, failure: { keyword, at, severity } }
}

// The direction of a value, from where a rule found it (`{ op, dataPath }`),
// read off the first segment under the operation: `responses` is the API's
// answer, anything else (`requestBody`, `parameters`, a Path Item's parameters
// above the operation) the client's request. A component's own value has no
// direction, and neither has a webhook's or a callback's: the API sends their
// request and the client answers it, so the `readOnly` / `writeOnly` contract
// — written from the client's seat — names neither end.
export function sideOf({ op, dataPath }) {
  if (!op || op.kind === 'webhook' || op.kind === 'callback') return null
  if (!dataPath.startsWith(`${op.pointer}/`)) return 'request'
  const [segment] = dataPath.slice(op.pointer.length + 1).split('/')
  return segment === 'responses' ? 'response' : 'request'
}

// A place in the value: its JSONPath and how many members deep it sits — the
// count `composition` compares, which the text of a quoted key would skew.
const ROOT = { path: '$', level: 0 }

function walk(value, schema, at, depth, state, via, stack, exempt) {
  if (schema === false) return fail(via, at)
  if (!isObject(schema) || depth > MAX_DEPTH || state.budget <= 0) return NONE
  if (typeof schema.$ref === 'string' || stack.includes(schema)) return NONE
  state.budget -= 1
  if (value === null && schema.nullable === true) return NONE
  const exempted = isObject(value) ? exemptions(schema, state.side, exempt) : exempt
  const result = { checked: false, failure: null }
  const steps = [typeStep, constantStep, stringStep, numberStep, arrayStep, objectStep, composition]
  for (const step of steps) {
    absorb(result, step(value, schema, at, depth, state, stack, exempted))
    if (result.failure?.severity === 'error') break
  }
  return result
}

function typeStep(value, schema, at) {
  const types = declaredTypes(schema)
  // No type, or one that is no JSON type: no verdict.
  if (!types?.length) return NONE
  return verdict(
    types.some((type) => valueIsType(value, type)),
    'type',
    at,
  )
}

function constantStep(value, schema, at) {
  const result = { checked: false, failure: null }
  if (Array.isArray(schema.enum) && schema.enum.length) {
    absorb(
      result,
      verdict(
        schema.enum.some((entry) => deepEqual(entry, value)),
        'enum',
        at,
      ),
    )
  }
  if (schema.const !== undefined) {
    absorb(result, verdict(deepEqual(schema.const, value), 'const', at))
  }
  return result
}

function stringStep(value, schema, at) {
  if (typeof value !== 'string') return NONE
  const result = { checked: false, failure: null }
  const { minLength, maxLength, pattern, format } = schema
  if (isCount(minLength) || isCount(maxLength)) {
    const length = codePoints(value)
    if (isCount(minLength)) absorb(result, verdict(length >= minLength, 'minLength', at))
    if (isCount(maxLength)) absorb(result, verdict(length <= maxLength, 'maxLength', at))
  }
  const regex = compilePattern(pattern)
  if (regex) absorb(result, verdict(regex.test(value), 'pattern', at))
  const formatCheck = STRING_FORMATS.get(format)
  if (formatCheck) absorb(result, verdict(formatCheck(value), 'format', at, 'warning'))
  return result
}

function numberStep(value, schema, at) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return NONE
  const result = { checked: false, failure: null }
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = numericBounds(schema)
  if (minimum !== undefined) absorb(result, verdict(value >= minimum, 'minimum', at))
  if (maximum !== undefined) absorb(result, verdict(value <= maximum, 'maximum', at))
  if (exclusiveMinimum !== undefined) {
    absorb(result, verdict(value > exclusiveMinimum, 'exclusiveMinimum', at))
  }
  if (exclusiveMaximum !== undefined) {
    absorb(result, verdict(value < exclusiveMaximum, 'exclusiveMaximum', at))
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    absorb(result, verdict(isMultiple(value, schema.multipleOf), 'multipleOf', at))
  }
  const range = INTEGER_FORMATS.get(schema.format)
  if (range && Number.isInteger(value)) {
    absorb(result, verdict(value >= range[0] && value <= range[1], 'format', at, 'warning'))
  }
  return result
}

function arrayStep(value, schema, at, depth, state) {
  if (!Array.isArray(value)) return NONE
  const result = { checked: false, failure: null }
  if (isCount(schema.minItems))
    absorb(result, verdict(value.length >= schema.minItems, 'minItems', at))
  if (isCount(schema.maxItems))
    absorb(result, verdict(value.length <= schema.maxItems, 'maxItems', at))
  if (schema.uniqueItems === true) {
    const twice = value.findIndex((item, index) =>
      value.slice(0, index).some((earlier) => deepEqual(earlier, item)),
    )
    absorb(result, verdict(twice < 0, 'uniqueItems', twice < 0 ? at : index(at, twice)))
  }
  const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : []
  // A draft-04 tuple `items: [...]` is no 3.x spelling: no verdict.
  const rest = Array.isArray(schema.items) ? undefined : schema.items
  for (const [position, item] of value.entries()) {
    if (result.failure?.severity === 'error') break
    const [sub, via] =
      position < prefix.length ? [prefix[position], 'prefixItems'] : [rest, 'items']
    if (sub === undefined) continue
    absorb(result, walk(item, sub, index(at, position), depth + 1, state, via, [], NO_EXEMPTION))
  }
  return result
}

function objectStep(value, schema, at, depth, state, _stack, exempt) {
  if (!isObject(value)) return NONE
  const result = { checked: false, failure: null }
  const keys = Object.keys(value)
  const properties = isObject(schema.properties) ? schema.properties : {}
  if (isCount(schema.minProperties)) {
    absorb(result, verdict(keys.length >= schema.minProperties, 'minProperties', at))
  }
  if (isCount(schema.maxProperties)) {
    absorb(result, verdict(keys.length <= schema.maxProperties, 'maxProperties', at))
  }
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name !== 'string' || exempt.has(name)) continue
      absorb(result, verdict(Object.hasOwn(value, name), 'required', member(at, name)))
      if (result.failure?.severity === 'error') return result
    }
  }
  const patterns = []
  let patternsKnown = true
  if (isObject(schema.patternProperties)) {
    for (const [source, sub] of Object.entries(schema.patternProperties)) {
      const regex = compilePattern(source)
      if (regex) patterns.push([regex, sub])
      else patternsKnown = false
    }
  }
  // `additionalProperties` sees only its own siblings: beside an `allOf`, the
  // properties a member declares are "additional" to it — `false` then rejects
  // them and a schema judges them, a schema bug rather than the example's, and
  // judged nowhere here.
  const additional = hasComposition(schema) ? undefined : schema.additionalProperties
  const closed = additional === false
  for (const key of keys) {
    const place = member(at, key)
    const declared = Object.hasOwn(properties, key)
    if (declared)
      absorb(
        result,
        walk(value[key], properties[key], place, depth + 1, state, 'properties', [], NO_EXEMPTION),
      )
    let matched = false
    for (const [regex, sub] of patterns) {
      if (!regex.test(key)) continue
      matched = true
      absorb(
        result,
        walk(value[key], sub, place, depth + 1, state, 'patternProperties', [], NO_EXEMPTION),
      )
    }
    if (!declared && !matched && patternsKnown) {
      if (closed) absorb(result, fail('additionalProperties', place))
      else if (isObject(additional)) {
        absorb(
          result,
          walk(
            value[key],
            additional,
            place,
            depth + 1,
            state,
            'additionalProperties',
            [],
            NO_EXEMPTION,
          ),
        )
      }
    }
    if (result.failure?.severity === 'error') break
  }
  return result
}

// The schemas applied to the same value inherit the exemptions of the one
// they are composed into: a branch's `required` may name a parent's
// `readOnly` property.
function composition(value, schema, at, depth, state, stack, exempt) {
  const result = { checked: false, failure: null }
  const inner = [...stack, schema]
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      absorb(result, walk(value, member, at, depth + 1, state, 'allOf', inner, exempt))
      if (result.failure?.severity === 'error') return result
    }
  }
  for (const keyword of ['oneOf', 'anyOf']) {
    const branches = schema[keyword]
    if (!Array.isArray(branches) || !branches.length) continue
    const outcomes = branches.map((branch) =>
      walk(value, branch, at, depth + 1, state, keyword, inner, exempt),
    )
    if (outcomes.every((outcome) => outcome.failure)) {
      const failures = outcomes.map((outcome) => outcome.failure)
      // A branch broken on a format alone is one the value nearly matches: the
      // whole is graded as that, and named after it.
      const severity = failures.some((failure) => failure.severity === 'warning')
        ? 'warning'
        : 'error'
      const candidates = failures.filter((failure) => failure.severity === severity)
      // The branch the value got furthest into is the one it meant: its own
      // failure says more than "no branch matches". A tie names the choice.
      const reach = Math.max(...candidates.map((failure) => failure.level))
      const furthest = candidates.filter((failure) => failure.level === reach)
      const reported =
        reach > at.level && furthest.length === 1
          ? furthest[0]
          : { keyword, at: at.path, level: at.level }
      absorb(result, { checked: true, failure: { ...reported, severity } })
    } else if (outcomes.some((outcome) => outcome.checked && !outcome.failure)) {
      absorb(result, PASS)
    }
  }
  return result
}

// The names a value going `side` does not owe: `inherited`, plus the
// `readOnly` / `writeOnly` properties the schema and its `allOf` members
// declare, however deep.
function exemptions(schema, side, inherited) {
  const names = new Set(inherited)
  const seen = new Set()
  const visit = (node, level) => {
    if (!isObject(node) || seen.has(node) || level > MAX_DEPTH) return
    seen.add(node)
    if (isObject(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        if (!owes(property, side)) names.add(name)
      }
    }
    if (Array.isArray(node.allOf)) for (const member of node.allOf) visit(member, level + 1)
  }
  visit(schema, 0)
  return names.size ? names : NO_EXEMPTION
}

function owes(property, side) {
  if (!isObject(property)) return true
  if (property.readOnly === true && side !== 'response') return false
  if (property.writeOnly === true && side !== 'request') return false
  return true
}

function hasComposition(schema) {
  return ['allOf', 'oneOf', 'anyOf'].some((keyword) => Array.isArray(schema[keyword]))
}

function absorb(into, outcome) {
  if (outcome.checked) into.checked = true
  const { failure } = outcome
  if (!failure) return
  if (!into.failure || (into.failure.severity === 'warning' && failure.severity === 'error')) {
    into.failure = failure
  }
}

function verdict(passed, keyword, at, severity = 'error') {
  return passed ? PASS : fail(keyword, at, severity)
}

function fail(keyword, at, severity = 'error') {
  return { checked: true, failure: { keyword, at: at.path, level: at.level, severity } }
}

function member(at, key) {
  const path = /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${at.path}.${key}`
    : `${at.path}[${JSON.stringify(key)}]`
  return { path, level: at.level + 1 }
}

function index(at, position) {
  return { path: `${at.path}[${position}]`, level: at.level + 1 }
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0
}

function codePoints(text) {
  let count = 0
  for (const _ of text) count += 1
  return count
}

// Floating-point division leaves `0.3 / 0.1` at 2.9999999999999996: a
// quotient that close to an integer is one. The tolerance is the division's
// own rounding error, a few ulps of the quotient — a fixed share of it would
// let `1e9 + 0.5` pass as a multiple of 1.
function isMultiple(value, divisor) {
  const quotient = value / divisor
  if (!Number.isFinite(quotient)) return true
  return (
    Math.abs(quotient - Math.round(quotient)) <=
    Math.max(1e-9, 8 * Number.EPSILON * Math.abs(quotient))
  )
}

// RFC 3339 §5.6: full-date, partial-time, time-offset; `T` and `Z` in either
// case, a leap second allowed.
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const FULL_TIME = /^([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/

function isDate(text) {
  const match = FULL_DATE.exec(text)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= days
}

const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`)

function isIpv6(text) {
  if (!text.includes(':') || !/^[\da-fA-F:.]+$/.test(text)) return false
  try {
    new URL(`http://[${text}]/`)
    return true
  } catch {
    return false
  }
}

const STRING_FORMATS = new Map([
  ['date', isDate],
  [
    'date-time',
    (text) => {
      const at = text.search(/[Tt]/)
      return at > 0 && isDate(text.slice(0, at)) && FULL_TIME.test(text.slice(at + 1))
    },
  ],
  ['time', (text) => FULL_TIME.test(text)],
  ['uuid', (text) => /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(text)],
  ['ipv4', (text) => IPV4.test(text)],
  ['ipv6', isIpv6],
  ['email', isEmail],
  ['uri', isAbsoluteUri],
])

const INTEGER_FORMATS = new Map([
  ['int32', [-(2 ** 31), 2 ** 31 - 1]],
  ['int64', [-(2 ** 63), 2 ** 63 - 1]],
])
