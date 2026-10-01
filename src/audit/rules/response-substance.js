import { isSelfDescribingMedia } from '../payload-media.js'
import { pointer } from '../pointer.js'

// A response with no word of description and no content that says anything
// renders as an empty status line: the reader learns that the code exists and
// nothing else.
//
// Content counts only when one of its media types says something about the
// payload: a schema (or 3.2's `itemSchema`), an example, or a type that is the
// whole story — a file or plain text (`image/png`, `text/plain`). `{
// "application/json": {} }` names a format and describes nothing: the doc shows
// `any` under it. That a structured media type lacks its schema is
// `response-content-schema`'s, whether or not the response is described.
export const responseSubstance = {
  id: 'response-substance',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
        if (!response || typeof response !== 'object') continue
        const content =
          response.content && typeof response.content === 'object' ? response.content : {}
        const hasContent = Object.entries(content).some(([mediaType, media]) =>
          saysSomething(mediaType, media),
        )
        // 3.2 makes `description` optional and adds `summary`: either one is
        // substance.
        const described = [response.description, response.summary].some(
          (text) => typeof text === 'string' && text.trim(),
        )
        check(hasContent || described, {
          op: entry,
          dataPath: `${entry.pointer}${pointer('responses', status)}`,
          params: { status },
        })
      }
    }
  },
}

function saysSomething(mediaType, media) {
  if (isSelfDescribingMedia(mediaType)) return true
  if (!media || typeof media !== 'object') return false
  if (media.schema !== undefined || media.itemSchema !== undefined) return true
  if (media.example !== undefined) return true
  return Boolean(
    media.examples && typeof media.examples === 'object' && Object.keys(media.examples).length,
  )
}
