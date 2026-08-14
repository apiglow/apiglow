import { docsZoneEntries } from '../docs/pages.js'
import { t } from '../i18n/index.js'
import { firstCallHash, homeHash, opHash, overviewHash, pageHash, scenarioHash } from '../router.js'
import { changeDot } from './change-badge.js'
import { el, externalLink, icon, text, tooltipText } from './dom.js'
import { downloadText } from './download.js'
import { externalDocsLink } from './external-docs.js'
import {
  COLLAPSE_SVG,
  EXTERNAL_SVG_SM,
  IMPORT_SVG,
  SCENARIO_CONFIG_SVG,
  SCENARIO_LOCAL_SVG,
  SCENARIO_START_SVG,
  SEND_SVG,
  SPEC_DOC_SVG,
} from './icons.js'
import { methodBadgeClass } from './method-colors.js'
import { searchTrigger } from './search-palette.js'

// Side navigation, two zones (docs-pages.md §1.2): the docs zone — pages,
// one level of collapsible groups, external links, in declaration order —
// above the API reference zone, whose groups come from tags (schema order)
// with a fallback group for untagged operations. A top-level docs entry may
// instead declare `nav: 'bottom'` and join the trailing zone that closes the
// list below the reference (§2.7). Each entry is a real copyable link
// (deep-linking). Search is delegated to the Cmd+K palette: the field at the
// top of the nav is only a trigger (Scalar/Algolia style).
class ApiNav extends HTMLElement {
  #model = null
  #docs = []
  #docsError = null
  #homeSlug = null
  #activeId = null
  #activePage = null
  #activeOverview = false
  #activeFirstCall = false
  #firstCall = false
  #activeScenario = null
  #scenarios = []
  // Feature disabled by the host config: the section disappears entirely,
  // including the create and import items (these are its entry points).
  #scenariosEnabled = true
  #openGroups = new Set()
  // Docs groups declare their own initial state (`collapsed`), so what has to
  // be remembered is the user's override, not the open set: an id absent here
  // means "never toggled", which is not the same as "closed". No persistence
  // in v1 (§2.1).
  #docsGroupOpen = new Map()

  set scenariosEnabled(enabled) {
    this.#scenariosEnabled = enabled !== false
    if (this.isConnected) this.#renderList()
  }

  // The generated onboarding page exists only when the host asked for it AND
  // the schema offered a read to start from — the shell resolves both and
  // pushes the answer, the nav never decides.
  set firstCall(enabled) {
    this.#firstCall = enabled === true
    if (this.isConnected) this.#renderList()
  }

  // Wired by the shell: opens the search palette.
  onOpenSearch = null
  // Wired by the shell: creates an empty local scenario and navigates to it.
  onNewScenario = null

  set model(model) {
    this.#model = model
    if (this.isConnected) this.#renderList()
  }

  // { [opId]: { status } } from the local schema diff, pushed by the shell
  // once the snapshot read succeeds (after the first render).
  #changes = null
  set changes(byOp) {
    this.#changes = byOp ?? null
    if (this.isConnected) this.#renderList()
  }

  // The resolved docs outline (src/docs/pages.js), in declaration order — the
  // array order IS the nav order. Already language-resolved: the shell builds
  // it once for the nav and the exports both.
  set docs(entries) {
    this.#docs = entries ?? []
    if (this.isConnected) this.#renderList()
  }

  // The llms.txt provider (async, like the home page's), or null. It closes
  // the docs zone rather than living only on the home page: the file is the
  // map an agent is handed, and a reader who came to fetch it should not have
  // to find the overview first.
  #llmsText = null
  set llmsText(provider) {
    this.#llmsText = provider ?? null
    if (this.isConnected) this.#renderList()
  }

  // URL of a manifest that failed to load (§2.2): shown in place of the docs
  // section rather than leaving it silently empty. The reference nav below is
  // unaffected.
  set docsError(url) {
    this.#docsError = url ?? null
    if (this.isConnected) this.#renderList()
  }

