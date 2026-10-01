import { placeOf } from '../locate.js'
import { unescapePointerToken } from '../../scenarios/pointer.js'

// An API key carried in the query string. A URL is not a place for a secret:
// servers, proxies, CDNs and load balancers log it whole, and a browser that
// opens it keeps it in its history. RFC 9110 §17.9
// calls sensitive information in a URI unwise; RFC 6750 §2.3 says a token in
// a query parameter SHOULD NOT be used unless no header or body can carry it,
// because (§5.3) URLs end up in "browser history, web server logs"; OWASP
// API2:2023 lists credentials in the URL under broken authentication. TLS does
// not help: the URL is encrypted on the wire and logged in clear at both ends.
//
// In this documentation the try-it appends the key to the request URL
// (`buildAuthInjection`, then `buildRequest`), so it is in the URL the
// history stores and every export of that request carries — cURL, HAR,
// Postman, snippets. Redaction masks it there by default, but only when the
// key reads the same once URL-encoded; and a CORS proxy, when one is set,
// receives the whole target URL as a query parameter of its own.
//
// One check per `apiKey` Security Scheme. The MCP export cannot carry a query
// key at all — that is `bridge-degradation`'s, per operation.
export const apikeyInQuery = {
  id: 'apikey-in-query',
  category: 'security',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'SecurityScheme' || node.type !== 'apiKey') continue
      const inQuery = node.in === 'query'
      check(!inQuery, {
        ...placeOf(ctx.operations, dataPath),
        dataPath: inQuery ? `${dataPath}/in` : dataPath,
        // A scheme with no `name` (`required-field-missing`'s) is named by its key.
        params: {
          name:
            typeof node.name === 'string' && node.name
              ? node.name
              : unescapePointerToken(dataPath.split('/').at(-1)),
        },
      })
    }
  },
}
