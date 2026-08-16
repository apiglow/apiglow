// The one menu in the bar that is about the app rather than about the API:
// how it looks, what language it speaks, what it stores, and what it is. The
// rest of the header names a document and acts on it — this is the drawer
// everything else is not.
//
// The maintenance panel is an ITEM here, never the trigger. A gear opening a
// menu whose first entry is also called "Settings" says one word for two
// different things; the trigger is a plain overflow glyph and the naming
// splits where the meaning does — preferences change how the app looks,
// settings govern what it keeps (docs/architecture.md §5.11).
import { t } from '../i18n/index.js'
import { el, icon, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import { DOTS_SVG, GEAR_SVG, HELP_SVG } from './icons.js'

// The heading a section of this menu carries. Exported because the sections
// are built by the switchers themselves: they own their controls, the menu
// owns the grammar those controls are dressed in.
export function menuSectionHeading(svg, label) {
  return el(
    'p',
    'flex items-center gap-2 px-2 pt-1 text-xs font-medium text-subtle',
    icon(svg, 'shrink-0'),
    text(label),
  )
}

export function appMenu({ themeSwitcher, langSwitcher, onSettings, onAbout }) {
  const trigger = el('summary', 'btn btn-sm btn-ghost btn-square', icon(DOTS_SVG, 'text-subtle'))
  trigger.title = t('menu.label')
  trigger.setAttribute('aria-label', t('menu.label'))
  trigger.dataset.appMenu = ''

  // Assigned once the dropdown exists — the items are built before it.
  let close = () => {}
  const item = (svg, label, marker, onClick) => {
    const btn = el(
      'button',
      'flex w-full items-center gap-2 text-sm',
      icon(svg, 'shrink-0 text-subtle'),
      el('span', 'grow text-start', text(label)),
    )
    btn.type = 'button'
    btn.dataset[marker] = ''
    btn.addEventListener('click', () => {
      // Focus moves to the trigger BEFORE the menu folds. Both items open a
      // modal, and a modal hands focus back to whatever had it — an item
      // inside a closed <details> is still in the document but no longer
      // rendered, so the reader would come back to nothing. The trigger is
      // where the path started and it is still on screen.
      trigger.focus()
      close()
      onClick()
    })
    return el('li', 'w-full', btn)
  }

  const actions = el(
    'ul',
    'menu w-full p-0',
    item(GEAR_SVG, t('settings.open'), 'menuSettings', onSettings),
    item(HELP_SVG, t('about.open'), 'menuAbout', onAbout),
  )

  // A rule follows each section rather than sitting between them: an install
  // offering one theme or one language hands over a null, and the menu is then
  // an action list with no stray line above it.
  const sections = [themeSwitcher, langSwitcher].filter(Boolean)
  const content = el(
    'div',
    'dropdown-content z-30 flex w-60 flex-col rounded-box border border-base-300 bg-base-100 p-1 shadow-sm',
    ...sections.flatMap((section) => [section, el('div', 'my-1 border-t border-base-300')]),
    actions,
  )

  const dropdown = detailsDropdown('dropdown-end', trigger, content)
  close = dropdown.close
  // What a section defers building, it builds here: the menu is the only thing
  // that knows it is about to be looked at.
  dropdown.details.addEventListener('toggle', () => {
    if (dropdown.details.open) for (const section of sections) section.reveal?.()
  })
  return dropdown.details
}
