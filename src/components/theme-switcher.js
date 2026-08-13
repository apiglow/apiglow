import { t } from '../i18n/index.js'
import { readPref, writePref } from '../storage/prefs.js'
import { detailsDropdown } from './dropdown.js'
import { el, icon, text } from './dom.js'
import { CHECK_MARK_SVG_SM, PALETTE_SVG } from './icons.js'

const THEME_KEY = 'theme'
// Virtual choice following prefers-color-scheme; never a data-theme value.
const SYSTEM = 'system'

// Light/dark counterparts among the themes known to form a pair. "System"
// follows the OS scheme within the first pair fully offered by
// theme.available; without such a pair the entry does not exist and 'system'
// resolves like a plain fallback.
const THEME_PAIRS = [
  ['apiglow', 'apiglow-dark'],
  ['light', 'dark'],
]

// The signature themes are product names; every other theme keeps its daisyUI
// identifier (the CSS `capitalize` dresses it up enough).
const DISPLAY_NAMES = { apiglow: 'ApiGlow', 'apiglow-dark': 'ApiGlow Dark' }

function systemPair(available) {
  const pair = THEME_PAIRS.find(([l, d]) => available.includes(l) && available.includes(d))
  return pair ? { light: pair[0], dark: pair[1] } : null
}

// One MediaQueryList for the app's lifetime: both the read and the listener
// below query the same OS state.
const DARK_SCHEME = window.matchMedia('(prefers-color-scheme: dark)')

// Every caller is already gated on a pair existing — 'system' is not an
// offered choice without one (resolveThemeChoice).
function resolveSystemTheme(available) {
  const { light, dark } = systemPair(available)
  return DARK_SCHEME.matches ? dark : light
}

// The persisted CHOICE — a theme name or 'system'. It takes priority over
// theme.default, which is only an initial value (docs/architecture.md §5.9). A
// stored value made meaningless since (theme dropped from `available`, pair
// broken) is ignored, as is a 'system' default without a pair to resolve in.
export function resolveThemeChoice({ available, fallback }) {
  const stored = readPref(THEME_KEY)
  if (stored === SYSTEM && systemPair(available)) return SYSTEM
  if (available.includes(stored)) return stored
  if (fallback === SYSTEM) return systemPair(available) ? SYSTEM : (available[0] ?? 'light')
  return fallback
}

// The data-theme actually applied for a choice.
export function resolveInitialTheme({ available, fallback }) {
  const choice = resolveThemeChoice({ available, fallback })
  return choice === SYSTEM ? resolveSystemTheme(available) : choice
}

// Live half of 'system': repaint when the OS scheme flips. One listener for
// the app's lifetime — it re-reads the choice on every event, so it stays
// correct after the user picks an explicit theme (and costs nothing then).
export function followSystemTheme({ available, fallback }) {
  DARK_SCHEME.addEventListener('change', () => {
    if (resolveThemeChoice({ available, fallback }) !== SYSTEM) return
    document.documentElement.dataset.theme = resolveSystemTheme(available)
  })
}

// Preview of a theme's colors: the local data-theme is enough to repaint the
// swatches, all standard themes being embedded in the CSS.
function themePreview(theme) {
  const box = el(
    'span',
    'flex shrink-0 items-center gap-px rounded-sm border border-base-content/15 bg-base-100 p-0.5',
    el('span', 'size-2 rounded-xs bg-primary'),
    el('span', 'size-2 rounded-xs bg-secondary'),
    el('span', 'size-2 rounded-xs bg-accent'),
  )
  box.dataset.theme = theme
  return box
}

// Selector limited to the themes in theme.available — the CSS embeds
// all standard themes anyway, it's the host config that restricts the offering.
// Rendered as an icon dropdown: the header already carries five tools, a wide
// <select> would cost space there that the theme name doesn't justify.
class ThemeSwitcher extends HTMLElement {
  #available = []
  #current = null

  // `current` is the persisted choice ('system' included), not the resolved
  // data-theme — the check mark must land on what the user picked.
  set themes({ available, current }) {
    this.#available = available
    this.#current = current
    if (this.isConnected) this.#render()
  }

