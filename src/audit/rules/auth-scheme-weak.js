import { effectiveSecurity, isCleartext, operationServerUrls, schemeNamed } from '../security.js'
import { toolOperations } from '../tool-inputs.js'

// A credential that needs TLS, sent to a plain http server. The security that
// applies (the operation's, else the document's) names the scheme in any
// alternative, and one of the servers the operation goes to (its own, else its
// Path Item's, else the document's, variables at their defaults) is cleartext:
//
// - a bearer token — `http` `bearer`, and the access token of an `oauth2` or
//   `openIdConnect` scheme, which the try-it sends as `Authorization: Bearer`
//   too (`buildAuthInjection`): RFC 6750 §5.3, clients MUST use TLS. `error`.
//   The OAuth schemes are graded here as well because RFC 6750 is the OAuth
//   access token's own transport: leaving them out would pass the very case
//   the RFC was written for.
// - `mutualTLS`: the client certificate is presented in the TLS handshake
//   (RFC 8705 §2); over http there is none, and the scheme cannot work at all.
//   `error`.
// - `http` `basic`: a reversible encoding of the password. RFC 7617 §4: SHOULD
//   NOT be used without TLS. `warning`.
//
// An `apiKey` has no transport rule of its own to cite; its server is still
// reported by `server-https`. Loopback servers are exempt (`isCleartext`).
//
// One check per tool operation using one of these schemes, graded at the most
// severe one; the finding names that scheme and the first cleartext server.
// `server-https` reports the server itself, once; this rule reports what each
// operation exposes on it. An undeclared scheme is `security-scheme-declared`'s.
const SEVERITY = { warning: 1, error: 2 }

export const authSchemeWeak = {
  id: 'auth-scheme-weak',
  category: 'security',
  severity: 'error',
  run(ctx, check) {
    for (const entry of toolOperations(ctx)) {
      let worst = null
      for (const alternative of effectiveSecurity(ctx, entry).alternatives) {
        for (const name of Object.keys(alternative)) {
          const severity = transportSeverity(schemeNamed(ctx, name))
          if (severity && (!worst || SEVERITY[severity] > SEVERITY[worst.severity]))
            worst = { name, severity }
        }
      }
      if (!worst) continue
      const url = operationServerUrls(ctx, entry).find(isCleartext)
      check(url === undefined, {
        op: entry,
        severity: worst.severity,
        params: { scheme: worst.name, url },
      })
    }
  },
}

function transportSeverity(scheme) {
  if (!scheme) return null
  if (scheme.type === 'mutualTLS' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect')
    return 'error'
  if (scheme.type !== 'http' || typeof scheme.scheme !== 'string') return null
  const name = scheme.scheme.toLowerCase()
  if (name === 'bearer') return 'error'
  return name === 'basic' ? 'warning' : null
}
