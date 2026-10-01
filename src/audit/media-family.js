import { mediaEssence } from '../openapi/body-kind.js'

// The media type a Media Type Object stands for, read off its pointer: the key
// it sits under in a `content` map. A 3.2 `components/mediaTypes` entry is
// keyed by a name, not a media type → null, and so is anything else.
export function mediaTypeAt(dataPath) {
  const tokens = dataPath.split('/')
  if (tokens.at(-2) !== 'content') return null
  return mediaEssence(tokens.at(-1).replaceAll('~1', '/').replaceAll('~0', '~'))
}

// Name-value media types: what an `encoding` map applies to.
export function isFormMedia(essence) {
  return essence === 'application/x-www-form-urlencoded' || essence.startsWith('multipart/')
}

// Whether the Media Type Object describes a request body — the only place
// 3.0 and 3.1 apply an `encoding` map — rather than a response or a component.
export function isRequestBodyMedia(dataPath) {
  return (
    /\/requestBody\/content\/[^/]+$/.test(dataPath) ||
    /^\/components\/requestBodies\/[^/]+\/content\/[^/]+$/.test(dataPath)
  )
}
