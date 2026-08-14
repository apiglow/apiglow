import { t } from '../i18n/index.js'
import { modalDismiss, openModal } from './a11y.js'
import { checkbox, el, icon, labeled, text, textInput } from './dom.js'
import { LINK_SVG } from './icons.js'
import { envColorPicker } from './env-color-picker.js'
import { envValueBox, removeRowButton } from './env-fields.js'
import { envLabel } from '../env/store.js'

// Environments editor (docs/architecture.md §5.3): full CRUD, sensitive variables
// masked (password type + eye), "unencrypted local storage" disclaimer,
// manual seed from the schema's `servers`. Edits are committed on
// `change` (blur) of each field — no Save button.
class EnvManager extends HTMLElement {
  #store = null
  #servers = []
  #dialog = null
  #body = null
  #editedId = null
  // Text field commits are "silent": re-rendering the whole modal
  // on a field's blur would destroy the element the user just
  // clicked and steal focus mid-entry. Only structural
  // changes (row add/remove, env CRUD) re-render.
  #quiet = false

  set store(store) {
    this.#store = store
    store.addEventListener('change', () => {
      if (!this.#quiet && this.#dialog?.open) this.#renderBody()
    })
  }

  #quietUpdate(id, patch) {
    this.#quiet = true
    try {
      this.#store.update(id, patch)
    } finally {
      this.#quiet = false
    }
  }

  set servers(servers) {
    this.#servers = servers ?? []
  }

  // Variable names suggested by the loaded schema (auth.X — docs/architecture.md §5.4).
  #suggestedVars = []
  set suggestedVariables(names) {
    this.#suggestedVars = names ?? []
  }

  // The two hand-off gestures of docs/env-setup-link.md, both owned by the
  // shell: `(env) => void` for §3.4's share of THIS environment, `() => void`
  // for §3.5's from-scratch builder. Neither generator lives here — this
  // element edits environments, and a generator that moved in would make it
  // the place every environment-shaped dialog accretes. What it holds of them
  // is a band with two buttons, and no idea what a link is.
  onShare = null
  onBuild = null

