import { checkValueEnum, checkValueRange, describeValue, hasComposition } from '../value-check.js'

// A `default` its own schema rejects: the form prefills a value the API will
// refuse, and every client generator copies it.
export const defaultAllowed = {
  id: 'default-allowed',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (schema.default === undefined || hasComposition(schema)) continue
      const allowed = checkValueEnum(schema.default, schema)
      const inRange = checkValueRange(schema.default, schema)
      if (allowed === null && inRange === null) continue
      check(allowed !== false && inRange !== false, {
        op,
        location,
        dataPath: `${dataPath}/default`,
        params: { value: describeValue(schema.default) },
      })
    }
  },
}
