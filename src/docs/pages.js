// Docs pages (docs/docs-pages.md §2): the prose side of the documentation.
// The host declares an ordered array — pages, one level of groups, external
// links — or a URL pointing at a manifest holding the same array.
//
// Pure module: the shell fetches the manifest and hands the raw arrays over,
// so everything below is normalization, merge and resolution — testable
// without a network or a DOM.

import { slugify } from '../openapi/model.js'

// --- i18n'd fields (§2.3) --------------------------------------------------

// A field accepting a string or a per-language map. Kept in its declared form
// through normalization and the multi-spec merge, both of which are
// language-agnostic: resolution happens once afterwards, in
// `resolveDocsOutline`.
function i18nField(raw) {
  if (typeof raw === 'string') return raw.trim() ? raw : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const map = {}
  for (const [lang, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim()) map[lang] = value
  }
  return Object.keys(map).length ? map : null
}

// Current UI language → `en` → first declared key. A plain string means "same
// in every language", which keeps the monolingual case free of ceremony.
export function resolveI18n(value, lang = 'en') {
  if (typeof value === 'string') return value.trim() ? value : null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return (
    [value[lang], value.en, ...Object.values(value)].find(
      (candidate) => typeof candidate === 'string' && candidate.trim(),
    ) ?? null
  )
}

// --- manifest URL rebasing (§2.2) -----------------------------------------

function absolute(url, base) {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

function rebaseField(value, base) {
  if (typeof value === 'string') return absolute(value, base)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([lang, url]) => [
      lang,
      typeof url === 'string' ? absolute(url, base) : url,
    ]),
  )
}

// Relative `url`s inside a manifest resolve against the manifest's own URL, so
// a docs folder is self-contained: the host page names one file, and the
// folder can be versioned, moved or generated independently of index.html.
// Runs on RAW entries, before normalization — the manifest is the only place
// the base differs from the host page.
export function rebaseDocsUrls(entries, base) {
  if (!Array.isArray(entries)) return []
  if (!base) return entries
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    if (Array.isArray(entry.pages)) return { ...entry, pages: rebaseDocsUrls(entry.pages, base) }
    if (entry.url === undefined) return entry
    return { ...entry, url: rebaseField(entry.url, base) }
  })
}

// The manifest envelope (docs/docs-pages.md §2.2), once the caller has the
// bytes: the app fetches them and the bake reads them off disk, and the shape
// they agree on is written here so the two cannot drift into baking a page set
// the app does not render.
//
// Top-level object rather than a bare array: it leaves room for future fields,
// and a bare array here is a manifest written against the wrong shape, not an
// alternative form. `base` is the manifest's own address — what its relative
// page urls resolve against, and what makes a docs folder movable in one piece.
export function manifestPages(data, base) {
  if (!Array.isArray(data?.pages)) throw new Error('manifest has no "pages" array')
  return rebaseDocsUrls(data.pages, base)
}

// --- normalization (§2.1) --------------------------------------------------

const ZONES = new Set(['top', 'bottom'])

// Which side of the API reference an entry sits on (§2.7). A top-level choice
// only: a group travels as a whole, so a page declaring its own zone from
// inside one is asking to be torn out of the group it was put in.
function navZone(raw, warnings, path, topLevel) {
  if (raw.nav === undefined) return 'top'
  const value = typeof raw.nav === 'string' ? raw.nav.trim().toLowerCase() : ''
  if (!topLevel) {
    warnings.push(`${path}: "nav" is a top-level choice, ignored inside a group`)
    return 'top'
  }
  if (ZONES.has(value)) return value
  warnings.push(`${path}: unknown nav "${raw.nav}", ignored`)
  return 'top'
}

function normalizePageEntry(raw, warnings, path, topLevel) {
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : ''
  // Three ways to declare a body (§2.6), in that precedence order — the same
  // order `openapi.spec` takes over `openapi.url`: what the page already
  // carries beats what it would have to go and fetch.
  const content = i18nField(raw.content)
  const contentId = i18nField(raw.contentId)
  const url = i18nField(raw.url)
  if (!slug || !(content || contentId || url)) {
    warnings.push(
      `${path}: page dropped, "slug" and one of "content"/"contentId"/"url" are required`,
    )
    return null
  }
  const format = docsFormat(raw.format)
  if (raw.format !== undefined && !format) {
    warnings.push(`${path}: unknown format "${raw.format}", ignored`)
  }
  // `kind: 'changelog'` opts the page into the timeline treatment (§4.5).
  // Same stance as `format`: a kind naming nothing is dropped with a warning
  // rather than silently honoured.
  const changelog = raw.kind === 'changelog'
  if (raw.kind !== undefined && !changelog) {
    warnings.push(`${path}: unknown kind "${raw.kind}", ignored`)
  }
  return {
    kind: 'page',
    slug,
    title: i18nField(raw.title) ?? slug,
    content,
    contentId,
    url,
    format,
    changelog,
    home: raw.home === true,
    nav: navZone(raw, warnings, path, topLevel),
  }
}

