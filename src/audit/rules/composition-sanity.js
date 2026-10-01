import { listOf } from '../../openapi/model.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// Compositions that cannot mean what they say:
// - `oneOf` / `anyOf` with a single member — a choice with no alternative:
//   this documentation shows a "one of" heading over one variant, generators
//   emit a union of one. Only a bare one: next to a description, `nullable` or
//   any other keyword it is the 3.0 idiom for decorating a `$ref`, like a
//   single-member `allOf`, which is never flagged.
// - a member listed twice — in a `oneOf` an instance matching it then matches
//   two members, and `oneOf` demands exactly one: never valid; in `anyOf` /
//   `allOf` it is dead weight, and generators emit the type twice.
// - `allOf` members declaring disjoint types (`string` and `object`): no
//   instance satisfies them all.
//
// The first two read the source, where the members are written (a `$ref` is
// its target's name there); the third the dereferenced schemas, where each
// member's type is in sight. One check per defect, none otherwise.
const COMPOSITIONS = ['oneOf', 'anyOf', 'allOf']

export const compositionSanity = {
  id: 'composition-sanity',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Schema') continue
      for (const keyword of COMPOSITIONS) {
        const members = node[keyword]
        if (!Array.isArray(members)) continue
        const at = `${dataPath}${pointer(keyword)}`
        if (members.length === 1 && keyword !== 'allOf' && Object.keys(node).length === 1) {
          check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { keyword } })
        }
        const seen = new Set()
        for (const [index, member] of members.entries()) {
          const key = memberKey(member)
          if (key === null) continue
          if (seen.has(key)) {
            const memberAt = `${at}${pointer(index)}`
            check(false, {
              ...placeOf(ctx.operations, memberAt),
              dataPath: memberAt,
              params: { keyword },
            })
          }
          seen.add(key)
        }
      }
    }
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!Array.isArray(schema.allOf) || !disjointTypes(schema)) continue
      check(false, { op, location, dataPath: `${dataPath}/allOf`, params: { keyword: 'allOf' } })
    }
  },
}

// What makes two written members the same: the target of a `$ref`, or the
// member written out in full. A member that cannot be serialized (a YAML alias
// looping back) has no verdict.
function memberKey(member) {
  if (!member || typeof member !== 'object') return null
  if (typeof member.$ref === 'string' && Object.keys(member).length === 1)
    return `$ref ${member.$ref}`
  try {
    return JSON.stringify(member)
  } catch {
    return null
  }
}

// The types each of the schema and its `allOf` members allows, intersected —
// `integer` within `number` — and found empty. Members declaring no type
// constrain nothing here.
function disjointTypes(schema) {
  let allowed = null
  for (const part of [schema, ...listOf(schema.allOf)]) {
    const types = declaredTypes(part)
    if (!types) continue
    allowed = allowed ? intersect(allowed, types) : types
    if (!allowed.size) return true
  }
  return false
}

function intersect(a, b) {
  const both = new Set([...a].filter((type) => b.has(type)))
  if ((a.has('integer') && b.has('number')) || (a.has('number') && b.has('integer'))) {
    both.add('integer')
  }
  return both
}

function declaredTypes(schema) {
  if (!schema || typeof schema !== 'object') return null
  const types = Array.isArray(schema.type)
    ? schema.type.filter((type) => typeof type === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : []
  if (!types.length) return null
  if (schema.nullable === true) types.push('null')
  return new Set(types)
}
