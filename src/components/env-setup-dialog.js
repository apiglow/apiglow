import { t } from '../i18n/index.js'
import { MASK } from '../export/redact.js'
import { modalDismiss, openModal, scrollBlock } from './a11y.js'
import { el, text } from './dom.js'

// Preview of an environment setup link (docs/env-setup-link.md §4.3).
// A URL is not a mandate: this shows exactly what would be written, and
// nothing is written until Apply.
//
// The component renders a `planSetup` result and nothing else — it computes no
// diff of its own, so the preview cannot promise what the write does not do.

// Static maps (rule 2): a `badge-${action}` would be purged by the JIT.
const ACTION_BADGE = {
  add: 'badge badge-sm badge-success badge-soft',
  set: 'badge badge-sm badge-info badge-soft',
  keep: 'badge badge-sm badge-ghost',
}

class EnvSetupDialog extends HTMLElement {
  #dialog = null
  #body = null
  #plan = null

  // `() => void` — the shell owns the write.
  onApply = null

  open(plan) {
    this.#plan = plan
    this.#render()
    openModal(this.#dialog)
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({
      backdropLabel: t('envSetup.close'),
      closeLabel: t('envSetup.close'),
    })
    this.#body = el('div', 'flex flex-col gap-3')
    this.#dialog = el(
      'dialog',
      'modal',
      el('div', 'modal-box max-w-2xl', dismiss, this.#body),
      backdrop,
    )
    this.replaceChildren(this.#dialog)
  }

  #render() {
    const plan = this.#plan
    if (!plan) return
    const title = el('h3', 'text-lg font-bold', text(t('envSetup.title')))
    title.id = 'apidoc-env-setup-title'
    this.#dialog.setAttribute('aria-labelledby', title.id)

    const verdictKey = plan.mode === 'create' ? 'envSetup.willCreate' : 'envSetup.willUpdate'
    const verdict = el(
      'div',
      'alert alert-info alert-soft text-sm py-2',
      el('span', '', text(t(verdictKey, { name: plan.name }))),
    )
    verdict.dataset.setupMode = plan.mode

    const identity = [
      plan.baseUrl ? changeRow(t('env.baseUrl'), plan.baseUrl.from, plan.baseUrl.to) : null,
      plan.color
        ? changeRow(t('env.color'), colorLabel(plan.color.from), colorLabel(plan.color.to))
        : null,
    ].filter(Boolean)

    // Filtered, not passed straight through: an absent section is `null`, and
    // `replaceChildren` renders that as the literal text "null".
    this.#body.replaceChildren(
      ...[
        el(
          'div',
          'flex flex-col gap-1 pe-8',
          title,
          el('p', 'text-xs text-subtle', text(t('envSetup.intro'))),
        ),
        verdict,
        identity.length ? el('div', 'flex flex-col gap-1', ...identity) : null,
        plan.variables.length ? rowsTable(t('env.variables'), plan.variables, 'variable') : null,
        plan.headers.length ? rowsTable(t('env.headers'), plan.headers, 'header') : null,
        // Said before the choice, because it is the choice: the URL is already
        // gone from the address bar, so "later" is not on offer.
        el('p', 'text-xs text-subtle', text(t('envSetup.noLater'))),
        this.#actions(),
      ].filter(Boolean),
    )
  }

  #actions() {
    const cancel = el('button', 'btn btn-sm', text(t('envSetup.cancel')))
    const cancelForm = el('form', '', cancel)
    cancelForm.method = 'dialog'
    const apply = el('button', 'btn btn-sm btn-primary', text(t('envSetup.apply')))
    apply.type = 'button'
    apply.dataset.setupApply = ''
    apply.addEventListener('click', () => {
      this.#dialog.close()
      this.onApply?.()
    })
    return el('div', 'modal-action', cancelForm, apply)
  }
}

// The value column. A sensitive value is never revealed here: the user is
// accepting a credential, not reading one — and an empty one says so in words,
// because a blank cell reads as a bug.
function valueCell(row) {
  if (row.sensitive && row.value) {
    const masked = el('span', 'font-mono text-subtle', text(MASK))
    masked.setAttribute('aria-label', t('envSetup.hidden'))
    return masked
  }
  if (!row.value) return el('span', 'text-xs italic text-subtle', text(t('envSetup.emptyValue')))
  return el('code', 'font-mono text-xs break-all', text(row.value))
}

function rowsTable(caption, rows, kind) {
  const body = el(
    'tbody',
    '',
    ...rows.map((row) => {
      const tr = el(
        'tr',
        '',
        el('td', 'font-mono text-xs', text(row.name)),
        // The word carries the meaning; the color only repeats it (rule 15).
        el(
          'td',
          '',
          el('span', ACTION_BADGE[row.action], text(t(`envSetup.action.${row.action}`))),
        ),
        el('td', 'w-full', valueCell(row)),
      )
      tr.dataset.setupRow = kind
      tr.dataset.setupName = row.name
      tr.dataset.setupAction = row.action
      return tr
    }),
  )
  return el(
    'section',
    'flex flex-col gap-1',
    el('h4', 'text-xs font-bold text-subtle', text(caption)),
    scrollBlock(
      el(
        'div',
        'overflow-x-auto',
        el(
          'table',
          'table table-xs',
          el(
            'thead',
            '',
            el(
              'tr',
              '',
              // i18n keys, not Tailwind classes: rule 2 is about the JIT purge.
              ...['columnName', 'columnAction', 'columnValue'].map((key) =>
                el('th', '', text(t(`envSetup.${key}`))),
              ),
            ),
          ),
          body,
        ),
      ),
      t('a11y.scrollable.table'),
    ),
  )
}

function changeRow(label, from, to) {
  return el(
    'div',
    'flex flex-wrap items-baseline gap-2 text-sm',
    el('span', 'text-xs text-subtle', text(label)),
    // On a creation there is no "before" to strike through.
    from ? el('code', 'font-mono text-xs line-through text-faint', text(from)) : null,
    from ? el('span', 'text-faint', text('→')) : null,
    el('code', 'font-mono text-xs', text(to)),
  )
}

function colorLabel(color) {
  return color ? t(`env.color.${color}`) : ''
}

if (!customElements.get('env-setup-dialog'))
  customElements.define('env-setup-dialog', EnvSetupDialog)
