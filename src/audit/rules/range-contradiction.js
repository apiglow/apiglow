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
      const numeric = numericBounds(schema)
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

// The tightest lower and upper bound, both spellings → the contradiction, if
// any: { at, keys } naming the keywords to show.
function numericBounds(schema) {
  const lower = []
  const upper = []
  if (isNumber(schema.minimum)) {
    lower.push({
      value: schema.minimum,
      exclusive: schema.exclusiveMinimum === true,
      keys: ['minimum'],
    })
  }
  if (isNumber(schema.exclusiveMinimum)) {
    lower.push({ value: schema.exclusiveMinimum, exclusive: true, keys: ['exclusiveMinimum'] })
  }
  if (isNumber(schema.maximum)) {
    upper.push({
      value: schema.maximum,
      exclusive: schema.exclusiveMaximum === true,
      keys: ['maximum'],
    })
  }
  if (isNumber(schema.exclusiveMaximum)) {
    upper.push({ value: schema.exclusiveMaximum, exclusive: true, keys: ['exclusiveMaximum'] })
  }
  for (const low of lower) {
    for (const high of upper) {
      const empty =
        low.value > high.value || (low.value === high.value && (low.exclusive || high.exclusive))
      if (!empty) continue
      const keys = [...low.keys, ...high.keys]
      // 3.0's boolean qualifiers are part of what the reader must see.
      if (low.exclusive && low.keys[0] === 'minimum') keys.push('exclusiveMinimum')
      if (high.exclusive && high.keys[0] === 'maximum') keys.push('exclusiveMaximum')
      return { at: low.keys[0], keys }
    }
  }
  return null
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
