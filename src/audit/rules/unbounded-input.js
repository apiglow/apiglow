import { listOf } from '../../openapi/model.js'
import { valueTypes } from '../input-shape.js'
import { lastToken } from '../ref-pointer.js'
import { isBinarySchema } from '../schema-keywords.js'
import { SCHEMA_DEPTH } from '../schema-walk.js'
import { payloadChildren, toolInputs, toolOperations } from '../tool-inputs.js'
import { isObject } from '../value-check.js'
import { abbreviate } from '../text.js'

// An operation taking strings or arrays with no upper bound. OWASP API4:2023
// (Unrestricted Resource Consumption) puts it first among the preventions:
// "Define and enforce a maximum size of data on all incoming parameters and
// payloads, such as maximum length for strings, maximum number of elements in
// arrays". A limit the server enforces but the document does not state is one
// every client discovers by failing: a generated client, a fuzzer or an agent
// filling in a tool has no `maxLength` to stay under, and a gateway validating
// against the schema lets a megabyte through as a valid name.
//
// The operation's request bodies, read the way the agent rules read them
// (`toolInputs`, files excepted), every value position below — properties (a
// `readOnly` one is never sent, whether the keyword sits on it or on an `allOf`
// member; one declared in a `then`, an `else` or a `dependentSchemas` entry
// is), map values, array and tuple items. A string is bounded by `maxLength`,
// by `enum` or `const`, by a format whose values have a fixed shape (`date`,
// `date-time`, `time`, `uuid`, `ipv4`, `ipv6`, `duration`), or by a `pattern`
// anchored at both ends with no unbounded quantifier (`*`, `+`, `{n,}` — inside
// a lookaround they consume nothing and do not count); an array by `maxItems`,
// by `enum` or `const`, or by `prefixItems` with `items: false`. A bound in an
// `allOf` member bounds the value; a `oneOf`/`anyOf` bounds it when every
// branch that can hold the value's type does — a branch without a `type` of
// its own constrains the parent's (`{ type: string, anyOf: [{ maxLength: 5 },
// { format: uuid }] }` is bounded), one typed otherwise does not apply. A file
// (`format: binary`, or a binary `contentMediaType`, `isBinarySchema`) is
// bytes, not a string to bound: its size is the server's upload limit. Numbers
// are out of scope — their bounds are ranges, not sizes. An input with no type
// at all is `untyped-input`'s.
//
// Parameters are left out: they travel in the request line and the headers,
// which every server already caps — RFC 9110 §4.1 asks for 8000 octets of URI
// and answers 414 past its own limit, RFC 6585 §5 431 for headers — so a
// path or query string is bounded before the API sees it. A body has no such
// ceiling short of the server's upload limit, and that is where the
// unbounded string or array lands.
//
// One check per paths operation (webhooks and callbacks are requests the API
// sends) with at least one string or array in its body; the finding names how
// many inputs are unbounded and the first three. An input is a place in the
// body: a component used twice (`billing`, `shipping`) is two of them. Graded
// per operation rather than per schema: the limit protects the endpoint, and a
// shared component left unbounded is a gap in every operation that accepts it.
export const unboundedInput = {
  id: 'unbounded-input',
  category: 'security',
  severity: 'info',
  run(ctx, check) {
    const verdicts = new Map()
    for (const entry of toolOperations(ctx)) {
      let sized = false
      const unbounded = new Set()
      const visit = (schema, label) => {
        const verdict = verdictOf(schema, [], verdicts, 0)
        if (!verdict.sized.size) return
        sized = true
        if (verdict.unbounded.size) unbounded.add(label)
      }
      const budget = { positions: POSITIONS }
      for (const input of toolInputs(entry)) {
        // Named from its properties; a body that is itself a string or an
        // array, by its media type.
        if (input.kind === 'body') walkValues(input.schema, input.mediaType, visit, budget)
      }
      if (!sized) continue
      check(!unbounded.size, {
        op: entry,
        params: { count: unbounded.size, names: abbreviate([...unbounded]) },
      })
    }
  },
}

const BOUNDED_FORMATS = new Set(['date', 'date-time', 'time', 'uuid', 'ipv4', 'ipv6', 'duration'])
const SIZED = ['string', 'array']

// Value positions walked per operation at most. Every path to a shared schema
// is a position of its own, so a body sharing components at every level grows
// with the number of paths, not of schemas.
const POSITIONS = 5000

// The edges `payloadChildren` lists that lead to another description of the
// same value rather than to a value below it.
const SAME_VALUE = new Set(['allOf', 'oneOf', 'anyOf', 'then', 'else', 'dependentSchemas'])

// The value positions below and including `root`, each labeled from the input:
// `owner.name`, `tags[]`, `labels.*`, `point[0]`. A position's children are read
// through every schema describing the same value (`sameValue`). A schema is
// walked once per path to it, a cycle cut where it comes back to an ancestor.
function walkValues(root, rootLabel, visit, budget) {
  const ancestors = new Set()
  const walk = (schema, label, base, depth) => {
    if (!isObject(schema) || depth > SCHEMA_DEPTH || ancestors.has(schema)) return
    if (budget.positions <= 0) return
    budget.positions -= 1
    visit(schema, label)
    ancestors.add(schema)
    for (const part of sameValue(schema)) {
      for (const [child, path] of payloadChildren(part, '')) {
        const keyword = path.split('/')[1]
        if (SAME_VALUE.has(keyword)) continue
        if (keyword === 'properties' && saysOwnOrAllOf(child, (s) => s.readOnly === true)) continue
        const step = {
          properties: () => (base ? `${base}.${lastToken(path)}` : lastToken(path)),
          patternProperties: () => (base ? `${base}.*` : '*'),
          additionalProperties: () => (base ? `${base}.*` : '*'),
          unevaluatedProperties: () => (base ? `${base}.*` : '*'),
          items: () => `${base}[]`,
          unevaluatedItems: () => `${base}[]`,
          prefixItems: () => `${base}[${lastToken(path)}]`,
        }[keyword]
        if (!step) continue
        const childLabel = step()
        walk(child, childLabel, childLabel, depth + 1)
      }
    }
    ancestors.delete(schema)
  }
  walk(root, rootLabel, '', 0)
}

