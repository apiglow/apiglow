import { t } from '../i18n/index.js'
import { opHash, pageHash, scenarioHash } from '../router.js'
import { searchIndex } from '../search/index.js'
import { announce, openModal } from './a11y.js'
import { el, icon, text } from './dom.js'
import { SEARCH_SVG } from './icons.js'
import { methodBadgeClass } from './method-colors.js'

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

// Bounds the DOM, not the search: the counter shows the real total.
const RENDER_LIMIT = 20

// The palette moves a highlight through a list its input never leaves, so the
// active result is a CSS class and nothing else — a screen reader hears silence
// while arrowing, and Enter then opens something never named. The ARIA 1.2
// combobox pattern is what closes that: `aria-activedescendant` is a reference,
// so both ends need a stable id.
const LIST_ID = 'apidoc-search-results'
const optionId = (index) => `${LIST_ID}-${index}`

// Which kinds wear a word instead of a method badge. Listed rather than
// derived by excluding the operation kinds: a kind added later gets no badge
// and is noticed, where a negative test would silently label it "Documentation".
const RESULT_BADGE = {
  page: 'search.page',
  'page-section': 'search.page',
  scenario: 'search.scenario',
}

// Scope chips over the index's kinds. A chip only exists when the index holds
// entries of its kind — an installation with no scenarios gets no dead filter
// — and the row only exists when there are at least two of them to tell apart.
const SCOPES = [
  { key: 'all', label: 'search.scope.all', types: null },
  { key: 'reference', label: 'search.scope.reference', types: ['op', 'webhook'] },
  { key: 'pages', label: 'search.scope.pages', types: ['page', 'page-section'] },
  { key: 'scenarios', label: 'search.scope.scenarios', types: ['scenario'] },
]

export function searchShortcutLabel() {
  return IS_MAC ? '⌘ K' : 'Ctrl K'
}

// The one way into the palette that isn't the keyboard, wherever it appears:
// drawer, header, dead-end page. Three hand-built copies drifted on exactly the
// parts that must not (rule 15) — the accessible name and the shortcut hint —
// so callers now supply only the dressing.
export function searchTrigger(onOpen, className) {
  const trigger = el(
    'button',
    className,
    icon(SEARCH_SVG, 'text-faint'),
    el('span', 'grow truncate text-left', text(t('search.placeholder'))),
    el('kbd', 'kbd kbd-sm api-kbd-hint', text(searchShortcutLabel())),
  )
  trigger.type = 'button'
  trigger.addEventListener('click', onOpen)
  return trigger
}

// Search palette (Cmd/Ctrl+K): queries the pure index from src/search/ and
// navigates via the hash router. Results are real links (copyable).
class SearchPalette extends HTMLElement {
  #entries = []
  #dialog = null
  #input = null
  #scopeRow = null
  #resultsBox = null
  #results = []
  #active = 0
  #scope = 'all'

  set index(entries) {
    this.#entries = entries ?? []
    // A new index invalidates the narrowing shortcut: the last match set was
    // computed over entries that may no longer exist.
    this.#lastQuery = null
    this.#lastMatches = null
    // The content index lands after the palette may already be open (§6): the
    // results in front of the user are the ones that have to grow — and the
    // chip row with them, if the late entries brought a new kind.
    if (this.#dialog?.open) {
      this.#renderScopes()
      this.#renderResults()
    }
  }

  open() {
    // showModal throws if the dialog is already open (repeated Cmd+K).
    if (this.#dialog.open) {
      this.#input.select()
      return
    }
    this.#input.value = ''
    this.#active = 0
    this.#scope = 'all'
    this.#renderScopes()
    this.#renderResults()
    openModal(this.#dialog, { focus: this.#input })
  }

  connectedCallback() {
    this.#input = el('input', 'grow')
    this.#input.type = 'search'
    this.#input.placeholder = t('search.placeholder')
    this.#input.autofocus = true
    this.#input.setAttribute('role', 'combobox')
    this.#input.setAttribute('aria-autocomplete', 'list')
    this.#input.setAttribute('aria-expanded', 'false')
    this.#input.setAttribute('aria-controls', LIST_ID)
    this.#input.addEventListener('input', () => {
      this.#active = 0
      this.#renderResults()
    })
    this.#input.addEventListener('keydown', (event) => this.#onKeydown(event))

