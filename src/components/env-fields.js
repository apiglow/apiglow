import { t } from '../i18n/index.js'
import { el, text } from './dom.js'

// The row controls shared by the two environment editors: the manager, which
// commits to the store, and the setup-link builder, which only holds a form.
// The rows compose differently — the builder adds a "send the value" checkbox
// and commits as you type — but what is duplicated below is the part whose
// rationale is not guessable from the markup, and that is the part that drifts
// when it lives twice.

// A value field masked while the variable is sensitive: the person typing is
// entering their own credential, and a field that shows it is a field read
// over a shoulder.
//
// `basis-40` with a wrapping row: at 390 px the fixed-width name field plus the
// sensitive toggle and the remove button leave nothing for a `grow` box, and it
// collapsed to zero width — a variable that could be named but never given a
// value. Wrapping to a second line is what a phone has room for.
export function envValueBox(input, { sensitive = false } = {}) {
  input.type = sensitive ? 'password' : 'text'
  const box = el('label', 'input input-sm font-mono grow basis-40', input)
  if (!sensitive) return box
  const eye = el('button', 'btn btn-ghost btn-xs px-1', text('👁'))
  eye.type = 'button'
  eye.title = t('env.reveal')
  eye.setAttribute('aria-label', t('env.reveal'))
  eye.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password'
  })
  box.append(eye)
  return box
}

// "✕" is the whole visible label, so the accessible name is the only one a
// screen reader has.
export function removeRowButton(onRemove) {
  const btn = el('button', 'btn btn-ghost btn-xs', text('✕'))
  btn.type = 'button'
  btn.setAttribute('aria-label', t('env.removeRow'))
  btn.addEventListener('click', onRemove)
  return btn
}
