import { t } from '../i18n/index.js'
import { copyTextButton } from './copy-button.js'
import { SETUP_CAPS } from '../env/setup-link.js'
import { setupLinkHash } from '../router.js'
import { el, text } from './dom.js'

// The output half of a setup-link generator (docs/env-setup-link.md §3.4): the
// link in a read-only field, a copy button, the length warning and the secret
// warning. Shared by the manager's share sub-dialog and the from-scratch
// builder (§3.5), which the spec asks for "the same output as §3.4" — one
// implementation is what makes that sentence true rather than aspirational.
export function setupLinkOutput() {
  const field = el('input', 'input input-sm font-mono grow')
  field.readOnly = true
  field.dataset.setupLink = ''
  field.setAttribute('aria-label', t('envSetup.share.linkLabel'))
  const copy = copyLinkButton(field)
  const lengthLine = el('p', 'text-xs text-subtle')
  // Shown while a secret is actually in the link, and not as a one-off flash:
  // it has to be readable at the moment of deciding, and withdrawing the value
  // is the thing it argues for.
  const warning = el(
    'div',
    'alert alert-warning alert-soft text-xs py-2',
    el('span', '', text(t('envSetup.share.secretWarning'))),
  )
  warning.setAttribute('role', 'note')
  warning.dataset.setupSecretWarning = ''

  // `encoded` null means the form produces no link right now (the builder's
  // over-cap state). The field is emptied rather than left as it was: a stale
  // link is what a copy button would hand over.
  const update = (encoded, { sharesSecret = false } = {}) => {
    warning.classList.toggle('hidden', !sharesSecret)
    copy.disabled = !encoded
    if (!encoded) {
      field.value = ''
      lengthLine.replaceChildren()
      return
    }
    // Built off the current URL with only the hash replaced: the payload cannot
    // end up in the query string by accident (decision 2).
    const url = new URL(window.location.href)
    url.hash = setupLinkHash(encoded)
    field.value = url.href
    lengthLine.replaceChildren(text(t('envSetup.share.length', { count: url.href.length })))
    if (url.href.length > SETUP_CAPS.urlWarnChars)
      lengthLine.append(el('span', 'text-warning ms-1', text(t('envSetup.share.tooLong'))))
  }

  return {
    node: el(
      'div',
      'flex flex-col gap-3',
      warning,
      el('div', 'flex items-center gap-2', field, copy),
      lengthLine,
    ),
    update,
  }
}

function copyLinkButton(linkInput) {
  const btn = copyTextButton({
    classes: 'btn btn-sm btn-primary',
    label: t('envSetup.share.copy'),
    getText: () => linkInput.value,
    copiedLabel: t('envSetup.share.copied'),
  })
  btn.dataset.setupCopy = ''
  return btn
}
