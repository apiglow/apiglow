import { placeOf } from '../locate.js'
import { objectLabel } from '../openapi-objects.js'
import { pointer } from '../pointer.js'

// Keys written next to a `$ref` that the specification says to ignore. In 3.0 a
// Reference Object "cannot be extended with additional properties", and any it
// has are ignored — a Schema's `$ref` included. 3.1 lets a Reference Object
// carry a `summary` and a `description` that override the target's, still
// ignores anything else, and lets a Schema's `$ref` combine with its other
// keywords, as JSON Schema does.
//
// This documentation lays every sibling over a copy of the target, whatever the
// version (the loader, `deref.js` — the newest version's meaning, rule 19): the
// reader here sees the sibling, a validator or a code generator honouring the
// declared version does not. The finding is that disagreement. `x-` extensions
// are left alone: tools that read them beside a `$ref` do so on purpose. A Path
// Item's `$ref` is one of its fields, not a Reference Object. One check per
// ignored sibling.

// Kept by 3.1+ on any Reference Object.
const OVERRIDES = new Set(['summary', 'description'])

export const refSiblings = {
  id: 'ref-siblings',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const { minor, raw } = ctx.version
    for (const { type, expected, node, dataPath } of ctx.objects) {
      if (type !== 'Reference') continue
      // JSON Schema: from 3.1 the siblings of a Schema's `$ref` apply.
      if (minor >= 1 && expected === 'Schema') continue
      for (const key of Object.keys(node)) {
        if (key === '$ref' || key.startsWith('x-')) continue
        if (minor >= 1 && OVERRIDES.has(key)) continue
        const at = `${dataPath}${pointer(key)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { sibling: key, object: objectLabel(expected), declared: raw },
        })
      }
    }
  },
}
