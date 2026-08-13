import { describe, expect, it } from 'vitest'
import {
  dedentDocsContent,
  docsFormat,
  docsPageFormat,
  docsZoneEntries,
  flattenDocsOutline,
  mergeDocsPages,
  normalizeDocsPages,
  rebaseDocsUrls,
  resolveDocsOutline,
  resolveI18n,
} from '../src/docs/pages.js'

// One resolved arrangement feeds every consumer, so the assertions below go
// through it rather than through a per-consumer shortcut.
const outline = (entries, lang = 'en') => resolveDocsOutline(entries, lang)
const homeSlug = (entries) =>
  flattenDocsOutline(resolveDocsOutline(entries)).find((page) => page.home)?.slug ?? null

// docs/docs-pages.md §2: the config model of the prose side. Everything here
// is pure — the manifest FETCH lives in the shell, the shape it yields is
// checked below like any inline array.

const page = (slug, extra = {}) => ({ slug, url: `/docs/${slug}.md`, ...extra })

describe('normalizeDocsPages', () => {
  it('discriminates the three entry kinds by their keys', () => {
    const entries = normalizeDocsPages([
      page('intro', { title: 'Intro' }),
      { group: 'Guides', pages: [page('pagination')] },
      { title: 'GitHub', href: 'https://github.com/acme/api' },
    ])
    expect(entries.map((e) => e.kind)).toEqual(['page', 'group', 'link'])
    expect(entries[1].entries.map((e) => e.kind)).toEqual(['page'])
  })

  it('keeps the declaration order as the nav order', () => {
    const entries = normalizeDocsPages([page('z'), page('a'), page('m')])
    expect(entries.map((e) => e.slug)).toEqual(['z', 'a', 'm'])
  })

  it('drops invalid entries and says which', () => {
    const warnings = []
    const entries = normalizeDocsPages(
      [
        { title: 'No slug', url: '/x.md' },
        { slug: 'no-url', title: 'No url' },
        { group: 'Empty' },
        { title: 'Link with no href' },
        'not an object',
        page('kept'),
      ],
      warnings,
    )
    expect(entries.map((e) => e.slug)).toEqual(['kept'])
    expect(warnings).toHaveLength(5)
    expect(warnings.join('\n')).toContain('docsPages[2]: group "Empty" dropped')
  })

  it('refuses a group inside a group, keeping its siblings', () => {
    const warnings = []
    const [group] = normalizeDocsPages(
      [{ group: 'Guides', pages: [{ group: 'Nested', pages: [] }, page('kept')] }],
      warnings,
    )
    expect(group.entries.map((e) => e.slug)).toEqual(['kept'])
    expect(warnings[0]).toContain('nested groups are not supported')
  })

  it('defaults a group id to its slugified title, and honors an explicit one', () => {
    const [auto, explicit] = normalizeDocsPages([
      { group: 'Getting started!', pages: [] },
      { group: 'Guides', id: 'how-to', pages: [] },
    ])
    expect(auto.id).toBe('getting-started')
    expect(explicit.id).toBe('how-to')
  })

  it('reads collapsed and home as strict booleans', () => {
    const [group] = normalizeDocsPages([
      { group: 'G', pages: [page('a', { home: 'yes' }), page('b', { home: true })] },
    ])
    expect(group.collapsed).toBe(false)
    expect(group.entries.map((e) => e.home)).toEqual([false, true])
  })

  it('treats an entry carrying both url and href as a page', () => {
    const [entry] = normalizeDocsPages([page('both', { href: 'https://example.test' })])
    expect(entry.kind).toBe('page')
  })

  // §4.5: the timeline opt-in rides the entry, and an unknown kind is flagged
  // rather than silently honoured — the same stance as `format`.
  it('reads kind: "changelog" and flags any other kind', () => {
    const warnings = []
    const entries = normalizeDocsPages(
      [page('log', { kind: 'changelog' }), page('plain'), page('odd', { kind: 'timeline' })],
      warnings,
    )
    expect(entries.map((e) => e.changelog)).toEqual([true, false, false])
    expect(warnings).toEqual(['docsPages[2]: unknown kind "timeline", ignored'])
  })

  it('carries the changelog kind into the resolved outline', () => {
    const resolved = outline(normalizeDocsPages([page('log', { kind: 'changelog' })]))
    expect(resolved[0].changelog).toBe(true)
  })
})

