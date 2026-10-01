import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// An example whose whole value is `{ "$ref": "…" }`. An example is data, and a
// `$ref` inside data is data too — the loader leaves it as written, so this
// documentation shows the literal object, and the try-it prefills it as the
// body to send. The author almost always meant a reference to a shared
// example: that `$ref` belongs on the Example Object itself, as an entry of an
// `examples` map (`examples: { pet: { $ref: '#/components/examples/Pet' } }`).
//
// Only a value that is exactly one `$ref` string: an example that merely
// contains `$ref` keys deeper down is a payload about JSON Schemas, and
// legitimate. Read on the source, where each example sits once.
export const exampleHasRef = {
  id: 'example-has-ref',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const report = (value, dataPath) => {
      if (!isLoneRef(value)) return
      check(false, { ...placeOf(ctx.operations, dataPath), dataPath, params: { ref: value.$ref } })
    }
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Parameter' || type === 'Header' || type === 'MediaType') {
        report(node.example, `${dataPath}/example`)
      } else if (type === 'Example') {
        report(node.value, `${dataPath}/value`)
        report(node.dataValue, `${dataPath}/dataValue`)
      } else if (type === 'Schema') {
        report(node.example, `${dataPath}/example`)
        if (Array.isArray(node.examples)) {
          for (const [index, value] of node.examples.entries()) {
            report(value, `${dataPath}${pointer('examples', index)}`)
          }
        }
      }
    }
  },
}

function isLoneRef(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.$ref === 'string' &&
    Object.keys(value).length === 1
  )
}
