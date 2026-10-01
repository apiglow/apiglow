import { placeOf } from '../locate.js'
import { isPlaceholderExample } from '../placeholder-example.js'
import { pointer } from '../pointer.js'
import { nodeAt } from '../ref-pointer.js'
import { describeValue } from '../value-check.js'

// An example that is a placeholder rather than a value: `"string"`, `"TODO"`,
// `"lorem ipsum…"`, or an object made only of those and of `0`/`false` —
// Swagger Editor's generated `{ "id": 0, "name": "string" }`. The reader takes
// an example as the API's own word for what a real payload looks like; this
// documentation shows it as written under "Example", and the try-it prefills it
// as the value to send. A placeholder fills the slot and shows nothing, so
// `response-example` does not count it as an example.
//
// Narrow on purpose (`src/audit/placeholder-example.js`): a dull but plausible
// value is an example, and a value the schema's `enum`/`const` allows is
// never a placeholder. One check per example value written: a schema's
// `example` and each `examples` item, a Parameter's, Header's or Media Type's
// `example`, an Example Object's `value` and `dataValue`. Read on the source,
// where each sits once; an example shared through `components.examples` is
// checked there. That a value contradicts its schema is
// `example-type-mismatch`'s.
export const examplePlaceholder = {
  id: 'example-placeholder',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    // Example Object → the schema of the parameter, header or media type
    // whose `examples` map holds it inline: the `enum` a value may come from.
    const owners = new Map()
    const judge = (value, schema, dataPath) => {
      if (value === undefined) return
      // Placed and described on a finding only: GitHub's document carries
      // thousands of examples, some of them whole payloads.
      if (!isPlaceholderExample(value, schema)) return check(true, { dataPath })
      check(false, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { value: describeValue(value) },
      })
    }
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Parameter' || type === 'Header' || type === 'MediaType') {
        const schema = ownSchema(ctx, node, dataPath)
        judge(node.example, schema, `${dataPath}/example`)
        if (node.examples && typeof node.examples === 'object') {
          for (const example of Object.values(node.examples)) {
            if (example && typeof example === 'object') owners.set(example, schema)
          }
        }
      } else if (type === 'Example') {
        const schema = owners.get(node)
        judge(node.value, schema, `${dataPath}/value`)
        judge(node.dataValue, schema, `${dataPath}/dataValue`)
      } else if (type === 'Schema') {
        judge(node.example, node, `${dataPath}/example`)
        if (Array.isArray(node.examples)) {
          for (const [index, value] of node.examples.entries()) {
            judge(value, node, `${dataPath}${pointer('examples', index)}`)
          }
        }
      }
    }
  },
}

// The dereferenced schema next to the example: the source may hold a `$ref`.
function ownSchema(ctx, node, dataPath) {
  if (node.schema === undefined && node.itemSchema === undefined) return undefined
  const key = node.schema !== undefined ? 'schema' : 'itemSchema'
  return nodeAt(ctx.document, `${dataPath}/${key}`)
}
