import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { isCleartext } from '../../openapi/mixed-content.js'
import { documentUrl } from '../security.js'

// An OAuth or OpenID Connect endpoint over plain http. TLS is not advice
// there, it is the protocol: RFC 6749 requires it on the authorization
// endpoint (§3.1) and the token endpoint (§3.2), refresh tokens travel only
// over it (§10.4), the device endpoint requires it (RFC 8628 §3.1), the
// authorization server metadata MUST be https (RFC 8414 §3), the OpenID
// Connect issuer is an https URL (Discovery §3); OpenAPI repeats it on every
// flow URL and on 3.2's `oauth2MetadataUrl`. Over http the user's password,
// the authorization code, the client secret and the tokens cross the network
// in clear.
//
// In this documentation's try-it (`src/openapi/oauth-flow.js`), from a page
// served over https: the login is a top-level navigation, which mixed-content
// blocking does not stop, so the reader lands on the http login page and types
// a password there; the token request is a `fetch()`, blocked as mixed
// content, and the OAuth block says so (`oauth.error.mixedContent`). The
// client credentials flow fails the same way, before the secret leaves.
//
// Each URL is judged where it is used: a flow's URL only on a flow that uses
// it (the spec's "Applies To"), and only under an `oauth2` scheme;
// `openIdConnectUrl` on an `openIdConnect` scheme, `oauth2MetadataUrl` on an
// `oauth2` one. Anywhere else nothing fetches it. Loopback is exempt, like
// everywhere in this category (`isCleartext`). A relative URL is judged where
// the app sends it: resolved against the document's own URI.
//
// One check per such URL present. A missing URL is `oauth-flow-urls`'; one
// that is not a URL at all, `uri-form`'s.
const FLOW_URLS = {
  implicit: ['authorizationUrl', 'refreshUrl'],
  password: ['tokenUrl', 'refreshUrl'],
  clientCredentials: ['tokenUrl', 'refreshUrl'],
  authorizationCode: ['authorizationUrl', 'tokenUrl', 'refreshUrl'],
  deviceAuthorization: ['deviceAuthorizationUrl', 'tokenUrl', 'refreshUrl'],
}

const SCHEME_URLS = { openIdConnect: 'openIdConnectUrl', oauth2: 'oauth2MetadataUrl' }

export const oauthUrlTls = {
  id: 'oauth-url-tls',
  category: 'security',
  severity: 'error',
  run(ctx, check) {
    const grade = (url, field, dataPath) => {
      if (typeof url !== 'string') return
      check(!isCleartext(documentUrl(ctx, url)), {
        ...placeOf(ctx.operations, dataPath),
        dataPath,
        params: { field, url },
      })
    }
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'SecurityScheme') continue
      const own = SCHEME_URLS[node.type]
      if (own) grade(node[own], own, `${dataPath}${pointer(own)}`)
      if (node.type !== 'oauth2' || !node.flows || typeof node.flows !== 'object') continue
      for (const [key, fields] of Object.entries(FLOW_URLS)) {
        const flow = node.flows[key]
        if (!flow || typeof flow !== 'object') continue
        for (const field of fields) {
          grade(flow[field], field, `${dataPath}${pointer('flows', key, field)}`)
        }
      }
    }
  },
}