  // Slug of the page that took `#/` over (§2.4), or null. Two consequences
  // here: that page's entry links to `#/` — one canonical landing URL rather
  // than two — and the reference zone gains its "API overview" entry.
  set homeSlug(slug) {
    this.#homeSlug = slug ?? null
    if (this.isConnected) this.#renderList()
  }

  // [{ id, title, source }] — scenarios provided by config first, local
  // ones after. Wired by the shell, re-pushed on every store change.
  set scenarios(scenarios) {
    this.#scenarios = scenarios ?? []
    if (this.isConnected) this.#renderList()
  }

  // Applied once: the default is a starting state, not a rule — once the
  // reader (or a later route) has touched the groups, the open set is theirs
  // and re-renders must not reopen anything.
  #defaultOpened = false

  // A landing that targets no operation unfolds the first reference group: a
  // fully folded reference makes the reader's first act a guess at which
  // header hides the endpoints, and the first group is where it starts. A
  // route aiming at an operation consumes the default instead — its own group
  // opens above, and unfolding group one under a deep link into group five
  // would be noise. Called from both the route setter and #renderList because
  // their order is not fixed: the router's first emit can precede the nav
  // being connected at all, and a consult before anything is rendered must
  // not burn the one application this gets.
  #applyDefaultOpen() {
    if (this.#defaultOpened) return
    if (this.#activeId) {
      this.#defaultOpened = true
      return
    }
    const first = this.querySelector('details[data-group]')
    if (!first) return
    this.#defaultOpened = true
    const key = first.dataset.group
    this.#openGroups.add(key)
    this.#groupBuilders.get(key)?.()
    first.open = true
  }

  set route(route) {
    this.#activeId = route.type === 'op' ? route.id : null
    // `#/` under a takeover IS the home page: its docs entry lights up, not
    // nothing at all.
    this.#activePage =
      route.type === 'page' ? route.id : route.type === null ? this.#homeSlug : null
    this.#activeOverview = route.type === 'overview'
    this.#activeFirstCall = route.type === 'first-call'
    this.#activeScenario = route.type === 'scenario' ? route.id : null
    // The active operation's group always opens; it
    // remains manually collapsible afterward.
    if (this.#activeId && this.#model) {
      const group = this.#model.groups.find((g) => g.operationIds.includes(this.#activeId))
      // Root first: a nested group is only reachable once every disclosure
      // above it is open.
      for (const ancestor of group ? this.#ancestry(group) : []) {
        const key = ancestor.tag ?? ''
        this.#openGroups.add(key)
        // Built before `open`: the highlight below runs synchronously, and the
        // `toggle` event a programmatic open fires is a queued task — waiting
        // for it would highlight (and scroll to) a link not yet in the DOM.
        this.#groupBuilders.get(key)?.()
        const details = this.querySelector(`details[data-group="${CSS.escape(key)}"]`)
        if (details) details.open = true
      }
    }
    this.#applyDefaultOpen()
    // Same for a docs page reached from outside the nav (deep link, palette,
    // prev/next): its group opens rather than leaving the highlight hidden.
    if (this.#activePage) {
      const group = this.#docs.find(
        (entry) =>
          entry.kind === 'group' &&
          entry.entries.some((child) => child.kind === 'page' && child.slug === this.#activePage),
      )
      if (group) {
        this.#docsGroupOpen.set(group.id, true)
        const details = this.querySelector(`details[data-docs-group="${CSS.escape(group.id)}"]`)
        if (details) details.open = true
      }
    }
    this.#highlight()
  }

  // A group and its ancestors (3.2 tag `parent`), root first. The `seen` set
  // is the bound: the model already broke every parent cycle, and a nav that
  // spun on one would freeze the page rather than degrade (rule 7).
  #ancestry(group) {
    const byTag = new Map(this.#model.groups.map((g) => [g.tag, g]))
    const chain = [group]
    const seen = new Set([group.tag])
    for (let up = byTag.get(group.parent); up && !seen.has(up.tag); up = byTag.get(up.parent)) {
      seen.add(up.tag)
      chain.unshift(up)
    }
    return chain
  }

