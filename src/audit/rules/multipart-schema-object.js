import { mediaEssence } from '../../openapi/body-kind.js'
import { operationContents } from '../schema-walk.js'

// A form body — `multipart/form-data` or `application/x-www-form-urlencoded` —
// whose schema is not an object with properties. A form is a set of named
// fields, and the schema's top-level properties are their names: the try-it
// builds one field per property (src/components/try-it/body-state.js). With no
// schema, an array, a string, or an object that names no property, it has no
// field to offer: the body section stays empty and the request leaves without
// one. Generators, likewise, have nothing to name the parts after.
//
// `multipart/mixed` and the other multipart flavours are left alone: their
// parts are positional, and 3.2 describes them with an array (`prefixEncoding`,
// `itemEncoding`). A composed schema (`allOf`…) is an object all the same — the
// try-it not merging it is this app's gap, not the document's.
const FORMS = new Set(['multipart/form-data', 'application/x-www-form-urlencoded'])

export const multipartSchemaObject = {
  id: 'multipart-schema-object',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const { kind, mediaType, content, dataPath } of operationContents(entry)) {
        if (kind !== 'request' || !FORMS.has(mediaEssence(mediaType))) continue
        if (namesFields(content.schema)) continue
        check(false, {
          op: entry,
          dataPath: content.schema === undefined ? dataPath : `${dataPath}/schema`,
          params: { mediaType: mediaEssence(mediaType) },
        })
      }
    }
  },
}

function namesFields(schema) {
  if (!schema || typeof schema !== 'object') return false
  if (['allOf', 'oneOf', 'anyOf'].some((keyword) => Array.isArray(schema[keyword]))) return true
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (schema.type !== undefined && !types.includes('object')) return false
  const properties = schema.properties
  return Boolean(properties && typeof properties === 'object' && Object.keys(properties).length)
}
