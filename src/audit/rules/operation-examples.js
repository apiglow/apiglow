import { hasRealExample } from '../placeholder-example.js'
import { carriesFile, operationContents } from '../schema-walk.js'
import { isObject } from '../value-check.js'

// Docs readiness: with no example anywhere, the try-it prefills a sample
// generated from the schema — structurally valid, semantically meaningless
// ("string", 0). One hand-written example per operation is what makes the
// prefilled request sendable as-is.
//
// One check per operation carrying content: an operation that exchanges no
// payload at all has nothing to exemplify, and neither has one whose only
// payloads are files — a download, an upload — since no example stands for
// bytes.
//
// "Anywhere" includes the parameters: `sample.js` prefills a field from
// `schema.examples[0]` whatever the field is, so an operation whose only
// example sits on a query parameter is already sendable as-is — saying it has
// none would be false. A parameter serialized by media type (`content`, 3.2's
// `querystring`) counts the same, on itself or on its media type.
//
// A placeholder is no example (`isPlaceholderExample`): Swagger's generated
// `{ "id": 0, "name": "string" }` prefills exactly the meaningless sample this
// rule asks to replace. `example-placeholder` lists each one.
export const operationExamples = {
  id: 'operation-examples',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      const contents = [...operationContents(entry)].filter((item) => !carriesFile(item))
      if (!contents.length) continue
      check(
        contents.some(({ content }) => hasExample(content)) ||
          entry.parameters.some(({ param }) => parameterHasExample(param)),
        { op: entry },
      )
    }
  },
}

function hasExample(node) {
  return hasRealExample(node, node.schema ?? node.itemSchema)
}

// A parameter serialized by media type has no schema of its own: its
// examples illustrate its one media type's, which may carry examples too.
function parameterHasExample(param) {
  if (!isObject(param)) return false
  const media = isObject(param.content) ? Object.values(param.content).filter(isObject) : []
  const schema =
    param.schema ?? (media.length === 1 ? (media[0].schema ?? media[0].itemSchema) : undefined)
  return hasRealExample(param, schema) || media.some(hasExample)
}
