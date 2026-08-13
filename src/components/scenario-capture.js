import { t } from '../i18n/index.js'
import { el, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'

// "Add to a scenario" button shared by the try-it and history
// (docs/scenarios.md §5.4). `capture` is provided by the shell:
//   { list: () => [{ id, name }], add: async (scenarioId|null, step) => void }
// scenarioId null = create a new scenario. `getStep` returns { opId, request }.
export function captureButton(
  capture,
  getStep,
  { classes = 'btn btn-xs gap-1', dropdownClasses = 'dropdown-top' } = {},
) {
  const summary = el(
    'summary',
    `${classes} font-normal`,
    text(t('scenario.addStep')),
    el('span', 'text-subtle', text('▾')),
  )
  const menu = el(
    'ul',
    'dropdown-content menu menu-sm bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-56 p-1',
  )
  const dropdown = detailsDropdown(dropdownClasses, summary, menu)
  dropdown.details.dataset.scenarioCapture = ''

  const pick = async (scenarioId) => {
    dropdown.close()
    await capture.add(scenarioId, getStep())
  }

  // Rebuilt on open: the list of local scenarios changes underneath the
  // panel (creation from the nav, previous capture).
  dropdown.details.addEventListener('toggle', () => {
    if (!dropdown.details.open) return
    const items = capture.list().map((scenario) => {
      const btn = el('button', 'truncate', text(scenario.name || t('scenario.untitled')))
      btn.type = 'button'
      btn.dataset.scenarioTarget = scenario.id
      btn.addEventListener('click', () => pick(scenario.id))
      return el('li', 'max-w-full', btn)
    })
    const create = el('button', 'text-primary', text(t('scenario.addToNew')))
    create.type = 'button'
    create.dataset.scenarioTarget = 'new'
    create.addEventListener('click', () => pick(null))
    // replaceChildren has no null-filtering of its own (unlike `el`): a
    // falsy child would be stringified into a literal "null" text node.
    const separator = items.length
      ? [el('li', 'pointer-events-none', el('div', 'divider my-0'))]
      : []
    menu.replaceChildren(...items, ...separator, el('li', '', create))
  })
  return dropdown.details
}