  connectedCallback() {
    if (this.#available.length) this.#render()
  }

  // The pair the mode toggle operates on: the one the current choice lives
  // in, or the first pair theme.available offers — so "light" from `dracula`
  // still lands somewhere sensible instead of doing nothing.
  #pairFor() {
    const home = THEME_PAIRS.find(
      ([light, dark]) =>
        (light === this.#current || dark === this.#current) &&
        this.#available.includes(light) &&
        this.#available.includes(dark),
    )
    return home ? { light: home[0], dark: home[1] } : systemPair(this.#available)
  }

  // Which side of the toggle the current choice is, if it is one at all — a
  // theme outside every pair (dracula) lights no segment.
  #modeOf() {
    if (this.#current === SYSTEM) return 'system'
    for (const [light, dark] of THEME_PAIRS) {
      if (this.#current === light) return 'light'
      if (this.#current === dark) return 'dark'
    }
    return null
  }

  #render() {
    if (this.#available.length < 2) {
      this.replaceChildren()
      return
    }
    // Filled in by detailsDropdown further below; the items are built before that.
    let closeMenu = () => {}
    const items = new Map()
    const modeButtons = new Map()
    const pick = (key, theme) => {
      this.#current = key
      document.documentElement.dataset.theme = theme
      writePref(THEME_KEY, key)
      this.#syncActive(items)
      this.#syncMode(modeButtons)
    }
    const menu = el(
      'ul',
      // flex-nowrap: the DaisyUI menu is a wrappable flex-col — without this, a
      // list taller than max-h spreads into columns instead of scrolling.
      'menu w-full flex-nowrap max-h-72 overflow-y-auto p-0',
    )

    const entry = ({ key, label, preview, apply }) => {
      const check = icon(CHECK_MARK_SVG_SM, 'shrink-0')
      const btn = el(
        'button',
        'flex items-center gap-2 text-sm',
        preview,
        el('span', 'grow truncate capitalize', text(label)),
        check,
      )
      btn.type = 'button'
      btn.addEventListener('click', () => {
        pick(key, apply())
        closeMenu()
      })
      items.set(key, { btn, check })
      menu.append(el('li', '', btn))
    }

    for (const theme of this.#available)
      entry({
        key: theme,
        label: DISPLAY_NAMES[theme] ?? theme,
        preview: themePreview(theme),
        apply: () => theme,
      })
    this.#syncActive(items)

    // The quick mode toggle (docs/architecture.md §5.9), atop the theme list.
    // "System" lives here rather than among the themes: it is a mode, not one
    // more palette. Picking a mode keeps the menu open — flipping light/dark
    // to compare is exactly what the row is for.
    let modeRow = null
    const pair = systemPair(this.#available)
    if (pair) {
      const modes = [
        {
          id: 'light',
          label: t('theme.mode.light'),
          choice: () => ({ key: this.#pairFor().light, theme: this.#pairFor().light }),
        },
        {
          id: 'dark',
          label: t('theme.mode.dark'),
          choice: () => ({ key: this.#pairFor().dark, theme: this.#pairFor().dark }),
        },
        {
          id: 'system',
          label: t('theme.system'),
          choice: () => ({ key: SYSTEM, theme: resolveSystemTheme(this.#available) }),
        },
      ]
      modeRow = el('div', 'join w-full')
      for (const mode of modes) {
        const btn = el('button', 'btn btn-xs join-item grow', text(mode.label))
        btn.type = 'button'
        btn.dataset.mode = mode.id
        btn.addEventListener('click', () => {
          const { key, theme } = mode.choice()
          pick(key, theme)
        })
        modeButtons.set(mode.id, btn)
      }
      modeRow.append(...modeButtons.values())
      this.#syncMode(modeButtons)
    }

    const palette = icon(PALETTE_SVG, 'text-subtle')
    const trigger = el('summary', 'btn btn-sm btn-ghost btn-square', palette)
    trigger.title = t('theme.label')
    trigger.setAttribute('aria-label', t('theme.label'))

    const content = el(
      'div',
      'dropdown-content z-10 flex w-52 flex-col gap-1 rounded-box border border-base-300 bg-base-100 p-1 shadow-sm',
      modeRow,
      menu,
    )
    const dropdown = detailsDropdown('dropdown-end', trigger, content)
    closeMenu = dropdown.close
    this.replaceChildren(dropdown.details)
  }

  #syncActive(items) {
    for (const [key, { btn, check }] of items) {
      const active = key === this.#current
      btn.classList.toggle('menu-active', active)
      check.classList.toggle('invisible', !active)
      if (active) btn.setAttribute('aria-current', 'true')
      else btn.removeAttribute('aria-current')
    }
  }

  #syncMode(modeButtons) {
    const mode = this.#modeOf()
    for (const [id, btn] of modeButtons) {
      const active = id === mode
      btn.classList.toggle('btn-active', active)
      btn.setAttribute('aria-pressed', String(active))
    }
  }
}

if (!customElements.get('theme-switcher')) customElements.define('theme-switcher', ThemeSwitcher)
