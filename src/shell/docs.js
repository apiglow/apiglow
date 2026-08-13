// The impure half of the docs pages: fetching. The manifest form of
// `docsPages` (docs/docs-pages.md §2.2) and the page bodies the exports and
// the search index read. Everything these yield goes straight back into the
// pure modules (src/docs/*), which is why nothing here transforms content.
import { docsPageSourceLabel, loadDocsPageSource } from '../components/docs-source.js'
import { manifestPages } from '../docs/pages.js'

async function loadManifest(url) {
  const base = new URL(url, window.location.href).href
  const response = await fetch(base)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return manifestPages(await response.json(), base)
}

// → { root, spec, error }, or **null** when neither side names a manifest:
// inline arrays need no fetch and the caller's config is already correct.
// `error` is the URL that failed — a manifest that doesn't load surfaces a
// visible nav-level error rather than an empty section, and the reference nav
// stays intact either way.
export async function loadDocsSources({ root, spec }) {
  if (typeof root !== 'string' && typeof spec !== 'string') return null
  let error = null
  const resolve = async (value, label) => {
    if (typeof value !== 'string') return Array.isArray(value) ? value : []
    try {
      return await loadManifest(value)
    } catch (err) {
      console.error(`[api-doc] docsPages manifest (${label}) failed:`, value, err)
      error ??= value
      return []
    }
  }
  const [rootPages, specPages] = await Promise.all([resolve(root, 'root'), resolve(spec, 'spec')])
  return { root: rootPages, spec: specPages, error }
}

// Every declared page's body and format → [{ page, text, format }]. A page
// carried by the host costs nothing; a fetched one goes through the shared
// cache, so a page the reader already opened is not downloaded again.
//
// One skip policy for both consumers (the llms-full export and the search
// index): an unreachable page is logged and dropped, never allowed to fail the
// whole operation. They differ only in what they do with the text.
export async function loadDocsPageTexts(pages) {
  const loaded = await Promise.all(
    pages.map(async (page) => {
      try {
        return { page, ...(await loadDocsPageSource(page)) }
      } catch (err) {
        console.error('[api-doc] docs page skipped:', docsPageSourceLabel(page), err)
        return null
      }
    }),
  )
  return loaded.filter(Boolean)
}
