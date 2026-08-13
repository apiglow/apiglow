// The elements OpenAPI lets an author deprecate, in one walk: the inventory
// rule checks all of them, the replacement rule only the deprecated ones
// (docs/audit.md §4.3). Yields `{ node, target }`, `target` being what the
// engine needs to locate a finding.

import { pointer } from './pointer.js'

export function* deprecableElements(ctx) {
  for (const entry of ctx.operations) yield { node: entry.op, target: { op: entry } }

  // Identity dedup: a `$ref`'d parameter shared by ten operations is one
  // deprecation, and it is fixed once.
  const seen = new Set()
  for (const entry of ctx.operations) {
    for (const { param, dataPath } of entry.parameters) {
      if (!param || typeof param !== 'object' || seen.has(param)) continue
      seen.add(param)
      yield { node: param, target: { op: entry, dataPath, params: { name: param.name ?? '' } } }
    }
  }

  // Schemas cover properties too: `ctx.schemas` visits every property subtree,
  // each already reported at its definition site when it is a shared component.
  for (const { schema, dataPath, op, location } of ctx.schemas) {
    yield { node: schema, target: { op, location, dataPath } }
  }

  // `deprecated` on a Security Scheme is 3.2; on an older document it is an
  // unknown field, which is exactly the kind of thing an author wants told.
  for (const [name, scheme] of Object.entries(ctx.document.components?.securitySchemes ?? {})) {
    if (!scheme || typeof scheme !== 'object') continue
    yield {
      node: scheme,
      target: {
        location: `components.securitySchemes.${name}`,
        dataPath: pointer('components', 'securitySchemes', name),
        params: { name },
      },
    }
  }
}

export function isDeprecated(node) {
  return node.deprecated === true
}
