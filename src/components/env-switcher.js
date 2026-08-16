import { t } from '../i18n/index.js'
import { el, icon, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import { CHECK_MARK_SVG, CHEVRON_SVG_SM, LAYERS_SVG } from './icons.js'
import { ENV_AURA, ENV_GRADIENT, ENV_SWATCH } from '../env/colors.js'
import { envLabel } from '../env/store.js'

// Colored identification dot for an environment (color or rainbow aura).
function colorDot(color, extra = 'size-2.5') {
  return el('span', `${extra} shrink-0 rounded-full ${ENV_SWATCH[color] ?? 'bg-base-content/25'}`)
}

// Header environment selector (docs/architecture.md §5.3): always visible,
// persistent via the store. Dropdown list rather than a <select> — each
// entry shows its color, its name, its base URL and the absence of credentials.
// Management (onManage, delegated to the shell to stay decoupled from the modal)
// is the last item of the list; if absent — environments locked in
// config — the item isn't rendered.
class EnvSwitcher extends HTMLElement {
  #store = null
  // Conventional auth variables expected by the scheme, set by the
  // shell: without them, no flagging of missing credentials.
  #authVariables = []
  // Resolvable variables (src/env/variables.js): a credential the host
  // provides counts as present here too, otherwise every environment would
  // wear a "no credentials" warning the send disproves.
  #variables = null
  #close = () => {}
  onManage = null

  set store(store) {
    this.#store = store
    if (this.isConnected) this.#render()
  }

  // Also the re-render signal, for both origins: an environment edited and a
  // host fill arriving change the same badges.
  set variables(variables) {
    this.#variables = variables
    variables.addEventListener('change', () => {
      if (this.isConnected) this.#render()
    })
    if (this.isConnected) this.#render()
  }

  set authVariables(names) {
    this.#authVariables = names ?? []
    if (this.isConnected) this.#render()
  }

  connectedCallback() {
    this.classList.add('block')
    this.#render()
  }

  // An environment with none of the expected auth variables filled in
  // starts without credentials: flagged at selection, it's the guard rail against
  // "I sent to prod with an empty env".
  #missingAuth(env) {
    if (!this.#authVariables.length) return false
    return !this.#authVariables.some((name) => this.#variables.sourceOf(name, env) !== null)
  }

  #render() {
    if (!this.#store) return
    const envs = this.#store.list()
    const selected = this.#store.selected()

    const labelText = selected ? envLabel(selected) : t('env.none')
    // The name goes below sm and the colour carries the environment alone —
    // which is what it is for, and what the button was already built around
    // ("red = prod", read without opening the list). Below 640 px the bar has
    // no 150 px to give a word that a dot already says, and the name stays in
    // the accessible name and the tooltip either way.
    const label = el('span', 'max-sm:hidden truncate max-w-28 font-normal', text(labelText))
    label.dataset.envName = ''
    const chevron = icon(CHEVRON_SVG_SM, 'shrink-0')
    const summary = el(
      'summary',
      // The env color gradient is carried by the button itself:
      // a permanent visual marker ("red = prod") without opening the list.
      `btn btn-sm gap-2 ${ENV_GRADIENT[selected?.color] ?? ''}`,
      colorDot(selected?.color),
      label,
      // The base URL only appears from lg onward, one step after the name
      // itself: the acting zone shares the bar with a brand and a search
      // field, and none of the three glyphs beside this button can shrink to
      // pay for a second line of text (architecture.md §5.16).
      selected?.baseUrl
        ? el(
            'span',
            'hidden lg:inline font-mono text-xs text-faint truncate max-w-40',
            text(selected.baseUrl),
          )
        : null,
      chevron,
    )
    // The selection belongs in the accessible name, not only in the visible
    // label: below sm the label is gone and the colour that replaces it says
    // nothing to a screen reader.
    summary.setAttribute('aria-label', `${t('env.select')} — ${labelText}`)
    // Everything is truncated: hover remains the only way to read a long value.
    summary.title =
      selected?.baseUrl && selected.baseUrl !== labelText
        ? `${labelText} — ${selected.baseUrl}`
        : labelText

    const menu = el(
      'ul',
      'dropdown-content menu bg-base-100 rounded-box border border-base-300 shadow-sm z-50 w-72 p-1',
    )
    if (!envs.length) {
      menu.append(
        el('li', 'w-full menu-disabled', el('span', 'text-sm text-subtle', text(t('env.none')))),
      )
    }
    for (const env of envs) {
      menu.append(this.#envItem(env, env.id === this.#store.selectedId))
    }
    if (this.onManage) {
      const layers = icon(LAYERS_SVG, 'text-subtle')
      const manage = el(
        'button',
        'w-full min-w-0 flex items-center gap-2 text-sm',
        layers,
        text(t('env.manage')),
      )
      manage.type = 'button'
      manage.addEventListener('click', () => {
        this.#close()
        this.onManage?.()
      })
      menu.append(
        el('li', `w-full ${envs.length ? 'border-t border-base-300 mt-1 pt-1' : ''}`, manage),
      )
    }

    // Aligned left as long as the toolbar is on its own line (below
    // md: the selector opens it, a list aligned right would run off
    // the screen), right beyond that.
    const dropdown = detailsDropdown('dropdown-start md:dropdown-end', summary, menu)
    this.#close = dropdown.close
    // The daisyUI aura wraps its single child: the wrapper always exists,
    // only its classes change. The closed <details> has the size of its
    // summary (the list is absolutely positioned) — the aura hugs the button.
    // `relative z-20` on this wrapper: the aura creates a stacking context that
    // encloses the list's z-50, which would otherwise pass UNDER the page's
    // content. Deliberately under the mobile overlay (z-30) and the drawer (z-40).
    this.replaceChildren(
      el('div', `relative z-20 ${ENV_AURA[selected?.color] ?? ''}`, dropdown.details),
    )
  }

  #baseUrlLabel(baseUrl) {
    const span = el('span', 'font-mono text-xs text-subtle truncate', text(baseUrl))
    span.title = baseUrl
    return span
  }

  #envItem(env, isSelected) {
    // `w-full` (here and on the <li>) is not decorative: the daisyUI menu is a
    // `column wrap` flex, whose row width follows the widest
    // content. Without a defined width, an unbreakable base URL stretches the item well
    // past the bottom of the menu — both text AND highlight overflow.
    const item = el('button', 'w-full min-w-0 flex items-start gap-2 py-2')
    item.type = 'button'
    item.dataset.envOption = env.id
    if (isSelected) item.classList.add('menu-active')
    item.setAttribute('aria-current', String(isSelected))
    item.addEventListener('click', () => {
      this.#close()
      this.#store.select(env.id)
    })

    // An environment without a name is read by its base URL (same fallback as the
    // trigger): the URL line is then redundant and disappears.
    const name = envLabel(env)
    const nameLabel = el('span', 'truncate font-medium', text(name))
    nameLabel.title = name
    const title = el(
      'div',
      'flex items-center gap-2 min-w-0',
      nameLabel,
      this.#missingAuth(env)
        ? el('span', 'badge badge-warning badge-xs shrink-0', text(t('env.noCredentials')))
        : null,
    )
    const check = icon(isSelected ? CHECK_MARK_SVG : '', 'shrink-0 text-success')
    item.append(
      colorDot(env.color, 'size-2.5 mt-1.5'),
      el(
        'div',
        'grow min-w-0 flex flex-col gap-0.5',
        title,
        env.baseUrl === name
          ? null
          : env.baseUrl
            ? this.#baseUrlLabel(env.baseUrl)
            : el('span', 'text-xs text-faint italic', text(t('env.noBaseUrl'))),
      ),
      check,
    )
    return el('li', 'w-full', item)
  }
}

if (!customElements.get('env-switcher')) customElements.define('env-switcher', EnvSwitcher)
