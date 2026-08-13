import { t } from '../i18n/index.js'
import { el, text } from './dom.js'

// Step editing bar (docs/scenarios.md §5.2), placed above the try-it
// like the step-by-step one — and exclusive with it.
//
// It answers the two questions asked while editing a step in the real
// panel: "what am I currently modifying?" and "which
// variables am I allowed to write here?". Without it, the panel wasn't
// distinguishable in any way from a free trial, and saving had to be sought in
// the menu of another view.
//
// No writing here: the shell owns the store, the bar only
// requests (onSave / onClose).
class ScenarioEditBar extends HTMLElement {
  #state = null
  onSave = null
  onClose = null

  // null = no edit in progress.
  set state(state) {
    this.#state = state
    this.#render()
  }

  connectedCallback() {
    this.classList.add('block')
    this.#render()
  }

  #render() {
    const state = this.#state
    if (!state) {
      this.replaceChildren()
      this.classList.add('hidden')
      return
    }
    this.classList.remove('hidden')

    const close = el('button', 'btn btn-ghost btn-xs', text(t('scenario.edit.done')))
    close.type = 'button'
    close.dataset.editAction = 'close'
    close.addEventListener('click', () => this.onClose?.())

    const save = el('button', 'btn btn-primary btn-xs', text(t('scenario.edit.save')))
    save.type = 'button'
    save.dataset.editAction = 'save'
    save.addEventListener('click', () => this.onSave?.())

    const box = el(
      'div',
      'rounded-box border border-secondary/40 bg-base-100 p-3 flex flex-col gap-2 mb-3',
      el(
        'div',
        'flex flex-wrap items-center gap-2',
        el(
          'span',
          'badge badge-secondary badge-sm',
          text(t('scenario.step.position', { index: state.index + 1, total: state.total })),
        ),
        el(
          'span',
          'text-sm font-bold min-w-0 truncate',
          text(state.scenarioName || t('scenario.untitled')),
        ),
        el('span', 'grow'),
        close,
      ),
      el('p', 'text-xs text-subtle', text(t('scenario.edit.hint'))),
    )
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', t('scenario.edit.region'))

    const variables = this.#variables(state.variables ?? [])
    if (variables) box.append(variables)
    box.append(el('div', 'flex flex-wrap items-center gap-2', save))
    this.replaceChildren(box)
  }

  // What is writable as `{{…}}` AT THIS POINT in the scenario: extractions
  // from earlier steps first (chaining, what we're after), then
  // environment variables. A click copies the template — all that's left
  // is to paste it into the desired field.
  #variables(variables) {
    if (!variables.length) return null
    const line = el(
      'div',
      'flex flex-wrap items-center gap-1.5',
      el('span', 'text-xs uppercase text-subtle', text(t('scenario.edit.variables'))),
    )
    for (const variable of variables) {
      const chip = el(
        'button',
        variable.from
          ? 'badge badge-sm font-mono badge-success badge-outline cursor-pointer'
          : 'badge badge-sm font-mono badge-ghost cursor-pointer',
        text(`{{${variable.name}}}`),
      )
      chip.type = 'button'
      chip.dataset.insertVariable = variable.name
      chip.title = variable.from
        ? t('scenario.edit.copyFromStep', { index: variable.from })
        : t('scenario.edit.copyFromEnv')
      chip.addEventListener('click', () => copyTemplate(chip, variable.name))
      line.append(chip)
    }
    return line
  }
}

// Local visual feedback rather than a toast: the chip is already in view, and
// a notification per copied variable would be noise.
function copyTemplate(chip, name) {
  navigator.clipboard
    .writeText(`{{${name}}}`)
    .then(() => {
      const previous = chip.textContent
      chip.replaceChildren(text(t('scenario.edit.copied')))
      setTimeout(() => chip.replaceChildren(text(previous)), 1200)
    })
    .catch((err) => console.error('[api-doc] clipboard write failed:', err))
}

if (!customElements.get('scenario-edit-bar'))
  customElements.define('scenario-edit-bar', ScenarioEditBar)
