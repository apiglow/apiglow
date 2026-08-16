import { t } from '../i18n/index.js'
import {
  decodeSetupLink,
  encodeSetupLink,
  setupFormIssues,
  setupFormPayload,
  setupSharesSecret,
} from '../env/setup-link.js'
import { modalDismiss, openModal } from './a11y.js'
import { checkbox, el, labeled, text, textInput } from './dom.js'
import { envColorPicker } from './env-color-picker.js'
import { envValueBox, removeRowButton } from './env-fields.js'
import { setupLinkOutput } from './setup-link-output.js'

// From-scratch setup-link builder (docs/env-setup-link.md §3.5). §3.4 shares an
// environment the lead already owns; this produces the same link with no
// environment ever existing on their machine — the answer to "to hand the team
// a link I must first create it locally, with values I do not want to keep".
//
// A pure generator (decision 1): there is no write path in this file at all,
// not even a non-silent one. A lead who also wants the environment locally
// previews their own link and applies it, through the one write path the
// feature has.
//
// The form feeds the core encoder (decision 2) — no second payload builder,
// which is exactly the duplication this feature retires — and refuses to
// produce a link the landing would refuse, using the landing's own decoder as
// the last word rather than a re-reading of the caps. The shaping and the cap
// check are the core's too (`setupFormPayload`, `setupFormIssues`): what is
// left here is a form and the wording of a refusal.

// The core names the bound; the component says it. Splitting it this way is
// what keeps the messages from being a second, drifting statement of §3.3.
const ISSUE_KEYS = {
  name: 'envSetup.builder.errName',
  nameChars: 'envSetup.builder.errNameLength',
  valueChars: 'envSetup.builder.errValueLength',
  variables: 'envSetup.builder.errTooManyVariables',
  headers: 'envSetup.builder.errTooManyHeaders',
  duplicate: 'envSetup.builder.errDuplicate',
}

class EnvSetupBuilder extends HTMLElement {
  #dialog = null
  #body = null
  #specId = null
  #state = null
  #output = null
  #errors = null
  #previewBtn = null
  #encoded = null

  // `(encoded) => void`: the shell owns the URL (rule 10). A component does not
  // navigate, and decision 5's preview is a navigation.
  onPreview = null

  // Active spec id in multi-spec, null otherwise — it rides in the payload so a
  // recipient reading another API is refused rather than configured sideways.
  set specId(id) {
    this.#specId = id || null
  }

  open() {
    // A fresh form on every opening: the builder keeps nothing between
    // gestures, because it keeps nothing at all.
    this.#state = { name: '', baseUrl: '', color: null, variables: [], headers: [] }
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

  // Structural changes only (a row added or removed, the sensitive flag, the
  // color): text fields commit on `input` and re-encode without re-rendering,
  // because rebuilding the form under a keystroke destroys the field being
  // typed into — the manager's own rule, for the same reason.
  #render() {
    const state = this.#state
    const title = el('h3', 'text-lg font-bold', text(t('envSetup.builder.title')))
    title.id = 'apidoc-env-setup-builder-title'
    this.#dialog.setAttribute('aria-labelledby', title.id)

    const nameInput = this.#field(state, 'name', 'input input-sm')
    nameInput.dataset.setupField = 'envName'
    const baseUrlInput = this.#field(state, 'baseUrl', 'input input-sm font-mono w-full')
    baseUrlInput.dataset.setupField = 'baseUrl'
    baseUrlInput.placeholder = 'https://api.example.com/v1'

    const colorRow = envColorPicker(state.color, (color) => {
      state.color = color
      this.#render()
    })

    this.#errors = el('ul', 'alert alert-error alert-soft text-xs py-2 flex-col items-start gap-1')
    this.#errors.setAttribute('role', 'alert')
    this.#errors.dataset.setupBuilderErrors = ''
    this.#output = setupLinkOutput()

    this.#previewBtn = el('button', 'btn btn-sm btn-primary', text(t('envSetup.builder.preview')))
    this.#previewBtn.type = 'button'
    this.#previewBtn.dataset.setupPreview = ''
    this.#previewBtn.addEventListener('click', () => {
      // Closed first: the landing dialog is the recipient's, and it opens on a
      // page this one has no further business covering.
      this.#dialog.close()
      this.onPreview?.(this.#encoded)
    })
    const close = el('form', '', el('button', 'btn btn-sm', text(t('envSetup.close'))))
    close.method = 'dialog'

