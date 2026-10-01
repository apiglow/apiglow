import { abbreviate, isSubstantive } from '../text.js'
import { isObject } from '../value-check.js'

// Property descriptions are what the schema view and the try-it body editor show
// next to each field; without them the reader gets a name and a type and has to
// guess the rest.
//
// One check per schema with properties, failing on any property left
// undescribed, and naming them: a schema is where the author writes them, in
// one sitting, and a document with hundreds of self-explanatory `id` and
// `created_at` fields would otherwise read as hundreds of findings — and
// weigh as much in the score. `info`, where the other completeness rules are
// warnings: it is a polishing pass, not a documentation hole the size of an
// undocumented operation.
export const propertyDescribed = {
  id: 'property-described',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!isObject(schema.properties)) continue
      const properties = Object.entries(schema.properties).filter(([, property]) =>
        isObject(property),
      )
      if (!properties.length) continue
      // A `title` counts like a description — unless it is the name read back,
      // which is what code generators emit for every property.
      const missing = properties
        .filter(
          ([name, property]) =>
            !isSubstantive(property.description, { name }) &&
            !isSubstantive(property.title, { name }),
        )
        .map(([name]) => name)
      check(!missing.length, {
        op,
        location,
        dataPath: `${dataPath}/properties`,
        params: { count: missing.length, names: abbreviate(missing) },
      })
    }
  },
}
