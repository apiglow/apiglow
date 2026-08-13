import { toDocsPageMarkdown } from '../export/docs-page-markdown.js'
import { t } from '../i18n/index.js'
import { pageHash } from '../router.js'
import { announce } from './a11y.js'
import { copyPageMenu } from './copy-page-menu.js'
import {
  decorateCallouts,
  decorateCodeHeaders,
  decorateCodeTabs,
  interpolateVariables,
  plainText,
} from './docs-content.js'
import { docsPageSourceLabel, loadDocsPageSource } from './docs-source.js'
import { el, scrollToAnchor, text } from './dom.js'
import { decorateHeadings, docsMarkdownBlock, highlightCode, htmlBlock } from './markdown.js'
import { pagerSection } from './pager.js'

// A docs page (docs/docs-pages.md §4–§5): the markdown pipeline, then the page
// chrome every page carries — a table of contents and prev/next links, the
// home takeover included.
class MdPage extends HTMLElement {
  #page = null
  #anchor = null
  #pager = null
  #feedback = null
  #sections = null
  #tracking = null
  #presetActive = null
  #vars = null
  #onManageEnv = null
  // Undo of the last variable walk (§12.2): a re-walk restores the pristine
  // text nodes first, so it never chews on its own output.
  #restoreVars = null
  #content = null
  // The body behind what is on screen, kept for the "Copy page" menu: the page
  // the reader takes away is the one they are reading, and re-asking for it
  // would be a second fetch of a text this element already holds.
  #source = null
  #copySlot = null
  #llmsFullExport = null
  #mcp = null
  // What is currently on screen, identified by where its body came from — a
  // page carried by the host has no URL to compare.
  #rendered = null

  set page(page) {
    // Same page, new anchor — a ToC entry, a ¶ link, a search result: all of
    // those route through here, and re-parsing, re-sanitizing and
    // re-highlighting a page already on screen to scroll it is the most
    // expensive way to do nothing.
    const same =
      this.#page?.slug === page?.slug && page && this.#rendered === docsPageSourceLabel(page)
    this.#page = page
    if (this.isConnected && !same) this.#render()
  }

  // { prev, next } from the flattened nav order, resolved by the shell —
  // groups flatten, external links skip. Set before `page`, which renders.
  set pager(pager) {
    this.#pager = pager ?? null
  }

  // { url } when the host declared `feedback.url`, null otherwise — set once
  // by the shell (rule 10), before any page renders.
  set feedback(feedback) {
    this.#feedback = feedback ?? null
  }

  // The whole-API half of the "Copy page" menu (docs/architecture.md §5.14.1),
  // wired by the shell like the endpoint doc's: the async llms-full.txt
  // provider, and a provider of the MCP context — a provider, because its base
  // URL follows the selected environment and this element does not re-render
  // when that changes.
  set llmsFullExport(provider) {
    this.#llmsFullExport = provider ?? null
  }

  set mcp(provider) {
    this.#mcp = provider ?? null
  }

  // The one source a `{{var}}` resolves against (§12): the environment under
  // the host credential overlay, exactly what the try-it reads. Set once by the
  // shell; its `change` covers an environment switch, a variable edit and a
  // host `setCredentials` push alike.
  set variables(source) {
    this.#vars = source
    // Detached, the page is about to be re-rendered from scratch on its next
    // connection: walking a tree nobody is looking at would be work for the
    // bin.
    source.addEventListener('change', () => {
      if (!this.isConnected) return
      this.#interpolate()
      // The MCP install links carry the environment's base URL: built once,
      // they would keep registering whichever environment was selected when
      // the page happened to render.
      this.#buildCopyMenu()
    })
  }

  // Null under `environmentsLocked` — no manager, so a missing-variable chip
  // signals without offering (§12.1).
  set onManageEnv(open) {
    this.#onManageEnv = open ?? null
  }

  set anchor(anchor) {
    this.#anchor = anchor
    this.#scrollToAnchor()
  }