  connectedCallback() {
    this.classList.add('block')
    // lg:hidden: from lg up the header centers its own trigger — one visible
    // "Search the docs" button at a time keeps the accessible name unique.
    const trigger = searchTrigger(
      () => this.onOpenSearch?.(),
      'input input-sm w-full cursor-pointer gap-2 text-base-content/70 lg:hidden',
    )
    this.#collapseBtn = el(
      'button',
      'btn btn-ghost btn-sm btn-square shrink-0 opacity-50 hover:opacity-100',
    )
    this.#collapseBtn.type = 'button'
    this.#collapseBtn.innerHTML = COLLAPSE_SVG
    this.#collapseBtn.dataset.collapseGroups = ''
    this.#collapseBtn.setAttribute('aria-label', t('nav.collapseAll'))
    this.#collapseBtn.title = t('nav.collapseAll')
    this.#collapseBtn.addEventListener('click', () => this.#collapseAll())
    this.#listBox = el('div', 'px-3 pb-3')
    // Sticky within the scrollable aside (which carries no padding for this):
    // the trigger stays visible at the top of the column, the list scrolls below.
    // From lg up the row holds only the collapse-all button, end-aligned.
    this.replaceChildren(
      el(
        'div',
        'sticky top-0 z-10 bg-base-100 p-3 flex items-center gap-1 lg:justify-end lg:py-2',
        trigger,
        this.#collapseBtn,
      ),
      this.#listBox,
    )
    if (this.#model) this.#renderList()
  }

  #collapseBtn = null

