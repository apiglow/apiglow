import { describe, expect, it } from 'vitest'
import { toDocsPageMarkdown } from '../src/export/docs-page-markdown.js'

// The prose counterpart of `endpoint-markdown.test.js`: what the "Copy page"
// menu of a docs page copies, shows and saves (docs/docs-pages.md §5).
describe('toDocsPageMarkdown', () => {
  it('keeps a markdown page verbatim when it opens on its own title', () => {
    const text = '# Pagination\n\nCollections return a page at a time.\n'
    expect(toDocsPageMarkdown({ title: 'Pagination', text })).toBe(text)
  })

  it('drops the frontmatter the render drops too', () => {
    const text = '---\ntitle: ignored by design\ndraft: true\n---\n\n# Pagination\n\nBody.'
    expect(toDocsPageMarkdown({ title: 'Pagination', text })).toBe('# Pagination\n\nBody.\n')
  })

  it('prepends the nav title when the body opens on no level-1 heading', () => {
    const text = '## Cursors\n\nPass the cursor back.'
    expect(toDocsPageMarkdown({ title: 'Pagination', text })).toBe(
      '# Pagination\n\n## Cursors\n\nPass the cursor back.\n',
    )
  })

  it('recognizes a setext title as one', () => {
    const text = 'Pagination\n==========\n\nBody.'
    expect(toDocsPageMarkdown({ title: 'Pagination', text })).toBe(text.concat('\n'))
  })

  it('does not take a comment inside a fence for the page title', () => {
    const text = '```bash\n# install the client\nnpm i acme\n```'
    expect(toDocsPageMarkdown({ title: 'Quickstart', text })).toBe(`# Quickstart\n\n${text}\n`)
  })

  it('flattens an html page to its text, like llms-full does', () => {
    const text = '<h1>Notes</h1>\n<p>Authored as <b>HTML</b>.</p>\n<script>evil()</script>'
    expect(toDocsPageMarkdown({ title: 'Notes', text, format: 'html' })).toBe(
      '# Notes\n\nNotes Authored as HTML .\n',
    )
  })

  it('leaves a text page alone, `---` line included', () => {
    const text = '---\n2026-08-07  Added /orders.\n---\n2026-07-15  First release.'
    expect(toDocsPageMarkdown({ title: 'Raw changelog', text, format: 'text' })).toBe(
      `# Raw changelog\n\n${text}\n`,
    )
  })

  // Rule 12: the rendered page resolves `{{token}}` against the selected
  // environment, and those values are credentials. The export carries the
  // template, never the substitution.
  it('carries {{var}} literally', () => {
    const text = '# Auth\n\nSend `Authorization: Bearer {{token}}`.'
    expect(toDocsPageMarkdown({ title: 'Auth', text })).toContain('{{token}}')
  })

  it('needs no title to produce a page', () => {
    expect(toDocsPageMarkdown({ title: '', text: 'Body.' })).toBe('Body.\n')
  })
})
