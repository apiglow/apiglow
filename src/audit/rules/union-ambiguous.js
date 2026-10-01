import { listOf } from '../../openapi/model.js'
import { isConstant, placeInput, valueTypes } from '../input-shape.js'
import { hasText } from '../text.js'
import { isSchemaObject, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'

// An input `oneOf` / `anyOf` whose branches an agent cannot tell apart: two of
// them take the same JSON type, and neither carries a `title` or a
// `description`. The bridges copy the union into the tool's schema as it is,
// with every branch inlined — a `$ref`'s component name does not survive — so
// the model sees two nameless object shapes and picks one; a `oneOf` the payload
// matches the wrong way is a rejected call. A `discriminator` settles it (the
// key says which branch), and so does a title and a description per branch
// saying when to send it.
//
// Worth knowing, though not what this rule grades: OpenAI's strict mode and
// Gemini's function declarations do not support `oneOf` at all.
//
// A branch's type is its declared `type`, else the one its keywords imply
// (`properties` → object, `items` → array), else its `allOf` members'; `integer`
// and `number` are one JSON type. Not ambiguous:
// - a branch that is a single constant: it names itself; a union made only of
//   constants is an enum, `enum-values-undescribed`'s;
// - two object branches that each require a key the other does not declare
//   (`{ subject_digests }` or `{ attestation_ids }`): the key is the
//   discriminator, left implicit, and its name and description say which
//   branch a payload is;
// - two array branches whose items are of different types;
// - a branch with no type at all: `untyped-input`'s.
// Annotations on a branch's `allOf` members count — the tool carries them with
// it — unless both branches have them, as from a shared base.
const MAX_MEMBER_DEPTH = 3

export const unionAmbiguous = {
  id: 'union-ambiguous',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const seen = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        walkInputSchema(
          input.schema,
          input.dataPath,
          (schema, dataPath) => {
            for (const keyword of ['oneOf', 'anyOf']) {
              const branches = listOf(schema[keyword])
              if (branches.length < 2 || branches.every(isConstant)) continue
              const clash = isSchemaObject(schema.discriminator) ? null : firstClash(branches)
              check(!clash, {
                ...placeInput(ctx, entry, schema, dataPath),
                params: { keyword, ...clash },
              })
            }
          },
          seen,
        )
      }
    }
  },
}

function firstClash(branches) {
  const candidates = branches
    .map((branch, index) => ({
      index,
      constant: isConstant(branch),
      kinds: kindsOf(branch, 0),
      texts: textsOf(branch, 0),
      keys: keysOf(branch, 0),
      itemKinds: kindsOf(branch?.items, 0),
    }))
    .filter(({ constant }) => !constant)
  for (const [at, a] of candidates.entries()) {
    for (const b of candidates.slice(at + 1)) {
      if (tellsApart(a.texts, b.texts) || tellsApart(b.texts, a.texts)) continue
      const type = [...a.kinds].find((kind) => b.kinds.has(kind))
      if (!type || (type === 'object' && keyed(a.keys, b.keys) && keyed(b.keys, a.keys))) continue
      if (type === 'array' && disjoint(a.itemKinds, b.itemKinds)) continue
      return { first: a.index, second: b.index, type }
    }
  }
  return null
}

// Arrays of strings and arrays of objects: the elements say which is which.
function disjoint(kinds, others) {
  return kinds.size > 0 && others.size > 0 && ![...kinds].some((kind) => others.has(kind))
}

// A key one object branch requires and the other does not even declare: a
// payload carries it or not, and the key's own name and description say which
// branch it is — the discriminator, left implicit.
function keyed(keys, others) {
  return [...keys.required].some((name) => !others.declared.has(name))
}

// A title or a description one branch has and the other lacks. Text both share
// — a common base's description, inherited through `allOf` — names neither.
function tellsApart(texts, others) {
  return [...texts].some((text) => !others.has(text))
}

function kindsOf(schema, depth) {
  const kinds = new Set(valueTypes(schema).map((type) => (type === 'integer' ? 'number' : type)))
  if (kinds.size || depth >= MAX_MEMBER_DEPTH || !isSchemaObject(schema)) return kinds
  for (const member of listOf(schema.allOf)) {
    for (const kind of kindsOf(member, depth + 1)) kinds.add(kind)
  }
  return kinds
}

function keysOf(schema, depth, keys = { required: new Set(), declared: new Set() }) {
  if (!isSchemaObject(schema)) return keys
  for (const name of listOf(schema.required)) keys.required.add(name)
  if (isSchemaObject(schema.properties)) {
    for (const name of Object.keys(schema.properties)) keys.declared.add(name)
  }
  if (depth < MAX_MEMBER_DEPTH) {
    for (const member of listOf(schema.allOf)) keysOf(member, depth + 1, keys)
  }
  return keys
}

function textsOf(schema, depth, texts = new Set()) {
  if (!isSchemaObject(schema)) return texts
  for (const text of [schema.title, schema.description]) {
    if (hasText(text)) texts.add(text.trim())
  }
  if (depth < MAX_MEMBER_DEPTH) {
    for (const member of listOf(schema.allOf)) textsOf(member, depth + 1, texts)
  }
  return texts
}
