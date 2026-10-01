import { placeOf } from '../locate.js'
import { inVersion, OBJECTS, objectLabel, PATTERNED } from '../openapi-objects.js'
import { pointer } from '../pointer.js'

// A field the object does not have in the declared version — `descripton`,
// `requried`, a 3.0 `allowEmptyValue` left on a 3.2 Header. Every OpenAPI
// object holds its fixed fields and `x-` extensions, nothing else: whatever the
// author meant by it, no tool reads it, this documentation included, and the
// value silently does nothing.
//
// A field a LATER version introduced is `version-construct`'s, which says which
// version to declare; a Schema Object is open to unknown keywords in 3.1, and
// a misspelled one is `schema-keyword-typo`'s; a Reference Object's extra keys
// are `ref-siblings`'. One check per unknown field, none otherwise.
export const unknownField = {
  id: 'unknown-field',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const minor = ctx.version.minor
    for (const { type, node, dataPath } of ctx.objects) {
      if (type === 'Schema' || type === 'Reference' || PATTERNED.has(type)) continue
      const fields = OBJECTS[type]
      for (const key of Object.keys(node)) {
        if (key.startsWith('x-')) continue
        const field = fields[key]
        if (field && (inVersion(field, minor) || (field.since ?? 0) > minor)) continue
        const at = `${dataPath}${pointer(key)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { field: key, object: objectLabel(type), declared: ctx.version.raw },
        })
      }
    }
  },
}
