import { t } from '../i18n/index.js'
import { el, icon, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import { CHECK_MARK_SVG, CHEVRON_SVG_SM, SWAP_SVG } from './icons.js'

// Spec selector (multi-spec §4.3), same pattern as env-switcher. Placed
// in navbar-start, next to the brand: it changes WHAT we're documenting, not how
// it's displayed — unlike the navbar-end tools. Reduced to an icon:
// the brand already names the active API and carries its version, the trigger
// used to repeat them word for word. Titles come from the config (specs that aren't
// active are never loaded, their info.title is unknown). The switch is
// delegated to the shell via onSelect (preference + hash + reload).
class SpecSwitcher extends HTMLElement {
  #specs = []
  #activeId = null
  #close = () => {}
  onSelect = null

  set specs({ specs, activeId }) {
    this.#specs = specs ?? []
    this.#activeId = activeId ?? null
    if (this.isConnected) this.#render()
  }

  connectedCallback() {
    this.classList.add('block')
    this.#render()
  }

  #render() {
    // Only one spec declared: nothing to select, the selector disappears
    // (the version badge becomes the header's business again).
    if (this.#specs.length < 2) {
      this.replaceChildren()
      return
    }
    const active = this.#specs.find((s) => s.id === this.#activeId) ?? this.#specs[0]
    const swap = icon(SWAP_SVG, 'shrink-0 text-subtle')
    const chevron = icon(CHEVRON_SVG_SM, 'shrink-0')
    const summary = el('summary', 'btn btn-sm btn-ghost px-2 gap-1', swap, chevron)
    // The trigger no longer names the spec — it's the brand, just to its left,
    // that carries it. The tooltip recalls it anyway: without it the button
    // would say what it acts on, but not from what.
    const label = `${t('spec.select')} — ${active.title}`
    summary.setAttribute('aria-label', label)
    summary.title = label

    const menu = el(
      'ul',
      'dropdown-content menu bg-base-100 rounded-box border border-base-300 shadow-sm z-50 w-72 p-1',
    )
    for (const spec of this.#specs) {
      menu.append(this.#specItem(spec, spec.id === active.id))
    }

    // dropdown-start: the selector lives at the left edge of the header, a list
    // aligned to the right would run off the screen.
    const dropdown = detailsDropdown('dropdown-start', summary, menu)
    this.#close = dropdown.close
    // relative z-20: same stacking context as the env-switcher — the list
    // (z-50) would otherwise pass under the content, while still staying under the
    // mobile overlay (z-30) and the drawer (z-40).
    this.replaceChildren(el('div', 'relative z-20', dropdown.details))
  }

  #specItem(spec, isSelected) {
    const item = el('button', 'w-full min-w-0 flex items-start gap-2 py-2')
    item.type = 'button'
    item.dataset.specOption = spec.id
    if (isSelected) item.classList.add('menu-active')
    item.setAttribute('aria-current', String(isSelected))
    item.addEventListener('click', () => {
      this.#close()
      this.onSelect?.(spec.id)
    })
    const title = el('span', 'truncate font-medium', text(spec.title))
    title.title = spec.title
    const check = icon(isSelected ? CHECK_MARK_SVG : '', 'shrink-0 text-success')
    item.append(
      el(
        'div',
        'grow min-w-0 flex flex-col gap-0.5',
        title,
        el('span', 'font-mono text-xs text-faint truncate', text(spec.id)),
      ),
      check,
    )
    return el('li', 'w-full', item)
  }
}

if (!customElements.get('spec-switcher')) customElements.define('spec-switcher', SpecSwitcher)
