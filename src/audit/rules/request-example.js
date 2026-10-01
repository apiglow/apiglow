import { isFileSchema } from '../../openapi/body-kind.js'
import { enumOf, listOf } from '../../openapi/model.js'
import { sentProperties } from '../body-properties.js'
import { toolInputs, toolOperations } from '../tool-inputs.js'
import { isObject } from '../value-check.js'
import { SCHEMA_DEPTH } from '../schema-walk.js'

// A request body whose schema shows no example of what to send. Tools built
// from the operation copy the request schema into their input schema whole —
// `example`, `examples`, `enum`, descriptions included — and ignore the media
// type's `example` / `examples`. An example written there, which this
// documentation's try-it prefills and `operation-examples` counts, never
// reaches the agent: it fills the body from types alone, and a `string` says
// nothing of the id format, the date layout or the unit the API expects.
//
// The schema shows an example when its root, or an `allOf` member of it, has
// `example` / `examples`; or when every value it sends does: each top-level
// property (read-only ones are never sent) carries `example`, `examples`,
// `enum` or `const` — an object property through its own properties, an array
// through its items, a wrapper or a union through one of its members; a file
// part of a form (`format: binary`, the try-it's file picker) has nothing to
// show. A scalar body is exemplified by its `enum` / `const` too.
//
// One check per distinct schema among an operation's non-file request media
// types — the same payload offered as JSON, form and XML is one example to
// write, as `response-example` counts it; a file has no example to write, a
// body with no schema is no tool argument to fill, and an object whose
// declared properties are all `readOnly` has nothing to send.
export const requestExample = {
  id: 'request-example',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      const seen = new Set()
      for (const input of toolInputs(entry)) {
        if (input.kind !== 'body' || !isObject(input.schema)) continue
        if (seen.has(input.schema) || sendsNothing(input.schema)) continue
        seen.add(input.schema)
        check(exemplified(input.schema), {
          op: entry,
          dataPath: input.dataPath,
          params: { mediaType: input.mediaType },
        })
      }
    }
  },
}

// An object whose every declared property is `readOnly`: nothing to send, so
// nothing to show an example of.
function sendsNothing(schema) {
  if (sentProperties(schema, '').length) return false
  return [schema, ...listOf(schema.allOf)].some(
    (member) => isObject(member?.properties) && Object.keys(member.properties).length > 0,
  )
}

// A cycle back to an ancestor shows nothing new, and counts as unexemplified.

function exemplified(schema, depth = 0, stack = new Set()) {
  if (!isObject(schema) || depth > SCHEMA_DEPTH || stack.has(schema)) return false
  // A file part of a form: bytes the user picks, no value to exemplify.
  if (carriesExample(schema) || isFileSchema(schema)) return true
  stack.add(schema)
  const result = shownByParts(schema, depth + 1, stack)
  stack.delete(schema)
  return result
}

function shownByParts(schema, depth, stack) {
  const properties = sentProperties(schema, '')
  if (properties.length) {
    return properties.every((property) => exemplified(property.schema, depth, stack))
  }
  if (isObject(schema.items)) return exemplified(schema.items, depth, stack)
  if (listsValues(schema)) return true
  // A value held by a wrapper (`allOf: [$ref]`, the 3.0 way to describe a
  // reference) or offered as a choice: one exemplified branch shows a value.
  return ['allOf', 'oneOf', 'anyOf'].some((keyword) =>
    listOf(schema[keyword]).some((member) => exemplified(member, depth, stack)),
  )
}

// `enum`, `const`, or a union of constants: the values themselves are the
// example.
function listsValues(schema) {
  return Boolean(enumOf(schema)?.values.length)
}

function carriesExample(schema) {
  if (schema.example !== undefined) return true
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return true
  return listOf(schema.allOf).some(
    (member) =>
      isObject(member) &&
      (member.example !== undefined ||
        (Array.isArray(member.examples) && member.examples.length > 0)),
  )
}
