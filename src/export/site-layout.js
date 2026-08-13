// Where a baked page lives and what URL it answers at (docs/seo.md §4). One
// module, because three readers depend on the same convention: `sitemap.js`
// lists the pages, the llms exports link them, and the bake writes them — a
// layout decided twice is a sitemap pointing at files nobody wrote.
//
// The tree mirrors the app's own routes, multi-spec prefix included
// (`s/{specId}/op/…` for `#/s/{specId}/op/…`), so a reader who sees both
// addresses reads one arrangement.

// A file name that can only ever be a file name. `operationId` and a docs page
// `slug` are strings their author chose freely — the OpenAPI specification
// constrains neither — and one holding `/` or `..` would name a file outside
// the tree it belongs to. Ids that were already file names, which is nearly
// all of them, travel unchanged; the hash is what keeps two ids that sanitize
// alike from claiming one file.
const UNSAFE = /[^A-Za-z0-9._-]+/g

function hash32(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function fileSlug(id) {
  const raw = String(id ?? '')
  const safe = raw.replace(UNSAFE, '-').replace(/^[-.]+|[-.]+$/g, '')
  if (safe === raw) return raw
  return `${safe || 'x'}-${hash32(raw)}`
}

// The host page's own URL, hash and query stripped: what a `#/op/…` link is
// built on, and the address the snapshots send a reader back to.
export function siteBase(siteUrl) {
  return String(siteUrl ?? '').split(/[#?]/)[0]
}

// The directory the baked tree is deposited in — next to the host page, which
// is where `llms.txt` already expects its siblings to be served from. A URL
// ending in `/` already names it; anything else names the page inside it.
export function siteRoot(siteUrl) {
  const base = siteBase(siteUrl)
  return base.slice(0, base.lastIndexOf('/') + 1)
}

// `target`: { kind: 'op' | 'page' | 'scenario' | 'overview', id, specId }.
// Webhooks share the `op` kind because they share the `#/op/…` route — one
// namespace in the app, one directory here.
export function bakedPath(target, ext = 'html') {
  const { kind, id = '', specId = '' } = target ?? {}
  const dir = specId ? `s/${specId}/` : ''
  if (kind === 'overview') return `${dir}overview.${ext}`
  return `${dir}${kind}/${fileSlug(id)}.${ext}`
}

// The extension a published Arazzo recipe answers at
// (docs/scenario-handoff.md §3.4): `.arazzo.json` is a convention an agent
// should not have to guess, and the served form is JSON whatever the document
// was authored in.
export const RECIPE_EXT = 'arazzo.json'

export function bakedUrl(siteUrl, target, ext = 'html') {
  return `${siteRoot(siteUrl)}${bakedPath(target, ext)}`
}

// The URL mapper the llms exports take: `.md` for the mirrors an agent fetches
// (llmstxt.org convention), `.html` for the pages a human opens. Handed in by
// the bake — without one, there is nothing served to point at and the exports
// keep their hash routes.
export function bakedUrls(siteUrl, { specId = '', ext = 'md' } = {}) {
  const at = (kind, id) => bakedUrl(siteUrl, { kind, id, specId }, ext)
  return {
    op: (id) => at('op', id),
    page: (slug) => at('page', slug),
    scenario: (id) => at('scenario', id),
  }
}
