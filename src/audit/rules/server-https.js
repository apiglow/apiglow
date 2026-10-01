import { placeOf, sentByTheApi } from '../locate.js'
import { isCleartext } from '../../openapi/mixed-content.js'
import { serverDefaultUrl } from '../security.js'

// A server reached over plain http. Everything sent to it crosses the network
// in clear — the credentials of every security scheme, and every payload — so
// anyone on the path reads and alters it. Browsers also refuse it outright from
// an https page: a `fetch()` to an http address is mixed content, blocked and
// never upgraded (W3C Mixed Content). Every hosted install of this
// documentation is served over https, so its try-it cannot reach the server
// unless a CORS proxy relays the call, and the failed request is diagnosed as
// mixed content (`diagnoseFailure`, `src/openapi/insights.js`).
//
// The URL is judged as this documentation sends to it (`serverDefaultUrl`):
// variables at their defaults — a `{scheme}` variable defaulting to `http`
// counts — and a relative URL resolved against the document's 3.2 `$self`,
// so `/v1` under an http `$self` is cleartext. Without `$self` a relative URL
// takes the scheme of wherever the document is served from, which the audit
// is not told: no verdict. Loopback (`localhost`, `127.0.0.0/8`, `[::1]`) is
// exempt: browsers hold it potentially trustworthy (W3C Secure Contexts) and
// nothing leaves the machine. An undeclared variable in the host gives no
// verdict: that is `server-variables`'.
//
// Every Server Object the client calls: root, Path Item, Operation, a Link's
// `server`. A server inside a webhook or a callback is the receiver's — the
// API sends those requests, and the receiver picks its own transport.
//
// One check per Server with a string URL. The credential a cleartext server
// exposes is `auth-scheme-weak`'s, per operation.
export const serverHttps = {
  id: 'server-https',
  category: 'security',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Server' || typeof node.url !== 'string' || sentByTheApi(dataPath)) continue
      const place = placeOf(ctx.operations, dataPath)
      const url = serverDefaultUrl(ctx, node)
      check(!isCleartext(url), { ...place, dataPath: `${dataPath}/url`, params: { url } })
    }
  },
}