describe('i18n resolution (§2.3)', () => {
  it('follows current language → en → first declared key', () => {
    const map = { de: 'Anleitung', en: 'Guide', fr: 'Guide FR' }
    expect(resolveI18n(map, 'fr')).toBe('Guide FR')
    expect(resolveI18n(map, 'es')).toBe('Guide')
    expect(resolveI18n({ de: 'Anleitung' }, 'es')).toBe('Anleitung')
  })

  it('takes a plain string as "same in every language"', () => {
    expect(resolveI18n('Guide', 'fr')).toBe('Guide')
  })

  it('resolves a page title and url independently', () => {
    const [entry] = normalizeDocsPages([
      {
        slug: 'guide',
        title: { en: 'Guide', fr: 'Le guide' },
        url: { en: '/docs/guide.en.md', fr: '/docs/guide.fr.md' },
      },
    ])
    expect(outline([entry], 'fr')[0]).toEqual({
      kind: 'page',
      slug: 'guide',
      title: 'Le guide',
      content: null,
      contentId: null,
      url: '/docs/guide.fr.md',
      format: null,
      changelog: false,
      home: false,
      nav: 'top',
    })
    expect(outline([entry], 'en')[0].url).toBe('/docs/guide.en.md')
  })

  it('falls back on the slug when no title is declared', () => {
    expect(outline(normalizeDocsPages([page('pagination')]))[0].title).toBe('pagination')
  })

  it('drops empty strings from a map rather than resolving to one', () => {
    const entries = normalizeDocsPages([
      { slug: 'g', title: { en: '', fr: 'Guide' }, url: '/g.md' },
    ])
    expect(outline(entries)[0].title).toBe('Guide')
  })
})

describe('manifest url rebasing (§2.2)', () => {
  const base = 'https://cdn.test/docs-pages/manifest.json'

  it('resolves relative page urls against the manifest, not the host page', () => {
    const [entry] = rebaseDocsUrls([{ slug: 'intro', url: 'intro.md' }], base)
    expect(entry.url).toBe('https://cdn.test/docs-pages/intro.md')
  })

  it('rebases every language of an i18n map, and reaches into groups', () => {
    const [group] = rebaseDocsUrls(
      [{ group: 'Guides', pages: [{ slug: 'g', url: { en: 'g.en.md', fr: '../fr/g.md' } }] }],
      base,
    )
    expect(group.pages[0].url).toEqual({
      en: 'https://cdn.test/docs-pages/g.en.md',
      fr: 'https://cdn.test/fr/g.md',
    })
  })

  it('leaves absolute urls and external links alone', () => {
    const entries = rebaseDocsUrls(
      [
        { slug: 'a', url: 'https://other.test/a.md' },
        { title: 'GitHub', href: 'https://github.com/acme/api' },
      ],
      base,
    )
    expect(entries[0].url).toBe('https://other.test/a.md')
    expect(entries[1]).toEqual({ title: 'GitHub', href: 'https://github.com/acme/api' })
  })
})

