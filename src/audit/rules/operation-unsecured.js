import { effectiveSecurity } from '../security.js'
import { toolOperations } from '../tool-inputs.js'

// An operation anyone can call: no security requirement applies to it, or one
// lets anonymous callers in. OWASP API2:2023 (Broken Authentication) starts
// there — an endpoint that should check who calls it and does not. The
// document cannot prove the server's behavior, but it is the contract: a
// client generated from it sends no credential, and this documentation shows
// the operation with no authentication section and a try-it with no
// credentials form, sending the request bare (`applicableSchemes`,
// `src/openapi/auth.js`). Either the API is open, or the document hides that
// it is not.
//
// Three verdicts, told apart by the severity and the `access` param:
// - open by omission (`access: omitted`), no `security` on the operation and
//   none at the root: `warning` on a method that changes state, `info` on a
//   safe one (RFC 9110 §9.2.1: GET, HEAD, OPTIONS, TRACE, plus 3.2's QUERY and
//   the safe methods of the IANA registry a 3.2 `additionalOperations` may
//   name — SEARCH, PROPFIND, REPORT). Any other custom method may write, so it
//   is graded as one;
// - open on purpose (`access: declared`), `security: []` or a `{}`
//   alternative: `info` whatever the method — the author decided, and an
//   access review wants the list of what is public;
// - secured: passes, graded at the severity an omission would have had.
//
// A document with no security scheme and no `security` anywhere documents no
// authentication at all: one check on the whole document instead of one per
// operation, since every operation would fire for the same single gap. It sits
// at `/components/securitySchemes`, where the fix starts — `/` would give the
// finding no location to show.
//
// Tool operations only, hidden ones included: hiding lives in this
// documentation, the endpoint is still served. A webhook or a callback is a
// request the API sends; its security is the receiver's. A `security` list
// whose entries are all malformed gives no verdict (`field-value-kind`'s), and
// a requirement naming an undeclared scheme still reads as secured
// (`security-scheme-declared`'s).
const SAFE_METHODS = new Set([
  'get',
  'head',
  'options',
  'trace',
  'query',
  'search',
  'propfind',
  'report',
])

export const operationUnsecured = {
  id: 'operation-unsecured',
  category: 'security',
  severity: 'warning',
  run(ctx, check) {
    const operations = toolOperations(ctx)
    if (!operations.length) return
    if (documentsNoAuthentication(ctx, operations)) {
      check(false, {
        location: 'components.securitySchemes',
        dataPath: '/components/securitySchemes',
        params: { access: 'omitted' },
      })
      return
    }
    for (const entry of operations) {
      const { alternatives, declared, anonymous } = effectiveSecurity(ctx, entry)
      const params = { method: entry.method.toUpperCase() }
      if (anonymous) {
        check(false, {
          op: entry,
          dataPath: Array.isArray(entry.op.security) ? `${entry.pointer}/security` : entry.pointer,
          severity: 'info',
          params: { ...params, access: 'declared' },
        })
        continue
      }
      if (declared && !alternatives.length) continue
      check(declared, {
        op: entry,
        severity: SAFE_METHODS.has(entry.method) ? 'info' : 'warning',
        params: { ...params, access: 'omitted' },
      })
    }
  },
}

function documentsNoAuthentication(ctx, operations) {
  const schemes = ctx.document.components?.securitySchemes
  if (schemes && typeof schemes === 'object' && Object.keys(schemes).length) return false
  if (Array.isArray(ctx.document.security)) return false
  return !operations.some((entry) => Array.isArray(entry.op.security))
}
