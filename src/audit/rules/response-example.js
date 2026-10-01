import { componentNames, placeOf } from '../locate.js'
import { hasRealExample } from '../placeholder-example.js'
import { pointer } from '../pointer.js'
import { responsesWhere } from '../response-sites.js'
import { carriesFile } from '../schema-walk.js'
import { isObject } from '../value-check.js'

// A success response whose payload shows no example: what the reader copies
// into their own client. The app renders a generated sample when there is
// none, so this is `info`: the page is never empty, it is just filled with
// "string" and 0 — which is also why a placeholder example
// (`isPlaceholderExample`, Swagger's generated `{ "id": 0, "name": "string" }`)
// does not count as one.
//
// Success responses only (`2xx`, `2XX`): an error body's shape is the schema's
// and `error-machine-readable`'s business. One check per distinct payload, not
// per use: a response shared through `components.responses` once, at the
// component, and a payload whose schema is a `components.schemas` entry once,
// at that schema — an example written there serves every response returning
// it; it passes only when every response returning it shows an example. One
// check per response, not per media type: the same payload declared as JSON
// and as XML is one example to write. A file (a PDF, an export) has no example
// to write, and a response with no schema no payload to exemplify. Tool
// operations only: a webhook's or a callback's response is the integrator's.
const SUCCESS = /^2(\d\d|XX)$/

export const responseExample = {
  id: 'response-example',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    const schemaNames = componentNames(ctx.document, 'schemas')
    const payloads = new Map()
    for (const { response, status, site } of responsesWhere(ctx, (s) => SUCCESS.test(s))) {
      if (!isObject(response.content)) continue
      let schema = null
      let example = false
      for (const [mediaType, media] of Object.entries(response.content)) {
        if (!isObject(media) || carriesFile({ mediaType, content: media })) continue
        const payload = media.schema ?? media.itemSchema
        if (!isObject(payload)) continue
        schema ??= payload
        example ||= hasRealExample(media, payload)
      }
      if (!schema) continue
      const name = schemaNames.get(schema)
      const key = name === undefined ? response : schema
      if (!payloads.has(key)) {
        const at = name === undefined ? site : schemaSite(ctx, name)
        payloads.set(key, { target: { ...at, params: { status } }, example: true })
      }
      payloads.get(key).example &&= example
    }
    for (const { target, example } of payloads.values()) check(example, target)
  },
}

function schemaSite(ctx, name) {
  const dataPath = pointer('components', 'schemas', name)
  return { ...placeOf(ctx.operations, dataPath), dataPath }
}
