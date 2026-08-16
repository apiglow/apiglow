import { currentLanguage, t } from '../i18n/index.js'
import { readPref, writePref } from '../storage/prefs.js'
import { menuSectionHeading } from './app-menu.js'
import { el, icon, text } from './dom.js'
import { CHECK_MARK_SVG_SM, GLOBE_SVG } from './icons.js'

const LANG_KEY = 'language'
// Virtual choice following the browser's own preferences; never a language code.
// Same shape as the theme's 'system' (docs/architecture.md §5.9): a choice that
// resolves at boot rather than a value to store.
const BROWSER = 'browser'

// The first offered language the browser asks for, in the order IT ranks them.
// Matched on the primary subtag too: a browser asking for `fr-CA` gets `fr`,
// and demanding an exact tag would make the feature miss almost every real
// browser.
function browserLanguage(available) {
  const primary = (tag) => String(tag).split('-')[0].toLowerCase()
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    if (!tag) continue
    const exact = available.find((code) => code.toLowerCase() === String(tag).toLowerCase())
    if (exact) return exact
    const loose = available.find((code) => primary(code) === primary(tag))
    if (loose) return loose
  }
  return null
}

// The persisted CHOICE — a language code or 'browser'. It takes priority over
// language.default, which is only an initial value. A stored language absent
// from `available` (config narrowed since) is ignored.
export function resolveLanguageChoice({ available, fallback }) {
  const stored = readPref(LANG_KEY)
  if (stored === BROWSER) return BROWSER
  if (available.includes(stored)) return stored
  return fallback
}

// The language actually loaded for a choice. 'browser' asking for something
// this install does not offer lands on the first offered language rather than
// on a code the switcher could not even show as current.
export function resolveInitialLanguage({ available, fallback }) {
  const choice = resolveLanguageChoice({ available, fallback })
  if (choice !== BROWSER) return choice
  return browserLanguage(available) ?? available[0] ?? 'en'
}

// Language name written in that language ("English", "Deutsch"): no
// table to maintain on the i18n side, the list of codes is free on the config side.
function languageName(code) {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code)
    if (name && name.toLowerCase() !== code.toLowerCase()) return name
  } catch {
    // Code not recognized by the browser's ICU: fallback to the raw code.
  }
  return code.toUpperCase()
}

// How many offered languages still fit as one row of segments. Past that the
// row would wrap into an unreadable grid and the list takes over.
const JOIN_MAX = 3

// Language selector, a section of the header's preferences menu. The change
// reloads the page: all components then re-render in the new language, and only
// the active language's file is downloaded.
class LangSwitcher extends HTMLElement {
  #available = []
  #current = null
  #build = null

  // `current` is the persisted CHOICE ('browser' included), not the loaded
  // language — under 'browser' the two differ, and the check mark must land on
  // what the user picked. The loaded one comes from i18n, which is the only
  // thing that knows what the fetch ended up giving us.
  set languages({ available, current }) {
    this.#available = available
    this.#current = current
    if (this.isConnected) this.#render()
  }

  connectedCallback() {
    if (this.#available.length) this.#render()
  }

  // Called by the menu holding this section when it first opens: the long-list
  // form costs an `Intl.DisplayNames` per language and this element renders on
  // the boot path of every page, for a list most sessions never unfold.
  reveal() {
    const build = this.#build
    this.#build = null
    build?.()
  }

  #render() {
    if (this.#available.length < 2) {
      this.replaceChildren()
      return
    }
    const body = this.#available.length <= JOIN_MAX ? this.#segments() : this.#list()
    this.replaceChildren(
      el('div', 'flex flex-col gap-1', menuSectionHeading(GLOBE_SVG, t('lang.label')), body),
    )
  }

  // Picking a language costs a reload, so the choice is one press away rather
  // than one press plus a scan: with two or three offered, every option and the
  // automatic mode fit on a single row of segments — same grammar as the
  // theme's light/dark/system row, and no `Intl` call at all.
  #segments() {
    const row = el('div', 'join w-full')
    const segment = (key, label, title) => {
      const active = key === this.#current
      const btn = el('button', 'btn btn-xs join-item grow', text(label))
      btn.type = 'button'
      btn.dataset.langChoice = key
      btn.title = title
      btn.classList.toggle('btn-active', active)
      btn.setAttribute('aria-pressed', String(active))
      btn.addEventListener('click', () => this.#pick(key))
      row.append(btn)
    }
    // The automatic mode first, and named by its own label rather than by the
    // code it resolved to: it is a mode, not one more language.
    segment(BROWSER, t('lang.browser'), `${t('lang.browser')} — ${currentLanguage().toUpperCase()}`)
    for (const code of this.#available) segment(code, code.toUpperCase(), code)
    return row
  }

  #pick(key) {
    if (key === this.#current) return
    writePref(LANG_KEY, key)
    window.location.reload()
  }

  #list() {
    const menu = el('ul', 'menu w-full flex-nowrap max-h-56 overflow-y-auto p-0')
    const entry = (key, tag, label) => {
      const active = key === this.#current
      const check = icon(CHECK_MARK_SVG_SM, active ? 'shrink-0' : 'shrink-0 invisible')
      const btn = el(
        'button',
        active ? 'menu-active flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-sm',
        el('span', 'font-mono text-xs text-subtle uppercase', text(tag)),
        el('span', 'grow truncate', text(label)),
        check,
      )
      btn.type = 'button'
      btn.dataset.langChoice = key
      if (active) btn.setAttribute('aria-current', 'true')
      btn.addEventListener('click', () => this.#pick(key))
      menu.append(el('li', '', btn))
    }

    this.#build = () => {
      // First, and separated: following the browser is a mode, not one more
      // language — and it is where an install starts, so it is also the way
      // back. Its code column shows what the browser actually resolved to,
      // which is the one thing "Automatic" alone does not say.
      entry(BROWSER, currentLanguage(), t('lang.browser'))
      menu.append(el('li', 'pointer-events-none', el('div', 'divider my-0')))
      for (const code of this.#available) entry(code, code, languageName(code))
    }
    return menu
  }
}

if (!customElements.get('lang-switcher')) customElements.define('lang-switcher', LangSwitcher)
