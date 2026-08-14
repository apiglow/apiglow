import { statusMatches } from './evaluate.js'
import { pointerFrom, unescapePointerToken } from './pointer.js'

// Reading a response to turn it into extractions/assertions
// (docs/scenarios.md §5.4) — pure, tested functions.
//
// This is what makes chaining accessible without reading a doc: the JSON
// body of a response already obtained becomes a list of clickable pointers.
// The declared SCHEMA gives the same rows without anything having been
// sent — the keys of a response are known in advance, only their values
// aren't. Hence two producers of rows of the same shape, and a single
// rendering mechanism.

const PREVIEW_MAX = 60

// Safety bounds: a response can be huge or deeply nested, and this rendering
// lives in a doc column, not in a JSON explorer.
export function responseLeaves(value, { maxRows = 150, maxDepth = 6 } = {}) {
  const rows = []
  let truncated = false

  const walk = (node, segments, depth) => {
    if (truncated) return
    const entries = Array.isArray(node)
      ? node.map((item, index) => [String(index), item])
      : Object.entries(node)
    for (const [key, child] of entries) {
      if (rows.length >= maxRows) {
        truncated = true
        return
      }
      const path = [...segments, key]
      const container = child !== null && typeof child === 'object'
      rows.push({
        pointer: pointerFrom(path),
        label: key,
        depth,
        container,
        preview: preview(child),
      })
      // A container that is too deep remains extractable (its serialized
      // form), it is simply not expanded.
      if (container && depth + 1 < maxDepth) walk(child, path, depth + 1)
    }
  }

  if (value === null || typeof value !== 'object') return { rows, truncated }
  walk(value, [], 0)
  return { rows, truncated }
}

function preview(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return `{${Object.keys(value).length}}`
  const asText = typeof value === 'string' ? `"${value}"` : String(value)
  return asText.length > PREVIEW_MAX ? `${asText.slice(0, PREVIEW_MAX)}…` : asText
}

// --- rows derived from the schema -------------------------------------------

// Chain of nested composites: bounded, as everywhere else (rule 7).
const COMPOSITE_MAX = 12

// Same rows as `responseLeaves`, but derived from the normalized schema: the
// `preview` here describes the TYPE, never a value. A sample value here
// would make it look like an observation, and an assertion "= \"string\""
// would get committed without anyone seeing it.
export function schemaLeaves(schema, { maxRows = 150, maxDepth = 6 } = {}) {
  const rows = []
  let truncated = false

  const walk = (node, segments, depth) => {
    if (truncated) return
    for (const entry of childEntries(node)) {
      if (rows.length >= maxRows) {
        truncated = true
        return
      }
      const child = effective(entry.schema)
      const container = child?.kind === 'object' || child?.kind === 'array'
      const path = [...segments, entry.key]
      rows.push({
        // Dynamic keys: no pointer can be proposed, only manual entry can.
        // The row exists to say so.
        pointer: entry.dynamic ? null : pointerFrom(path),
        label: entry.key,
        depth,
        container,
        preview: schemaTypeLabel(child),
        required: entry.required === true,
        dynamic: entry.dynamic === true,
      })
      // A cyclic node is the same object as its ancestor: expanding it would
      // never terminate.
      if (entry.dynamic || child?.circular) continue
      if (container && depth + 1 < maxDepth) walk(child, path, depth + 1)
    }
  }

  const root = effective(schema)
  if (!root) return { rows, truncated }
  walk(root, [], 0)
  return { rows, truncated }
}

function childEntries(node) {
  if (node?.kind === 'object') {
    const entries = (node.properties ?? []).map((prop) => ({
      key: prop.name,
      schema: prop.schema,
      required: prop.required,
    }))
    if (node.additionalProperties) {
      entries.push({
        key: '*',
        schema: typeof node.additionalProperties === 'object' ? node.additionalProperties : null,
        dynamic: true,
      })
    }
    return entries
  }
  if (node?.kind === 'array') {
    // Index 0: it's the pointer you write by hand anyway (`/data/0/id`),
    // and the only one the schema guarantees if the array isn't empty.
    if (node.tupleItems?.length)
      return node.tupleItems.map((schema, i) => ({ key: String(i), schema }))
    return node.items ? [{ key: '0', schema: node.items }] : []
  }
  return []
}

