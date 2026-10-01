import { mediaEssence } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'
import { isSchemaObject, toolOperations } from '../tool-inputs.js'

// An error response whose body is prose: only `text/*` or HTML, or JSON / XML
// declared without a schema that gives it fields. An agent reading the failure
// of a call gets a sentence where it needs a value to branch on — which field
// was refused, whether to retry, whether to ask the user — and either guesses
// from the wording or gives up on the whole task.
//
// Structured means a schema with a shape: an object or an array (declared, or
// told by `properties`, `items` or a composition). A bare `type: string` in
// JSON is a sentence in quotes, and an empty schema promises nothing. Any media
// type other than text and HTML can carry that shape; one structured media type
// among several is enough, since a client can ask for it.
//
// One check per error response — `4XX` / `5XX` codes and ranges, and `default` —
// that declares content, on tool operations only: a response with no content
// leaves the status as the signal, which is a decision, not prose. Whether
// error responses are documented at all is `error-responses-documented`'s.
export const errorMachineReadable = {
  id: 'error-machine-readable',
  category: 'agent',
  severity: 'info',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      const responses = entry.op.responses
      if (!isSchemaObject(responses)) continue
      for (const [status, response] of Object.entries(responses)) {
        if (!isErrorStatus(status) || !isSchemaObject(response?.content)) continue
        const contents = Object.entries(response.content)
        if (!contents.length) continue
        check(
          contents.some(([mediaType, media]) => structured(mediaType, media)),
          {
            op: entry,
            dataPath: `${entry.pointer}${pointer('responses', status, 'content')}`,
            params: { status },
          },
        )
      }
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
  return isSchemaObject(media) && hasShape(media.schema)
}

// A composition can loop back on itself once dereferenced: each schema object
// is looked at once (rule 7).
function hasShape(schema, seen = new Set()) {
  if (!isSchemaObject(schema) || seen.has(schema)) return false
  seen.add(schema)
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.includes('object') || types.includes('array')) return true
  if (SHAPE_KEYWORDS.some((keyword) => schema[keyword] !== undefined)) return true
  return ['allOf', 'oneOf', 'anyOf'].some((keyword) =>
    listOf(schema[keyword]).some((member) => hasShape(member, seen)),
  )
}

const SHAPE_KEYWORDS = [
  'properties',
  'additionalProperties',
  'patternProperties',
  'items',
  'prefixItems',
]
