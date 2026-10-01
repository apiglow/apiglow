import { listOf } from '../../openapi/model.js'

// A discriminator naming a property the payload is not bound to carry. The
// discriminating property is what tells a client which variant it received;
// the specification calls it "the property in the payload", 3.0 and 3.1 add
// that it SHOULD be required — the behaviour when it is absent is undefined —
// and 3.2 lets it be optional only with a `defaultMapping` saying which schema
// then applies. A property that no schema declares, or that a payload may
// omit with nothing to fall back on, leaves a code generator's deserializer
// with nothing to switch on. This documentation still offers the variants;
// what it cannot do is say which one a given payload is.
//
// The property counts as declared — and as required — when the schema says so
// itself (through `allOf`, which is how a child inherits it), or when every
// variant does: each member of its `oneOf`/`anyOf`, or, for a parent with
// neither, each component that extends it through `allOf`. Read on the
// dereferenced schemas, components first. One check per discriminator at
// fault; its mapping's targets are `discriminator-mapping`'s.

const MAX_DEPTH = 16

export const discriminatorProperty = {
  id: 'discriminator-property',
  category: 'correctness',
  // Not `error`: before 3.2 an optional discriminating property is a SHOULD,
  // and real documents (GitHub's) carry it on purpose.
  severity: 'warning',
  run(ctx, check) {
    const children = childrenByParent(ctx.document.components?.schemas)
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      const discriminator = schema.discriminator
      if (!discriminator || typeof discriminator !== 'object') continue
      const property = discriminator.propertyName
      if (typeof property !== 'string') continue
      const own = shapeOf(schema)
      const variants = [...listOf(schema.oneOf), ...listOf(schema.anyOf)].filter(isObject)
      const others = variants.length ? variants : (children.get(schema) ?? [])
      const everyVariant = (test) =>
        others.length > 0 && others.every((variant) => test(shapeOf(variant)))
      const declared =
        own.properties.has(property) || everyVariant((shape) => shape.properties.has(property))
      const required =
        own.required.has(property) || everyVariant((shape) => shape.required.has(property))
      const optionalAllowed = ctx.version.minor >= 2 && discriminator.defaultMapping !== undefined
      if (declared && (required || optionalAllowed)) continue
      check(false, {
        op,
        location,
        dataPath: `${dataPath}/discriminator/propertyName`,
        params: { property },
      })
    }
  },
}

// A schema's own properties and required names, `allOf` members included.
function shapeOf(
  schema,
  depth = 0,
  seen = new Set(),
  shape = { properties: new Set(), required: new Set() },
) {
  if (!isObject(schema) || seen.has(schema) || depth > MAX_DEPTH) return shape
  seen.add(schema)
  if (isObject(schema.properties))
    for (const name of Object.keys(schema.properties)) shape.properties.add(name)
  for (const name of listOf(schema.required)) if (typeof name === 'string') shape.required.add(name)
  for (const part of listOf(schema.allOf)) shapeOf(part, depth + 1, seen, shape)
  return shape
}

// Parent schema → the components extending it through `allOf`.
function childrenByParent(components) {
  const children = new Map()
  if (!isObject(components)) return children
  for (const schema of Object.values(components)) {
    if (!isObject(schema)) continue
    for (const part of listOf(schema.allOf)) {
      if (!isObject(part)) continue
      if (!children.has(part)) children.set(part, [])
      children.get(part).push(schema)
    }
  }
  return children
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
