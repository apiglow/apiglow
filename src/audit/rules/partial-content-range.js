import { mediaEssence } from '../../openapi/body-kind.js'
import { declaresHeader, responsesWhere } from '../response-sites.js'

// A 206 that says neither which range it carries nor that it carries several.
// RFC 9110 §15.3.7: a single-part 206 MUST come with a Content-Range header
// (§15.3.7.1); a multiple-part one MUST be `multipart/byteranges` content,
// each part with its own Content-Range, and MUST NOT carry the header at the
// top (§15.3.7.2). A client resuming a download or reading a slice needs one
// or the other to place the bytes it got; a document declaring a 206 with
// neither describes partial content without saying which part.
//
// Passes with a `Content-Range` header (compared without case) or a
// `multipart/byteranges` media type. One check per 206 of a tool operation;
// one written once under `components.responses` is checked once, at the
// component (`response-sites.js`). Webhooks and callbacks are left out.
const BYTERANGES = 'multipart/byteranges'

export const partialContentRange = {
  id: 'partial-content-range',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const { response, site } of responsesWhere(ctx, (status) => status === '206')) {
      const content = response.content
      const multipart =
        content !== null &&
        typeof content === 'object' &&
        !Array.isArray(content) &&
        Object.keys(content).some((mediaType) => mediaEssence(mediaType) === BYTERANGES)
      check(multipart || declaresHeader(response, 'content-range'), {
        ...site,
        params: { status: '206' },
      })
    }
  },
}
