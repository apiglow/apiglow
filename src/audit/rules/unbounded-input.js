import { isFileSchema } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { valueTypes } from '../input-shape.js'
import { isSchemaObject, toolInputs, toolOperations } from '../tool-inputs.js'

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
// (`toolInputs`, files excepted), every value position below — properties (a `readOnly` one is never sent, one declared in a
// `then`, an `else` or a `dependentSchemas` entry is), map values, array and
// tuple items. A string is bounded by `maxLength`, by `enum` or `const`, by a
// format whose values have a fixed shape (`date`, `date-time`, `time`, `uuid`,
// `ipv4`, `ipv6`, `duration`), or by a `pattern` anchored at both ends with no
// unbounded quantifier (`*`, `+`, `{n,}` — inside a lookaround they consume
// nothing and do not count); an array by `maxItems`, by `enum` or `const`, or
// by `prefixItems` with `items: false`. A bound in an `allOf` member bounds the
// value; a `oneOf`/`anyOf` bounds it when every branch does. A file (`format:
// binary`) is bytes, not a string to bound: its size is the server's upload
// limit. Numbers are out of scope — their bounds are ranges, not sizes. An
// input with no type at all is `untyped-input`'s.
//
// Parameters are left out: they travel in the request line and the headers,
// which every server already caps — RFC 9110 §4.1 asks for 8000 octets of URI
// and answers 414 past its own limit, RFC 6585 §5 431 for headers — so a
// path or query string is bounded before the API sees it. A body has no such
// ceiling short of the server's upload limit, and that is where the
// unbounded string or array lands.
//
// One check per paths operation (webhooks and callbacks are requests the API
// sends) with at least one string or array in its body; the finding names how many
// inputs are unbounded and the first three. Graded per operation rather than
// per schema: the limit protects the endpoint, and a shared component left
// unbounded is a gap in every operation that accepts it.
export const unboundedInput = {
  id: 'unbounded-input',
  category: 'security',
  severity: 'info',
  run(ctx, check) {
    const verdicts = new Map()
    for (const entry of toolOperations(ctx)) {
      let sized = 0
      const unbounded = new Set()
      const seen = new Set()
      const visit = (schema, label) => {
        const verdict = verdictOf(schema, verdicts, 0)
        if (!verdict.sized.size) return
        sized += 1
        if (verdict.unbounded.size) unbounded.add(label)
      }
      for (const input of toolInputs(entry)) {
        // Named from its properties; a body that is itself a string or an
        // array, by its media type.
        if (input.kind === 'body') walkValues(input.schema, input.mediaType, '', visit, seen)
      }
      if (!sized) continue
      check(!unbounded.size, {
        op: entry,
        params: { count: unbounded.size, names: abbreviate([...unbounded]) },
      })
    }
  },
}

// Same budget as the shared schema walk (schema-walk.js).
const MAX_DEPTH = 24

const BOUNDED_FORMATS = new Set(['date', 'date-time', 'time', 'uuid', 'ipv4', 'ipv6', 'duration'])
const SIZED = ['string', 'array']

// The value positions below and including `root`, each labeled from the input:
// `owner.name`, `tags[]`, `labels.*`, `point[0]`. A position's children are read
// through its composition members, which describe the same value. Each schema
// object once per operation.
function walkValues(root, rootLabel, rootBase, visit, seen) {
  const walk = (schema, label, base, depth) => {
    if (!isSchemaObject(schema) || depth > MAX_DEPTH || seen.has(schema)) return
    seen.add(schema)
    visit(schema, label)
    const into = (sub, childLabel) => walk(sub, childLabel, childLabel, depth + 1)
    for (const part of compositionClosure(schema)) {
      if (isSchemaObject(part.properties)) {
        for (const [name, sub] of Object.entries(part.properties)) {
          if (isSchemaObject(sub) && sub.readOnly !== true)
            into(sub, base ? `${base}.${name}` : name)
        }
      }
      into(part.additionalProperties, base ? `${base}.*` : '*')
      if (isSchemaObject(part.patternProperties)) {
        for (const sub of Object.values(part.patternProperties)) into(sub, base ? `${base}.*` : '*')
      }
      into(part.items, `${base}[]`)
      for (const [index, sub] of listOf(part.prefixItems).entries()) into(sub, `${base}[${index}]`)
    }
  }
  walk(root, rootLabel, rootBase, 0)
}

// The schema and every subschema below it that describes this same value, each
// once: composition members, and the conditional ones — a property declared
// only in a `then` is sent all the same when the condition holds.
function compositionClosure(schema) {
  const parts = []
  const add = (part, depth) => {
    if (!isSchemaObject(part) || depth > MAX_DEPTH || parts.includes(part)) return
    parts.push(part)
    for (const keyword of ['allOf', 'oneOf', 'anyOf']) {
      for (const member of listOf(part[keyword])) add(member, depth + 1)
    }
    add(part.then, depth + 1)
    add(part.else, depth + 1)
    if (isSchemaObject(part.dependentSchemas)) {
      for (const member of Object.values(part.dependentSchemas)) add(member, depth + 1)
    }
  }
  add(schema, 0)
  return parts
}

// → { sized, unbounded, bounded }: the sized kinds (`string`, `array`) the
// value may be, those of them nothing bounds, and those something does.
// `allOf` members are conjoined with the schema — any of them bounding a kind
// bounds the value; `oneOf`/`anyOf` branches are alternatives — a kind is
// bounded there only when every branch bounds it. Cached by schema object:
// the verdict depends on nothing else.
function verdictOf(schema, cache, depth) {
  const cached = cache.get(schema)
  if (cached) return cached
  const verdict = { sized: new Set(), unbounded: new Set(), bounded: new Set() }
  // A cycle through composition, or past the budget: settled as saying nothing.
  cache.set(schema, verdict)
  if (depth > MAX_DEPTH) return verdict
  const parts = conjunction(schema)
  if (parts.some(isFileSchema)) return verdict
  const branches = parts
    .flatMap((part) => [...listOf(part.oneOf), ...listOf(part.anyOf)])
    .filter(isSchemaObject)
    .map((branch) => verdictOf(branch, cache, depth + 1))
  for (const kind of SIZED) {
    const declared = parts.some((part) => valueTypes(part).includes(kind))
    const inBranch = branches.some((branch) => branch.sized.has(kind))
    if (!declared && !inBranch) continue
    verdict.sized.add(kind)
    const bounded =
      parts.some((part) => bounds(part, kind)) ||
      (branches.length > 0 && branches.every((branch) => branch.bounded.has(kind)))
    if (bounded) verdict.bounded.add(kind)
    else if (declared || branches.some((branch) => branch.unbounded.has(kind))) {
      verdict.unbounded.add(kind)
    }
  }
  return verdict
}

// The schema and its `allOf` members, recursively: constraints that all hold.
function conjunction(schema) {
  const parts = []
  const add = (part, depth) => {
    if (!isSchemaObject(part) || depth > MAX_DEPTH || parts.includes(part)) return
    parts.push(part)
    for (const member of listOf(part.allOf)) add(member, depth + 1)
  }
  add(schema, 0)
  return parts
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

const SHOWN = 3

function abbreviate(values) {
  const shown = values.slice(0, SHOWN).join(', ')
  return values.length > SHOWN ? `${shown}, …` : shown
}
