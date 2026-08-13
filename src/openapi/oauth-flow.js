import {
  buildAuthorizationUrl,
  clientCredentialsBody,
  codeExchangeBody,
  parseCallbackParams,
  parseTokenResponse,
  pkceChallenge,
  randomToken,
  stripCallbackParams,
} from './oauth.js'
import { parseHash } from '../router.js'
import { OAUTH_PENDING_KEY as PENDING_KEY } from '../storage/maintenance.js'

// Effectful orchestration of the OAuth flows. The authorization server's return
// happens via a full-page redirect (no popup): the
// PKCE handshake (state + code_verifier) must survive the navigation, in
// sessionStorage — ephemeral and tab-scoped, a documented exception to the
// localStorage/IndexedDB storage rule. The key itself lives in
// `storage/maintenance.js`, with every other key the app writes, so that a full
// reset cannot forget it.

// The host page's URL without the hash: the authorization server appends
// ?code=… to it, the return hash is restored from the pending entry.
function redirectUri() {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`
}

export class OAuthError extends Error {
  constructor(code, detail = '') {
    super(detail || code)
    this.code = code // network | token | denied | state
    this.detail = detail
  }
}

async function postToken(tokenUrl, body) {
  let response
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    })
  } catch {
    throw new OAuthError('network')
  }
  let data = null
  try {
    data = await response.json()
  } catch {
    // Non-JSON response: treated as an invalid response below.
  }
  if (!response.ok)
    throw new OAuthError(
      'token',
      data?.error_description ?? data?.error ?? `HTTP ${response.status}`,
    )
  const parsed = parseTokenResponse(data)
  if (parsed.error) throw new OAuthError('token', parsed.error)
  return parsed.accessToken
}

// Starts Authorization Code + PKCE: the page leaves the application.
export async function beginAuthorizationLogin({ flow, schemeName, clientId, scopes, envId }) {
  const state = randomToken(16)
  const codeVerifier = randomToken(48)
  const uri = redirectUri()
  const url = buildAuthorizationUrl(flow, {
    clientId,
    redirectUri: uri,
    state,
    codeChallenge: await pkceChallenge(codeVerifier),
    scopes,
  })
  // Written after building the URL: an invalid authorizationUrl (throw)
  // doesn't leave an orphaned handshake behind.
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      state,
      codeVerifier,
      clientId,
      envId,
      schemeName,
      tokenUrl: flow.tokenUrl,
      redirectUri: uri,
      returnHash: window.location.hash,
      // Multi-spec: derived from the current hash (always qualified in multi) — the
      // boot handling the flow's return must resolve the spec that started the login.
      specId: parseHash(window.location.hash).specId,
    }),
  )
  window.location.assign(url)
}

export function fetchClientCredentialsToken({ flow, clientId, clientSecret, scopes }) {
  return postToken(flow.tokenUrl, clientCredentialsBody({ clientId, clientSecret, scopes }))
}

// Read at boot BEFORE resolving the active spec (§4.2 rule 1): the return
// of an OAuth flow must land on the spec that started it. Doesn't consume the
// pending entry — resumeAuthorizationLogin handles that afterwards.
export function pendingOAuthSpecId() {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_KEY))?.specId ?? null
  } catch {
    return null
  }
}

// To be called at boot. null outside of an OAuth return; otherwise { schemeName, envId,
// returnHash } + token or error (OAuthError) — the pending entry is consumed and
// the URL cleared of its callback parameters in all cases.
export async function resumeAuthorizationLogin() {
  const rawPending = sessionStorage.getItem(PENDING_KEY)
  if (!rawPending) return null
  let pending
  try {
    pending = JSON.parse(rawPending)
  } catch {
    sessionStorage.removeItem(PENDING_KEY)
    return null
  }
  const callback = parseCallbackParams(window.location.search)
  if (!callback) {
    // Returned without a callback (cancellation, back button): stale handshake.
    sessionStorage.removeItem(PENDING_KEY)
    return null
  }
  sessionStorage.removeItem(PENDING_KEY)
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${stripCallbackParams(window.location.search)}${window.location.hash}`,
  )
  const base = {
    schemeName: pending.schemeName,
    envId: pending.envId,
    returnHash: pending.returnHash,
  }
  if (callback.state !== pending.state) return { ...base, error: new OAuthError('state') }
  if (callback.error)
    return { ...base, error: new OAuthError('denied', callback.errorDescription ?? callback.error) }
  try {
    const token = await postToken(
      pending.tokenUrl,
      codeExchangeBody({
        code: callback.code,
        codeVerifier: pending.codeVerifier,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
      }),
    )
    return { ...base, token }
  } catch (error) {
    return { ...base, error }
  }
}
