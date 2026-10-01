import { declaresHeader, responsesWithStatus } from '../response-sites.js'

// A 405 that does not document its Allow header. RFC 9110 §15.5.6: "The origin
// server MUST generate an Allow header field in a 405 response containing a
// list of the target resource's currently supported methods." The server's
// side is a MUST; the document's is to say so — a client told "not this
// method" learns from the header which ones are, and one written from the
// document knows to read it. An `info`: the defect, if any, is in what the
// document leaves unsaid, not in what the server does.
//
// One check per 405 of a tool operation; one written once under
// `components.responses` is checked once, at the component
// (`response-sites.js`). Webhooks and callbacks are left out: their responses
// come from the integrator's server. Header names are compared without case.
export const methodNotAllowedAllow = {
  id: 'method-not-allowed-allow',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const { response, ...site } of responsesWithStatus(ctx, '405')) {
      check(declaresHeader(response, 'allow'), { ...site, params: { status: '405' } })
    }
  },
}
