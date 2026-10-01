import { pointer } from '../pointer.js'
import { declaresHeader, responsesWhere } from '../response-sites.js'
import { effectiveSecurity } from '../security.js'
import { toolOperations } from '../tool-inputs.js'
import { isObject } from '../value-check.js'

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
//   very thing this one must stand apart from. When no secured operation
//   documents one, that is one decision about the document: one check, at
//   `paths`;
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
    const secured = toolOperations(ctx).filter((entry) => {
      const { alternatives, anonymous } = effectiveSecurity(ctx, entry)
      return !anonymous && alternatives.length > 0
    })
    const refuses = (entry) =>
      isObject(entry.op.responses) &&
      Object.keys(entry.op.responses).some((status) => AUTH_FAILURE.test(status))
    const params = { missing: '401 / 403' }
    if (secured.length > 1 && !secured.some(refuses)) {
      check(false, { location: 'paths', dataPath: '/paths', params })
    } else {
      for (const entry of secured) {
        check(refuses(entry), {
          op: entry,
          dataPath: `${entry.pointer}${pointer('responses')}`,
          params,
        })
      }
    }
    for (const { response, site } of responsesWhere(ctx, (status) => status === '401')) {
      check(declaresHeader(response, 'www-authenticate'), {
        ...site,
        params: { missing: 'WWW-Authenticate' },
      })
    }
  },
}
