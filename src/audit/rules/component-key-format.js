import { placeOf } from '../locate.js'
import { inVersion, OBJECTS } from '../openapi-objects.js'
import { pointer } from '../pointer.js'

// A component named with characters the specification does not allow: every
// map of `components` "MUST use keys that match the regular expression
// ^[a-zA-Z0-9\.\-_]+$" (OAS 3.x, Components Object). Spaces, slashes, `#`,
// accents: validators reject the document, a code generator turning the name
// into a type or a file name fails or mangles it, and every `$ref` to it has
// to escape what the name should not have held. One check per bad key, in the
// maps the declared version has: a later one is `version-construct`'s.
const KEY = /^[a-zA-Z0-9.\-_]+$/

export const componentKeyFormat = {
  id: 'component-key-format',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Components') continue
      for (const [section, field] of Object.entries(OBJECTS.Components)) {
        if (!inVersion(field, ctx.version.minor)) continue
        const members = node[section]
        if (!members || typeof members !== 'object' || Array.isArray(members)) continue
        for (const name of Object.keys(members)) {
          if (KEY.test(name)) continue
          const at = `${dataPath}${pointer(section, name)}`
          check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { section, name } })
        }
      }
    }
  },
}
