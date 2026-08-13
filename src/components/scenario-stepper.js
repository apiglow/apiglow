import { MASK } from '../export/redact.js'
import { t } from '../i18n/index.js'
import { el, text } from './dom.js'
import { markdownBlock } from './markdown.js'
import { methodBadgeClass } from './method-colors.js'
import { stepReportBlock } from './scenario-report.js'

// Guided step-by-step bar (docs/scenarios.md §5.3): placed above the try-it
// (so in the bottom sheet on mobile — it's the same DOM), it says where we
// are, what needs to be done, then the step's verdict.
//
// No execution logic here: the controller (shell) pushes a state and
// receives a decision. The real Send button remains the try-it's — the
// bar never duplicates the action.
class ScenarioStepper extends HTMLElement {
  #state = null
  // (kind, payload) => void with kind ∈ prev | skip | quit | next | retry |
  // continue | resume | stop | provide (payload: variables entered by hand).
  onDecision = null

  // null = no run in progress: the bar disappears.
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
    const { index, total, step, op, result, awaiting } = state
    const progress = el('progress', 'progress progress-primary h-1')
    progress.max = total
    // A step awaiting send isn't done yet: the bar shows what's
    // behind us, not the current step.
    progress.value = awaiting ? index : index + 1

    const quit = el('button', 'btn btn-ghost btn-xs', text(t('scenario.step.quit')))
    quit.type = 'button'
    quit.dataset.stepAction = 'quit'
    quit.addEventListener('click', () => this.onDecision?.('quit'))

    const head = el(
      'div',
      'flex flex-wrap items-center gap-2',
      el(
        'span',
        'badge badge-primary badge-sm',
        text(t('scenario.step.position', { index: index + 1, total })),
      ),
      el(
        'span',
        'text-sm font-bold min-w-0 truncate',
        text(state.scenarioName || t('scenario.untitled')),
      ),
      el('span', 'grow'),
      quit,
    )

    const target = el(
      'div',
      'flex flex-wrap items-center gap-2 text-xs',
      el('span', methodBadgeClass(op?.method), text(op?.method ?? '?')),
      el('code', 'font-mono break-all', text(op?.path ?? step?.opId ?? '')),
    )

    const box = el(
      'div',
      'rounded-box border border-primary/40 bg-base-100 p-3 flex flex-col gap-2 mb-3',
      head,
      progress,
      target,
    )
    box.setAttribute('role', 'region')
    box.setAttribute('aria-label', t('scenario.step.region'))
    const scope = availableVariables(state.variables)
    if (scope) box.append(scope)
    const note = markdownBlock(step?.note)
    if (note) box.append(el('div', 'text-sm', note))

    if (awaiting) {
      box.append(el('p', 'text-sm', text(t('scenario.step.sendHint'))))
    } else if (result) {
      box.append(stepReportBlock(result, { showMissing: false }))
    }
    // Missing variable: entering it here is the useful gesture. The message alone
    // used to point to the environment manager for a value that, most
    // often, only matters for this run (the step that produced it was skipped).
    const form = this.#missingForm(result?.missing ?? [])
    if (form) box.append(form)
    box.append(el('div', 'flex flex-wrap items-center gap-2', ...this.#actions(state)))
    this.replaceChildren(box)
  }

  #missingForm(missing) {
    if (!missing.length) return null
    const inputs = missing.map((name) => {
      const input = el('input', 'input input-xs font-mono grow min-w-24')
      input.type = 'text'
      input.dataset.missingVar = name
      input.setAttribute('aria-label', name)
      return { name, input }
    })
    const persist = el('input', 'checkbox checkbox-xs')
    persist.type = 'checkbox'
    persist.dataset.missingPersist = ''
    const submit = el(
      'button',
      'btn btn-xs btn-primary self-start',
      text(t('scenario.step.provideApply')),
    )
    submit.type = 'submit'
    submit.dataset.stepAction = 'provide'
    const form = el(
      'form',
      'rounded-box border border-warning/40 bg-warning/5 p-2 flex flex-col gap-1.5',
      el('span', 'text-label uppercase text-subtle', text(t('scenario.step.provideTitle'))),
      ...inputs.map(({ name, input }) =>
        el(
          'label',
          'flex items-center gap-2',
          el('code', 'font-mono text-xs shrink-0', text(`{{${name}}}`)),
          input,
        ),
      ),
      el(
        'label',
        'label text-xs gap-1 cursor-pointer self-start',
        persist,
        text(t('scenario.step.providePersist')),
      ),
      submit,
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      // A field left empty isn't a value: the variable would remain
      // missing and the step would block again, this time saying something wrong.
      const variables = {}
      for (const { name, input } of inputs) {
        if (input.value !== '') variables[name] = { value: input.value, sensitive: false }
      }
      if (!Object.keys(variables).length) return
      this.onDecision?.('provide', { variables, persist: persist.checked })
    })
    return form
  }

  #actions(state) {
    const { index, total, result, awaiting } = state
    const button = (label, kind, classes) => {
      const btn = el('button', classes, text(label))
      btn.type = 'button'
      btn.dataset.stepAction = kind
      btn.addEventListener('click', () => this.onDecision?.(kind))
      return btn
    }
    const last = index >= total - 1
    // Awaiting send: nothing resembling "send" — the user
    // must see the request and click the panel's real button.
    if (awaiting) {
      return [
        index > 0 ? button(t('scenario.step.previous'), 'prev', 'btn btn-xs btn-outline') : null,
        button(t('scenario.step.skip'), 'skip', 'btn btn-xs btn-outline'),
        // Escape hatch: the user may have gone off to look at another endpoint,
        // or messed up the step's request. This reloads it exactly as
        // recorded, without deciding anything about the run.
        button(t('scenario.step.reload'), 'resume', 'btn btn-xs btn-ghost'),
      ].filter(Boolean)
    }
    if (result?.status === 'ok') {
      return [
        button(
          last ? t('scenario.step.finish') : t('scenario.step.next'),
          'next',
          'btn btn-sm btn-primary',
        ),
        index > 0 ? button(t('scenario.step.previous'), 'prev', 'btn btn-xs btn-outline') : null,
      ].filter(Boolean)
    }
    // Failure: no default advance, three explicit outcomes (§5.3). "stop"
    // and the header's "quit" end up the same — two labels because
    // they aren't read at the same moment.
    return [
      button(t('scenario.step.retry'), 'retry', 'btn btn-sm btn-primary'),
      last ? null : button(t('scenario.step.continue'), 'continue', 'btn btn-xs btn-outline'),
      button(t('scenario.step.stop'), 'stop', 'btn btn-xs btn-error btn-outline'),
    ].filter(Boolean)
  }
}

// Run scope: what the already-played steps produced, and thus what the
// {{var}} of the current step have available. Sensitive values
// are masked like everywhere else (report, history, exports).
function availableVariables(variables) {
  const entries = Object.entries(variables ?? {})
  if (!entries.length) return null
  return el(
    'div',
    'flex flex-wrap items-center gap-1.5',
    el('span', 'text-label uppercase text-subtle', text(t('scenario.step.variables'))),
    ...entries.map(([name, entry]) => {
      const chip = el(
        'span',
        'badge badge-ghost badge-sm font-mono',
        text(`{{${name}}} = ${entry?.sensitive ? MASK : (entry?.value ?? '')}`),
      )
      chip.dataset.runVariable = name
      return chip
    }),
  )
}

if (!customElements.get('scenario-stepper'))
  customElements.define('scenario-stepper', ScenarioStepper)
