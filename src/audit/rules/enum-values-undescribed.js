import { enumOf } from '../../openapi/model.js'
import { placeInput } from '../input-shape.js'
import { isSubstantive } from '../text.js'
import { SCHEMA_DEPTH } from '../schema-walk.js'
import { payloadChildren, toolInputs, toolOperations } from '../tool-inputs.js'
import { isObject } from '../value-check.js'

// An input enum whose values are not all explained: the agent sees `S`, `M`,
// `XL`, or `1`, `2`, `3`, and has to guess which one the user's request means.
// A tool built from the operation carries the schema whole — the values and
// whatever the schema says about them — so the meaning has to be written there.
//
// A value is explained when the schema describes it on its own, read exactly as
// this documentation reads it (`enumOf`, `src/openapi/model.js`, rendered as a list of value and
// meaning by `chipsLine`): an `x-enum-descriptions` / `x-enumDescriptions` entry,
// or the `description` / `title` of its branch in a `oneOf` / `anyOf` of
// constants. A placeholder or the value read back ("active: Active") explains
// nothing (`isSubstantive`, as for every "described" rule). Or when the prose
// that goes with the enum names the value as a whole word, case-insensitive: the
// schema's own `description`, and, through `items` and composition, the one of
// the array, wrapper or parameter that holds it. The description is the
// recommended form: OpenAI strict mode keeps standard keywords only and drops
// the `x-` extensions, while the description travels everywhere.
//
// A schema held in several places — a component under two parameters, or
// under a described array and as a bare property — is explained by that prose
// only when every place's names the value: each tool carries its own, and the
// agent behind the least explicit one guesses. Whatever order the operations
// come in, the verdict is the same.
//
// One check per input enum of two values or more, each schema object once —
// a component's at the component, where it is fixed for every operation.
// `null` is the nullable marker, not a choice to explain, and a boolean enum
// says all there is to say. Whether the enum has a description at all is
// `property-described`'s and `parameter-described`'s; a union of constants is
// this rule's, never `union-ambiguous`'s.
export const enumValuesUndescribed = {
  id: 'enum-values-undescribed',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    // schema → { entry, dataPath, contexts }: where it was first met, and the
    // prose each place holding it carries, keyed by its texts.
    const reached = new Map()
    const reach = (schema, dataPath, depth, inherited, entry) => {
      if (!isObject(schema) || depth > SCHEMA_DEPTH) return
      let site = reached.get(schema)
      if (!site) {
        site = { entry, dataPath, contexts: new Map() }
        reached.set(schema, site)
      }
      const key = inherited.join('\u0000')
      if (site.contexts.has(key)) return
      site.contexts.set(key, inherited)
      const passed = withText(inherited, schema.description)
      const held = new Set(heldSchemas(schema))
      for (const [child, childPath] of payloadChildren(schema, dataPath)) {
        reach(child, childPath, depth + 1, held.has(child) ? passed : [], entry)
      }
    }
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        const inherited = input.kind === 'parameter' ? withText([], input.param.description) : []
        reach(input.schema, input.dataPath, 0, inherited, entry)
      }
    }
    for (const [schema, { entry, dataPath, contexts }] of reached) {
      const missing = unexplained(schema, [...contexts.values()])
      if (!missing) continue
      check(!missing.list.length, {
        ...placeInput(ctx, entry, schema, dataPath),
        params: { count: missing.count, missing: abbreviate(missing.list) },
      })
    }
  },
}

// The prose a place carries, lowercased, each text once and in a fixed order:
// a cycle through `items` or composition adds nothing new, and ends there.
function withText(texts, text) {
  if (typeof text !== 'string' || !text.trim()) return texts
  const lower = text.toLowerCase()
  return texts.includes(lower) ? texts : [...texts, lower].sort()
}

// Schemas that stand for the same value as their holder, or for its elements:
// the holder's prose is about them. A property is a value of its own.
function heldSchemas(schema) {
  const held = [schema.items]
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
    if (Array.isArray(schema[keyword])) held.push(...schema[keyword])
  }
  return held.filter(isObject)
}

// → null when the schema is no enum worth a check, else { count, list } of
// the values nothing explains. `contexts`: the prose of each place holding it.
function unexplained(schema, contexts) {
  const read = enumOf(schema)
  if (!read) return null
  const entries = read.values
    .map((value, index) => ({ value, description: read.descriptions?.[index] }))
    .filter(({ value }) => value !== null)
  if (entries.length < 2 || entries.every(({ value }) => typeof value === 'boolean')) return null
  const own = withText([], schema.description)
  const list = entries
    .filter(({ value, description }) => {
      if (isSubstantive(description, { name: spelled(value) })) return false
      if (own.some((text) => namesValue(text, value))) return false
      return !contexts.every((texts) => texts.some((text) => namesValue(text, value)))
    })
    .map(({ value }) => spelled(value))
  return { count: entries.length, list }
}

// Whole word, case-insensitive. Searched rather than matched with a regular
// expression built per value: a Unicode-aware pattern compiled for each of a
// large document's thousands of values is most of the rule's time.
function namesValue(text, value) {
  const needle = spelled(value).toLowerCase()
  let at = text.indexOf(needle)
  while (at >= 0) {
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + needle.length])) return true
    at = text.indexOf(needle, at + 1)
  }
  return false
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

function isWordChar(char) {
  return char !== undefined && WORD_CHAR.test(char)
}

// A string as written; anything else — and the empty string, which would show
// as nothing at all — as JSON.
function spelled(value) {
  return typeof value === 'string' && value ? value : JSON.stringify(value)
}

const SHOWN = 3

function abbreviate(values) {
  const shown = values.slice(0, SHOWN).join(', ')
  return values.length > SHOWN ? `${shown}, …` : shown
}
