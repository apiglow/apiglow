import { t } from '../i18n/index.js'
import {
  OAuthError,
  beginAuthorizationLogin,
  fetchClientCredentialsToken,
} from '../openapi/oauth-flow.js'
import { drivableFlows, requiredScopes } from '../openapi/oauth.js'
import { flowLabel } from './auth-labels.js'
import { el, text } from './dom.js'
import { KEY_SVG } from './icons.js'

const ERROR_KEY = {
  network: 'oauth.error.network',
  token: 'oauth.error.exchange',
  denied: 'oauth.error.denied',
  state: 'oauth.error.state',
}

// Shared with the shell: the redirect return (resumeAuthorizationLogin)
// produces the same OAuthError as the block.
export function oauthErrorMessage(error) {
  const key = ERROR_KEY[error instanceof OAuthError ? error.code : ''] ?? 'oauth.error.exchange'
  return t(key, { message: error?.detail || error?.message || '' })
}

// "Get a token" block of the Credentials cartouche: drivable OAuth2
// flows of the scheme (PKCE / client credentials). The obtained token is
// written to the environment's auth.X variable — the rest of the panel
// (injection, redaction, status) then works like a token pasted
// by hand.
export function oauthBlock({ scheme, model, op, envStore, configClientId, notify }) {
  const flows = drivableFlows(scheme)
  if (!flows.length) return null

  const env = envStore.selected()
  const variables = envStore.variablesOf(env)
  const varValue = (suffix) => variables[`auth.${scheme.name}.${suffix}`]?.value ?? ''

  const state = {
    flow: flows.find((f) => f.key === 'authorizationCode') ?? flows[0],
    // Environment variable takes priority over the host config's default.
    clientId: varValue('clientId') || configClientId || '',
    clientSecret: varValue('clientSecret'),
    // Selection per flow (their scope lists differ): pre-checks the
    // scopes the operation requires.
    scopesByFlow: new Map(),
  }
  const opScopes = requiredScopes(model, op, scheme.name)
  const selectedScopes = () => {
    if (!state.scopesByFlow.has(state.flow.key)) {
      const available = Object.keys(state.flow.scopes ?? {})
      state.scopesByFlow.set(state.flow.key, new Set(opScopes.filter((s) => available.includes(s))))
    }
    return state.scopesByFlow.get(state.flow.key)
  }

  const wrap = el('div', 'flex flex-col gap-2 border-t border-base-300 pt-2 mt-1')

  const persistIfChanged = (suffix, value, sensitive) => {
    if (env && value !== varValue(suffix)) {
      envStore.setVariable(env.id, `auth.${scheme.name}.${suffix}`, value, { sensitive })
    }
  }

  const render = () => {
    const error = el('div', 'text-error text-xs hidden')
    const showError = (message) => {
      error.textContent = message
      error.classList.remove('hidden')
    }

    const rows = []

    if (flows.length > 1) {
      const select = el('select', 'select select-xs w-full')
      for (const flow of flows) {
        const option = el('option', '', text(flowLabel(flow.key)))
        option.value = flow.key
        option.selected = flow.key === state.flow.key
        select.append(option)
      }
      select.addEventListener('change', () => {
        state.flow = flows.find((f) => f.key === select.value) ?? flows[0]
        render()
      })
      rows.push(labeledRow(t('oauth.flowLabel'), select))
    }

    const clientIdInput = el('input', 'input input-xs font-mono w-full')
    clientIdInput.type = 'text'
    clientIdInput.value = state.clientId
    clientIdInput.autocomplete = 'off'
    clientIdInput.addEventListener('input', () => {
      state.clientId = clientIdInput.value
    })
    rows.push(labeledRow(t('oauth.clientId'), clientIdInput))

    if (state.flow.key === 'clientCredentials') {
      const secretInput = el('input', 'input input-xs font-mono w-full')
      secretInput.type = 'password'
      secretInput.value = state.clientSecret
      secretInput.autocomplete = 'off'
      secretInput.addEventListener('input', () => {
        state.clientSecret = secretInput.value
      })
      rows.push(labeledRow(t('oauth.clientSecret'), secretInput))
    }

    const scopeNames = Object.keys(state.flow.scopes ?? {})
    if (scopeNames.length) {
      const selection = selectedScopes()
      const list = el('div', 'flex flex-col gap-1 max-h-28 overflow-y-auto pr-1')
      for (const name of scopeNames) {
        const checkbox = el('input', 'checkbox checkbox-xs')
        checkbox.type = 'checkbox'
        checkbox.checked = selection.has(name)
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selection.add(name)
          else selection.delete(name)
        })
        const label = el(
          'label',
          'flex items-center gap-2 cursor-pointer min-w-0',
          checkbox,
          el('code', 'font-mono text-xs truncate', text(name)),
        )
        const description = state.flow.scopes[name]
        if (description) label.title = description
        list.append(label)
      }
      rows.push(
        el(
          'div',
          'flex flex-col gap-1',
          el('span', 'text-xs text-subtle', text(t('oauth.scopes'))),
          list,
        ),
      )
    }

    const button = el(
      'button',
      'btn btn-primary btn-xs self-start gap-1.5',
      keyIcon(),
      text(t('oauth.getToken')),
    )
    button.type = 'button'
    if (!env) button.disabled = true
    button.addEventListener('click', async () => {
      error.classList.add('hidden')
      if (!state.clientId.trim()) return showError(t('oauth.missingClientId'))
      if (state.flow.key === 'clientCredentials') {
        if (!state.clientSecret) return showError(t('oauth.missingClientSecret'))
        button.disabled = true
        button.replaceChildren(
          el('span', 'loading loading-spinner loading-xs'),
          text(t('oauth.gettingToken')),
        )
        try {
          const token = await fetchClientCredentialsToken({
            flow: state.flow,
            clientId: state.clientId.trim(),
            clientSecret: state.clientSecret,
            scopes: [...selectedScopes()],
          })
          // Batch persistence on success only: each setVariable emits
          // a change that rebuilds the panel (and thus this block) — doing it
          // before costs a lost entry on failure.
          persistIfChanged('clientId', state.clientId.trim(), false)
          persistIfChanged('clientSecret', state.clientSecret, true)
          envStore.setVariable(env.id, `auth.${scheme.name}`, token, { sensitive: true })
          notify?.('success', t('oauth.tokenSaved', { env: env.name }))
        } catch (err) {
          render()
          showErrorOn(wrap, oauthErrorMessage(err))
        }
        return
      }
      // Authorization Code + PKCE: URL validation before any persistence,
      // an invalid authorizationUrl must not trigger a re-render that
      // would detach the error zone. A relative URL is valid — it means
      // "same origin as the docs" and resolves against the page.
      try {
        new URL(state.flow.authorizationUrl, globalThis.location?.href)
      } catch {
        return showError(t('oauth.error.exchange', { message: state.flow.authorizationUrl }))
      }
      persistIfChanged('clientId', state.clientId.trim(), false)
      await beginAuthorizationLogin({
        flow: state.flow,
        schemeName: scheme.name,
        clientId: state.clientId.trim(),
        scopes: [...selectedScopes()],
        envId: env.id,
      })
    })

    const footer = el('div', 'flex flex-col gap-1')
    footer.append(button)
    if (!env) footer.append(el('span', 'text-xs text-subtle', text(t('oauth.noEnv'))))
    else if (state.flow.key === 'authorizationCode') {
      footer.append(el('span', 'text-[11px] text-subtle', text(t('oauth.redirectNote'))))
    }

    wrap.replaceChildren(...rows, footer, error)
  }

  render()
  return wrap
}

// After a re-render (client credentials failure), the previous render's
// error zone no longer exists: we target the current render's.
function showErrorOn(wrap, message) {
  const error = wrap.querySelector('.text-error')
  if (!error) return
  error.textContent = message
  error.classList.remove('hidden')
}

function labeledRow(label, input) {
  return el('label', 'flex flex-col gap-1', el('span', 'text-xs text-subtle', text(label)), input)
}

function keyIcon() {
  const span = el('span', '')
  span.innerHTML = KEY_SVG
  span.setAttribute('aria-hidden', 'true')
  return span
}
