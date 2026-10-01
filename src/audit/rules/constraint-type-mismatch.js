import { pointer } from '../pointer.js'
import { APPLIES_TO, declaredTypes } from '../schema-keywords.js'
import { validateValue } from '../value-validate.js'

// A keyword that acts on none of the declared types: `maxLength` on an
// integer, `minimum` on a string, `minItems` on an object, `properties` on an
// array. JSON Schema applies each keyword to instances of its own type and
// ignores it on the others, so the limit the author wrote is enforced by no
// validator and dropped by code generators — while this documentation shows it
// as a constraint, promising a check nobody makes. Usually a `type` changed
// after the constraints were written, or a constraint meant for `items`.
//
// Only where a type is declared, and only for JSON types (a type this table
// does not know is `field-value-kind`'s). `required: true` on a property is
// `schema-keyword-typo`'s.
//
// The same holds for 3.0's `nullable: true` with no `type` beside it: OAS
// 3.0.4, Schema Object, "This keyword only takes effect if type is explicitly
// defined within the same Schema Object." Validators then let the rest of the
// schema decide, while this documentation shows the field as nullable (the
// model adds `null` all the same). Reported only where that rest rejects null
// — a `oneOf` of a string and an integer, an `allOf` of an object — since a
// schema that already admits anything loses nothing. From 3.1, `nullable` is
// `version-legacy`'s. One check per ignored keyword, none otherwise.
export const constraintTypeMismatch = {
  id: 'constraint-type-mismatch',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (ctx.version.minor === 0 && nullableIgnored(schema)) {
        check(false, {
          op,
          location,
          dataPath: `${dataPath}/nullable`,
          params: { keyword: 'nullable' },
        })
      }
      const types = declaredTypes(schema)
      if (!types?.length) continue
      for (const [keyword, applies] of Object.entries(APPLIES_TO)) {
        if (schema[keyword] === undefined) continue
        if (keyword === 'required' && !Array.isArray(schema.required)) continue
        if (types.some((type) => applies.includes(type))) continue
        check(false, {
          op,
          location,
          dataPath: `${dataPath}${pointer(keyword)}`,
          params: { keyword, type: types.join(' | ') },
        })
      }
    }
  },
}

function nullableIgnored(schema) {
  if (schema.nullable !== true || schema.type !== undefined) return false
  const { nullable: _, ...rest } = schema
  return Boolean(validateValue(null, rest).failure)
}
