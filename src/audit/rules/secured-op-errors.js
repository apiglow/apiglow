import { pointer } from '../pointer.js'
import { declaresHeader, responsesWithStatus } from '../response-sites.js'
import { effectiveSecurity } from '../security.js'
import { toolOperations } from '../tool-inputs.js'

// A secured operation that does not document how it refuses a caller. The
// status is how a client tells "authenticate" from any other failure: a 401
// means the credentials are missing or wrong, and RFC 9110 §15.5.2 says the
// server generating it MUST send a WWW-Authenticate header with at least one
// challenge — the scheme to authenticate with; a 403 (§15.5.4) means it
// understood who calls and refuses all the same. A generated client maps each
// documented status to an error type, an agent reads them to decide whether
// to ask for credentials; with neither documented, an expired token looks like
// a bug in the request.
//
// Two kinds of check, both `info`:
// - per secured tool operation (an effective security with a requirement and
//   no anonymous alternative): a `401`, a `403` or the `4XX` range is
//   documented. `default` does not count — it is every other failure, the
//   very thing this one must stand apart from;
// - per documented `401` response of a tool operation, secured or not: it
//   declares the `WWW-Authenticate` header (names are case-insensitive). A
//   401 written once under `components.responses` is checked once, at the
//   component (`response-sites.js`): it is one header to add.
//
// This documentation reads neither from a real response: the try-it's
// insight strip (`src/openapi/insights.js`) parses rate limits, retry delays,
// deprecation, pagination, correlation ids and validators, not
// WWW-Authenticate — and a cross-origin page sees that header only when the
// API lists it in Access-Control-Expose-Headers. The document is where a
// reader learns the challenge.
//
// Webhooks and callbacks are left out: their responses come from the
// integrator's server. Whether an operation is secured at all is
// `operation-unsecured`'s; whether a mutating one documents any error,
// `error-responses-documented`'s.
const AUTH_FAILURE = /^(401|403|4XX)$/i

export const securedOpErrors = {
  id: 'secured-op-errors',
  category: 'security',
  severity: 'info',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      const { alternatives, anonymous } = effectiveSecurity(ctx, entry)
      if (anonymous || !alternatives.some((alternative) => Object.keys(alternative).length)) {
        continue
      }
      const responses = entry.op.responses
      const statuses =
        responses && typeof responses === 'object' && !Array.isArray(responses)
          ? Object.keys(responses)
          : []
      check(
        statuses.some((status) => AUTH_FAILURE.test(status)),
        {
          op: entry,
          dataPath: `${entry.pointer}${pointer('responses')}`,
          params: { missing: '401 / 403' },
        },
      )
    }
    for (const { response, ...site } of responsesWithStatus(ctx, '401')) {
      check(declaresHeader(response, 'www-authenticate'), {
        ...site,
        params: { status: '401', missing: 'WWW-Authenticate' },
      })
    }
  },
}
