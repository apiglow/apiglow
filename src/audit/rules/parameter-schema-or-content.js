import { placeOf } from '../locate.js'
import { objectLabel } from '../openapi-objects.js'

// A Parameter or a Header says how its value is shaped in one of two ways: a
// `schema` (with `style` and `explode` describing the serialization), or a
// `content` map naming the one media type the value is serialized as. Never
// both, never neither, and a `content` map holds exactly one entry (OAS 3.x,
// Parameter Object: "MUST contain either a schema property, or a content
// property, but not both"; content "MUST only contain one entry"). With both,
// tools pick different ones; with neither, the value has no type at all — a
// bare text box in the try-it, an untyped argument in a generated client; with
// several media types, nothing says which one the value is sent as.
//
// A field present without a value is `field-without-value`'s, a `content` that
// is not a map `field-value-kind`'s. One check per defect.
export const parameterSchemaOrContent = {
  id: 'parameter-schema-or-content',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Parameter' && type !== 'Header') continue
      const hasSchema = node.schema !== undefined
      const hasContent = node.content !== undefined
      const content = node.content
      const entries =
        content && typeof content === 'object' && !Array.isArray(content)
          ? Object.keys(content).filter((key) => !key.startsWith('x-')).length
          : 1
      if (hasSchema !== hasContent && (!hasContent || entries === 1)) continue
      check(false, {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { object: objectLabel(type) },
      })
    }
  },
}
