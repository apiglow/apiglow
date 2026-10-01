import { describeValue } from '../value-check.js'
import { sideOf, validateValue } from '../value-validate.js'

// A `default` its own schema rejects: the form prefills a value the API will
// refuse, and every client generator copies it. Validated like an example
// (`value-validate.js`): type, enum, lengths, pattern, bounds, sizes, members,
// compositions, the common formats — a broken `format` alone graded `warning`.
// One check per default the validator has something to say about.
export const defaultAllowed = {
  id: 'default-allowed',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (schema.default === undefined) continue
      const target = { op, location, dataPath: `${dataPath}/default` }
      const { checked, failure } = validateValue(schema.default, schema, { side: sideOf(target) })
      if (!checked) continue
      check(!failure, {
        ...target,
        severity: failure?.severity,
        params: {
          value: describeValue(schema.default),
          keyword: failure?.keyword,
          at: failure?.at,
        },
      })
    }
  },
}
