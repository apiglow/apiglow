// Client-side OAuth2 flows (competitive analysis, prio 1 #3): Authorization
// Code + PKCE (RFC 7636 — no secret required) and Client Credentials (secret
// entered by the user, sent via client_secret_post). Pure and
// tested functions; the effects (redirect, sessionStorage, fetch) live in
// oauth-flow.js. The manual token field remains the fallback for everything else.

const DRIVABLE = {
  authorizationCode: (flow) => Boolean(flow.authorizationUrl && flow.tokenUrl),
  clientCredentials: (flow) => Boolean(flow.tokenUrl),
}

// Flows of the scheme that the app knows how to run (implicit and password stay
// on the manual token: the former is deprecated by RFC 9700, and so is the latter).
export function drivableFlows(scheme) {
  if (scheme?.type !== 'oauth2') return []
  return (scheme.flows ?? []).filter((flow) => DRIVABLE[flow.key]?.(flow))
}

// Extra conventional variables when a flow is runnable:
// the token lives in auth.X (as before), the client identifies itself via
// auth.X.clientId / auth.X.clientSecret — overrides from the host config.
export function oauthSuggestedVariables(scheme) {
  const flows = drivableFlows(scheme)
  if (!flows.length) return []
  const names = [`auth.${scheme.name}.clientId`]
  if (flows.some((f) => f.key === 'clientCredentials'))
    names.push(`auth.${scheme.name}.clientSecret`)
  return names
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

// S256 only (RFC 7636 §4.2): `plain` brings nothing to a client
// capable of SHA-256, and some servers refuse it.
export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export function buildAuthorizationUrl(
  flow,
  { clientId, redirectUri, state, codeChallenge, scopes = [] },
) {
  // new URL preserves the query params already present in authorizationUrl
  // (audience, tenant…): we only add our own. A relative authorizationUrl
  // means "same origin as the docs" and resolves against the page — outside a
  // browser (tests) there is no base, and absolute URLs behave as before.
  const url = new URL(flow.authorizationUrl, globalThis.location?.href)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (scopes.length) url.searchParams.set('scope', scopes.join(' '))
  return url.href
}

export function codeExchangeBody({ code, codeVerifier, clientId, redirectUri }) {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  }).toString()
}

export function clientCredentialsBody({ clientId, clientSecret, scopes = [] }) {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })
  if (scopes.length) params.set('scope', scopes.join(' '))
  return params.toString()
}

// Authorization server response in the return query. null if the query
// doesn't look like an OAuth callback — the host page is entitled to have its
// own parameters.
export function parseCallbackParams(search) {
  const params = new URLSearchParams(search)
  if (!params.has('code') && !params.has('error')) return null
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    errorDescription: params.get('error_description'),
  }
}

// Only removes the OAuth response's parameters: the host page's
// survive the URL cleanup.
export function stripCallbackParams(search) {
  const params = new URLSearchParams(search)
  for (const name of ['code', 'state', 'error', 'error_description', 'error_uri', 'iss'])
    params.delete(name)
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}

export function parseTokenResponse(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.access_token !== 'string' ||
    !data.access_token
  ) {
    return { error: typeof data?.error === 'string' ? data.error : 'invalid_response' }
  }
  return { accessToken: data.access_token }
}

// Scopes required by the operation for a scheme (union over the requirements,
// the operation's `security` otherwise the global one) — pre-checked in the selector.
export function requiredScopes(model, op, schemeName) {
  const requirements = op.security ?? model.security ?? []
  const out = []
  for (const requirement of requirements) {
    for (const scope of requirement[schemeName] ?? []) {
      if (!out.includes(scope)) out.push(scope)
    }
  }
  return out
}
