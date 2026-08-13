import { pointer } from '../pointer.js'

// A value the caller must always supply cannot fall back to anything: the
// `default` next to it is unreachable, and it says the opposite of `required`.
// The reader gets two contradictory signals about whether they have to send the
// field, and code generators pick whichever they were written to trust.
//
// Both halves of the same contradiction are checked here — a required
// parameter, and a property listed in its schema's `required` — because they
// are one authoring mistake with two spellings.
//
// One check per required element, not per finding: the score reads as the share
// of the mandatory surface that does not contradict itself.
export const requiredWithDefault = {
  id: 'required-with-default',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    // Same identity dedup as the other parameter rules: a `$ref`'d parameter is
    // one decision, fixed once.
    const seen = new Set()
    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        if (!param || typeof param !== 'object' || seen.has(param)) continue
        seen.add(param)
        if (param.required !== true) continue
        // `default` sits on the parameter's schema, never on the parameter
        // itself — the Parameter Object has no `default` field.
        check(param.schema?.default === undefined, {
          op: entry,
          dataPath,
          params: { name: param.name ?? '' },
        })
      }
    }
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!Array.isArray(schema.required) || !schema.properties) continue
      for (const name of schema.required) {
        const property = schema.properties[name]
        // A `required` naming no property is `required-property-declared`'s
        // finding, not this one's.
        if (!property || typeof property !== 'object') continue
        check(property.default === undefined, {
          op,
          location,
          dataPath: `${dataPath}${pointer('properties', name)}`,
          params: { name },
        })
      }
    }
  },
}
