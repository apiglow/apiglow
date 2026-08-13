import { operationContents } from '../schema-walk.js'

// Docs readiness: with no example anywhere, the try-it prefills a sample
// generated from the schema — structurally valid, semantically meaningless
// ("string", 0). One hand-written example per operation is what makes the
// prefilled request sendable as-is.
//
// One check per operation carrying content: an operation that exchanges no
// payload at all has nothing to exemplify.
//
// "Anywhere" includes the parameters: `sample.js` prefills a field from
// `schema.examples[0]` whatever the field is, so an operation whose only
// example sits on a query parameter is already sendable as-is — saying it has
// none would be false.
export const operationExamples = {
  id: 'operation-examples',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      const contents = [...operationContents(entry)]
      if (!contents.length) continue
      check(
        contents.some(({ content }) => hasExample(content)) ||
          entry.parameters.some(({ param }) => hasExample(param)),
        { op: entry },
      )
    }
  },
}

// Media Type Object and Parameter Object alike: both carry `example`,
// `examples` and a schema, and the prefill reads them the same way.
function hasExample(node) {
  if (node.example !== undefined) return true
  if (node.examples && typeof node.examples === 'object') {
    if (Object.keys(node.examples).length) return true
  }
  // A schema-level example counts: the app uses it for the prefill just the
  // same, whether it sits on the media type or on the schema.
  return [node.schema, node.itemSchema].some(
    (schema) =>
      schema &&
      typeof schema === 'object' &&
      (schema.example !== undefined ||
        (Array.isArray(schema.examples) && schema.examples.length > 0)),
  )
}
