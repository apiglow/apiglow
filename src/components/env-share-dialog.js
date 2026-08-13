import { t } from '../i18n/index.js'
import { defaultSetupSelection, encodeSetupLink, setupSharesSecret } from '../env/setup-link.js'
import { MASK } from '../export/redact.js'
import { modalDismiss, openModal } from './a11y.js'
import { checkbox, el, text } from './dom.js'
import { setupLinkOutput } from './setup-link-output.js'

// Share an environment as a setup link (docs/env-setup-link.md §3.4).
//
// What travels is chosen row by row, and the default is a skeleton: names and
// non-sensitive values. A secret costs a deliberate check plus a warning that
// stays readable while deciding — the whole point being that the 80 % case
// (base URL, tenant header, the fact that the variable is called
// `auth.bearerAuth`) needs no secret at all.
//
// Its own element, and not a second modal inside the manager: this is a
// generator, the manager is the environments editor, and the two share nothing
// but the environment they are handed. §3.5's builder made the same move for
// the same reason, and leaving this one behind was what kept the manager the
// place every environment-shaped dialog accreted.
class EnvShareDialog extends HTMLElement {
  #dialog = null
  #body = null
  #specId = null

  // Active spec id in multi-spec, null otherwise: it rides in the link so a
  // recipient reading another API is refused rather than configured sideways.
  // Comes from the shell — a component never reads the config (rule 10).
  set specId(id) {
    this.#specId = id || null
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

  open(env) {
    // Everything below is per-opening state: the selection dies with the
    // dialog, so it is a local and not a field. The body is rebuilt on each
    // open anyway — it is a snapshot of one environment.
    const selection = defaultSetupSelection(env)
    const output = setupLinkOutput()

    const refresh = () => {
      output.update(encodeSetupLink(env, selection, { specId: this.#specId }), {
        sharesSecret: setupSharesSecret(env, selection),
      })
    }
    const pick = (label, detail, checked, onToggle, options) =>
      shareRow(label, detail, checked, onToggle, refresh, options)

    const carried = []
    if (env.baseUrl) {
      carried.push(
        pick(t('env.baseUrl'), env.baseUrl, selection.baseUrl, (on) => {
          selection.baseUrl = on
        }),
      )
    }
    if (env.color) {
      carried.push(
        pick(t('env.color'), t(`env.color.${env.color}`), selection.color, (on) => {
          selection.color = on
        }),
      )
    }
    const variables = env.variables
      .filter((v) => v.name)
      .map((variable) =>
        pick(
          variable.name,
          // A sensitive value is not previewed here either: the sender knows
          // what it is, and the row is about whether to send it.
          variable.sensitive ? MASK : variable.value,
          selection.variables[variable.name] === true,
          (on) => {
            selection.variables[variable.name] = on
          },
          { sensitive: variable.sensitive === true },
        ),
      )
    const headers = env.defaultHeaders
      .filter((h) => h.name)
      .map((header) =>
        pick(header.name, header.value, selection.headers[header.name] === true, (on) => {
          selection.headers[header.name] = on
        }),
      )

    // Filtered, not passed straight through: an absent section is `null`, and
    // `replaceChildren` renders that as the literal text "null".
    this.#body.replaceChildren(
      ...[
        el(
          'div',
          'flex flex-col gap-1 pe-8',
          el('h3', 'text-lg font-bold', text(t('envSetup.share.title', { name: env.name }))),
          el('p', 'text-xs text-subtle', text(t('envSetup.share.intro'))),
        ),
        fieldset(t('envSetup.share.settings'), carried),
        fieldset(t('env.variables'), variables, t('envSetup.share.skeletonHint')),
        fieldset(t('env.headers'), headers),
        output.node,
      ].filter(Boolean),
    )
    refresh()
    openModal(this.#dialog)
  }
}

// One "does this travel?" checkbox. `refresh` re-encodes the link, so the
// length counter and the secret warning track the choice as it is made.
function shareRow(label, detail, checked, onToggle, refresh, { sensitive = false } = {}) {
  const box = checkbox(checked, (on) => {
    onToggle(on)
    refresh()
  })
  box.dataset.setupPick = label
  return el(
    'label',
    'flex items-center gap-2 text-sm cursor-pointer',
    box,
    el('span', 'font-mono text-xs', text(label)),
    sensitive
      ? el('span', 'badge badge-xs badge-warning badge-soft', text(t('env.sensitive')))
      : null,
    detail ? el('span', 'text-xs text-subtle truncate', text(detail)) : null,
  )
}

// An empty section is no section: a legend over nothing reads as a bug.
function fieldset(legend, rows, hint = null) {
  if (!rows.length) return null
  return el(
    'fieldset',
    'fieldset',
    el('legend', 'fieldset-legend', text(legend)),
    ...rows,
    hint ? el('p', 'text-xs text-subtle', text(hint)) : null,
  )
}

if (!customElements.get('env-share-dialog'))
  customElements.define('env-share-dialog', EnvShareDialog)
