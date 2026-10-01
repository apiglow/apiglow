// `allOf` is one value meeting every member at once — for objects, a value
// carrying the properties of all of them. The model keeps the composition as
// written (the schema view shows its members); what builds a value — a sample,
// the try-it's prefill, its form fields — needs the one object it describes.
// Without this, `allOf: [Pet, { properties: { owner } }]` prefilled `Pet`'s
// fields alone, and a form body built that way had no field at all.
//
// Merged when every member is an object, or itself an `allOf` of objects: the
// properties in member order (a later declaration of a name wins, `required`
// if any member requires it), then the composite's own. Anything else — a
// member of another type, a cycle, a depth past the budget (rule 7) — returns
// null, and the caller keeps reading the composite as before.

const MAX_DEPTH = 8

export function mergeAllOf(schema, ancestors = new Set()) {
  if (schema?.kind !== 'composite' || schema.composite?.keyword !== 'allOf') return null
  if (ancestors.has(schema) || ancestors.size >= MAX_DEPTH) return null
  ancestors.add(schema)
  try {
    const byName = new Map()
    const add = (properties) => {
      for (const property of properties ?? []) {
        const before = byName.get(property.name)
        byName.set(
          property.name,
          before ? { ...property, required: property.required || before.required } : property,
        )
      }
    }
    for (const member of schema.composite.variants) {
      const object = member?.kind === 'object' ? member : mergeAllOf(member, ancestors)
      if (!object) return null
      add(object.properties)
    }
    add(schema.properties)
    const { composite, ...rest } = schema
    return { ...rest, type: 'object', kind: 'object', properties: [...byName.values()] }
  } finally {
    ancestors.delete(schema)
  }
}
