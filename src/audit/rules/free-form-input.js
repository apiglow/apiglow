import { bodyKind, isFieldsKind } from '../../openapi/body-kind.js'
import { compositionMembers, isObjectSchema, placeInput, saysNothing } from '../input-shape.js'
import { isSchemaObject, toolInputs, toolOperations, walkInputSchema } from '../tool-inputs.js'

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
// else is an empty object, closed, not free. A composition member is not judged
// on its own (an `allOf` member holding only `type: object` is completed by its
// siblings), and neither is the root of a form body: a form with no fields is
// `multipart-schema-object`'s.
export const freeFormInput = {
  id: 'free-form-input',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    const seen = new Set()
    const members = new Set()
    for (const entry of toolOperations(ctx)) {
      for (const input of toolInputs(entry)) {
        const form = input.kind === 'body' && isFieldsKind(bodyKind(input))
        walkInputSchema(
          input.schema,
          input.dataPath,
          (schema, dataPath, depth) => {
            for (const member of compositionMembers(schema)) members.add(member)
            if (members.has(schema) || (form && depth === 0) || !isObjectSchema(schema)) return
            check(hasShape(schema), placeInput(ctx, entry, schema, dataPath))
          },
          seen,
        )
      }
    }
  },
}

function hasShape(schema) {
  if (nonEmpty(schema.properties) || nonEmpty(schema.patternProperties)) return true
  if (schema.propertyNames !== undefined) return true
  if (compositionMembers(schema).length) return true
  return !isOpen(schema.additionalProperties) || !isOpen(schema.unevaluatedProperties)
}

// Any extra key, any value.
function isOpen(keyword) {
  return keyword === undefined || keyword === true || saysNothing(keyword)
}

function nonEmpty(map) {
  return isSchemaObject(map) && Object.keys(map).length > 0
}
