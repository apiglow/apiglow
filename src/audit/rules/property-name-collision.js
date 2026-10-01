import { identifierKey } from '../identifier-key.js'
import { pointer } from '../pointer.js'

// Two properties of one schema whose names differ and become one identifier
// in generated code: `user_id` and `userId`, `createdAt` and `created-at`.
// openapi-generator camelizes property names (`user_id` → `userId`) but
// deduplicates on the JSON name, so both generate a `userId` field and a
// `getUserId()` — a Java model that does not compile (openapi-generator
// issues #8291, #20484; the maintainers' answer is a per-name mapping option
// every consumer has to set). The JSON is valid; the SDK built from it is not.
//
// The key is `identifier-key.js`': case aside, separators dropped, other
// symbols kept (`+1` and `-1` do not collide). Own `properties` only, each
// schema once (`ctx.schemas`, a component's at the component). One check per
// schema with two properties or more; a finding per colliding name, on the
// later property, naming the first one of its key.
export const propertyNameCollision = {
  id: 'property-name-collision',
  category: 'consistency',
  severity: 'warning',
  run(ctx, check) {
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const properties = schema.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue
      const names = Object.keys(properties)
      if (names.length < 2) continue
      const first = new Map()
      let collisions = 0
      for (const name of names) {
        const key = identifierKey(name)
        const other = first.get(key)
        if (other === undefined) {
          first.set(key, name)
          continue
        }
        collisions += 1
        check(false, {
          op,
          location,
          dataPath: `${dataPath}${pointer('properties', name)}`,
          params: { name, other },
        })
      }
      if (!collisions) check(true, { op, location, dataPath })
    }
  },
}
