import { pointer } from '../pointer.js'
import { isSubstantive } from '../text.js'

// Property descriptions are what the schema view and the try-it body editor show
// next to each field; without them the reader gets a name and a type and has to
// guess the rest.
//
// `info`, where the other completeness rules are warnings: on a real schema this
// is a long list, and it is a polishing pass, not a documentation hole the size
// of an undocumented operation.
export const propertyDescribed = {
  id: 'property-described',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!schema.properties || typeof schema.properties !== 'object') continue
      for (const [name, property] of Object.entries(schema.properties)) {
        if (!property || typeof property !== 'object') continue
        // A `title` counts like a description — unless it is the name read
        // back, which is what code generators emit for every property.
        check(
          isSubstantive(property.description, { name }) || isSubstantive(property.title, { name }),
          {
            op,
            location,
            dataPath: `${dataPath}${pointer('properties', name)}`,
            params: { name },
          },
        )
      }
    }
  },
}
