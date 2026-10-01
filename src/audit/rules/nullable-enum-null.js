// A schema that allows `null` — 3.0's `nullable: true`, or `null` among 3.1's
// types — while its `enum` does not list it. Both keywords apply: the type
// admits null, the enum then rejects it, so null is never valid. The author
// meant "one of these, or nothing"; validators answer "one of these", and code
// generators that read `nullable` produce an optional field the server will
// refuse to receive empty.
//
// `nullable` counts in a 3.0 document only, and only next to a `type` — 3.0.3
// says it adds null to the type it qualifies, nothing otherwise. From 3.1 it is
// no keyword at all (`version-legacy` says so).
// A null entry the declared type forbids is `enum-valid`'s.
export const nullableEnumNull = {
  id: 'nullable-enum-null',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.includes(null)) continue
      const declared = nullSpelling(schema, ctx.version.minor)
      if (!declared) continue
      check(false, { op, location, dataPath: `${dataPath}/enum`, params: { declared } })
    }
  },
}

function nullSpelling(schema, minor) {
  if (minor === 0 && schema.nullable === true && schema.type !== undefined) return 'nullable: true'
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    return `type: [${schema.type.map((type) => JSON.stringify(type)).join(', ')}]`
  }
  return null
}