    // Radio inputs, not buttons: one Tab stop for the whole row, arrows moving
    // within it — the radio group's native keyboard model is exactly the
    // chips' (rule 15), so nothing is wired by hand.
    this.#scopeRow = el('div', 'tabs tabs-box tabs-xs mx-4 mb-2 w-fit max-w-full overflow-x-auto')
    this.#scopeRow.setAttribute('role', 'radiogroup')
    this.#scopeRow.setAttribute('aria-label', t('search.scopeLabel'))
    this.#scopeRow.addEventListener('change', (event) => {
      if (event.target?.name !== 'search-scope') return
      this.#scope = event.target.value
      this.#active = 0
      this.#renderResults()
    })

    this.#resultsBox = el('div', 'max-h-96 overflow-y-auto border-t border-base-300 p-2')
    const footer = el(
      'div',
      'api-kbd-hint flex items-center gap-4 border-t border-base-300 px-4 py-2 text-xs text-subtle',
      kbdHint(['↑', '↓'], t('search.kbd.navigate')),
      kbdHint(['⏎'], t('search.kbd.open')),
      kbdHint(['esc'], t('search.kbd.close')),
    )

    const backdrop = el('form', 'modal-backdrop', el('button', '', text(t('search.kbd.close'))))
    backdrop.method = 'dialog'
    this.#dialog = el(
      'dialog',
      'modal',
      el(
        'div',
        'modal-box self-start mt-[10vh] w-full max-w-xl p-0',
        el(
          'label',
          'input input-lg w-full border-0 shadow-none focus-within:outline-none',
          this.#input,
        ),
        this.#scopeRow,
        this.#resultsBox,
        footer,
      ),
      backdrop,
    )
    this.replaceChildren(this.#dialog)
  }

  #onKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!this.#results.length) return
      const delta = event.key === 'ArrowDown' ? 1 : -1
      this.#active = (this.#active + delta + this.#results.length) % this.#results.length
      this.#highlight()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = this.#results[this.#active]
      if (result) this.#go(result)
    } else if (event.key === 'Escape') {
      // `type=search`: Chrome and Safari spend the first Escape emptying the
      // field, so a reader who typed anything had to press it twice — while
      // the palette's own legend, and the About dialog, promise one.
      event.preventDefault()
      this.#dialog.close()
    }
  }

  #go(result) {
    this.#dialog.close()
    window.location.hash = resultHash(result)
  }

  #renderScopes() {
    if (!this.#scopeRow) return
    const kinds = new Set(this.#entries.map((entry) => entry.type))
    const scopes = SCOPES.filter(
      (scope) => !scope.types || scope.types.some((type) => kinds.has(type)),
    )
    // "All" plus a single kind is not a choice.
    this.#scopeRow.classList.toggle('hidden', scopes.length < 3)
    this.#scopeRow.replaceChildren(
      ...scopes.map((scope) => {
        const chip = el('input', 'tab')
        chip.type = 'radio'
        chip.name = 'search-scope'
        chip.value = scope.key
        // The visible label too: daisyUI's input tabs render it from here.
        chip.setAttribute('aria-label', t(scope.label))
        chip.checked = scope.key === this.#scope
        return chip
      }),
    )
  }

  // The previous query and the entries it matched, per scope: when a
  // keystroke merely EXTENDS the query, only those entries can still match
  // (every token of the shorter query stays required), so the scan shrinks
  // from the whole index to the last result set — the difference between a
  // keystroke over 1200 operations and one over the dozens still standing.
  // Scoring reruns in full either way: ranking never depends on the shortcut.
  #lastQuery = null
  #lastScope = null
  #lastMatches = null

  #renderResults() {
    const query = this.#input.value.trim()
    const scope = SCOPES.find((s) => s.key === this.#scope) ?? SCOPES[0]
    const narrowable =
      this.#lastQuery && scope.key === this.#lastScope && query.startsWith(this.#lastQuery)
    const pool = narrowable
      ? this.#lastMatches
      : scope.types
        ? this.#entries.filter((entry) => scope.types.includes(entry.type))
        : this.#entries
    const all = searchIndex(pool, query, Infinity)
    if (query) {
      this.#lastQuery = query
      this.#lastScope = scope.key
      this.#lastMatches = all.map((result) => result.entry)
    } else {
      this.#lastQuery = null
      this.#lastMatches = null
    }
    this.#results = all.slice(0, RENDER_LIMIT)
    if (!query) {
      this.#resultsBox.replaceChildren(
        el('p', 'px-3 py-6 text-sm text-subtle', text(t('search.hint'))),
      )
      this.#collapse()
      return
    }
    if (!all.length) {
      this.#resultsBox.replaceChildren(
        el('p', 'px-3 py-6 text-sm text-subtle', text(t('search.noResults'))),
      )
      this.#collapse()
      // The count and the empty state are rebuilt whole on every keystroke,
      // and an inserted node is not a mutation: without the shared region,
      // typing into the palette is silent.
      announce(t('search.noResults'))
      return
    }
    const countText = t('search.count', { n: all.length })
    announce(countText)
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const count = el('p', 'px-3 pt-2 text-xs text-subtle', text(countText))
    const list = el('ul', 'menu w-full p-0')
    list.id = LIST_ID
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', t('search.results'))
    // Group headers ride the RANKED order: a header opens whenever the label
    // changes, it never re-sorts. Clustering by group would trade the ranking
    // for tidiness — and the top result must stay the top result.
    let lastGroup = null
    this.#results.forEach((result, i) => {
      const groupLabel = resultGroupLabel(result)
      if (groupLabel !== lastGroup) {
        lastGroup = groupLabel
        // A listbox owns options and nothing else: the header is a sighted
        // reader's landmark, and every option already names its own kind.
        const header = el('li', 'menu-title text-label uppercase', text(groupLabel))
        header.setAttribute('role', 'presentation')
        list.append(header)
      }
      const badge = RESULT_BADGE[result.type]
        ? el('span', 'badge badge-ghost badge-sm shrink-0 w-16', text(t(RESULT_BADGE[result.type])))
        : el('span', `${methodBadgeClass(result.method, 'badge-sm')} w-16`, text(result.method))
      const lines = [el('span', 'truncate font-medium', ...highlightTokens(result.title, tokens))]
      if (result.path) {
        lines.push(
          el(
            'span',
            'truncate font-mono text-xs text-subtle',
            ...highlightTokens(result.path, tokens),
          ),
        )
      } else if (result.type === 'page-section' && result.group) {
        // The page the section belongs to — the header above says the zone,
        // the crumb says the page.
        lines.push(el('span', 'truncate text-xs text-subtle', text(result.group)))
      }
      if (result.matchedProperties.length) {
        lines.push(
          el(
            'span',
            'truncate text-xs text-subtle',
            text(t('search.fields', { names: result.matchedProperties.join(', ') })),
          ),
        )
      }
      const link = el(
        'a',
        'flex items-center gap-3 w-full min-w-0',
        badge,
        el('span', 'flex flex-col min-w-0 grow', ...lines),
      )
      link.href = resultHash(result)
      link.id = optionId(i)
      link.setAttribute('role', 'option')
      link.dataset.resultId = result.id
      link.dataset.index = String(i)
      // Navigation is carried by the href; only the dialog is closed.
      link.addEventListener('click', () => this.#dialog.close())
      link.addEventListener('mouseenter', () => {
        this.#active = i
        this.#highlight()
      })
      const row = el('li', 'w-full', link)
      row.setAttribute('role', 'presentation')
      list.append(row)
    })
    this.#resultsBox.replaceChildren(count, list)
    // A fresh list starts at the top with the top result active — but not
    // via `scrollIntoView`, which has to READ layout first: that forced
    // reflow on every keystroke was most of the palette's per-key cost, on a
    // list that was just rebuilt and needs no measuring at all. The reset
    // rides the next frame, where layout is being computed anyway.
    requestAnimationFrame(() => {
      this.#resultsBox.scrollTop = 0
    })
    this.#highlight({ scroll: false })
  }

  // `scroll` is the arrow-key case: moving the highlight through a list that
  // overflows must chase it, and a single keydown can afford the reflow.
  #highlight({ scroll = true } = {}) {
    this.#input.setAttribute('aria-expanded', 'true')
    for (const link of this.#resultsBox.querySelectorAll('a[data-index]')) {
      const active = Number(link.dataset.index) === this.#active
      link.classList.toggle('menu-active', active)
      link.setAttribute('aria-selected', String(active))
      if (!active) continue
      this.#input.setAttribute('aria-activedescendant', link.id)
      if (scroll) link.scrollIntoView({ block: 'nearest' })
    }
  }

  // No list, no active option: a stale reference would have the reader hear a
  // result that is no longer on screen.
  #collapse() {
    this.#input.setAttribute('aria-expanded', 'false')
    this.#input.removeAttribute('aria-activedescendant')
  }
}