// The shape a node truly describes. `allOf` is rendered as-is by the model
// (not merged, cf. model.js): without a merge here, an "allOf: [Base,
// {props}]" schema — very common — would show none of its keys.
function effective(schema, guard = 0) {
  if (schema?.kind !== 'composite' || guard > COMPOSITE_MAX) return schema ?? null
  const { keyword, variants } = schema.composite
  const resolved = (variants ?? []).map((variant) => effective(variant, guard + 1)).filter(Boolean)
  if (!resolved.length) return null
  if (keyword === 'allOf') {
    const objects = resolved.filter((variant) => variant.kind === 'object')
    if (!objects.length) return resolved[0]
    const seen = new Set()
    const properties = []
    for (const object of objects) {
      for (const prop of object.properties ?? []) {
        if (seen.has(prop.name)) continue
        seen.add(prop.name)
        properties.push(prop)
      }
    }
    return {
      kind: 'object',
      type: 'object',
      schemaName: schema.schemaName ?? objects.find((object) => object.schemaName)?.schemaName,
      properties,
      additionalProperties: objects.find((object) => object.additionalProperties)
        ?.additionalProperties,
    }
  }
  // oneOf/anyOf: only one shape can be listed — the first, like the
  // generated sample (sample.js). The count accompanies the row so the UI
  // doesn't pass off a variant as the only possible one.
  return resolved.length > 1 ? { ...resolved[0], variantCount: resolved.length } : resolved[0]
}

// Distinct from the `typeLabel` in schema-view.js, which describes a node as
// it is written ("oneOf", "array<Pet>") for a tree where variants are
// expanded alongside. Here the row is a pointer: it must describe the
// EFFECTIVE shape that this pointer will reach, composites resolved.
function schemaTypeLabel(schema) {
  const node = effective(schema)
  if (!node) return 'any'
  if (node.circular) return '↻'
  let label
  if (node.enum?.length) {
    label = node.enum
      .map((value) => (typeof value === 'string' ? `"${value}"` : String(value)))
      .join(' | ')
  } else if (node.kind === 'object') {
    label = node.schemaName ?? 'object'
  } else if (node.kind === 'array') {
    const item = effective(node.items)
    label = item?.schemaName ? `${item.schemaName}[]` : `${item?.type ?? 'any'}[]`
  } else {
    label = node.type ?? 'any'
    if (node.format) label += ` (${node.format})`
  }
  if (node.nullable) label += ' | null'
  if (node.variantCount > 1) label += ` · 1/${node.variantCount}`
  return label.length > PREVIEW_MAX ? `${label.slice(0, PREVIEW_MAX)}…` : label
}

// --- declared responses of an operation -------------------------------------

// What an operation promises to return, reduced to what is chainable. A
// response without a schema or headers has nothing to offer chaining: it
// disappears from the selector rather than proposing an empty page there.
export function chainableResponses(op) {
  return (op?.responses ?? [])
    .map((response) => ({
      status: String(response.status),
      contents: (response.contents ?? []).filter((content) => content.schema),
      headers: (response.headers ?? []).map((header) => ({
        name: header.name,
        required: header.required === true,
        preview: schemaTypeLabel(header.schema),
      })),
    }))
    .filter((response) => response.contents.length || response.headers.length)
}

// The one the step will receive, as far as we can know: its expected
// status takes priority, then the first success, then `default`.
export function preferredResponse(responses, expectedStatus) {
  if (!responses?.length) return null
  const wanted =
    expectedStatus === undefined || expectedStatus === null ? '' : String(expectedStatus)
  return (
    (wanted ? responses.find((r) => r.status === wanted) : null) ??
    (wanted ? responses.find((r) => statusMatches(wanted, Number(r.status))) : null) ??
    responses.find((r) => /^2\d\d$/.test(r.status)) ??
    responses.find((r) => /^2xx$/i.test(r.status)) ??
    responses.find((r) => r.status === 'default') ??
    responses[0]
  )
}

// Variable name suggested for a pointer: the last segment, in camelCase
// (`/access_token` → `accessToken`). The name remains editable — it's a
// suggestion, not a rule.
export function variableNameFor(pointer, fallback = 'value') {
  const last = unescapePointerToken(
    String(pointer ?? '')
      .split('/')
      .pop(),
  )
  const camel = last
    .replace(/[^\w.-]+/g, ' ')
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('')
  // An array index doesn't make a variable name: we go up one level.
  if (!camel || /^\d+$/.test(camel)) {
    const parent = String(pointer ?? '')
      .split('/')
      .slice(0, -1)
      .join('/')
    return parent ? variableNameFor(parent, fallback) : fallback
  }
  return camel
}
