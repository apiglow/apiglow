// A `discriminator.mapping` key whose target names nothing this document can
// dispatch to. The key still travels on the wire, so the app keeps it and
// displays it as written — it just has no schema to point at, which makes the
// polymorphism undocumented rather than broken. Hence `info`: an external URI
// is a legitimate target we cannot follow, and a typo looks exactly the same
// from here.
//
// Resolution mirrors `buildDiscriminator` in `src/openapi/model.js` exactly —
// a target it resolves must never be flagged here. After dereference the
// mapping values are still strings, matched against the component name each
// candidate object was registered under.

import { escapePointerToken, unescapePointerToken } from '../../scenarios/pointer.js'

export const discriminatorMapping = {
  id: 'discriminator-mapping',
  category: 'correctness',
  severity: 'info',
  run(ctx, check) {
    const schemas = Object.entries(ctx.document.components?.schemas ?? {}).filter(
      ([, schema]) => schema && typeof schema === 'object',
    )
    const names = new Map(schemas.map(([name, schema]) => [schema, name]))
    // Parent-side idiom: the subtypes point back at the parent through `allOf`,
    // so a mapping on a schema with no variant list addresses those.
    const children = new Map()
    for (const [name, schema] of schemas) {
      for (const part of schema.allOf ?? []) {
        if (!part || typeof part !== 'object') continue
        if (!children.has(part)) children.set(part, new Set())
        children.get(part).add(name)
      }
    }

    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const mapping = schema.discriminator?.mapping
      if (!mapping || typeof mapping !== 'object') continue
      const variants = [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]
      const known = variants.length
        ? new Set(variants.map((variant) => names.get(variant)).filter(Boolean))
        : (children.get(schema) ?? new Set())
      for (const [key, target] of Object.entries(mapping)) {
        check(known.has(targetName(target)), {
          op,
          location,
          dataPath: `${dataPath}/discriminator/mapping/${escapePointerToken(key)}`,
          params: { key, target: String(target) },
        })
      }
    }
  },
}

// Last pointer segment, unescaped (RFC 6901) — `Pet` and
// `#/components/schemas/Pet` name the same thing.
function targetName(target) {
  if (typeof target !== 'string' || !target) return null
  return unescapePointerToken(target.split('/').pop())
}
