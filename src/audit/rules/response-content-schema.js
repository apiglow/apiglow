import { placeOf } from '../locate.js'
import { isStructuredMedia } from '../payload-media.js'
import { pointer } from '../pointer.js'

// A response media type with a structure to describe — JSON, XML, a form — and
// no schema to describe it. The format is named, the payload is not: a client
// generator gets no type for it, and this documentation
// prints the body as `any`, with `null` for its generated JSON example (an XML
// one has none at all) — the reader learns the format and nothing of the
// fields. 3.2's `itemSchema` counts: it describes each item of a sequential
// stream.
//
// A file or plain text (`image/png`, `text/plain`) is its own description, and
// a media range (`*/*`) names no format to describe. A request body with no
// schema is `untyped-input`'s; a response with neither description nor
// anything said by its content, `response-substance`'s.
//
// Every operation, webhooks' and callbacks' included: a response is documented
// for whoever reads it. A response written once under `components.responses`
// is checked once, at the component, whatever status it is used under first.
export const responseContentSchema = {
  id: 'response-content-schema',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    const components = componentResponses(ctx)
    const done = new Set()
    for (const entry of ctx.operations) {
      const responses = entry.op.responses
      if (!isObject(responses)) continue
      for (const [status, response] of Object.entries(responses)) {
        if (!isObject(response) || !isObject(response.content) || done.has(response)) continue
        const name = components.get(response)
        if (name !== undefined) done.add(response)
        const base =
          name === undefined
            ? `${entry.pointer}${pointer('responses', status)}`
            : pointer('components', 'responses', name)
        for (const [mediaType, media] of Object.entries(response.content)) {
          if (!isStructuredMedia(mediaType) || !isObject(media)) continue
          const dataPath = `${base}${pointer('content', mediaType)}`
          const place = name === undefined ? { op: entry } : placeOf(ctx.operations, dataPath)
          check(media.schema !== undefined || media.itemSchema !== undefined, {
            ...place,
            dataPath,
            params: { status, mediaType },
          })
        }
      }
    }
  },
}

// Response object → its name under `components.responses`; the first name
// wins when one component is a `$ref` to another.
function componentResponses(ctx) {
  const names = new Map()
  const declared = ctx.document.components?.responses
  if (!isObject(declared)) return names
  for (const [name, response] of Object.entries(declared)) {
    if (isObject(response) && !names.has(response)) names.set(response, name)
  }
  return names
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