  connectedCallback() {
    this.classList.add('block')
    if (this.#page) this.#render()
  }

  disconnectedCallback() {
    this.#sections?.disconnect()
    this.#sections = null
    this.#tracking?.abort()
    this.#tracking = null
    this.#presetActive = null
  }

  async #render() {
    const page = this.#page
    // The observer watches the outgoing tree; the new one is wired after the
    // page lands (and never, if the load fails — there is nothing to track).
    this.#sections?.disconnect()
    this.#sections = null
    this.#tracking?.abort()
    this.#tracking = null
    this.#presetActive = null
    const source = docsPageSourceLabel(page)
    if (this.#rendered !== source) {
      this.replaceChildren(
        el(
          'div',
          'flex items-center gap-2 py-8',
          el('span', 'loading loading-spinner'),
          el('span', '', text(t('app.loading'))),
        ),
      )
    }
    try {
      const { text: body, format } = await loadDocsPageSource(page)
      if (this.#page !== page) return // navigation happened in the meantime
      // Escaped text in a <pre> for a `.txt`, and nothing else: it has no
      // headings to anchor, no structure to build a ToC from, and no language
      // for the highlighter to guess at. Its prev/next still applies — that
      // comes from the nav, not from the file.
      const content =
        format === 'text'
          ? el('div', 'md-content', el('pre', 'whitespace-pre-wrap', el('code', '', text(body))))
          : format === 'html'
            ? htmlBlock(body)
            : (docsMarkdownBlock(body) ?? el('div'))
      // The timeline treatment (§4.5) is a class, and CSS does the rest: it
      // applies to whatever has h2s to style — a `.txt` has none.
      if (page.changelog && format !== 'text') content.classList.add('md-changelog')
      // Order matters only in that the anchors and the highlighting must run
      // on the final tree: a callout moves its paragraphs into a new box, and
      // a tab group hides all but one <pre>.
      if (format === 'markdown') {
        decorateCallouts(content)
        decorateCodeTabs(content)
        decorateCodeHeaders(content)
      }
      if (format !== 'text') {
        decorateHeadings(content, (id) => pageHash(page.slug, id))
        highlightCode(content)
      }
      // Last, and markdown-only (§12.3): heading ids are already assigned, so a
      // deep link never depends on the reader's environment, and an author who
      // wrote HTML owns their own markup.
      this.#content = format === 'markdown' ? content : null
      this.#restoreVars = null
      this.#source = { text: body, format }
      this.#copySlot = el('div', 'flex justify-end mb-2')
      // After the chrome, not before: the first pass then walks the same tree
      // every later one does, and the table of contents is caught up by the
      // same `#refreshToc` instead of by being built late enough to be right.
      this.replaceChildren(
        pageChrome(content, page.slug, this.#pager, this.#feedback, this.#copySlot),
      )
      this.#buildCopyMenu()
      this.#interpolate()
      this.#rendered = source
      this.#trackActiveSection()
      this.#scrollToAnchor()
    } catch (err) {
      if (this.#page !== page) return
      console.error('[api-doc] page load failed:', err)
      this.#rendered = null
      this.#content = null
      this.#restoreVars = null
      this.#source = null
      this.#copySlot = null
      const alert = el(
        'div',
        'alert alert-error',
        el('span', '', text(t('page.error', { url: source }))),
      )
      alert.setAttribute('role', 'alert')
      this.replaceChildren(alert)
    }
  }

  // The same hand-off menu as the endpoint doc, over this page's own source.
  // Rebuilt rather than patched: the items are built once from the values they
  // close over, which is exactly what makes the endpoint's version re-render.
  #buildCopyMenu() {
    if (!this.#copySlot || !this.#source) return
    const page = this.#page
    this.#copySlot.replaceChildren(
      copyPageMenu({
        markdown: () => toDocsPageMarkdown({ title: page.title, ...this.#source }),
        title: page.title,
        filename: `${page.slug}.md`,
        promptKey: 'doc.llmPromptPage',
        llmsFullExport: this.#llmsFullExport,
        mcp: this.#mcp,
      }),
    )
  }

  // The `{{var}}` walk (§12.2), re-runnable: undo first, so the second pass
  // starts from the pristine render and idempotence is not left to luck.
  #interpolate() {
    if (!this.#content) return
    this.#restoreVars?.()
    this.#restoreVars = this.#vars
      ? interpolateVariables(this.#content, {
          variables: this.#vars.for(),
          onManageEnv: this.#onManageEnv,
        })
      : null
    this.#refreshToc()
  }

  // A heading holding a reference reads differently once resolved, and the ToC
  // quotes the heading. Rendered twice (aside and dropdown) for headings that
  // mostly hold no reference at all, so only the labels that moved are written.
  #refreshToc() {
    const labels = new Map(tocEntries(this.#content).map((entry) => [entry.id, entry.label]))
    for (const link of this.querySelectorAll('a[data-toc-id]')) {
      const label = labels.get(link.dataset.tocId)
      if (label !== undefined && link.textContent !== label) link.textContent = label
    }
  }

  #scrollToAnchor() {
    // After render only — otherwise retried on the next #render.
    scrollToAnchor(this, this.#anchor)
    // A deep link or a ToC click names the section the reader is in; the
    // observer alone cannot always agree, because a heading near the bottom of
    // a short page never reaches the activation zone.
    if (this.#anchor) this.#presetActive?.(this.#anchor)
  }

  // ToC active tracking (§5): the section being read is the deepest heading
  // inside the top slice of the viewport. When none is there — a long section
  // fills the screen — it is the last one that was, unless that heading left
  // through the BOTTOM of the slice, which means the reader scrolled back up
  // into the previous section.
  #trackActiveSection() {
    const links = [...this.querySelectorAll('a[data-toc-id]')]
    const headings = [...this.querySelectorAll('.md-content h2[id], .md-content h3[id]')]
    if (!links.length || !headings.length) return
    let active = -1
    const apply = (index) => {
      if (index === active) return
      active = index
      const id = headings[index]?.id
      for (const link of links) {
        const on = link.dataset.tocId === id
        link.classList.toggle('md-toc-active', on)
        if (on) link.setAttribute('aria-current', 'true')
        else link.removeAttribute('aria-current')
      }
    }
    // A section the reader NAMED — a ToC click, a deep link — stays named until
    // they move. The observer's next delivery is a consequence of the scroll we
    // just made ourselves, and on a heading too short to ever reach the
    // activation zone it would take the highlight straight back off the entry
    // that was just clicked. Released on an intent to scroll, never on `scroll`
    // itself: the smooth scroll we started fires those too.
    let pinned = false
    this.#tracking?.abort()
    const tracking = new AbortController()
    this.#tracking = tracking
    for (const event of ['wheel', 'touchmove', 'keydown']) {
      window.addEventListener(
        event,
        () => {
          pinned = false
        },
        { passive: true, signal: tracking.signal },
      )
    }
    this.#presetActive = (id) => {
      const index = headings.findIndex((heading) => heading.id === id)
      if (index < 0) return
      apply(index)
      pinned = true
    }
    const inZone = new Set()
    this.#sections = new IntersectionObserver(
      (entries) => {
        let fallback = active
        for (const entry of entries) {
          const index = headings.indexOf(entry.target)
          if (index < 0) continue
          if (entry.isIntersecting) inZone.add(index)
          else {
            inZone.delete(index)
            if (
              index === fallback &&
              entry.boundingClientRect.top >= (entry.rootBounds?.bottom ?? 0)
            ) {
              fallback = index - 1
            }
          }
        }
        // The zone bookkeeping is kept up to date even while pinned: the first
        // delivery after the reader takes over must reason about where they
        // now are, not about where they were before the click.
        if (!pinned) apply(inZone.size ? Math.max(...inZone) : fallback)
      },
      // The activation zone is the top quarter of the viewport: past its
      // bottom a heading is only "coming up" — a wider zone would hand the
      // position to a section the reader has not reached yet whenever two
      // short sections share the screen.
      { rootMargin: '0px 0px -75% 0px' },
    )
    for (const heading of headings) this.#sections.observe(heading)
  }
}

// Content column + the chrome pieces (§5). A format with no headings —
// `.txt` — yields no ToC entries and so gets no ToC, without having to say so.
function pageChrome(content, slug, pager, feedback, copySlot) {
  const entries = tocEntries(content)
  const column = el(
    'div',
    'min-w-0 flex-1 max-w-3xl',
    // Above everything, aligned end: the page's own h1 comes from the markdown,
    // so there is no header to hang the menu off the way the endpoint doc does.
    copySlot,
    entries.length ? tocDropdown(entries, slug) : null,
    content,
    feedback ? feedbackRow(feedback, slug) : null,
    docsPager(pager),
  )
  return el(
    'div',
    'flex items-start gap-8',
    column,
    entries.length ? tocAside(entries, slug) : null,
  )
}

// h2/h3 only: h1 is the page title, and h4 and below are detail the reader
// already found by the time they matter.
function tocEntries(content) {
  return [...content.querySelectorAll('h2[id], h3[id]')].map((heading) => ({
    id: heading.id,
    // The ¶ anchor decorateHeadings appended is not part of the label, and a
    // variable chip is quoted for what it stands for — `textContent` would put
    // the mask's dots in the table of contents.
    label: [...heading.childNodes]
      .filter(
        (node) => !(node.nodeType === Node.ELEMENT_NODE && node.classList.contains('md-anchor')),
      )
      .map((node) => plainText(node))
      .join('')
      .trim(),
    depth: heading.tagName === 'H3' ? 1 : 0,
  }))
}

function tocList(entries, slug) {
  const list = el('ul', 'menu menu-sm w-full px-0 gap-0')
  for (const entry of entries) {
    const link = el('a', entry.depth ? 'ps-6 truncate' : 'truncate', text(entry.label))
    link.href = pageHash(slug, entry.id)
    link.dataset.tocId = entry.id
    list.append(el('li', 'max-w-full', link))
  }
  return list
}

function tocAside(entries, slug) {
  const nav = el(
    'nav',
    'hidden xl:block w-56 shrink-0 sticky top-0 max-h-[80vh] overflow-y-auto',
    el('p', 'text-label uppercase text-subtle px-2 pb-1', text(t('page.toc'))),
    tocList(entries, slug),
  )
  nav.setAttribute('aria-label', t('page.toc'))
  return nav
}

// Below xl there is no room for a column, and a permanently expanded list
// would push the prose off the first screen: same content, folded.
function tocDropdown(entries, slug) {
  const details = el(
    'details',
    'xl:hidden mb-4 rounded-box border border-base-300',
    el('summary', 'px-3 py-2 text-sm font-medium cursor-pointer', text(t('page.toc'))),
    el('div', 'px-1 pb-2', tocList(entries, slug)),
  )
  const nav = el('nav', 'xl:hidden', details)
  nav.setAttribute('aria-label', t('page.toc'))
  return nav
}

// "Was this page useful?" (docs/docs-pages.md §5): rendered only when the host
// declared `feedback.url` — no backend of our own, so absent config means
// absent widget. The verdict names the page by its slug, not its URL: the
// route is the page's identity, files and carried bodies move.
function feedbackRow(feedback, slug) {
  const outcome = el('span', 'text-sm')
  const buttons = [
    { verdict: 'up', label: t('page.feedback.yes') },
    { verdict: 'down', label: t('page.feedback.no') },
  ].map(({ verdict, label }) => {
    const button = el('button', 'btn btn-sm', text(label))
    button.type = 'button'
    button.dataset.feedbackVerdict = verdict
    return button
  })
  const send = async (verdict) => {
    for (const button of buttons) button.disabled = true
    outcome.textContent = ''
    outcome.classList.remove('text-error')
    try {
      const response = await fetch(feedback.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page: slug, verdict }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      // One verdict per rendering: the buttons go, the thanks stays.
      for (const button of buttons) button.remove()
      outcome.textContent = t('page.feedback.thanks')
      announce(t('page.feedback.thanks'))
    } catch {
      for (const button of buttons) button.disabled = false
      outcome.textContent = t('page.feedback.error')
      outcome.classList.add('text-error')
      announce(t('page.feedback.error'))
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => send(button.dataset.feedbackVerdict))
  }
  const row = el(
    'div',
    'mt-section flex flex-wrap items-center gap-3 border-t border-base-300 pt-block',
    el('span', 'text-sm text-subtle', text(t('page.feedback.question'))),
    ...buttons,
    outcome,
  )
  row.dataset.feedback = ''
  return row
}

const PAGER_LABELS = { prev: 'page.prev', next: 'page.next', section: 'page.pager' }

function docsPager(pager) {
  const slot = (page) =>
    page && { href: pageHash(page.slug), label: page.title, dataset: { pagerSlug: page.slug } }
  return pagerSection({ prev: slot(pager?.prev), next: slot(pager?.next) }, PAGER_LABELS)
}

if (!customElements.get('md-page')) customElements.define('md-page', MdPage)
