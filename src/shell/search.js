// Search palette (Cmd/Ctrl+K): the element, its index and the global
// shortcut that opens it.
import { splitSections } from '../docs/sections.js'
import { buildSearchIndex } from '../search/index.js'
import { loadDocsPageTexts } from './docs.js'

// Every docs page split into sections, tagged with the page it came from.
async function docsSections(pages) {
  return (await loadDocsPageTexts(pages)).flatMap(({ page, text, format }) =>
    splitSections(text, format).map((section) => ({
      ...section,
      slug: page.slug,
      pageTitle: page.title,
    })),
  )
}

// → { node, rebuild, open }. `scenarios` is a callback, and `rebuild` is
// exposed, for the same reason: the index is a snapshot, not a subscription.
// Local scenarios arrive from an asynchronous IndexedDB read and the caller
// replaces its list rather than mutating it, so a captured array would go
// stale on the first change.
export function createSearchPalette({ model, pages, scenarios }) {
  const node = document.createElement('search-palette')
  // Page CONTENT is indexed on the first open, not at boot (§6): the cost is
  // one fetch per page, and a session that never searches must not pay it.
  // In memory only, rebuilt per session and per language — which is what
  // satisfies rule 13 here, by construction.
  let sections = []
  let indexed = false
  // The operation index follows the same rule as the page content below: paid
  // on the first open, never at boot — walking 1220 operations' properties is
  // real time on the boot path of a session that may never search (rule 14).
  // `stale` covers the callers of `rebuild` too: they invalidate, the next
  // open rebuilds, which is the "snapshot, not subscription" contract above.
  let stale = true
  const build = () => {
    node.index = buildSearchIndex(model, pages, scenarios(), sections)
    stale = false
  }
  const rebuild = () => {
    stale = true
  }
  const open = () => {
    // The palette opens on titles immediately; the content index replaces it
    // in place when it lands, however long the fetches take.
    if (!indexed) {
      indexed = true
      docsSections(pages).then((built) => {
        sections = built
        // Applied directly: the palette is open (an open() got us here), and
        // the whole point of the fetch is to upgrade the visible results.
        build()
      })
    }
    if (stale) build()
    node.open()
  }
  window.addEventListener('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'k'
    ) {
      event.preventDefault()
      open()
    }
  })
  return { node, rebuild, open }
}
