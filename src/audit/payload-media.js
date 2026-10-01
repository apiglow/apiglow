import { bodyKind, mediaEssence } from '../openapi/body-kind.js'

// A media type whose payload has a structure only a schema can describe: the
// JSON family (as this documentation recognizes it, `body-kind.js`), XML
// (`application/xml`, `text/xml`, `+xml`), YAML (`application/yaml`, `+yaml`)
// and forms. A file or plain text is the opposite case — `image/png`,
// `text/plain`, `application/pdf` say all there is to say about their payload.
// A media range (`*/*`, `application/*`) is neither: it names no format at all.
export function isStructuredMedia(mediaType) {
  const essence = mediaEssence(mediaType)
  if (!essence || essence.includes('*')) return false
  if (STRUCTURED_TEXT.has(essence) || essence.endsWith('+xml') || essence.endsWith('+yaml'))
    return true
  return ['json', 'multipart', 'urlencoded'].includes(bodyKind({ mediaType: essence }))
}

// `text/yaml` and `application/x-yaml` predate RFC 9512's registration and
// are still what most servers send.
const STRUCTURED_TEXT = new Set([
  'application/xml',
  'text/xml',
  'application/yaml',
  'text/yaml',
  'application/x-yaml',
])

// A concrete media type that is not structured: the type is the whole story.
export function isSelfDescribingMedia(mediaType) {
  const essence = mediaEssence(mediaType)
  return Boolean(essence) && !essence.includes('*') && !isStructuredMedia(essence)
}