  // Collapses all groups at once. Each <details>'s `toggle` handles forgetting
  // the pin — including for the active operation's group, which will only
  // reopen on the next route change.
  #collapseAll() {
    for (const details of this.querySelectorAll('details[data-group], details[data-docs-group]')) {
      details.open = false
    }
  }

  #listBox = null

  // One builder per reference group, reset on every render: a closed group's
  // link list does not exist until something needs it (see #renderList).
  #groupBuilders = new Map()

  #renderList() {
    if (!this.#listBox || !this.#model) return
    const byId = new Map(this.#model.operations.map((op) => [op.id, op]))
    const list = el('ul', 'menu w-full px-0')
    // Sections in reading order: what you came to DO (guides, then
    // scenarios) before the exhaustive endpoint reference. The separator
    // only exists between two sections actually rendered — hence the
    // assembly via `section()` rather than a chain of `if`s that would each
    // need to know the state of all the previous ones.
    let filled = false
    const section = (...items) => {
      const nodes = items.filter(Boolean)
      if (!nodes.length) return
      // pointer-events-none: the DaisyUI menu styles every li child as a
      // clickable item (cursor + hover), including a simple separator.
      if (filled) list.append(el('li', 'pointer-events-none', el('div', 'divider my-1')))
      list.append(...nodes)
      filled = true
    }
    let total = 0
    const docsItems = this.#docsItems('top')
    // The pages placed below the reference (§2.7): built here, appended last.
    const trailingDocsItems = this.#docsItems('bottom')
    total += docsItems.length + trailingDocsItems.length
    // Uppercase section headers.
    section(docsItems.length ? sectionTitle(t('nav.pagesSection')) : null, ...docsItems)
    section(...this.#scenarioSection())
    const hasGroups = this.#model.groups.some((group) =>
      group.operationIds.some((id) => byId.has(id)),
    )
    this.#collapseBtn?.classList.toggle(
      'hidden',
      !hasGroups && !this.#docs.some((entry) => entry.kind === 'group'),
    )
    const groupItems = []
    this.#groupBuilders = new Map()
    // 3.2 tag hierarchy: the model hands a flat list in reading order, each
    // nested group naming the `parent` it sits under — already resolved there,
    // so a parent that does not exist or that loops has come back to the root.
    // Rebuilding the tree is the nav's job and nobody else's.
    const childGroups = new Map()
    const rootGroups = []
    for (const group of this.#model.groups) {
      if (!group.parent) rootGroups.push(group)
      else if (childGroups.has(group.parent)) childGroups.get(group.parent).push(group)
      else childGroups.set(group.parent, [group])
    }
    // Everything a group holds, its subgroups included: what the count pill
    // announces and what the change dot watches over — a folded parent hides
    // its children's endpoints too. Keyed by id, since an operation carrying
    // both a parent tag and a child tag is one endpoint, not two.
    const subtreeOps = (group, into = new Map()) => {
      for (const id of group.operationIds) {
        const op = byId.get(id)
        if (op) into.set(id, op)
      }
      for (const child of childGroups.get(group.tag) ?? []) subtreeOps(child, into)
      return into
    }
    // Returns the group's <li>, subgroups nested inside it, or null when
    // neither it nor anything below it has an operation left to show.
    const groupItem = (group) => {
      const ops = group.operationIds.map((id) => byId.get(id)).filter(Boolean)
      const childItems = (childGroups.get(group.tag) ?? []).map(groupItem).filter(Boolean)
      if (!ops.length && !childItems.length) return null
      total += ops.length
      const key = group.tag ?? ''
      // max-w-full on every level li>details>ul>li (+ w-full min-w-0 on the
      // link): otherwise the min-content size of the nowrap labels propagates
      // up the whole chain and overflows the menu instead of truncating.
      const sub = el('ul', 'max-w-full')
      // The group's content is built on demand: on a heavy schema the closed
      // groups hold thousands of links, and boot rendered every one of them
      // for a menu the reader sees folded (rule 14). Built here for a group
      // already open, and at the three places a closed one can open —
      // summary click (synchronously: `toggle` is a queued task, and the
      // disclosure must not paint empty), programmatic open (route setter),
      // and `toggle` as the net under anything else that flips it.
      let built = false
      const build = () => {
        if (built) return
        built = true
        // Subgroups exist from the start (a disclosure costs nothing, unlike
        // the links inside it) and close the group; everything built here
        // slots in above them.
        const anchor = childItems[0] ?? null
        // A tag's external documentation, as the group's first entry. Not in
        // the <summary>: an anchor nested inside it would be a control inside
        // a control — the disclosure would swallow the click, and the axe
        // sweep says so too (rule 15).
        const tagDocs = externalDocsLink(group.externalDocs, 'text-xs text-subtle gap-1 truncate')
        if (tagDocs) sub.insertBefore(el('li', 'max-w-full', tagDocs), anchor)
        for (const op of ops) {
          // Method badge on the right as a soft pill, label on the left.
          // w-full + min-w-0: the DaisyUI menu li is flex, without which the
          // link takes its max-content width and long labels overflow
          // instead of truncating.
          const link = el(
            'a',
            'flex items-center gap-2 w-full min-w-0',
            this.#dotFor(op.id),
            el('span', 'grow min-w-0 truncate', text(op.summary || op.path)),
            el('span', methodBadgeClass(op.method), text(op.method)),
          )
          link.href = opHash(op.id)
          link.dataset.opId = op.id
          link.title = `${op.method.toUpperCase()} ${op.path}`
          sub.insertBefore(el('li', 'max-w-full', link), anchor)
        }
      }
      this.#groupBuilders.set(key, build)
      sub.append(...childItems)
      const held = subtreeOps(group)
      const groupDot = this.#groupDot([...held.values()])
      const summary = el(
        'summary',
        'font-medium',
        groupDot,
        // 3.2 `summary` is the tag's display label; `name` — the identifier
        // operations point at, and the group key here — is the fallback.
        el('span', 'truncate', text(group.summary ?? group.tag ?? t('nav.otherGroup'))),
        // Group's endpoint count: deliberately discreet pill,
        // stuck to the name — not at the end of the
        // line, where it would collide with the menu chevron.
        // justify-self-start: the DaisyUI menu lays out summary's children
        // in a grid whose cells stretch — without this, the pill
        // spreads across the entire remaining width.
        el(
          'span',
          // `text-subtle` and not a raw `/50` mix: at 10 px on the pill's own
          // tinted background the latter reads 3.07:1, and axe never says so —
          // a one-digit count is "too short to determine if it is actual text
          // content", so `color-contrast` answers `incomplete` and moves on.
          'justify-self-start self-center shrink-0 rounded-full bg-base-content/5 px-1.5 py-0.5 text-[10px] font-mono leading-none tabular-nums text-subtle',
          text(String(held.size)),
        ),
      )
      // Tag description as a tooltip: it doesn't have room to display
      // in the nav, but this is where you hesitate between two groups.
      const description = tooltipText(group.description)
      if (description) summary.title = description
      const details = el('details', 'max-w-full', summary, sub)
      details.dataset.group = key
      // The group's operations, readable without its links existing: with the
      // list built on demand, this attribute is what still lets a test — or
      // any outside code — find which group to open for a given operation.
      details.dataset.ops = ops.map((op) => op.id).join(' ')
      // Collapsed by default; open if pinned by the user or if the active
      // operation is anywhere below — including in a subgroup, which stays
      // out of reach while its parent is folded.
      details.open = this.#openGroups.has(key) || held.has(this.#activeId)
      if (details.open) build()
      summary.addEventListener('click', build)
      details.addEventListener('toggle', () => {
        if (details.open) {
          build()
          this.#openGroups.add(key)
        } else this.#openGroups.delete(key)
      })
      return el('li', 'max-w-full', details)
    }
    let firstKey = null
    for (const group of rootGroups) {
      const item = groupItem(group)
      if (!item) continue
      if (firstKey === null) firstKey = group.tag ?? ''
      groupItems.push(item)
    }
    // The first group is built even closed: its links are the proof in the DOM
    // that the reference rendered, which is what the perf contract (and any
    // deep selector on a fresh page) waits for before interacting.
    if (firstKey !== null) this.#groupBuilders.get(firstKey)?.()
    // "API overview" heads the reference zone, and only when a docs page has
    // taken `#/` over: without a takeover the same view IS `#/`, and an entry
    // pointing at the page you are already on is noise.
    const overviewItem = this.#homeSlug ? this.#overviewItem() : null
    // "First call" heads the zone, above the overview: it is the one entry
    // meant for a reader who has never sent anything.
    const firstCallItem = this.#firstCall ? this.#firstCallItem() : null
    section(
      hasGroups || overviewItem || firstCallItem ? sectionTitle(t('nav.endpointsSection')) : null,
      firstCallItem,
      overviewItem,
      ...groupItems,
    )
    // Webhooks: flat list under the endpoints (no tags → no groups),
    // same data-op-id links as operations — shared highlighting and route.
    const webhooks = this.#model.webhooks ?? []
    total += webhooks.length
    section(
      webhooks.length ? sectionTitle(t('nav.webhooksSection')) : null,
      ...webhooks.map((wh) => {
        const link = el(
          'a',
          'flex items-center gap-2 w-full min-w-0',
          this.#dotFor(wh.id),
          el('span', 'grow min-w-0 truncate', text(wh.summary || wh.name)),
          el('span', methodBadgeClass(wh.method), text(wh.method)),
        )
        link.href = opHash(wh.id)
        link.dataset.opId = wh.id
        link.title = `${wh.method.toUpperCase()} ${wh.name}`
        return el('li', 'max-w-full', link)
      }),
    )
    // The trailing docs zone closes the nav, deliberately without a heading of
    // its own: what lands here — support, legal, a status link — is an
    // appendix, and the separator says everything a second "Documentation"
    // title would have said twice.
    section(...trailingDocsItems)
    // Schema with nothing to reference: the Scenarios section still shows — it
    // doesn't depend on operations to exist.
    if (!total) {
      section(
        el(
          'li',
          'pointer-events-none',
          el('p', 'text-sm text-subtle px-2 py-4', text(t('nav.noResults'))),
        ),
      )
    }
    this.#listBox.replaceChildren(list)
    // After the list exists: the route usually arrives before the first
    // render (the router starts before the nav is mounted), so this is where
    // the default actually finds a group to unfold.
    this.#applyDefaultOpen()
    this.#highlight()
  }

  // One docs zone, in declaration order. A failed manifest replaces the top
  // one: an empty section would read as "this API has no guides", which is a
  // different statement from "the guides could not be fetched" — and it is
  // reported where the docs are expected, not at the foot of the nav.
  #docsItems(zone) {
    if (this.#docsError && zone === 'top') {
      const alert = el(
        'p',
        'alert alert-error alert-soft text-xs mx-2 my-1',
        text(t('nav.docsError', { url: this.#docsError })),
      )
      return [el('li', 'pointer-events-none', alert)]
    }
    const items = []
    for (const entry of docsZoneEntries(this.#docs, zone)) {
      if (entry.kind === 'page') items.push(this.#docsPageItem(entry))
      else if (entry.kind === 'link') items.push(this.#docsLinkItem(entry))
      else if (entry.kind === 'group') {
        const group = this.#docsGroupItem(entry)
        if (group) items.push(group)
      }
    }
    // Last in the top zone: it is the index of everything above it, and of the
    // reference below. On a document with no docs pages it stands alone under
    // the heading, which is still what it is — the documentation, in the one
    // form an agent reads.
    if (this.#llmsText && zone === 'top') items.push(this.#llmsTextItem())
    return items
  }

  #firstCallItem() {
    const link = el(
      'a',
      'flex items-center gap-2 w-full min-w-0',
      icon(SEND_SVG, 'text-subtle shrink-0'),
      el('span', 'grow min-w-0 truncate', text(t('nav.firstCall'))),
    )
    link.href = firstCallHash()
    link.dataset.firstCall = ''
    return el('li', 'max-w-full', link)
  }

  #overviewItem() {
    const link = el(
      'a',
      'flex items-center gap-2 w-full min-w-0',
      // The glyph is what makes this read as a row rather than as a second
      // section title: it is the only entry in the reference zone with neither
      // a count badge nor a method badge to anchor it.
      icon(SPEC_DOC_SVG, 'text-subtle shrink-0'),
      el('span', 'grow min-w-0 truncate', text(t('nav.overview'))),
    )
    link.href = overviewHash()
    link.dataset.overview = ''
    return el('li', 'max-w-full', link)
  }

  #docsPageItem(page) {
    const link = el(
      'a',
      'flex items-center gap-2 w-full min-w-0',
      el('span', 'grow min-w-0 truncate', text(page.title)),
    )
    link.href = page.slug === this.#homeSlug ? homeHash() : pageHash(page.slug)
    link.dataset.pageSlug = page.slug
    return el('li', 'max-w-full', link)
  }

  #docsLinkItem(entry) {
    const link = externalLink(
      'flex items-center gap-2 w-full min-w-0',
      entry.href,
      el('span', 'grow min-w-0 truncate', text(entry.title)),
      icon(EXTERNAL_SVG_SM, 'text-subtle shrink-0'),
      // The icon is decorative; the fact that the link leaves the page has to
      // reach the accessible name, hence the visually hidden suffix (§8).
      el('span', 'sr-only', text(` ${t('nav.externalLink')}`)),
    )
    link.title = entry.href
    return el('li', 'max-w-full', link)
  }

  // A download, not a route: the file is generated in the browser and there is
  // no page to navigate to. Hence a button — the entry has no href a reader
  // could copy, and pretending otherwise with an anchor would be a broken link
  // in a nav made of real ones.
  #llmsTextItem() {
    // The label IS the file name, in both languages — but it goes through
    // `t()` like every other string (rule 9): a key nobody translates is
    // cheaper than an exception to the rule that has to be argued forever.
    const label = el('span', 'grow min-w-0 truncate font-mono', text(t('nav.llmsText')))
    const entry = el(
      'button',
      'flex items-center gap-2 w-full min-w-0',
      icon(IMPORT_SVG, 'text-subtle shrink-0'),
      label,
    )
    entry.type = 'button'
    entry.dataset.llmsText = ''
    entry.title = t('nav.llmsTextHint')
    entry.addEventListener('click', async () => {
      entry.disabled = true
      try {
        downloadText('llms.txt', await this.#llmsText())
      } finally {
        entry.disabled = false
      }
    })
    return el('li', 'max-w-full', entry)
  }

  #docsGroupItem(group) {
    if (!group.entries.length) return null
    const sub = el('ul', 'max-w-full')
    for (const child of group.entries) {
      sub.append(child.kind === 'link' ? this.#docsLinkItem(child) : this.#docsPageItem(child))
    }
    const summary = el('summary', 'font-medium', el('span', 'truncate', text(group.title)))
    const details = el('details', 'max-w-full', summary, sub)
    details.dataset.docsGroup = group.id
    // Same rule as the reference tags: the group holding the active page is
    // open whatever its declared state, and stays manually collapsible after.
    const holdsActive = group.entries.some(
      (child) => child.kind === 'page' && child.slug === this.#activePage,
    )
    details.open = (this.#docsGroupOpen.get(group.id) ?? !group.collapsed) || holdsActive
    details.addEventListener('toggle', () => this.#docsGroupOpen.set(group.id, details.open))
    return el('li', 'max-w-full', details)
  }

  // "Scenarios" section (§5.1), in two states. No scenario: a single item,
  // which CREATES instead of listing — a section reduced to its two utility
  // items used to sit prominently at the top of the nav for an API that
  // declares none, plenty of space for nothing to do. From the first
  // scenario on, the full section shows.
  #scenarioSection() {
    if (!this.#scenariosEnabled) return []
    if (!this.#scenarios.length) {
      const entry = el(
        'button',
        'flex items-center gap-2 w-full min-w-0',
        scenarioIcon('start'),
        el('span', 'grow min-w-0 truncate', text(t('nav.scenariosSection'))),
      )
      entry.type = 'button'
      entry.dataset.scenarioStart = ''
      // The label names the destination, the tooltip says what the click does:
      // "Scenarios" doesn't hint that clicking will create one.
      entry.title = t('nav.scenariosStartHint')
      entry.addEventListener('click', () => this.onNewScenario?.())
      return [el('li', 'max-w-full', entry)]
    }
    return [sectionTitle(t('nav.scenariosSection')), ...this.#scenarioItems()]
  }

  #scenarioItems() {
    const items = this.#scenarios.map((scenario) => {
      const link = el(
        'a',
        'flex items-center gap-2 w-full min-w-0',
        scenarioIcon(scenario.source),
        el('span', 'grow min-w-0 truncate', text(scenario.title || scenario.id)),
      )
      link.href = scenarioHash(scenario.id)
      link.dataset.scenarioId = scenario.id
      return el('li', 'max-w-full', link)
    })
    const create = el(
      'button',
      'flex items-center gap-2 w-full min-w-0 text-primary',
      text(t('scenario.new')),
    )
    create.type = 'button'
    create.addEventListener('click', () => this.onNewScenario?.())
    // File import is not offered here: the empty-scenario button and the
    // Export menu of a scenario page cover it (docs/scenarios.md §5.1).
    return [...items, el('li', 'max-w-full', create)]
  }

  #dotFor(opId) {
    return changeDot(this.#changes?.[opId]?.status)
  }

  // A collapsed group must indicate it's hiding something new. 'changed'
  // takes precedence over 'added': a modified contract demands more
  // attention than an endpoint that didn't exist before.
  #groupDot(ops) {
    if (!this.#changes) return null
    const statuses = ops.map((op) => this.#changes[op.id]?.status).filter(Boolean)
    if (!statuses.length) return null
    const dot = changeDot(
      statuses.includes('changed') ? 'changed' : 'added',
      t('changelog.mark.group', { count: statuses.length }),
    )
    // The children of a DaisyUI menu summary are laid out in a grid whose
    // cells stretch (cf. the count pill below).
    dot.classList.add('justify-self-start', 'self-center')
    return dot
  }

  // Last selection brought into the visible area: the scroll doesn't replay
  // on re-renders as long as the route doesn't change — the user
  // stays in control of their scroll within the nav.
  #scrolledKey = null

  #highlight() {
    // One row per route type the nav can point at: a sixth is a line here
    // rather than a sixth loop nobody remembers to add.
    const marks = [
      ['[data-op-id]', (link) => link.dataset.opId === this.#activeId],
      ['[data-page-slug]', (link) => link.dataset.pageSlug === this.#activePage],
      ['[data-scenario-id]', (link) => link.dataset.scenarioId === this.#activeScenario],
      ['[data-overview]', () => this.#activeOverview],
      ['[data-first-call]', () => this.#activeFirstCall],
    ]
    for (const [selector, isActive] of marks) {
      for (const link of this.querySelectorAll(selector)) {
        link.classList.toggle('menu-active', isActive(link))
      }
    }
    // A selection coming from elsewhere (palette, deep-link, history) can
    // point to an endpoint outside the nav's visible area: we bring it into view.
    const key = this.#activeId
      ? `op:${this.#activeId}`
      : this.#activePage
        ? `page:${this.#activePage}`
        : null
    if (!key) {
      this.#scrolledKey = null
      return
    }
    if (key === this.#scrolledKey) return
    const link = this.#activeId
      ? this.querySelector(`[data-op-id="${CSS.escape(this.#activeId)}"]`)
      : this.querySelector(`[data-page-slug="${CSS.escape(this.#activePage)}"]`)
    if (link) {
      revealInScroller(link)
      this.#scrolledKey = key
    }
  }
}

// `scrollIntoView({ block: 'nearest' })` by hand, because the real one has a
// side effect Chromium alone applies: it moves the sequential focus navigation
// starting point onto what it scrolled. The nav auto-scrolls on every selection
// that did not come from a click in it — a deep link above all — and the reader
// who then presses Tab for the first time lands in the middle of the endpoint
// list, past the skip link and past the whole header, with no action of theirs
// to explain it (WCAG 2.4.3). Scrolling the scrollport instead moves nothing
// but the scroll.
// `scroll-padding` is read rather than ignored: the nav's own search bar is
// sticky at the top of that scrollport, and an entry aligned flush with it is
// an entry hidden behind it (WCAG 2.4.11).
function revealInScroller(node) {
  let scroller = node.parentElement
  while (scroller) {
    const overflow = getComputedStyle(scroller).overflowY
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      scroller.scrollHeight > scroller.clientHeight
    )
      break
    scroller = scroller.parentElement
  }
  if (!scroller) return
  const style = getComputedStyle(scroller)
  const box = node.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  const top = view.top + (parseFloat(style.scrollPaddingTop) || 0)
  const bottom = view.bottom - (parseFloat(style.scrollPaddingBottom) || 0)
  if (box.top < top) scroller.scrollTop -= top - box.top
  else if (box.bottom > bottom) scroller.scrollTop += box.bottom - bottom
}

// Two scenario sources, two icons: provided by the docs (book) or created
// here (pencil) — the latter is the fallback below.
const SCENARIO_ICONS = { config: SCENARIO_CONFIG_SVG, start: SCENARIO_START_SVG }

function scenarioIcon(source) {
  return icon(SCENARIO_ICONS[source] ?? SCENARIO_LOCAL_SVG, 'text-subtle shrink-0')
}

function sectionTitle(label) {
  return el('li', 'menu-title uppercase text-label', text(label))
}

if (!customElements.get('api-nav')) customElements.define('api-nav', ApiNav)
