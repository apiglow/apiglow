import { checkNaming } from '../casing.js'
import { pointer } from '../pointer.js'

// Property names are the payload's keys: a consumer that has to remember which
// endpoint spells it `createdAt` and which one `created_at` writes a mapping
// layer, and gets it wrong once.
export const propertyNaming = {
  id: 'property-naming',
  category: 'consistency',
  severity: 'info',
  run(ctx, check) {
    const entries = []
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!schema.properties || typeof schema.properties !== 'object') continue
      for (const name of Object.keys(schema.properties)) {
        entries.push({
          name,
          target: { op, location, dataPath: `${dataPath}${pointer('properties', name)}` },
        })
      }
    }
    checkNaming(check, entries)
  },
}
