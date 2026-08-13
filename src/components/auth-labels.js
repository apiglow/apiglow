import { t } from '../i18n/index.js'

// Auth type labels — static map (rule 2), i18n keys resolved here.
// Shared between the central doc and the Credentials cartouche of the try-it panel.
const AUTH_TYPE_LABEL = {
  'http:bearer': 'auth.type.bearer',
  'http:basic': 'auth.type.basic',
  apiKey: 'auth.type.apiKey',
  oauth2: 'auth.type.oauth2',
  openIdConnect: 'auth.type.openIdConnect',
  mutualTLS: 'auth.type.mutualTLS',
}

// OAuth2 flows (3.2 adds deviceAuthorization) — same static map,
// shared between the selector of the "Get a token" block and the auth panel of
// the home page. An unknown key is displayed as-is.
const FLOW_LABEL = {
  authorizationCode: 'oauth.flow.authorizationCode',
  clientCredentials: 'oauth.flow.clientCredentials',
  implicit: 'oauth.flow.implicit',
  password: 'oauth.flow.password',
  deviceAuthorization: 'oauth.flow.deviceAuthorization',
}

// Nature of a credential field (cf. credentialFields) → label.
const CREDENTIAL_LABEL = {
  token: 'auth.field.token',
  apiKey: 'auth.field.apiKey',
  username: 'auth.field.username',
  password: 'auth.field.password',
  credential: 'auth.field.credential',
}

export function credentialLabel(kind) {
  return t(CREDENTIAL_LABEL[kind] ?? CREDENTIAL_LABEL.credential)
}

export function flowLabel(key) {
  return FLOW_LABEL[key] ? t(FLOW_LABEL[key]) : String(key)
}

export function schemeTypeLabel(scheme) {
  const key = AUTH_TYPE_LABEL[scheme.type === 'http' ? `http:${scheme.scheme}` : scheme.type]
  return key ? t(key) : `${scheme.type}${scheme.scheme ? ` ${scheme.scheme}` : ''}`
}

export function schemeLocation(scheme) {
  if (scheme.type === 'apiKey') {
    const byIn = { query: 'auth.queryLoc', cookie: 'auth.cookieLoc' }
    return t(byIn[scheme.in] ?? 'auth.headerLoc', { name: scheme.paramName ?? '' })
  }
  if (scheme.type === 'mutualTLS') return ''
  return t('auth.headerLoc', { name: 'Authorization' })
}
