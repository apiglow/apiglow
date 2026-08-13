import { t } from '../i18n/index.js'
import { suggestedVariables } from '../openapi/auth.js'
import { drivableFlows } from '../openapi/oauth.js'
import { flowLabel, platformNotes, schemeLocation, schemeTypeLabel } from './auth-labels.js'
import { el, text } from './dom.js'
import { markdownBlock } from './markdown.js'

// Home panel for auth schemes: what the endpoint doc only shows
// for the current operation (accepted types, where the credential goes, which
// variable carries it, OAuth flows and scopes) is summarized here for the whole
// API. The long detail lives behind a collapse — an OAuth2 scheme with fifteen
// scopes would otherwise flood the home page.

// Beyond this amount of description, a scheme's detail stays collapsed even
// if it's alone: the home page must fit in one screen.
const SHORT_DESCRIPTION = 240

function urlRow(labelKey, value) {
  if (!value) return null
  return el(
    'div',
    'flex flex-wrap items-baseline gap-2 text-xs',
    el('span', 'text-subtle shrink-0', text(t(labelKey))),
    el('code', 'font-mono bg-base-200 rounded px-1 break-all', text(value)),
  )
}

function scopesList(scopes) {
  const entries = Object.entries(scopes ?? {})
  if (!entries.length) return null
  return el(
    'div',
    'mt-1.5',
    el('div', 'text-xs text-subtle mb-1', text(t('oauth.scopes'))),
    el(
      'div',
      'flex flex-col gap-0.5',
      ...entries.map(([name, description]) =>
        el(
          'div',
          'flex flex-wrap items-baseline gap-2 text-xs',
          el('code', 'font-mono bg-base-200 rounded px-1', text(name)),
          description ? el('span', 'text-subtle', text(description)) : null,
        ),
      ),
    ),
  )
}

function flowBlock(flow) {
  return el(
    'div',
    'border-s-2 border-base-300 ps-3 py-0.5',
    el('div', 'text-xs font-bold', text(flowLabel(flow.key))),
    urlRow('auth.authorizationUrl', flow.authorizationUrl),
    urlRow('auth.deviceAuthorizationUrl', flow.deviceAuthorizationUrl),
    urlRow('auth.tokenUrl', flow.tokenUrl),
    urlRow('auth.refreshUrl', flow.refreshUrl),
    scopesList(flow.scopes),
  )
}

// Detailed body of a scheme, or null if it has nothing more to say than its
// identity line — in that case the line isn't made collapsible at all.
function schemeDetail(scheme) {
  const parts = []
  const description = markdownBlock(scheme.description)
  if (description) {
    description.classList.add('text-sm')
    parts.push(description)
  }
  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
    const key = drivableFlows(scheme).length ? 'auth.oauthFlowNote' : 'auth.oauthNote'
    parts.push(el('p', 'text-xs text-subtle', text(t(key))))
  }
  for (const note of platformNotes(scheme)) {
    parts.push(el('p', 'text-xs text-subtle', text(note)))
  }
  const urls = [
    urlRow('auth.openIdConnectUrl', scheme.openIdConnectUrl),
    urlRow('auth.metadataUrl', scheme.oauth2MetadataUrl),
  ].filter(Boolean)
  if (urls.length) parts.push(el('div', 'flex flex-col gap-1', ...urls))
  const flows = scheme.flows ?? []
  if (flows.length) parts.push(el('div', 'flex flex-col gap-2', ...flows.map(flowBlock)))
  if (!parts.length) return null
  return el('div', 'flex flex-col gap-2', ...parts)
}

function identityRow(scheme) {
  return el(
    'div',
    'flex flex-wrap items-center gap-2',
    el('span', 'font-mono text-sm font-bold', text(scheme.name)),
    el('span', 'badge badge-neutral badge-sm', text(schemeTypeLabel(scheme))),
    scheme.bearerFormat
      ? el('span', 'badge badge-ghost badge-sm', text(scheme.bearerFormat))
      : null,
    scheme.deprecated
      ? el('span', 'badge badge-warning badge-outline badge-sm', text(t('doc.deprecated')))
      : null,
    el('span', 'text-sm text-subtle', text(schemeLocation(scheme))),
    ...suggestedVariables(scheme).map((name) =>
      el('code', 'font-mono text-xs bg-base-200 rounded px-1', text(`{{${name}}}`)),
    ),
  )
}

function schemeBlock(scheme, { open }) {
  const detail = schemeDetail(scheme)
  if (!detail) {
    return el('div', 'border border-base-300 bg-base-100 rounded-box p-3', identityRow(scheme))
  }
  const details = el(
    'details',
    'collapse collapse-arrow border border-base-300 bg-base-100',
    el('summary', 'collapse-title p-3 pe-10 min-h-0', identityRow(scheme)),
    el('div', 'collapse-content p-3 pt-0', detail),
  )
  details.open = open
  return details
}

// `schemes`: model.securitySchemes (all declared schemas, not only
// those of one operation). Returns null with no scheme — no empty panel.
export function securitySchemesCard(schemes) {
  if (!schemes?.length) return null
  // A single scheme with little to say: might as well open it, the panel fits anyway
  // in a few lines. As soon as there's volume, everything starts collapsed.
  const only = schemes.length === 1 ? schemes[0] : null
  const open =
    Boolean(only) &&
    !(only.flows ?? []).length &&
    (only.description ?? '').length <= SHORT_DESCRIPTION
  return el(
    'div',
    'card card-border border-base-300 bg-base-200/50',
    el(
      'div',
      'card-body p-4 gap-3',
      el(
        'div',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1',
        el('h2', 'card-title text-base', text(t('auth.title'))),
        el('span', 'text-sm text-subtle', text(t('auth.overviewIntro'))),
      ),
      el('div', 'flex flex-col gap-2', ...schemes.map((scheme) => schemeBlock(scheme, { open }))),
    ),
  )
}
