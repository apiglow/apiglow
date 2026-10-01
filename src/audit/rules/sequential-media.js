import { placeOf } from '../locate.js'
import { mediaTypeAt } from '../media-family.js'
import { pointer } from '../pointer.js'
import { nodeAt } from '../ref-pointer.js'

// 3.2's fields for bodies made of a sequence, used where they cannot apply.
// `itemSchema` describes one item of a sequential media type (JSON Lines,
// NDJSON, JSON text sequences, server-sent events, multipart); `prefixEncoding`
// and `itemEncoding` SHALL only apply to multipart, MUST NOT sit next to an
// `encoding` map, and need an `itemSchema` or an array `schema` to address.
// Outside that, a tool honouring the specification ignores them — while this
// documentation shows the `itemSchema` as "one item of the stream" and lists
// the positional encodings, describing a body the API does not send.
//
// Only the families that are certainly not sequences are flagged for
// `itemSchema` — JSON, XML and form bodies, each one complete document; the
// specification leaves "sequential" open (any repeating structure with no
// envelope), and a custom streaming type must not be called wrong. Before 3.2
// these fields are `version-construct`'s. One check per misplaced field.

const DOCUMENT_TYPES =
  /^(application\/json|application\/[^/]*\+json|application\/xml|text\/xml|application\/[^/]*\+xml|application\/x-www-form-urlencoded)$/

export const sequentialMedia = {
  id: 'sequential-media',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    if (ctx.version.minor < 2) return
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'MediaType') continue
      const media = mediaTypeAt(dataPath)
      const report = (field) => {
        const at = `${dataPath}${pointer(field)}`
        check(false, {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { field, mediaType: media ?? '' },
        })
      }
      if (node.itemSchema !== undefined && media && DOCUMENT_TYPES.test(media)) report('itemSchema')
      const positional = ['prefixEncoding', 'itemEncoding'].filter(
        (field) => node[field] !== undefined,
      )
      if (!positional.length) continue
      const resolved = nodeAt(ctx.document, dataPath) ?? node
      const arraySchema = isArraySchema(resolved.schema)
      for (const field of positional) {
        const misplaced =
          (media && !media.startsWith('multipart/')) ||
          node.encoding !== undefined ||
          (resolved.itemSchema === undefined && !arraySchema)
        if (misplaced) report(field)
      }
    }
  },
}

function isArraySchema(schema) {
  if (!schema || typeof schema !== 'object') return false
  return (
    schema.type === 'array' ||
    (Array.isArray(schema.type) && schema.type.includes('array')) ||
    schema.items !== undefined ||
    schema.prefixItems !== undefined
  )
}
