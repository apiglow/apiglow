import { pointer } from '../pointer.js'
import { checkValueType, describeValue } from '../value-check.js'

// An `enum` that cannot do its job: not a list, an empty list (no value is ever
// valid), an entry the schema's own `type` rejects (`enum: ["1", "2"]` on an
// integer — a value nobody can send), or the same entry twice. Validators
// reject the instance or the schema; code generators emit an enum constant
// that can never occur, or two constants of one name — a compile error in
// Java, C# or Kotlin. This documentation lists every entry as written, so the
// reader is offered values the API refuses.
//
// One check per unusable entry (one for the whole enum when it is no list or
// an empty one), none otherwise. A `null` entry the schema forbids is reported
// here too; a schema that allows null while its enum lacks it is
// `nullable-enum-null`'s.
export const enumValid = {
  id: 'enum-valid',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (schema.enum === undefined || schema.enum === null) continue
      const at = `${dataPath}/enum`
      const report = (path, detail) =>
        check(false, { op, location, dataPath: path, params: { detail } })
      if (!Array.isArray(schema.enum) || !schema.enum.length) {
        report(at, describeValue(schema.enum))
        continue
      }
      const seen = new Set()
      for (const [index, value] of schema.enum.entries()) {
        const path = `${at}${pointer(index)}`
        const key = JSON.stringify(value)
        if (seen.has(key)) {
          report(path, `${describeValue(value)} ×2`)
          continue
        }
        seen.add(key)
        if (checkValueType(value, schema) === false) {
          report(path, `${describeValue(value)} ≠ type: ${typeLabel(schema)}`)
        }
      }
    }
  },
}

function typeLabel(schema) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  return types.join(' | ')
}