function normalizeLinkEntry(raw, warnings, path, topLevel) {
  const href = typeof raw.href === 'string' ? raw.href.trim() : ''
  if (!href) {
    warnings.push(`${path}: external link dropped, "href" is required`)
    return null
  }
  return {
    kind: 'link',
    href,
    title: i18nField(raw.title) ?? href,
    nav: navZone(raw, warnings, path, topLevel),
  }
}

function normalizeGroupEntry(raw, warnings, path, topLevel) {
  const title = i18nField(raw.group)
  if (!title) {
    warnings.push(`${path}: group dropped, "group" must be a non-empty title`)
    return null
  }
  if (!Array.isArray(raw.pages)) {
    warnings.push(`${path}: group "${resolveI18n(title)}" dropped, "pages" is required`)
    return null
  }
  const entries = []
  raw.pages.forEach((child, index) => {
    const childPath = `${path}.pages[${index}]`
    // One level, deliberately (§2.1): a nested group is a config mistake, not
    // a shape to flatten silently.
    if (child && typeof child === 'object' && child.group !== undefined) {
      warnings.push(`${childPath}: nested groups are not supported, dropped`)
      return
    }
    const entry = normalizeEntry(child, warnings, childPath)
    if (entry) entries.push(entry)
  })
  // `id` only exists for multi-spec merge identity (§2.5), which is why it can
  // default: two configs naming the same group the same way mean the same
  // group.
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : slugify(resolveI18n(title)) || 'group'
  return {
    kind: 'group',
    id,
    title,
    collapsed: raw.collapsed === true,
    entries,
    nav: navZone(raw, warnings, path, topLevel),
  }
}