  open(envId = null) {
    this.#editedId = envId ?? this.#store?.selectedId ?? null
    this.#renderBody()
    openModal(this.#dialog)
  }

  connectedCallback() {
    const { backdrop, dismiss } = modalDismiss({
      backdropLabel: t('env.close'),
      closeLabel: t('env.close'),
    })
    this.#body = el('div')
    // Named rather than reached through its daisyUI class: `data-env-editor` is
    // what the shared e2e helpers target, and a `.modal-box` selector would
    // match again the day this element grows a second one.
    const editorBox = el('div', 'modal-box max-w-3xl', dismiss, this.#body)
    editorBox.dataset.envEditor = ''
    this.#dialog = el('dialog', 'modal', editorBox, backdrop)
    this.replaceChildren(this.#dialog)
  }

  #edited() {
    return this.#store.get(this.#editedId) ?? this.#store.list()[0] ?? null
  }

  #renderBody() {
    const env = this.#edited()
    this.#editedId = env?.id ?? null

    // Permanent warning (it never closes): `soft` variant, without
    // border or icon — a full alert-warning shouted every time the modal
    // opened, whereas the message is a contextual note, not an error.
    const disclaimer = el(
      'div',
      'alert alert-warning alert-soft border-0 text-xs py-2',
      el('span', 'text-subtle', text(t('env.disclaimer'))),
    )
    disclaimer.setAttribute('role', 'note')

    const blocks = [
      el('h3', 'text-lg font-bold mb-2', text(t('env.manager.title'))),
      disclaimer,
      this.#toolbar(env),
      this.#shareBar(env),
    ]
    if (env) blocks.push(this.#editorFor(env))
    else blocks.push(el('p', 'py-4 text-sm text-subtle', text(t('env.empty'))))
    if (this.#servers.length) blocks.push(this.#seedBlock())
    this.#body.replaceChildren(...blocks)
  }

  // Selector for the edited env + new / duplicate / delete actions.
  #toolbar(env) {
    const store = this.#store
    const select = el('select', 'select select-sm')
    // The list is the only label this control gets: it sits in a toolbar with
    // no visible <label> to attach to.
    select.setAttribute('aria-label', t('env.manager.pick'))
    for (const e of store.list()) {
      const option = el('option', '', text(envLabel(e)))
      option.value = e.id
      option.selected = e.id === env?.id
      select.append(option)
    }
    select.disabled = !store.list().length
    select.addEventListener('change', () => {
      this.#editedId = select.value
      this.#renderBody()
    })

    const newBtn = el('button', 'btn btn-sm', text(t('env.new')))
    newBtn.type = 'button'
    newBtn.addEventListener('click', () => {
      const env = store.create({ name: t('env.defaultName', { n: store.list().length + 1 }) })
      this.#editedId = env.id
      this.#renderBody()
    })

    const dupBtn = el('button', 'btn btn-sm', text(t('env.duplicate')))
    dupBtn.type = 'button'
    dupBtn.disabled = !env
    dupBtn.addEventListener('click', () => {
      const copy = store.duplicate(env.id, t('env.copyOf', { name: env.name }))
      if (copy) {
        this.#editedId = copy.id
        this.#renderBody()
      }
    })

    const delBtn = el('button', 'btn btn-sm btn-error btn-outline', text(t('env.delete')))
    delBtn.type = 'button'
    delBtn.disabled = !env
    delBtn.addEventListener('click', () => {
      if (!window.confirm(t('env.deleteConfirm', { name: env.name }))) return
      store.remove(env.id)
      this.#editedId = null
      this.#renderBody()
    })

    return el('div', 'flex flex-wrap items-center gap-2 my-3', select, newBtn, dupBtn, delBtn)
  }

  // The setup link (docs/env-setup-link.md §3.4, §3.5), in a band of its own.
  // It used to be two more buttons in the toolbar above, which put a hand-off
  // ("share this with a teammate") in the row that renames and deletes, at the
  // same weight as Delete and behind labels that only mean something to
  // someone who already knows the feature. The band says what the feature is
  // first; then the two things one can do with it — this environment, or one
  // that does not exist yet.
  #shareBar(env) {
    let share = null
    if (env && this.onShare) {
      // Named, because "Share as link" said nothing about what would travel:
      // the button is about THIS environment, and the name is the whole
      // difference with the action beside it.
      share = el(
        'button',
        'btn btn-sm btn-primary btn-soft gap-1.5',
        icon(LINK_SVG),
        text(t('envSetup.share.action', { name: envLabel(env) })),
      )
      share.type = 'button'
      share.dataset.envShare = ''
      share.addEventListener('click', () => this.onShare(env))
    }

    // From scratch needs no environment — which is the whole point (§3.5), and
    // the reason this is the only action left when there is none to share.
    let build = null
    if (this.onBuild) {
      build = el('button', 'btn btn-sm btn-outline', text(t('envSetup.builder.fromScratch')))
      build.type = 'button'
      build.dataset.envBuild = ''
      build.addEventListener('click', () => this.onBuild())
    }

    return el(
      'div',
      // `mb-4`: the editor's first field carries a floating label, which sits on
      // its own top border and would land on this band's bottom one.
      'flex flex-wrap items-center gap-x-4 gap-y-2 mb-4 rounded-box border border-base-300 bg-base-200/50 px-3 py-2',
      el(
        'div',
        'flex flex-col min-w-0',
        el('span', 'text-sm font-medium', text(t('envSetup.section.title'))),
        el('span', 'text-xs text-subtle', text(t('envSetup.section.hint'))),
      ),
      el('div', 'flex flex-wrap items-center gap-2 ms-auto', share, build),
    )
  }

  #editorFor(env) {
    const commit = (patch) => this.#quietUpdate(env.id, patch)

    const nameInput = textInput(env.name, (v) => commit({ name: v }), 'input input-sm')
    const baseUrlInput = textInput(
      env.baseUrl,
      (v) => commit({ baseUrl: v }),
      'input input-sm font-mono w-full',
    )
    baseUrlInput.placeholder = 'https://api.example.com/v1'

    const identity = el(
      'div',
      'grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-2',
      labeled(t('env.name'), nameInput),
      labeled(t('env.baseUrl'), baseUrlInput),
    )

    // Identification color (switcher gradient, or aura for the last
    // four). Noisy update — the re-render is what repositions the selection
    // ring.
    const colorRow = envColorPicker(env.color ?? null, (color) =>
      this.#store.update(env.id, { color }),
    )

    // --- variables ---
    const varRows = el('div', 'flex flex-col gap-1')
    for (let i = 0; i < env.variables.length; i++) varRows.append(this.#variableRow(env, i))
    const addVarBtn = el(
      'button',
      'btn btn-xs btn-soft btn-primary self-start',
      text(`+ ${t('env.addVariable')}`),
    )
    addVarBtn.type = 'button'
    addVarBtn.addEventListener('click', () => {
      // Structural change → "noisy" update to make the row appear.
      this.#store.update(env.id, {
        variables: [...env.variables, { name: '', value: '', sensitive: false }],
      })
    })
    // auth.X variables suggested by the schema and absent from this env:
    // one-click pre-creation, sensitive by default.
    const missingSuggested = this.#suggestedVars.filter(
      (name) => !env.variables.some((v) => v.name === name),
    )
    let suggestedBlock = null
    if (missingSuggested.length) {
      suggestedBlock = el(
        'div',
        'flex flex-wrap items-center gap-2 mt-1',
        el('span', 'text-xs text-subtle', text(t('env.suggested'))),
        ...missingSuggested.map((name) => {
          const btn = el('button', 'btn btn-xs btn-outline font-mono', text(`+ ${name}`))
          btn.type = 'button'
          btn.addEventListener('click', () => {
            this.#store.update(env.id, {
              variables: [...env.variables, { name, value: '', sensitive: true }],
            })
          })
          return btn
        }),
      )
    }

    const varsFieldset = el(
      'fieldset',
      'fieldset',
      el('legend', 'fieldset-legend', text(t('env.variables'))),
      varRows,
      addVarBtn,
      suggestedBlock,
    )

    // --- default headers ---
    const headerRows = el('div', 'flex flex-col gap-1')
    for (let i = 0; i < env.defaultHeaders.length; i++) headerRows.append(this.#headerRow(env, i))
    const addHeaderBtn = el(
      'button',
      'btn btn-xs btn-soft btn-primary self-start',
      text(`+ ${t('env.addHeader')}`),
    )
    addHeaderBtn.type = 'button'
    addHeaderBtn.addEventListener('click', () => {
      this.#store.update(env.id, {
        defaultHeaders: [...env.defaultHeaders, { name: '', value: '' }],
      })
    })
    const headersFieldset = el(
      'fieldset',
      'fieldset',
      el('legend', 'fieldset-legend', text(t('env.headers'))),
      headerRows,
      addHeaderBtn,
    )

    return el('div', 'flex flex-col gap-4', identity, colorRow, varsFieldset, headersFieldset)
  }

  #variableRow(env, index) {
    const store = this.#store
    const variable = env.variables[index]
    // quiet=true for text entries (blur), false for changes that
    // modify the row's rendering (sensitive, removal).
    const patchVar = (patch, { quiet = true } = {}) => {
      const variables = env.variables.map((v, i) => (i === index ? { ...v, ...patch } : v))
      if (quiet) this.#quietUpdate(env.id, { variables })
      else store.update(env.id, { variables })
    }

    const nameInput = textInput(
      variable.name,
      (v) => patchVar({ name: v }),
      'input input-sm font-mono w-44',
    )
    nameInput.placeholder = t('env.varName')

    const valueInput = textInput(variable.value, (v) => patchVar({ value: v }), 'grow font-mono')
    valueInput.placeholder = t('env.varValue')

    const sensitiveToggle = checkbox(variable.sensitive, (on) =>
      patchVar({ sensitive: on }, { quiet: false }),
    )

    return el(
      'div',
      'flex flex-wrap items-center gap-2',
      nameInput,
      envValueBox(valueInput, { sensitive: variable.sensitive }),
      el('label', 'label text-xs gap-1 cursor-pointer', sensitiveToggle, text(t('env.sensitive'))),
      removeRowButton(() => {
        store.update(env.id, { variables: env.variables.filter((_, i) => i !== index) })
      }),
    )
  }

  #headerRow(env, index) {
    const store = this.#store
    const header = env.defaultHeaders[index]
    const patchHeader = (patch) => {
      const defaultHeaders = env.defaultHeaders.map((h, i) =>
        i === index ? { ...h, ...patch } : h,
      )
      this.#quietUpdate(env.id, { defaultHeaders })
    }
    const nameInput = textInput(
      header.name,
      (v) => patchHeader({ name: v }),
      'input input-sm font-mono w-44',
    )
    nameInput.placeholder = 'X-Header'
    // Same squeeze as the variable row, same answer.
    const valueInput = textInput(
      header.value,
      (v) => patchHeader({ value: v }),
      'input input-sm font-mono grow basis-40',
    )
    return el(
      'div',
      'flex flex-wrap items-center gap-2',
      nameInput,
      valueInput,
      removeRowButton(() => {
        store.update(env.id, { defaultHeaders: env.defaultHeaders.filter((_, i) => i !== index) })
      }),
    )
  }

  // Seed from `servers`: on explicit action only (never automatic).
  #seedBlock() {
    const rows = this.#servers.map((server) => {
      const btn = el('button', 'btn btn-xs', text(t('env.seedCreate')))
      btn.type = 'button'
      btn.addEventListener('click', () => {
        const env = this.#store.create({
          name: server.description || server.url,
          baseUrl: server.url,
          // Server template variables ({protocol}…) become
          // env variables pre-filled with their default.
          variables: (server.variables ?? []).map((v) => ({
            name: v.name,
            value: String(v.default ?? ''),
            sensitive: false,
          })),
        })
        this.#editedId = env.id
        this.#renderBody()
      })
      return el(
        'div',
        'flex items-center gap-2 py-1',
        btn,
        el('code', 'font-mono text-xs', text(server.url)),
        server.description ? el('span', 'text-xs text-subtle', text(server.description)) : null,
      )
    })
    return el(
      'fieldset',
      'fieldset mt-2',
      el('legend', 'fieldset-legend', text(t('env.seedTitle'))),
      ...rows,
    )
  }
}

if (!customElements.get('env-manager')) customElements.define('env-manager', EnvManager)
