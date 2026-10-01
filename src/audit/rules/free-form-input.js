import { bodyKind, isFieldsKind } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { compositionMembers, isObjectSchema, placeInput, saysNothing } from '../input-shape.js'
import { payloadChildren, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'
import { isObject } from '../value-check.js'

// An input object with no shape: `type: object` (or an object by its keywords)
// that names no property, no key pattern, no key schema, composes nothing, and
// leaves `additionalProperties` open to anything — absent, `true`, or a schema
// that says nothing. The agent filling the tool in has every key to invent and
// nothing to check them against; the bridges copy the schema as it is, so no
// layer on the way adds what the document left out. OpenAI's strict mode goes
// further and refuses the schema: it requires declared properties and
// `additionalProperties: false`.
//
// A typed map — `additionalProperties: { type: string }` — has a shape: its keys
// are data, its values are described. `additionalProperties: false` with nothing
// else is an empty object, closed, not free. Not judged on its own, as they
// complete what holds them: an `allOf` member (one holding only `type: object`
// is completed by its siblings), a `then` / `else` / `dependentSchemas` member,
// and a `oneOf` / `anyOf` branch of an object that has a shape of its own —
// `{ properties: { email, phone }, oneOf: [{ required: [email] }, …] }`. A
// branch of a union with no shape of its own is the whole of what an agent
// gets for that choice, and is judged. Neither is the root of a form body: a
// form with no fields is `multipart-schema-object`'s.
//
// A schema is judged when it is reached through a judged position anywhere,
// whatever the order the operations come in: the walk collects the positions,
// the checks come after.
export const freeFormInput = {
  id: 'free-form-input',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const seen = new Set()
    const judged = new Set()
    const met = new Map()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        const form = input.kind === 'body' && isFieldsKind(bodyKind(input))
        if (!form && isObject(input.schema)) judged.add(input.schema)
        walkInputSchema(
          input.schema,
          input.dataPath,
          (schema, dataPath) => {
            met.set(schema, { entry, dataPath })
            const completed = new Set(completingMembers(schema))
            for (const [child] of payloadChildren(schema, dataPath)) {
              if (!completed.has(child)) judged.add(child)
            }
          },
          seen,
        )
      }
    }
    for (const [schema, { entry, dataPath }] of met) {
      if (!judged.has(schema) || !isObjectSchema(schema)) continue
      check(hasShape(schema), placeInput(ctx, entry, schema, dataPath))
    }
  },
}

// The members that describe `schema`'s value together with it rather than on
// their own.
function completingMembers(schema) {
  const members = compositionMembers(schema)
  if (ownShape(schema)) return members
  const branches = new Set(['oneOf', 'anyOf'].flatMap((keyword) => listOf(schema[keyword])))
  return members.filter((member) => !branches.has(member))
}

function hasShape(schema) {
  return ownShape(schema) || compositionMembers(schema).length > 0
}

function ownShape(schema) {
  if (nonEmpty(schema.properties) || nonEmpty(schema.patternProperties)) return true
  if (schema.propertyNames !== undefined) return true
  return !isOpen(schema.additionalProperties) || !isOpen(schema.unevaluatedProperties)
}

// Any extra key, any value.
function isOpen(keyword) {
  return keyword === undefined || keyword === true || saysNothing(keyword)
}

function nonEmpty(map) {
  return isObject(map) && Object.keys(map).length > 0
}