function kbdHint(keys, label) {
  return el(
    'span',
    'flex items-center gap-1',
    ...keys.map((k) => el('kbd', 'kbd kbd-xs', text(k))),
    text(label),
  )
}

// The heading a run of results sits under: the nav's own section names, so the
// palette and the nav agree on where a result lives.
function resultGroupLabel(result) {
  if (result.type === 'op') return result.group ?? t('nav.otherGroup')
  if (result.type === 'webhook') return t('nav.webhooksSection')
  if (result.type === 'scenario') return t('nav.scenariosSection')
  return t('nav.pagesSection')
}

// Every occurrence of a query token wrapped in a <mark> (styled in app.css —
// the theme's tint, not the browser's highlighter yellow). Overlaps resolve to
// the earliest match, ties to the longest token; plain Text nodes throughout,
// so nothing external ever reaches innerHTML (rule 5).
function highlightTokens(value, tokens) {
  const lower = String(value).toLowerCase()
  const nodes = []
  let cursor = 0
  for (;;) {
    let at = -1
    let length = 0
    for (const token of tokens) {
      const found = lower.indexOf(token, cursor)
      if (found === -1) continue
      if (at === -1 || found < at || (found === at && token.length > length)) {
        at = found
        length = token.length
      }
    }
    if (at === -1) break
    if (at > cursor) nodes.push(text(value.slice(cursor, at)))
    nodes.push(el('mark', '', text(value.slice(at, at + length))))
    cursor = at + length
  }
  if (cursor < value.length) nodes.push(text(value.slice(cursor)))
  return nodes.length ? nodes : [text(value)]
}

// 'op' and 'webhook' share the #/op/{id} route; page and scenario have their
// own, and a page section deep-links to its heading.
function resultHash(result) {
  if (result.type === 'page-section') return pageHash(result.slug, result.anchor)
  if (result.type === 'page') return pageHash(result.id)
  if (result.type === 'scenario') return scenarioHash(result.id)
  return opHash(result.id)
}

if (!customElements.get('search-palette')) customElements.define('search-palette', SearchPalette)
