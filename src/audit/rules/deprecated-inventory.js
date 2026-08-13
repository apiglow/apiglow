import { deprecableElements, isDeprecated } from '../deprecated.js'

// §4.3: here the report IS the deliverable — every `deprecated: true` of the
// document in one list, which no rendered page gives you, since deprecation
// marks are scattered across the operations that carry them.
//
// Every deprecable element is a check, not just the deprecated ones: the score
// then reads as the share of the surface still current. An API with no
// deprecation scores 100 %, one deprecated operation out of fifty barely moves
// the needle, and a document that is half legacy says so.
export const deprecatedInventory = {
  id: 'deprecated-inventory',
  category: 'deprecation',
  severity: 'info',
  run(ctx, check) {
    for (const { node, target } of deprecableElements(ctx)) {
      check(!isDeprecated(node), target)
    }
  },
}
