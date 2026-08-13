import { pointer } from '../pointer.js'
import { hasComposition } from '../value-check.js'

// `required: ['petId']` with no `petId` in `properties`: the field is required
// but described nowhere, so the try-it form cannot even offer it.
export const requiredPropertyDeclared = {
  id: 'required-property-declared',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!Array.isArray(schema.required)) continue
      // A composed schema legitimately requires what a branch defines, and a
      // schema with no `properties` at all is a free-form object, not a bug.
      if (hasComposition(schema)) continue
      if (!schema.properties || typeof schema.properties !== 'object') continue
      for (const [index, name] of schema.required.entries()) {
        check(Object.hasOwn(schema.properties, name), {
          op,
          location,
          dataPath: `${dataPath}${pointer('required', index)}`,
          params: { name },
        })
      }
    }
  },
}