describe('multi-spec merge (§2.5)', () => {
  it('replaces a matching page in place and appends the rest', () => {
    const merged = mergeDocsPages(
      [page('intro', { title: 'Root intro' }), page('faq')],
      [page('intro', { title: 'Spec intro' }), page('billing')],
    )
    expect(merged.map((e) => [e.slug, resolveI18n(e.title)])).toEqual([
      ['intro', 'Spec intro'],
      ['faq', 'faq'],
      ['billing', 'billing'],
    ])
  })

  it('matches groups by id and merges their pages one level down', () => {
    const merged = mergeDocsPages(
      [{ group: 'Guides', id: 'guides', pages: [page('a', { title: 'Root A' }), page('b')] }],
      [
        {
          group: 'Guides du spec',
          id: 'guides',
          pages: [page('a', { title: 'Spec A' }), page('c')],
        },
      ],
    )
    expect(merged).toHaveLength(1)
    expect(resolveI18n(merged[0].title)).toBe('Guides du spec')
    expect(merged[0].entries.map((e) => [e.slug, resolveI18n(e.title)])).toEqual([
      ['a', 'Spec A'],
      ['b', 'b'],
      ['c', 'c'],
    ])
  })

  it('matches external links by href', () => {
    const merged = mergeDocsPages(
      [{ title: 'Status', href: 'https://status.test' }],
      [{ title: 'Statut', href: 'https://status.test' }],
    )
    expect(merged).toHaveLength(1)
    expect(resolveI18n(merged[0].title)).toBe('Statut')
  })

  it('keeps the root config alone when the spec declares nothing', () => {
    expect(mergeDocsPages([page('intro')], []).map((e) => e.slug)).toEqual(['intro'])
    expect(mergeDocsPages([page('intro')], undefined).map((e) => e.slug)).toEqual(['intro'])
  })
})

describe('home takeover (§2.4)', () => {
  it('resolves home on the merged result', () => {
    const merged = mergeDocsPages([page('intro')], [page('intro', { home: true })])
    expect(homeSlug(merged)).toBe('intro')
  })

  it('keeps only the first home and flags the others', () => {
    const warnings = []
    const merged = mergeDocsPages(
      [page('a', { home: true }), { group: 'G', pages: [page('b', { home: true })] }],
      [],
      warnings,
    )
    expect(homeSlug(merged)).toBe('a')
    expect(merged[1].entries[0].home).toBe(false)
    expect(warnings[0]).toContain('"home" is already set on "a"')
  })

  it('finds a home declared inside a group', () => {
    const merged = mergeDocsPages([{ group: 'G', pages: [page('b', { home: true })] }], [])
    expect(homeSlug(merged)).toBe('b')
  })

  it('reports no home when nobody claims it', () => {
    expect(homeSlug(mergeDocsPages([page('a')], []))).toBe(null)
  })
})

describe('flattening', () => {
  const entries = normalizeDocsPages([
    page('intro'),
    { group: 'Guides', pages: [page('a'), { title: 'Ext', href: 'https://x.test' }, page('b')] },
    { title: 'GitHub', href: 'https://github.test' },
    page('outro'),
  ])

  it('walks pages in nav order, groups flattened and links skipped', () => {
    expect(flattenDocsOutline(outline(entries)).map((p) => p.slug)).toEqual([
      'intro',
      'a',
      'b',
      'outro',
    ])
  })

  it('resolves a url through the fallback chain rather than dropping the page', () => {
    const resolved = outline(normalizeDocsPages([{ slug: 'partial', url: { fr: '/fr.md' } }]))
    // The `en` map key is missing, but the fallback chain still finds a file.
    expect(resolved.map((p) => p.url)).toEqual(['/fr.md'])
  })

  // The nav and the exports read this same tree (§7): a group carries the two
  // fields only the nav uses, and an empty one is not rendered by either.
  it('carries group identity and collapsed state, and drops empty groups', () => {
    const resolved = outline(
      normalizeDocsPages([
        { group: 'Guides', id: 'guides', collapsed: true, pages: [page('a')] },
        { group: 'Links only', pages: [{ title: 'Ext', href: 'https://x.test' }] },
      ]),
    )
    expect(resolved[0]).toMatchObject({ kind: 'group', id: 'guides', collapsed: true })
    expect(resolved[1].entries).toHaveLength(1)
  })
})

