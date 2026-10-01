import { TOKEN_PATTERN } from '../http-token.js'
import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// A `content` key that is not a media type: `json`, `application json`,
// `application/json charset=utf-8`. The key MUST be a media type or a media
// type range (OAS 3.x, the `content` field of Request Body, Response,
// Parameter and Header Objects; syntax of RFC 9110 §8.3.1 and §12.5.1:
// `type/subtype`, `type/*`, `*/*`, optional `; name=value` parameters). This
// documentation sends the key as written as the request's Content-Type, and
// classifies the body from it: a key it cannot read gives a body of unknown
// kind, sent with a Content-Type no server recognises; a generator does no
// better. One check per bad key.
const QUOTED = '"(?:[^"\\\\]|\\\\.)*"'
const MEDIA_RANGE = new RegExp(
  `^${TOKEN_PATTERN}/${TOKEN_PATTERN}(?:[ \\t]*;[ \\t]*(?:${TOKEN_PATTERN}=(?:${TOKEN_PATTERN}|${QUOTED}))?)*$`,
)

const HOLDERS = new Set(['Parameter', 'Header', 'RequestBody', 'Response'])

export const mediaTypeKeySyntax = {
  id: 'media-type-key-syntax',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (!HOLDERS.has(type)) continue
      const content = node.content
      if (!content || typeof content !== 'object' || Array.isArray(content)) continue
      for (const mediaType of Object.keys(content)) {
        if (MEDIA_RANGE.test(mediaType)) continue
        const at = `${dataPath}${pointer('content', mediaType)}`
        check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { mediaType } })
      }
    }
  },
}
