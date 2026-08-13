import { checkNaming } from '../casing.js'

// Query and path parameter names are typed by hand by every consumer, and a
// document that mixes `petId` with `pet_id` makes each of them a coin flip.
//
// Headers and cookies are excluded on purpose: `X-Request-Id` follows the HTTP
// convention, not the document's, and counting it as an outlier would flag the
// one name that is right.
const NAMED_LOCATIONS = new Set(['query', 'path'])

export const parameterNaming = {
  id: 'parameter-naming',
  category: 'consistency',
  severity: 'info',
  run(ctx, check) {
    const entries = []
    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        if (!NAMED_LOCATIONS.has(param.in) || typeof param.name !== 'string') continue
        entries.push({ name: param.name, target: { op: entry, dataPath } })
      }
    }
    checkNaming(check, entries)
  },
}
