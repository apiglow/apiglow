import { fileNameKey } from '../identifier-key.js'
import { pointer } from '../pointer.js'

// Two `components.schemas` names that differ and become one type in generated
// code: `Pet.Status`, `pet_status`, `PetStatus`. openapi-generator turns `.`,
// `-`, `:`, space, `|` and `/` into `_` and camelizes, so all three generate
// one `PetStatus` class — one file, the last schema silently overwriting the
// others, with no warning. Every operation typed with the lost schema now
// returns the other one's shape. Names differing by case alone (`Petstatus`,
// `PetStatus`) stay two classes, and two files that a case-insensitive file
// system — macOS's, Windows' default — holds as one. (The roadmap's
// `name-collision-after-sanitizing`, named for what it reads.)
//
// The key is `identifier-key.js`' `fileNameKey`: camelized, then case aside,
// since a generated class is also a file. One check
// per schema component; the finding on each one after the first of its key,
// naming that first one.
export const schemaNameCollision = {
  id: 'schema-name-collision',
  category: 'consistency',
  severity: 'warning',
  run(ctx, check) {
    const schemas = ctx.document.components?.schemas
    if (!schemas || typeof schemas !== 'object' || Array.isArray(schemas)) return
    const first = new Map()
    for (const name of Object.keys(schemas)) {
      const key = fileNameKey(name)
      const other = first.get(key)
      if (other === undefined) first.set(key, name)
      const dataPath = pointer('components', 'schemas', name)
      check(other === undefined, {
        location: `components.schemas.${name}`,
        dataPath,
        params: other === undefined ? { name } : { name, other },
      })
    }
  },
}
