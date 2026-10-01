import { placeOf } from '../locate.js'

// An `http` security scheme whose `scheme` is no HTTP authentication scheme.
// Every OpenAPI 3.x: the value "SHOULD be registered in the IANA
// Authentication Scheme registry"; 3.0.4 and 3.1.1 add that it is
// case-insensitive, as HTTP has it (RFC 9110 §11.1). It is not a
// label: it is the first word of the `Authorization` header. This
// documentation's try-it sends `Authorization: <scheme> <token>` with the
// value lowercased (`normalizeSecurityScheme`, then `buildAuthInjection`), the
// MCP config it exports writes it capitalized (`credentialHeader`) — so
// `scheme: JWT` goes out as `jwt eyJ…` and `Jwt …`, and a server expecting
// `Bearer` refuses both. A
// value with a space (`Bearer `) is never a scheme name: the header gets two
// spaces, which a server splitting on one does not parse.
//
// The habits behind it: `JWT` or `token` for what is a bearer token (`scheme:
// bearer`, with `bearerFormat: JWT`), `apiKey` for a key in a custom header
// (an `apiKey` scheme names the header).
//
// A registered scheme the try-it cannot drive — `Digest`, `Negotiate`, whose
// handshake is a challenge, not a pasted token — is not this rule's concern.
// An empty `scheme` gives no verdict: the try-it falls back to `Bearer`.
//
// One check per `http` Security Scheme with a non-empty string `scheme`.
//
// IANA HTTP Authentication Schemes registry, as updated 2025-02-18.
const REGISTERED = new Set([
  'basic',
  'bearer',
  'concealed',
  'digest',
  'dpop',
  'gnap',
  'hoba',
  'mutual',
  'negotiate',
  'oauth',
  'privatetoken',
  'scram-sha-1',
  'scram-sha-256',
  'vapid',
])

export const httpSchemeRegistered = {
  id: 'http-scheme-registered',
  category: 'security',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'SecurityScheme' || node.type !== 'http') continue
      if (typeof node.scheme !== 'string' || !node.scheme) continue
      check(REGISTERED.has(node.scheme.toLowerCase()), {
        ...placeOf(ctx.operations, dataPath),
        dataPath: `${dataPath}/scheme`,
        params: { scheme: node.scheme },
      })
    }
  },
}
