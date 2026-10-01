import { placeOf } from '../locate.js'
import { isFormMedia, isRequestBodyMedia, mediaTypeAt } from '../media-family.js'
import { pointer } from '../pointer.js'
import { nodeAt } from '../ref-pointer.js'

// An `encoding` entry the payload never uses. The map tells a client how to
// serialize each field of a form — its content type, its headers, its style —
// so an entry naming no property of the schema (the spec: the key MUST exist
// as a property) or sitting on a body that is not a form (it SHALL only apply
// to `multipart` and `application/x-www-form-urlencoded`, and before 3.2 only
// to request bodies) is ignored. This documentation still lists it under the
// media type, describing a serialization nothing performs; the try-it only
// applies an encoding to the field of a form body that carries its name.
//
// The schema is read dereferenced, its properties merged through `allOf`; a
// schema that admits other properties (`additionalProperties` other than
// `false`, a `oneOf`/`anyOf` whose variants may carry it) gets no verdict on its
// keys. One check per ignored entry.

const MAX_DEPTH = 16

export const encodingValid = {
  id: 'encoding-valid',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'MediaType') continue
      const encoding = node.encoding
      if (!encoding || typeof encoding !== 'object' || Array.isArray(encoding)) continue
      const media = mediaTypeAt(dataPath)
      if (media === null) continue
      const applies = isFormMedia(media) && (ctx.version.minor >= 2 || isRequestBodyMedia(dataPath))
      const names = applies ? propertyNames(nodeAt(ctx.document, dataPath)?.schema) : new Set()
      if (names === null) continue
      for (const key of Object.keys(encoding)) {
        if (key.startsWith('x-') || names.has(key)) continue
        const at = `${dataPath}${pointer('encoding', key)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { mediaType: media, property: key },
        })
      }
    }
  },
}

// The property names a schema declares, through `allOf` → a Set, or null when
// it may hold others and no verdict is possible.
function propertyNames(schema, depth = 0, seen = new Set()) {
  const names = new Set()
  if (!schema || typeof schema !== 'object' || seen.has(schema) || depth > MAX_DEPTH) return names
  seen.add(schema)
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
    return null
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf) || schema.patternProperties)
    return null
  if (schema.properties && typeof schema.properties === 'object') {
    for (const name of Object.keys(schema.properties)) names.add(name)
  }
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf) {
      const more = propertyNames(part, depth + 1, seen)
      if (more === null) return null
      for (const name of more) names.add(name)
    }
  }
  return names
}