// The schema and every subschema below it that describes this same value, each
// once: composition members, and the conditional ones — a property declared
// only in a `then` is sent all the same when the condition holds.
function sameValue(schema) {
  const parts = []
  const add = (part, depth) => {
    if (!isObject(part) || depth > SCHEMA_DEPTH || parts.includes(part)) return
    parts.push(part)
    for (const [member, path] of payloadChildren(part, '')) {
      if (SAME_VALUE.has(path.split('/')[1])) add(member, depth + 1)
    }
  }
  add(schema, 0)
  return parts
}

// → { sized, unbounded, bounded }: the sized kinds (`string`, `array`) the
// value may be, those of them nothing bounds, and those something does.
// `allOf` members are conjoined with the schema — any of them bounding a kind
// bounds the value. Each `oneOf`/`anyOf` list is a set of alternatives: it
// bounds a kind when every branch able to hold that kind bounds it, and rules
// the kind out when no branch can hold it. `inherited`: the sized kinds of the
// schema a branch belongs to — a branch with no type of its own constrains
// those. Cached by schema object and inherited kinds: the verdict depends on
// nothing else.
function verdictOf(schema, inherited, cache, depth) {
  const key = inherited.join()
  let byInherited = cache.get(schema)
  if (!byInherited) {
    byInherited = new Map()
    cache.set(schema, byInherited)
  }
  const cached = byInherited.get(key)
  if (cached) return cached
  const verdict = { sized: new Set(), unbounded: new Set(), bounded: new Set() }
  // A cycle through composition, or past the budget: settled as saying nothing.
  byInherited.set(key, verdict)
  if (depth > SCHEMA_DEPTH) return verdict
  const parts = conjunction(schema)
  if (parts.some(isBinarySchema)) return verdict
  // `type: 'null'` is a type of its own: such a branch holds no string.
  const typed = parts.some((part) => part.type !== undefined || valueTypes(part).length)
  const own = typed
    ? SIZED.filter((kind) => parts.some((part) => valueTypes(part).includes(kind)))
    : inherited
  const groups = parts
    .flatMap((part) => [part.oneOf, part.anyOf])
    .filter((list) => Array.isArray(list) && list.length)
    .map((list) => list.filter(isObject).map((branch) => verdictOf(branch, own, cache, depth + 1)))
  for (const kind of SIZED) {
    const holding = groups.map((group) => group.filter((branch) => branch.sized.has(kind)))
    if (holding.some((branches) => !branches.length)) continue
    if (!own.includes(kind) && !holding.length) continue
    verdict.sized.add(kind)
    const bounded =
      parts.some((part) => bounds(part, kind)) ||
      holding.some((branches) => branches.every((branch) => branch.bounded.has(kind)))
    verdict[bounded ? 'bounded' : 'unbounded'].add(kind)
  }
  return verdict
}

// The schema and its `allOf` members, recursively: constraints that all hold.
function conjunction(schema) {
  const parts = []
  const add = (part, depth) => {
    if (!isObject(part) || depth > SCHEMA_DEPTH || parts.includes(part)) return
    parts.push(part)
    for (const member of listOf(part.allOf)) add(member, depth + 1)
  }
  add(schema, 0)
  return parts
}

function saysOwnOrAllOf(schema, test) {
  return conjunction(schema).some(test)
}

function bounds(schema, kind) {
  if ((Array.isArray(schema.enum) && schema.enum.length) || schema.const !== undefined) return true
  if (kind === 'array') {
    return (
      typeof schema.maxItems === 'number' ||
      (Array.isArray(schema.prefixItems) && schema.items === false)
    )
  }
  return (
    typeof schema.maxLength === 'number' ||
    BOUNDED_FORMATS.has(schema.format) ||
    (typeof schema.pattern === 'string' && boundedPattern(schema.pattern))
  )
}

// A pattern every match of which has a maximum length: each top-level
// alternative anchored `^…$` (JSON Schema patterns are not implicitly
// anchored, so `^[a-z]{1,8}` matches any string starting so), and no `*`, `+`
// or `{n,}` outside a character class or a lookaround. Read character by
// character rather than with a regular expression over the pattern: escapes
// and classes decide what a `+` means.
function boundedPattern(pattern) {
  const groups = []
  const alternatives = []
  let inClass = false
  let start = 0
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\') {
      i += 1
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      continue
    }
    if (char === '[') inClass = true
    else if (char === '(') groups.push(/^\?<?[=!]/.test(pattern.slice(i + 1, i + 4)))
    else if (char === ')') groups.pop()
    else if (char === '|' && !groups.length) {
      alternatives.push(pattern.slice(start, i))
      start = i + 1
    } else if (!groups.includes(true)) {
      if (char === '*' || char === '+') return false
      if (char === '{' && /^\{\d+,\}/.test(pattern.slice(i))) return false
    }
  }
  alternatives.push(pattern.slice(start))
  return alternatives.every(anchored)
}

function anchored(alternative) {
  if (!alternative.startsWith('^') || !alternative.endsWith('$')) return false
  // `\$` is a dollar sign, not the end: count the backslashes before it.
  let escapes = 0
  for (let i = alternative.length - 2; i >= 0 && alternative[i] === '\\'; i--) escapes += 1
  return escapes % 2 === 0
}
