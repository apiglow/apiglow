import { pointer } from '../pointer.js'

// `required: ['petId']` with no `petId` declared: the field is required but
// described nowhere, so the try-it form cannot even offer it.
//
// "Declared" reads the schema the way a validator applies it to one value:
// the schema's own `properties`, those of its `allOf` members and of any
// `oneOf` / `anyOf` branch or conditional (recursively), a `patternProperties`
// pattern matching the name — and everything the schemas it is composed into
// declare: a `oneOf` branch requiring what its parent lists, or an `allOf`
// member requiring what a sibling defines, is the usual way to write a
// variant. The names `dependentRequired` lists are checked the same way.
//
// A schema whose whole family declares no property at all is a free-form
// object, skipped — unless it says `additionalProperties: false`: then no
// name is declarable, and every required one fails. One check per required
// name otherwise.
const SAME_VALUE = ['allOf', 'oneOf', 'anyOf']
const CONDITIONAL = ['if', 'then', 'else']
// The cap bounds a composition that refers to itself.
const MAX_DEPTH = 16

export const requiredPropertyDeclared = {
  id: 'required-property-declared',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const parents = composedInto(ctx.schemas)
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const names = requiredNames(schema)
      if (!names.length) continue
      const family = { names: new Set(), patterns: [] }
      const seen = new Set()
      collect(schema, family, seen)
      for (const parent of ancestors(schema, parents)) collect(parent, family, seen)
      const declarable = family.names.size > 0 || family.patterns.length > 0
      if (!declarable && schema.additionalProperties !== false) continue
      for (const { name, at } of names) {
        const declared =
          family.names.has(name) || family.patterns.some((pattern) => pattern.test(name))
        check(declared, { op, location, dataPath: `${dataPath}${at}`, params: { name } })
      }
    }
  },
}

function requiredNames(schema) {
  const names = []
  if (Array.isArray(schema.required)) {
    for (const [index, name] of schema.required.entries()) {
      if (typeof name === 'string') names.push({ name, at: pointer('required', index) })
    }
  }
  const dependent = schema.dependentRequired
  if (dependent && typeof dependent === 'object' && !Array.isArray(dependent)) {
    for (const [key, list] of Object.entries(dependent)) {
      if (!Array.isArray(list)) continue
      for (const [index, name] of list.entries()) {
        if (typeof name === 'string') {
          names.push({ name, at: pointer('dependentRequired', key, index) })
        }
      }
    }
  }
  return names
}

// Child → the schemas that apply it to the same value as themselves.
function composedInto(schemas) {
  const parents = new Map()
  const link = (child, parent) => {
    if (!child || typeof child !== 'object') return
    if (!parents.has(child)) parents.set(child, [])
    parents.get(child).push(parent)
  }
  for (const { schema } of schemas) {
    for (const keyword of SAME_VALUE) {
      if (Array.isArray(schema[keyword])) for (const member of schema[keyword]) link(member, schema)
    }
    for (const keyword of CONDITIONAL) link(schema[keyword], schema)
    const dependent = schema.dependentSchemas
    if (dependent && typeof dependent === 'object') {
      for (const member of Object.values(dependent)) link(member, schema)
    }
  }
  return parents
}

function* ancestors(schema, parents) {
  const seen = new Set([schema])
  const queue = [...(parents.get(schema) ?? [])]
  while (queue.length) {
    const parent = queue.shift()
    if (seen.has(parent)) continue
    seen.add(parent)
    yield parent
    queue.push(...(parents.get(parent) ?? []))
  }
}

// Everything a schema and its members declare, into `family`.
function collect(schema, family, seen, depth = 0) {
  if (!schema || typeof schema !== 'object' || seen.has(schema) || depth > MAX_DEPTH) return
  seen.add(schema)
  if (schema.properties && typeof schema.properties === 'object') {
    for (const name of Object.keys(schema.properties)) family.names.add(name)
  }
  if (schema.patternProperties && typeof schema.patternProperties === 'object') {
    for (const source of Object.keys(schema.patternProperties)) {
      try {
        family.patterns.push(new RegExp(source, 'u'))
      } catch {
        // `pattern-valid`'s; matching nothing here would invent a finding.
        family.patterns.push({ test: () => true })
      }
    }
  }
  for (const keyword of SAME_VALUE) {
    if (!Array.isArray(schema[keyword])) continue
    for (const member of schema[keyword]) collect(member, family, seen, depth + 1)
  }
  for (const keyword of CONDITIONAL) collect(schema[keyword], family, seen, depth + 1)
}