    this.#body.replaceChildren(
      el(
        'div',
        'flex flex-col gap-1 pe-8',
        title,
        el('p', 'text-xs text-subtle', text(t('envSetup.builder.intro'))),
      ),
      el(
        'div',
        'grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-2',
        labeled(t('env.name'), nameInput),
        labeled(t('env.baseUrl'), baseUrlInput),
      ),
      colorRow,
      this.#rowsFieldset({
        kind: 'variable',
        rows: state.variables,
        legend: t('env.variables'),
        addLabel: t('env.addVariable'),
        blankRow: () => ({ name: '', value: '', sensitive: false, carry: true }),
        renderRow: (row) => this.#variableRow(state.variables, row),
        hint: t('envSetup.share.skeletonHint'),
      }),
      this.#rowsFieldset({
        kind: 'header',
        rows: state.headers,
        legend: t('env.headers'),
        addLabel: t('env.addHeader'),
        blankRow: () => ({ name: '', value: '' }),
        renderRow: (row) => this.#headerRow(state.headers, row),
      }),
      this.#errors,
      this.#output.node,
      el('p', 'text-xs text-subtle', text(t('envSetup.builder.previewHint'))),
      el('div', 'modal-action', close, this.#previewBtn),
    )
    this.#refresh()
  }

  #rowsFieldset({ kind, rows, legend, addLabel, blankRow, renderRow, hint = null }) {
    const add = el('button', 'btn btn-xs btn-soft btn-primary self-start', text(`+ ${addLabel}`))
    add.type = 'button'
    add.dataset.setupAddRow = kind
    add.addEventListener('click', () => {
      rows.push(blankRow())
      this.#render()
    })
    return el(
      'fieldset',
      'fieldset',
      el('legend', 'fieldset-legend', text(legend)),
      el('div', 'flex flex-col gap-1', ...rows.map(renderRow)),
      add,
      hint ? el('p', 'text-xs text-subtle', text(hint)) : null,
    )
  }

  #variableRow(rows, row) {
    const nameInput = this.#field(row, 'name', 'input input-sm font-mono w-full sm:w-44')
    nameInput.placeholder = t('env.varName')
    nameInput.setAttribute('aria-label', t('env.varName'))
    nameInput.dataset.setupField = 'name'

    const valueInput = this.#field(row, 'value', 'grow font-mono')
    valueInput.placeholder = t('env.varValue')
    valueInput.setAttribute('aria-label', t('env.varValue'))
    valueInput.dataset.setupField = 'value'

    const sensitive = checkbox(row.sensitive, (on) => {
      row.sensitive = on
      // Carrying follows the flag rather than the other way round: a row that
      // becomes sensitive falls back to the skeleton (decision 4), and one that
      // stops being sensitive has no reason to withhold its value.
      row.carry = !on
      this.#render()
    })
    sensitive.dataset.setupSensitive = ''

    const carry = checkbox(row.carry, (on) => {
      row.carry = on
      this.#refresh()
    })
    carry.dataset.setupCarry = ''

    const container = el(
      'div',
      'flex flex-wrap items-center gap-2',
      nameInput,
      envValueBox(valueInput, { sensitive: row.sensitive }),
      el('label', 'label text-xs gap-1 cursor-pointer', sensitive, text(t('env.sensitive'))),
      el('label', 'label text-xs gap-1 cursor-pointer', carry, text(t('envSetup.builder.carry'))),
      removeRowButton(() => this.#removeRow(rows, row)),
    )
    container.dataset.setupRow = 'variable'
    return container
  }

  #headerRow(rows, row) {
    const nameInput = this.#field(row, 'name', 'input input-sm font-mono w-full sm:w-44')
    nameInput.placeholder = 'X-Header'
    nameInput.setAttribute('aria-label', t('env.varName'))
    nameInput.dataset.setupField = 'name'
    const valueInput = this.#field(row, 'value', 'input input-sm font-mono grow basis-40')
    valueInput.setAttribute('aria-label', t('env.varValue'))
    valueInput.dataset.setupField = 'value'
    const container = el(
      'div',
      'flex flex-wrap items-center gap-2',
      nameInput,
      valueInput,
      removeRowButton(() => this.#removeRow(rows, row)),
    )
    container.dataset.setupRow = 'header'
    return container
  }

  #removeRow(rows, row) {
    rows.splice(rows.indexOf(row), 1)
    this.#render()
  }

  #refresh() {
    const { env, selection } = setupFormPayload(this.#state)
    const errors = setupFormIssues(env).map(({ code, ...params }) => t(ISSUE_KEYS[code], params))
    let encoded = errors.length ? null : encodeSetupLink(env, selection, { specId: this.#specId })
    // The landing's own decoder has the last word: a payload it would refuse is
    // not a link, whatever this field could display. It is also the only
    // practical check of the byte cap, which no single form field carries.
    if (encoded && !decodeSetupLink(encoded)) {
      errors.push(t('envSetup.builder.errPayload'))
      encoded = null
    }
    this.#encoded = encoded
    this.#errors.replaceChildren(...errors.map((message) => el('li', '', text(message))))
    this.#errors.classList.toggle('hidden', errors.length === 0)
    this.#output.update(encoded, { sharesSecret: setupSharesSecret(env, selection) })
    this.#previewBtn.disabled = !encoded
  }

  // Commits on `input`, not on `change`: the link is the thing being built, and
  // it has to track the form as it is typed rather than on blur.
  #field(target, key, className) {
    return textInput(
      target[key],
      (v) => {
        target[key] = v
        this.#refresh()
      },
      className,
      { event: 'input' },
    )
  }
}

// The overview's entry point (decision 3): the manager's own action sits behind
// a modal a lead has no reason to open before they have an environment, and
// this is the place they actually land. The `environmentsLocked` check belongs
// to the CALLER — the manager is protected by not being instantiated at all,
// and that construction covers nothing living out here.
export function setupBuilderCard(onOpen) {
  const btn = el('button', 'btn btn-sm btn-primary btn-soft', text(t('envSetup.builder.action')))
  btn.type = 'button'
  btn.dataset.setupBuilderOpen = ''
  btn.addEventListener('click', onOpen)
  return el(
    'div',
    'card card-border border-base-300 bg-base-200/50',
    el(
      'div',
      'card-body p-4 gap-3',
      el(
        'div',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1',
        el('h2', 'card-title text-base', text(t('envSetup.builder.cardTitle'))),
        el('span', 'text-sm text-subtle', text(t('envSetup.builder.cardIntro'))),
      ),
      el('div', 'card-actions', btn),
    ),
  )
}

if (!customElements.get('env-setup-builder'))
  customElements.define('env-setup-builder', EnvSetupBuilder)