describe('nav zone (§2.7)', () => {
  it('defaults every entry kind to the zone above the reference', () => {
    const resolved = outline(
      normalizeDocsPages([
        page('intro'),
        { group: 'Guides', pages: [page('a')] },
        { title: 'GitHub', href: 'https://github.test' },
      ]),
    )
    expect(resolved.map((entry) => entry.nav)).toEqual(['top', 'top', 'top'])
    expect(docsZoneEntries(resolved, 'bottom')).toEqual([])
  })

  it('splits the outline in two zones, every entry kind eligible', () => {
    const resolved = outline(
      normalizeDocsPages([
        page('intro'),
        { group: 'Legal', nav: 'bottom', pages: [page('terms')] },
        { title: 'Status', href: 'https://status.test', nav: 'bottom' },
        page('support', { nav: 'bottom' }),
      ]),
    )
    expect(docsZoneEntries(resolved, 'top').map((entry) => entry.slug)).toEqual(['intro'])
    expect(docsZoneEntries(resolved, 'bottom').map((entry) => entry.slug ?? entry.id)).toEqual([
      'legal',
      undefined,
      'support',
    ])
  })

  // The outline IS the nav order, so a page declared first but placed below
  // the reference is read last — by the pager, by the exports, by everything.
  it('orders the outline top zone first, declaration order within each', () => {
    const resolved = outline(
      normalizeDocsPages([
        page('support', { nav: 'bottom' }),
        page('intro'),
        page('legal', { nav: 'bottom' }),
        page('errors'),
      ]),
    )
    expect(flattenDocsOutline(resolved).map((p) => p.slug)).toEqual([
      'intro',
      'errors',
      'support',
      'legal',
    ])
  })

  it('ignores an unknown zone, and a zone declared inside a group', () => {
    const warnings = []
    const resolved = outline(
      normalizeDocsPages(
        [
          page('sideways', { nav: 'left' }),
          { group: 'Guides', pages: [page('a', { nav: 'bottom' })] },
        ],
        warnings,
      ),
    )
    expect(resolved.every((entry) => entry.nav === 'top')).toBe(true)
    expect(warnings).toEqual([
      'docsPages[0]: unknown nav "left", ignored',
      'docsPages[1].pages[0]: "nav" is a top-level choice, ignored inside a group',
    ])
  })

  // A spec override replaces the root entry whole (§2.5), zone included: that
  // is how one spec can push a shared page down without moving it elsewhere.
  it('takes the zone from the overriding spec entry', () => {
    const merged = mergeDocsPages([page('changelog')], [page('changelog', { nav: 'bottom' })])
    expect(outline(merged)[0].nav).toBe('bottom')
  })
})

describe('format selection (§4.1)', () => {
  it('reads the extension, not a content-type nobody promised', () => {
    expect(docsPageFormat({ url: '/docs/guide.md' })).toBe('markdown')
    expect(docsPageFormat({ url: '/docs/notes.html' })).toBe('html')
    expect(docsPageFormat({ url: '/docs/changes.txt' })).toBe('text')
    expect(docsPageFormat({ url: '/docs/NOTES.HTML' })).toBe('html')
  })

  it('ignores a query string or a fragment on the url', () => {
    expect(docsPageFormat({ url: '/docs/notes.html?v=3' })).toBe('html')
    expect(docsPageFormat({ url: '/docs/changes.txt#top' })).toBe('text')
  })

  it('treats anything else as markdown', () => {
    expect(docsPageFormat({ url: '/docs/guide' })).toBe('markdown')
    expect(docsPageFormat({ url: '/docs/guide.markdown' })).toBe('markdown')
    expect(docsPageFormat({})).toBe('markdown')
    expect(docsPageFormat(null)).toBe('markdown')
  })

  it('lets a declared format win over the extension', () => {
    expect(docsPageFormat({ url: '/docs/notes.html', format: 'text' })).toBe('text')
    expect(docsPageFormat({ url: '/docs/guide.md', format: 'HTML' })).toBe('html')
  })

  it('ignores a format nobody implements', () => {
    expect(docsPageFormat({ url: '/docs/notes.html', format: 'asciidoc' })).toBe('html')
    expect(docsFormat('asciidoc')).toBe(null)
    expect(docsFormat(undefined)).toBe(null)
  })
})

