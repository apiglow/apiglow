import { t } from '../i18n/index.js'
import { anchoredList } from './anchored-list.js'
import { el, text } from './dom.js'

// Autocomplete for `{{variables}}` in request fields (docs/scenarios.md
// §5.2): typing `{{` suggests what's resolvable here — extractions from earlier
// steps when editing a step, the step-by-step run's scope, variables from
// the active environment. This is chaining made writable without changing screens
// or knowing the exact name by heart.
//
// Wired by delegation onto a container (the panel, the doc) rather than field
// by field: fields are recreated on every operation render, and the request
// body is a textarea nobody would have thought to wire up.

// `{{` then the start of a name, immediately before the cursor. The `}` is outside
// the class: an already-closed template (`{{petId}}`) therefore doesn't retrigger anything.
const TRIGGER_RE = /\{\{([\w.-]*)$/
// Beyond that, the list becomes a directory: the user needs to narrow their input.
const MAX_ITEMS = 12

let seq = 0

// `getVariables()` → [{ name, from }] where `from` is the number of the step that
// produces the variable, 'run' for the scope of a step-by-step in progress, or null
// for an environment variable. Re-read on every open: the context
// (edited step, run, environment) changes under the user's fingers.
export function attachVariableAutocomplete(root, getVariables) {
  const popover = anchoredList('min-w-56')
  popover.list.id = `api-var-complete-${++seq}`

  let field = null
  let anchorAt = 0
  let shown = []
  let active = 0

  const close = () => {
    if (!popover.isOpen()) return
    popover.close()
    field?.removeAttribute('aria-expanded')
    field?.removeAttribute('aria-activedescendant')
    field = null
    shown = []
  }

  const render = () => {
    popover.list.replaceChildren(
      ...shown.map((variable, index) => {
        const item = el(
          'button',
          'flex items-center gap-2',
          el('span', 'font-mono text-xs grow truncate', text(`{{${variable.name}}}`)),
          el('span', 'text-[10px] text-subtle shrink-0', text(sourceLabel(variable))),
        )
        item.type = 'button'
        item.id = `${popover.list.id}-${index}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', String(index === active))
        if (index === active) item.classList.add('menu-active')
        // Without this the focus leaves the field on mousedown and the list closes
        // before the click reaches the option.
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => pick(variable))
        return el('li', '', item)
      }),
    )
    field.setAttribute('aria-activedescendant', `${popover.list.id}-${active}`)
  }

  const openFor = (target) => {
    const found = triggerAt(target)
    if (!found) return close()
    const needle = found.prefix.toLowerCase()
    const matches = (getVariables() ?? [])
      .filter((variable) => variable.name.toLowerCase().includes(needle))
      .slice(0, MAX_ITEMS)
    // No suggestions: the list withdraws instead of showing a "no
    // results" — `{{` is also used to write a variable that doesn't exist yet.
    if (!matches.length) return close()
    field = target
    anchorAt = found.start
    shown = matches
    active = 0
    render()
    popover.open(target, close)
    field.setAttribute('aria-expanded', 'true')
    popover.list.children[0]?.scrollIntoView({ block: 'nearest' })
  }

  const pick = (variable) => {
    const target = field
    const start = anchorAt
    const caret = target.selectionStart
    const after = target.value.slice(caret)
    // `}}` already typed to the right of the cursor: we reuse it instead of placing
    // a second pair.
    const tail = after.startsWith('}}') ? after.slice(2) : after
    const template = `{{${variable.name}}}`
    close()
    target.value = `${target.value.slice(0, start)}${template}${tail}`
    const at = start + template.length
    target.setSelectionRange(at, at)
    target.focus()
    // Same path as manual entry (the panel state and the doc↔panel
    // sync listen to `input`); not trusted, so it doesn't reopen anything.
    target.dispatchEvent(new Event('input', { bubbles: true }))
  }

  root.addEventListener('input', (event) => {
    // A programmatic write (doc↔panel sync, history loading,
    // insertion above) must never unfold the list.
    if (!event.isTrusted || !eligible(event.target)) return
    openFor(event.target)
  })
  // The list follows a specific field: any keystroke elsewhere closes it.
  root.addEventListener('focusout', () => close())

  root.addEventListener('keydown', (event) => {
    if (!popover.isOpen() || event.target !== field) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      active = (active + (event.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length
      render()
      popover.list.children[active]?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pick(shown[active])
    } else if (event.key === 'Escape') {
      // Without stopPropagation, Escape would also close the bottom sheet or the
      // dropdown that hosts the field.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
}

function sourceLabel(variable) {
  if (variable.from === 'run') return t('tryit.varFromRun')
  if (variable.from) return t('scenario.uses.fromStep', { index: variable.from })
  return t('scenario.uses.fromEnv')
}

// Free-text input fields only. The enum combobox is excluded: it already
// unfolds its own list on the same keystrokes, and the two would fight for the
// same spot on screen.
function eligible(target) {
  if (target.getAttribute?.('role') === 'combobox') return false
  if (target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && target.type === 'text'
}

function triggerAt(target) {
  const caret = target.selectionStart
  // Selection in progress (or a field without an addressable cursor): nothing to complete.
  if (typeof caret !== 'number' || caret !== target.selectionEnd) return null
  const match = TRIGGER_RE.exec(target.value.slice(0, caret))
  return match ? { start: caret - match[0].length, prefix: match[1] } : null
}
