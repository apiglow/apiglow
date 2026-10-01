import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A Header Object carrying `name` or `in`, usually a Parameter copied into a
// `headers` map. Both are forbidden there (OAS 3.0/3.1, Header Object: "name
// MUST NOT be specified", "in MUST NOT be specified"; 3.2 no longer lists
// them): a header's name is its key in the map, and its location is implied.
// The field is ignored — this documentation names the header after its key —
// so a `name` that differs from the key promises a header nobody will see.
//
// `unknown-field` leaves these two to this rule, whose fix says where the name
// goes. One check per field found.
const FORBIDDEN = ['name', 'in']

export const headerObjectFields = {
  id: 'header-object-fields',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Header') continue
      for (const field of FORBIDDEN) {
        if (node[field] === undefined) continue
        const at = `${dataPath}${pointer(field)}`
        check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { field } })
      }
    }
  },
}