// §2.6: prose carried by the host page, for an installation that cannot serve
// files next to index.html — a doc behind a login, an app serving one route.
describe('inline page bodies (§2.6)', () => {
  it('accepts a body in the config and one held by the host page', () => {
    const entries = normalizeDocsPages([
      { slug: 'legal', title: 'Legal', content: '# Legal' },
      { slug: 'guide', title: 'Guide', contentId: 'doc-guide', format: 'html' },
    ])
    expect(outline(entries)).toMatchObject([
      { slug: 'legal', content: '# Legal', contentId: null, url: null, format: null },
      { slug: 'guide', content: null, contentId: 'doc-guide', url: null, format: 'html' },
    ])
  })

  it('takes what the page carries over what it would have to fetch', () => {
    const [entry] = normalizeDocsPages([
      { slug: 'g', content: '# Carried', contentId: 'doc-g', url: '/docs/g.md' },
    ])
    // All three survive normalization — the loader is what applies the order,
    // and a page keeping its url stays exportable as a link.
    expect(entry).toMatchObject({ content: '# Carried', contentId: 'doc-g', url: '/docs/g.md' })
  })

  it('drops a page declaring no body at all, naming the three ways', () => {
    const warnings = []
    expect(normalizeDocsPages([{ slug: 'empty', title: 'Empty' }], warnings)).toEqual([])
    expect(warnings[0]).toContain('"content"/"contentId"/"url"')
  })

  it('flags a format it does not implement instead of rendering it as markdown in silence', () => {
    const warnings = []
    normalizeDocsPages([{ slug: 'g', content: '# G', format: 'rst' }], warnings)
    expect(warnings[0]).toContain('unknown format "rst"')
  })

  it('resolves an inline body per language like a url', () => {
    const entries = normalizeDocsPages([
      { slug: 'g', content: { en: '# Guide', fr: '# Le guide' }, contentId: { fr: 'doc-fr' } },
    ])
    expect(outline(entries, 'fr')[0]).toMatchObject({ content: '# Le guide', contentId: 'doc-fr' })
    // No `en` key on contentId: the fallback chain finds the only one declared.
    expect(outline(entries, 'en')[0]).toMatchObject({ content: '# Guide', contentId: 'doc-fr' })
  })

  it('replaces a fetched page with a carried one on a spec override', () => {
    const merged = mergeDocsPages(
      [{ slug: 'intro', title: 'Intro', url: '/docs/intro.md' }],
      [{ slug: 'intro', title: 'Intro', content: '# Intro' }],
    )
    expect(merged[0]).toMatchObject({ content: '# Intro', url: null })
  })

  it('leaves a carried body alone when a manifest rebases its neighbours', () => {
    const rebased = rebaseDocsUrls(
      [
        { slug: 'a', url: 'a.md' },
        { slug: 'b', content: '# B' },
      ],
      'https://cdn.test/docs/manifest.json',
    )
    expect(rebased[1]).toEqual({ slug: 'b', content: '# B' })
  })
})

// Prose written inside an HTML page arrives indented by the markup around it,
// and four leading spaces are a markdown code block.
describe('dedenting a carried body', () => {
  it('removes the common indentation and keeps the relative one', () => {
    const source = ['', '      # Title', '', '      - one', '        - nested', '      '].join('\n')
    expect(dedentDocsContent(source)).toBe(
      ['', '# Title', '', '- one', '  - nested', ''].join('\n'),
    )
  })

  it('leaves an unindented body untouched', () => {
    const source = '# Title\n\n    indented code block\n'
    expect(dedentDocsContent(source)).toBe(source)
  })

  it('ignores blank lines when measuring, and empties whitespace-only ones', () => {
    expect(dedentDocsContent('    a\n\n  \n    b')).toBe('a\n\n\nb')
  })
})
