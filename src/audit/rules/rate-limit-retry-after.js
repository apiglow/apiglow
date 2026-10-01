import { declaresHeader, responsesWithStatus } from '../response-sites.js'

// A 429 response that does not say when to come back. RFC 6585 §4: a 429 "MAY
// include a Retry-After header indicating how long to wait before making a new
// request" — a delay in seconds or an HTTP date (RFC 9110 §10.2.3). A MAY, so
// `info`; but a client written without knowing to read it retries at once and
// stays throttled, or backs off by a guess.
//
// This documentation reads the header from a real response whether or not
// the document mentions it: the try-it's insight strip shows the delay on a
// 429 or a 503 (`src/openapi/insights.js`) — when the API lets a cross-origin
// page see it (Access-Control-Expose-Headers). What documenting it adds is the
// promise, for every client written before the first 429.
//
// One check per documented 429 of a tool operation; one written once under
// `components.responses` is checked once, at the component
// (`response-sites.js`). Webhooks and callbacks are left out: their responses
// come from the integrator's server. Rate-limit quota headers
// (`RateLimit-*`, `X-RateLimit-*`) are not a substitute here: they describe the
// quota, Retry-After the wait.
export const rateLimitRetryAfter = {
  id: 'rate-limit-retry-after',
  category: 'security',
  severity: 'info',
  run(ctx, check) {
    for (const { response, ...site } of responsesWithStatus(ctx, '429')) {
      check(declaresHeader(response, 'retry-after'), { ...site, params: { status: '429' } })
    }
  },
}