function normalizeEntry(raw, warnings, path, topLevel = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${path}: not an object, dropped`)
    return null
  }
  if (raw.group !== undefined) return normalizeGroupEntry(raw, warnings, path, topLevel)
  // `href` instead of `url`/`slug` is what makes an entry an external link; a
  // page carrying both is a page, and the stray `href` is ignored.
  if (raw.href !== undefined && raw.url === undefined) {
    return normalizeLinkEntry(raw, warnings, path, topLevel)
  }
  return normalizePageEntry(raw, warnings, path, topLevel)
}

export function normalizeDocsPages(raw, warnings = [], path = 'docsPages') {
  if (!Array.isArray(raw)) return []
  const entries = []
  raw.forEach((item, index) => {
    const entry = normalizeEntry(item, warnings, `${path}[${index}]`, true)
    if (entry) entries.push(entry)
  })
  return entries
}

// --- multi-spec merge (§2.5) -----------------------------------------------

// Identity per kind: a spec entry matching a root one replaces it IN PLACE
// (root position kept), unmatched spec entries append after.
function identity(entry) {
  if (entry.kind === 'page') return `page:${entry.slug}`
  if (entry.kind === 'group') return `group:${entry.id}`
  return `link:${entry.href}`
}

function mergeLevel(rootEntries, specEntries) {
  const overrides = new Map(specEntries.map((entry) => [identity(entry), entry]))
  const matched = new Set()
  const merged = rootEntries.map((entry) => {
    const key = identity(entry)
    const override = overrides.get(key)
    if (!override) return entry
    matched.add(key)
    // Two groups of the same identity are the same group: their contents
    // merge by the same rule, one level down.
    if (entry.kind === 'group' && override.kind === 'group') {
      return { ...override, entries: mergeLevel(entry.entries, override.entries) }
    }
    return override
  })
  const appended = new Set()
  for (const entry of specEntries) {
    const key = identity(entry)
    if (matched.has(key) || appended.has(key)) continue
    appended.add(key)
    merged.push(entry)
  }
  return merged
}

// At most one home per effective config (§2.4): the first wins, the others are
// flagged. Applied to the MERGED result — two specs can have different homes,
// or one a takeover and the other the classic welcome view.
function applyHomeUniqueness(entries, warnings) {
  let taken = null
  const visitPage = (page) => {
    if (!page.home) return page
    if (taken) {
      warnings.push(`docsPages: "home" is already set on "${taken}", ignored on "${page.slug}"`)
      return { ...page, home: false }
    }
    taken = page.slug
    return page
  }
  return entries.map((entry) => {
    if (entry.kind === 'page') return visitPage(entry)
    if (entry.kind !== 'group') return entry
    return {
      ...entry,
      entries: entry.entries.map((child) => (child.kind === 'page' ? visitPage(child) : child)),
    }
  })
}

// Root + active spec, the effective docs nav. Root-level pages shared across
// specs stay a feature here (unlike scenarios, which a spec must declare for
// itself): a "Getting started" written once for the whole portal is exactly
// what the root level is for.
export function mergeDocsPages(rootRaw, specRaw, warnings = []) {
  const root = normalizeDocsPages(rootRaw, warnings, 'docsPages')
  const spec = normalizeDocsPages(specRaw, warnings, 'openapi.specs[].docsPages')
  return applyHomeUniqueness(mergeLevel(root, spec), warnings)
}

// --- consumption -----------------------------------------------------------

const FORMATS = new Set(['markdown', 'html', 'text'])

// A declared `format`, or null for anything else — including undefined, which
// is the normal case: the format is usually deduced rather than written.
export function docsFormat(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return FORMATS.has(value) ? value : null
}

// Rendering pipeline (§4.1): the declared `format` first, then the URL
// extension, never the content-type — a static host makes no promise about
// the header it sends for a `.txt`, and the docs folder is served by whatever
// the integrator already had. Anything else is markdown, `.md` included.
// A body carried by the page has no extension to read, which is why `format`
// exists at all; a `<script>` holding one says its type instead, and that
// last deduction belongs to the DOM side (src/components/docs-source.js).
export function docsPageFormat(page) {
  const declared = docsFormat(page?.format)
  if (declared) return declared
  const path = String(page?.url ?? '')
    .split(/[?#]/)[0]
    .toLowerCase()
  if (path.endsWith('.html')) return 'html'
  if (path.endsWith('.txt')) return 'text'
  return 'markdown'
}

// Prose carried by the host page arrives indented — by the HTML around it, or
// by whatever formatted the config. Markdown reads four leading spaces as a
// code block, so shipping the text as typed would turn a whole page into one
// grey rectangle. Only the COMMON prefix goes, so the indentation the author
// meant (nested lists, fenced code) survives untouched.
export function dedentDocsContent(text) {
  const lines = String(text ?? '').split('\n')
  let indent = null
  for (const line of lines) {
    if (!line.trim()) continue
    const width = line.length - line.trimStart().length
    if (indent === null || width < indent) indent = width
  }
  if (!indent) return String(text ?? '')
  return lines.map((line) => (line.trim() ? line.slice(indent) : line.trimStart())).join('\n')
}

// --- the resolved outline ---------------------------------------------------
//
// ONE language-resolved arrangement of the docs zone, shared by everything that
// consumes it: the nav renders it, `llms.txt` sections it, and the flat page
// list below is derived from it. Resolving once here rather than per consumer
// is what stops the nav and the exports disagreeing on which pages exist —
// they used to walk the raw tree separately, each with its own idea of what a
// missing translation meant. The UI language change that would invalidate it
// reloads the page (see lang-switcher).

function resolveOutlineEntry(entry, lang) {
  if (entry.kind === 'link') {
    return { kind: 'link', href: entry.href, title: resolveI18n(entry.title, lang) ?? entry.href }
  }
  return {
    kind: 'page',
    slug: entry.slug,
    title: resolveI18n(entry.title, lang) ?? entry.slug,
    content: resolveI18n(entry.content, lang),
    contentId: resolveI18n(entry.contentId, lang),
    url: resolveI18n(entry.url, lang),
    format: entry.format ?? null,
    changelog: entry.changelog === true,
    home: entry.home === true,
  }
}

// A page whose i18n maps all resolve to nothing has no body to show and is not
// a page; a group left with nothing to show is not a group.
const routable = (entry) =>
  entry.kind === 'link' || Boolean(entry.content || entry.contentId || entry.url)

export function resolveDocsOutline(entries, lang = 'en') {
  const outline = []
  for (const entry of entries ?? []) {
    const nav = entry.nav === 'bottom' ? 'bottom' : 'top'
    if (entry.kind !== 'group') {
      const resolved = resolveOutlineEntry(entry, lang)
      if (routable(resolved)) outline.push({ ...resolved, nav })
      continue
    }
    const children = entry.entries.map((child) => resolveOutlineEntry(child, lang)).filter(routable)
    if (!children.length) continue
    outline.push({
      kind: 'group',
      // `id` and `collapsed` are the nav's business, and the nav reads this
      // same tree: carrying them here is what lets it stop re-resolving.
      id: entry.id,
      collapsed: entry.collapsed === true,
      title: resolveI18n(entry.title, lang) ?? entry.id,
      entries: children,
      nav,
    })
  }
  // The zone ordering is applied HERE rather than left to each consumer, so
  // "the outline is in nav order" stays literally true: a page declared first
  // but placed below the reference is read last by the pager and listed last
  // by the exports, exactly as the reader sees it. Stable within a zone —
  // declaration order still decides everything else.
  return [
    ...outline.filter((e) => e.nav !== 'bottom'),
    ...outline.filter((e) => e.nav === 'bottom'),
  ]
}

// One zone of the resolved outline (§2.7). The nav renders the two separately
// and llms.txt sections them on either side of the reference; every other
// consumer wants the whole thing, in the order above.
export function docsZoneEntries(outline, zone) {
  return (outline ?? []).filter((entry) => (entry.nav ?? 'top') === zone)
}

// Nav order, groups flattened, external links skipped: the order prev/next
// walks, the order the exports list, and the set of routable slugs.
export function flattenDocsOutline(outline) {
  const pages = []
  for (const entry of outline ?? []) {
    if (entry.kind === 'page') pages.push(entry)
    else if (entry.kind === 'group') {
      for (const child of entry.entries) if (child.kind === 'page') pages.push(child)
    }
  }
  return pages
}
