// An array schema that says nothing about its elements: `type: array` without
// `items` (nor 3.1's `prefixItems` or `contains`). OpenAPI 3.0 makes `items`
// required on an array; from 3.1 it is valid JSON Schema, and still says
// nothing. This documentation shows the type as `array<any>`, its generated
// sample is an empty list, and the try-it offers no editor for the elements —
// the body is a JSON text to write blind. Code generators type it as a list of
// untyped values.
export const arrayItems = {
  id: 'array-items',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const isArray =
        schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))
      if (!isArray) continue
      if (
        schema.items !== undefined ||
        schema.prefixItems !== undefined ||
        schema.contains !== undefined
      )
        continue
      check(false, { op, location, dataPath })
    }
  },
}
