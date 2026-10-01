import { declaresHeader, responsesWithStatus } from '../response-sites.js'

// A redirect that does not document where it redirects to. RFC 9110 says the
// server SHOULD generate a Location header with the new URI in a 301 and a 308
// (§15.4.2, §15.4.9) and with the different URI in a 302 and a 307 (§15.4.3,
// §15.4.8); a 303 states no requirement because it presupposes the field —
// the server is "redirecting the user agent to a different resource, as
// indicated by a URI in the Location header field" (§15.4.4). A client
// written from the document learns from it that the answer is somewhere else,
// and nothing about how to find it; an agent reading the operation cannot
// follow it.
//
// 301, 302, 303, 307 and 308 only: a 300's SHOULD is conditional (only when
// the server has a preferred choice), a 304 is a cache answer, and a 201's
// Location is no requirement at all. Concrete codes only — a `3XX` range
// names no single semantics. Header names are compared without case.
//
// One check per such response of a tool operation; one written once under
// `components.responses` is checked once, at the component
// (`response-sites.js`). Webhooks and callbacks are left out: their responses
// come from the integrator's server.
const REDIRECTS = ['301', '302', '303', '307', '308']

export const redirectLocation = {
  id: 'redirect-location',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const status of REDIRECTS) {
      for (const { response, ...site } of responsesWithStatus(ctx, status)) {
        check(declaresHeader(response, 'location'), { ...site, params: { status } })
      }
    }
  },
}
