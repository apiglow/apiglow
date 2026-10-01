import { placeOf } from '../locate.js'
import { mediaTypeAt } from '../media-family.js'
import { pointer } from '../pointer.js'
import { internalTarget, nodeAt } from '../ref-pointer.js'

// An `application/problem+json` response whose schema contradicts RFC 9457.
// "The canonical model for problem details is a JSON object" (§3), and its
// standard members have fixed types: `type` and `instance` a string holding
// a URI reference, `title` and `detail` strings, `status` a number (§3.1).
// A member of the wrong type "MUST be ignored" by the client — a `status`
// declared as the string "404" is dropped by every conforming reader, and a
// generated client typed from the schema expects what no problem-aware
// library hands over. A root that is no object (an array of errors, a
// string) is not problem details at all, whatever the media type says.
//
// Read from the schema itself and its `allOf` members (bounded, each once):
// a declared `type` without `object`, or `items`, at the root; a standard
// member whose declared `type` lacks `string` (`type`, `title`, `detail`,
// `instance`) or lacks both `number` and `integer` (`status`). An undeclared
// type contradicts nothing. Extension members are the API's own.
//
// One check per problem+json media type of a response (every operation kind,
// `components.responses` included) with a schema; a schema written once
// under `components.schemas` is checked once, there. The finding names the
// first offence as a JSON path — `$` for the root, `$.status` for a member.
// Boundaries: the value of `status` against the response's code is
// `problem-status-mismatch`'s; error responses that are prose only,
// `error-machine-readable`'s.
const PROBLEM = 'application/problem+json'
const RESPONSE_MEDIA = /\/responses\/[^/]+\/content\/[^/]+$/
const MEMBERS = [
  ['type', ['string']],
  ['status', ['number', 'integer']],
  ['title', ['string']],
  ['detail', ['string']],
  ['instance', ['string']],
]
const MAX_DEPTH = 8

export const problemDetailsShape = {
  id: 'problem-details-shape',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const seen = new Set()
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'MediaType' || !RESPONSE_MEDIA.test(dataPath)) continue
      if (mediaTypeAt(dataPath) !== PROBLEM) continue
      const schemaPath = `${dataPath}${pointer('schema')}`
      const schema = nodeAt(ctx.document, schemaPath)
      if (!isObject(schema) || seen.has(schema)) continue
      seen.add(schema)
      const ref = isObject(node.schema) ? internalTarget(node.schema.$ref) : null
      const at = ref?.startsWith('/components/schemas/') ? ref : schemaPath
      const member = offence(schema)
      check(member === null, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: member === null ? {} : { member },
      })
    }
  },
}

// → '$' or '$.<member>' for the first contradiction, or null.
function offence(root) {
  const layers = allOfLayers(root)
  for (const schema of layers) {
    if (schema.items !== undefined || excludes(schema.type, ['object'])) return '$'
  }
  for (const [name, allowed] of MEMBERS) {
    for (const schema of layers) {
      const member = isObject(schema.properties) ? schema.properties[name] : undefined
      if (isObject(member) && excludes(member.type, allowed)) return `$.${name}`
    }
  }
  return null
}

// The schema and its `allOf` members, recursively, each once.
function allOfLayers(root) {
  const layers = []
  const visit = (schema, depth) => {
    if (!isObject(schema) || depth > MAX_DEPTH || layers.includes(schema)) return
    layers.push(schema)
    if (Array.isArray(schema.allOf)) for (const member of schema.allOf) visit(member, depth + 1)
  }
  visit(root, 0)
  return layers
}

// A declared type (string or list) naming none of the allowed ones. No
// declared type, or one of another kind of value, excludes nothing here.
function excludes(type, allowed) {
  const types = typeof type === 'string' ? [type] : Array.isArray(type) ? type : null
  if (!types?.length) return false
  return !types.some((t) => allowed.includes(t))
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
