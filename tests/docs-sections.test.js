import { describe, expect, it } from 'vitest'
import { headingIds, splitSections } from '../src/docs/sections.js'
import { buildSearchIndex, searchIndex } from '../src/search/index.js'

// docs/docs-pages.md §6 — what the palette indexes once it goes from titles to
// content, and the anchors its results land on.

describe('heading ids', () => {
  it('slugifies and uniquifies in document order', () => {
    const next = headingIds()
    expect(next('Page size')).toBe('page-size')
    expect(next('Page size')).toBe('page-size-2')
    expect(next('Page size')).toBe('page-size-3')
    expect(next('  ')).toBe('section')
  })
})

describe('markdown splitting', () => {
  const PAGE = [
    '---',
    'title: ignored',
    '---',
    '# Pagination',
    '',
    'Collection endpoints return a page at a time.',
    '',
    '## Cursors',
    '',
    'Pass the `cursor` returned by the previous call.',
    '',
    '## Page size',
    '',
    '- The `limit` parameter caps the response.',
    'See [the errors guide](/docs/errors.md) too.',
  ].join('\n')

  const sections = splitSections(PAGE)

  it('splits on headings, in document order', () => {
    expect(sections.map((s) => s.heading)).toEqual(['Pagination', 'Cursors', 'Page size'])
  })

  it('anchors each section on the id the rendered page will carry', () => {
    expect(sections.map((s) => s.anchor)).toEqual(['pagination', 'cursors', 'page-size'])
  })

  it('strips the frontmatter and the inline markup', () => {
    expect(sections[0].text).toBe('Collection endpoints return a page at a time.')
    expect(sections[1].text).toBe('Pass the cursor returned by the previous call.')
    expect(sections[2].text).toBe(
      'The limit parameter caps the response. See the errors guide too.',
    )
  })

  it('keeps a heading with nothing under it', () => {
    const [only] = splitSections('## Empty section')
    expect(only).toEqual({ anchor: 'empty-section', heading: 'Empty section', text: '' })
  })

  it('records text written before the first heading', () => {
    const [preamble] = splitSections('Some intro.\n\n# Title')
    expect(preamble).toEqual({ anchor: null, heading: null, text: 'Some intro.' })
  })

  it('indexes code but never mistakes a comment in it for a heading', () => {
    const sections = splitSections(
      ['# Guide', '', '```bash', '# not a heading', 'curl /pets', '```'].join('\n'),
    )
    expect(sections.map((s) => s.heading)).toEqual(['Guide'])
    expect(sections[0].text).toContain('curl /pets')
  })

  it('ignores h5 and deeper, which the renderer gives no id to', () => {
    expect(splitSections('# A\n\n##### deep\n\ntext').map((s) => s.heading)).toEqual(['A'])
  })
})

describe('html splitting', () => {
  const PAGE =
    '<h1>Notes</h1><p>Intro &amp; more.</p><h2>Sanitization</h2>' +
    '<script>alert(1)</script><p>Safe.</p>'
  const sections = splitSections(PAGE, 'html')

  it('splits on heading tags and strips the markup', () => {
    expect(sections.map((s) => s.heading)).toEqual(['Notes', 'Sanitization'])
    expect(sections[0].text).toBe('Intro & more.')
  })

  it('drops script content rather than indexing it', () => {
    expect(sections[1].text).toBe('Safe.')
  })

  it('gives the same anchors the renderer will', () => {
    expect(sections.map((s) => s.anchor)).toEqual(['notes', 'sanitization'])
  })
})

describe('text splitting', () => {
  it('indexes a .txt page as one section with no anchor', () => {
    expect(splitSections('line one\nline two', 'text')).toEqual([
      { anchor: null, heading: null, text: 'line one line two' },
    ])
  })

  it('indexes nothing for an empty file', () => {
    expect(splitSections('   ', 'text')).toEqual([])
  })
})

describe('index integration', () => {
  const MODEL = { operations: [], webhooks: [], groups: [] }
  const SECTIONS = [
    {
      slug: 'pagination',
      pageTitle: 'Pagination',
      anchor: 'cursors',
      heading: 'Cursors',
      text: 'opaque token',
    },
    {
      slug: 'errors',
      pageTitle: 'Errors',
      anchor: 'retrying',
      heading: 'Retrying',
      text: 'backoff and cursors',
    },
  ]
  const entries = buildSearchIndex(
    MODEL,
    [{ slug: 'pagination', title: 'Pagination' }],
    [],
    SECTIONS,
  )

  it('finds a section by a word that appears only in its body', () => {
    const [top] = searchIndex(entries, 'opaque')
    expect(top).toMatchObject({ type: 'page-section', slug: 'pagination', anchor: 'cursors' })
  })

  it('ranks a heading match above a body match', () => {
    const results = searchIndex(entries, 'cursors')
    expect(results[0]).toMatchObject({ title: 'Cursors', anchor: 'cursors' })
    expect(results.map((r) => r.title)).toContain('Retrying')
    expect(results[0].score).toBeGreaterThan(results.at(-1).score)
  })

  it('names the page a section belongs to, so a bare heading reads', () => {
    const [top] = searchIndex(entries, 'backoff')
    expect(top.group).toBe('Errors')
  })
})

describe('setext headings', () => {
  // marked renders these as h1/h2 and the renderer gives them an id, so the
  // splitter has to count them or every later anchor shifts by one.
  it('splits on them and keeps the id sequence aligned with the renderer', () => {
    const sections = splitSections(
      ['Overview', '========', '', 'Intro.', '', '## Overview', '', 'Again.'].join('\n'),
    )
    expect(sections.map((s) => [s.heading, s.anchor])).toEqual([
      ['Overview', 'overview'],
      ['Overview', 'overview-2'],
    ])
  })

  it('leaves a bare rule alone', () => {
    expect(splitSections('# A\n\n---\n\ntext').map((s) => s.heading)).toEqual(['A'])
  })
})
