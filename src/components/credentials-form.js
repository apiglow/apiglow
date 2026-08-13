import { t } from '../i18n/index.js'
import { credentialFields } from '../openapi/auth.js'
import { credentialLabel } from './auth-labels.js'
import { el, text } from './dom.js'

// Credential entry directly in the try-it cartouche: one field per
// conventional variable of the scheme (token, API key, username/password),
// whatever its type — the environments popin remains the full technical
// view, it's no longer a mandatory step to send a request.
//
// Writing is delegated to `save`: every setVariable emits a change that
// rebuilds the panel, it's up to the caller to neutralize that rebuild so as
// not to lose the request being entered.
//
// `variables` (VariableSource) only decides which badge a void field wears and
// whether the manual refresh button exists. The inputs stay bound to the
// ENVIRONMENT variable alone — a host value is never displayed, not even
// masked, so there is no doubt about what editing the field does (§6).
export function credentialsForm({ scheme, envStore, save, variables }) {
  const hasEnv = Boolean(envStore.selected())
  const wrap = el('div', 'flex flex-col gap-2')
  wrap.append(
    ...credentialFields(scheme).map((field) => row(field, envStore, hasEnv, save, variables)),
  )
  if (variables.host.hasProvider) wrap.append(refreshButton(scheme, variables.host))
  return wrap
}

// Asks the host for fresh credentials for THIS scheme. Only rendered when a
// provider is registered: without one the button would have nothing to call.
function refreshButton(scheme, host) {
  const label = text(t('tryit.credHostRefresh'))
  const button = el('button', 'btn btn-ghost btn-xs self-start', label)
  button.type = 'button'
  button.dataset.credHostRefresh = scheme.name
  button.addEventListener('click', async () => {
    button.disabled = true
    // Spinner beside the label, not in place of it: a nameless button is a
    // button a screen reader can no longer report as pressed.
    button.replaceChildren(el('span', 'loading loading-spinner loading-xs'), label)
    try {
      await host.request('manual', scheme.name)
    } finally {
      // A fill rebuilds this whole block through the overlay's change event;
      // this restores the button when nothing changed (same token returned).
      button.disabled = false
      button.replaceChildren(label)
    }
  })
  return button
}

function row(field, envStore, hasEnv, save, variables) {
  // Re-read on every comparison: the field survives successive writes, its
  // reference value is the store's, not the first render's.
  const stored = () => envStore.variablesOf()[field.name]
  const variable = stored()
  // The choice made in the environments manager takes priority: a variable
  // already declared non-sensitive stays displayed in clear text.
  const masked = variable ? variable.sensitive === true : field.sensitive
  const missing = el('span', 'badge badge-soft badge-error badge-xs', text(t('tryit.credMissing')))
  // Same slot, different reading: the void is covered by a host-provided value,
  // so the send will work and the red alarm would be a lie (§6).
  // `covers`, not `sourceOf`: the question is what a VOID field would wear, and
  // the field is void only later, when the user clears it. `sourceOf` would
  // answer 'env' at build time and the badge would never come back.
  const fromHost = variables.host.covers(field.name)
    ? el('span', 'badge badge-info badge-soft badge-xs', text(t('tryit.credFromHost')))
    : null
  const labelLine = el(
    'div',
    'flex items-baseline gap-2 text-xs min-w-0',
    el('span', 'text-subtle shrink-0', text(credentialLabel(field.kind))),
    el('code', 'font-mono text-faint truncate', text(`{{${field.name}}}`)),
  )
  // Removal from the DOM rather than the `hidden` class: daisyUI's `.badge`
  // imposes its own display, the badge would stay visible.
  const syncMissing = (value) => {
    if (value) {
      missing.remove()
      fromHost?.remove()
    } else labelLine.append(fromHost ?? missing)
  }

  const input = el('input', 'grow font-mono')
  // What a blocked send focuses: the panel knows which variable is missing,
  // not which field edits it.
  input.dataset.credVar = field.name
  input.type = masked ? 'password' : 'text'
  input.value = variable?.value ?? ''
  input.autocomplete = 'off'
  input.spellcheck = false
  input.disabled = !hasEnv
  // Written on blur / Enter only: on every keystroke, the change emitted by
  // the store would rebuild the field under the user's fingers.
  input.addEventListener('change', () => {
    const value = input.value
    if (value === (stored()?.value ?? '')) return
    syncMissing(value)
    save(field.name, value, { sensitive: field.sensitive })
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    }
  })

  const box = el('label', 'input input-xs font-mono w-full', input)
  if (masked) {
    const eye = el('button', 'btn btn-ghost btn-xs px-1', text('👁'))
    eye.type = 'button'
    eye.title = t('env.reveal')
    eye.setAttribute('aria-label', t('env.reveal'))
    eye.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password'
    })
    box.append(eye)
  }

  syncMissing(variable?.value ?? '')
  return el('div', 'flex flex-col gap-1', labelLine, box)
}
