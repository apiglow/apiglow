import { mediaEssence } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { valueTypes } from '../input-shape.js'
import { responsesWhere } from '../response-sites.js'
import { isObject } from '../value-check.js'

// An error response whose body is prose: only `text/*` or HTML, or JSON / XML
// declared without a schema that gives it fields. An agent reading the failure
// of a call gets a sentence where it needs a value to branch on — which field
// was refused, whether to retry, whether to ask the user — and either guesses
// from the wording or gives up on the whole task.
//
// Structured means a schema with a shape: an object or an array, declared or
// inferred the way this documentation reads a schema (`valueTypes` — a
// `{ required: [code] }` is an object), or reached through a composition. A
// bare `type: string` in JSON is a sentence in quotes, and an empty schema
// promises nothing. Any media type other than text and HTML can carry that
// shape — a media range or a binary format such as CBOR included, which is why
// `isStructuredMedia` is not the test; one structured media type among several
// is enough, since a client can ask for it.
//
// One check per error response — `4XX` / `5XX` codes and ranges, and `default` —
// that declares content, on tool operations only; a response written once under
// `components.responses` is one check, at the component (`responsesWhere`). A
// response with no content leaves the status as the signal, which is a
// decision, not prose. Whether error responses are documented at all is
// `error-responses-documented`'s.
export const errorMachineReadable = {
  id: 'error-machine-readable',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    for (const { response, status, site } of responsesWhere(ctx, isErrorStatus)) {
      if (!isObject(response.content)) continue
      const contents = Object.entries(response.content)
      if (!contents.length) continue
      check(
        contents.some(([mediaType, media]) => structured(mediaType, media)),
        { ...site, dataPath: `${site.dataPath}/content`, params: { status } },
      )
    }
  },
}

function isErrorStatus(status) {
  return status === 'default' || /^[45](\d\d|XX)$/i.test(status)
}

function structured(mediaType, media) {
  const essence = mediaEssence(mediaType)
  if (essence.startsWith('text/') && !/xml/.test(essence)) return false
  if (essence.includes('html')) return false
  return isObject(media) && hasShape(media.schema)
}

// A composition can loop back on itself once dereferenced: each schema object
// is looked at once (rule 7).
function hasShape(schema, seen = new Set()) {
  if (!isObject(schema) || seen.has(schema)) return false
  seen.add(schema)
  if (valueTypes(schema).some((type) => type === 'object' || type === 'array')) return true
  return ['allOf', 'oneOf', 'anyOf'].some((keyword) =>
    listOf(schema[keyword]).some((member) => hasShape(member, seen)),
  )
}
