import { enumOf } from '../../openapi/model.js'
import { placeInput } from '../input-shape.js'
import { isSubstantive } from '../text.js'
import { isSchemaObject, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'

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
    const seen = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        // The prose inherited by a schema from what holds it.
        const context = new Map()
        if (isSchemaObject(input.schema) && input.kind === 'parameter') {
          context.set(input.schema, [input.param.description])
        }
        walkInputSchema(
          input.schema,
          input.dataPath,
          (schema, dataPath) => {
            const texts = [schema.description, ...(context.get(schema) ?? [])]
            for (const holder of heldSchemas(schema)) {
              if (!context.has(holder)) context.set(holder, texts)
            }
            const missing = unexplained(schema, texts)
            if (!missing) return
            check(!missing.list.length, {
              ...placeInput(ctx, entry, schema, dataPath),
              params: { count: missing.count, missing: abbreviate(missing.list) },
            })
          },
          seen,
        )
      }
    }
  },
}

// Schemas that stand for the same value as their holder, or for its elements:
// the holder's prose is about them. A property is a value of its own.
function heldSchemas(schema) {
  const held = [schema.items]
  for (const keyword of ['allOf', 'oneOf', 'anyOf', 'prefixItems']) {
    if (Array.isArray(schema[keyword])) held.push(...schema[keyword])
  }
  return held.filter(isSchemaObject)
}

// → null when the schema is no enum worth a check, else { count, list } of
// the values nothing explains.
function unexplained(schema, texts) {
  const read = enumOf(schema)
  if (!read) return null
  const entries = read.values
    .map((value, index) => ({ value, description: read.descriptions?.[index] }))
    .filter(({ value }) => value !== null)
  if (entries.length < 2 || entries.every(({ value }) => typeof value === 'boolean')) return null
  const prose = texts
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => text.toLowerCase())
  const list = entries
    .filter(({ value, description }) => {
      if (isSubstantive(description, { name: spelled(value) })) return false
      return !prose.some((text) => namesValue(text, value))
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
