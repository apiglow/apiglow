import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'

// An OAuth 2.0 flow the OAuth Security Best Current Practice retires.
// - `password` (`error`): RFC 9700 §2.4 — the resource owner password
//   credentials grant "MUST NOT be used": the user types their password into
//   the client app, which sees it and sends it on; the grant also leaves no
//   room for a second factor or a passkey.
// - `implicit` (`warning`): RFC 9700 §2.1.2 — clients "SHOULD NOT use the
//   implicit grant": the access token comes back in the redirect URL, where it
//   leaks through history and referrers and can be replayed; the
//   authorization code grant replaces it.
// Every other flow passes, graded at the rule's severity.
//
// This documentation's try-it runs neither (`drivableFlows`,
// `src/openapi/oauth.js`): it drives authorizationCode with PKCE and
// clientCredentials, and leaves these two to a token pasted by hand.
//
// One check per flow of each `oauth2` Security Scheme, a 3.2 `deprecated`
// scheme included — deprecation tells clients to leave, the flow still runs
// until they have. A scheme reached through a `$ref` is checked where it is
// declared. URLs over http are `oauth-url-tls`'s, missing ones
// `oauth-flow-urls`'.
const SEVERITY = { password: 'error', implicit: 'warning' }
const FLOWS = [
  'implicit',
  'password',
  'clientCredentials',
  'authorizationCode',
  'deviceAuthorization',
]

export const oauthLegacyFlows = {
  id: 'oauth-legacy-flows',
  category: 'security',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'SecurityScheme' || node.type !== 'oauth2') continue
      const flows = node.flows
      if (!flows || typeof flows !== 'object') continue
      for (const flow of FLOWS) {
        if (!flows[flow] || typeof flows[flow] !== 'object') continue
        const at = `${dataPath}${pointer('flows', flow)}`
        check(!SEVERITY[flow], {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          severity: SEVERITY[flow],
          params: { flow },
        })
      }
    }
  },
}
