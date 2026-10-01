import { numericBounds } from '../value-check.js'

// Bounds no value can satisfy: `minimum` above `maximum` (or equal to it with
// either bound exclusive, in 3.0's boolean spelling or 3.1's numeric one),
// `minLength` above `maxLength`, `minItems` above `maxItems`, `minProperties`
// above `maxProperties`, `minContains` above `maxContains`, a `multipleOf` that
// is not above zero, a length or count bound below zero. JSON Schema requires
// the last two; the others are legal and empty: every value is rejected, so
// the field can never be sent and a response holding it is always invalid.
// This documentation shows the bounds as written, side by side.
//
// One check per contradiction, none otherwise.
const PAIRS = [
  ['minLength', 'maxLength'],
  ['minItems', 'maxItems'],
  ['minProperties', 'maxProperties'],
  ['minContains', 'maxContains'],
]
const COUNTS = PAIRS.flat()

export const rangeContradiction = {
  id: 'range-contradiction',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const report = (keyword, ...bounds) =>
        check(false, {
          op,
          location,
          dataPath: `${dataPath}/${keyword}`,
          params: { bounds: bounds.map((key) => `${key}: ${schema[key]}`).join(', ') },
        })
      const numeric = numericContradiction(schema)
      if (numeric) report(numeric.at, ...numeric.keys)
      for (const [low, high] of PAIRS) {
        if (isNumber(schema[low]) && isNumber(schema[high]) && schema[low] > schema[high]) {
          report(low, low, high)
        }
      }
      for (const keyword of COUNTS) {
        if (isNumber(schema[keyword]) && schema[keyword] < 0) report(keyword, keyword)
      }
      if (isNumber(schema.multipleOf) && schema.multipleOf <= 0) report('multipleOf', 'multipleOf')
    }
  },
}

// The numeric bounds, both spellings of exclusivity unified (`numericBounds`)
// → the first contradiction, as { at, keys } naming the keywords as written.
function numericContradiction(schema) {
  const bounds = numericBounds(schema)
  const side = (inclusive, exclusive) =>
    [inclusive, exclusive]
      .filter((keyword) => isNumber(bounds[keyword]))
      .map((keyword) => ({
        value: bounds[keyword],
        exclusive: keyword === exclusive,
        // 3.0 writes an exclusive bound as the bound plus a boolean beside it.
        keys: keyword === exclusive && schema[keyword] === true ? [inclusive, keyword] : [keyword],
      }))
  const lower = side('minimum', 'exclusiveMinimum')
  const upper = side('maximum', 'exclusiveMaximum')
  for (const low of lower) {
    for (const high of upper) {
      const empty =
        low.value > high.value || (low.value === high.value && (low.exclusive || high.exclusive))
      if (empty) return { at: low.keys[0], keys: [...low.keys, ...high.keys] }
    }
  }
  return null
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
