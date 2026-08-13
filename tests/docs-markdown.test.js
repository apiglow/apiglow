import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { docsMarkdownToHtml, stripFrontmatter } from '../src/docs/markdown.js'

// docs/docs-pages.md §4.1–4.3 — the markdown half of a docs page. What the
// DOM does with the output (callout boxes, tablists) is e2e's job; what
// matters here is that the HTML carries what the decorators need, and that
// everything degrades to legible markup without them.

describe('frontmatter (§4.1)', () => {
  it('strips a leading YAML block', () => {
    expect(stripFrontmatter('---\ntitle: Guide\ntags: [a]\n---\n# Guide\n')).toBe('# Guide\n')
  })

  it('leaves a horizontal rule alone', () => {
    expect(stripFrontmatter('# Guide\n\n---\n\nmore')).toBe('# Guide\n\n---\n\nmore')
  })

  it('only strips at the very top of the file', () => {
    const source = 'intro\n\n---\ntitle: nope\n---\n'
    expect(stripFrontmatter(source)).toBe(source)
  })

  it('needs a closing delimiter to strip anything', () => {
    expect(stripFrontmatter('---\ntitle: unterminated\n')).toBe('---\ntitle: unterminated\n')
  })
})

describe('code tabs (§4.3)', () => {
  const fence = (info, code) => `\`\`\`${info}\n${code}\n\`\`\``

  it('groups adjacent fences and labels them from the meta string', () => {
    const html = docsMarkdownToHtml(
      [fence('js Node.js', 'fetch(url)'), fence('python Python', 'requests.get(url)')].join('\n'),
    )
    expect(html).toContain('data-code-tabs')
    expect(html).toContain('data-tab-label="Node.js"')
    expect(html).toContain('data-tab-lang="js"')
    expect(html).toContain('data-tab-label="Python"')
    expect(html).toContain('class="language-python"')
  })

  it('falls back on the language as the label', () => {
    const html = docsMarkdownToHtml([fence('bash', 'curl url'), fence('json', '{}')].join('\n'))
    expect(html).toContain('data-tab-label="bash"')
    expect(html).toContain('data-tab-label="json"')
  })

  it('leaves fences separated by a blank line independent', () => {
    const html = docsMarkdownToHtml([fence('bash', 'curl url'), fence('json', '{}')].join('\n\n'))
    expect(html).not.toContain('data-code-tabs')
  })

  it('leaves a lone fence alone', () => {
    expect(docsMarkdownToHtml(fence('bash', 'curl url'))).not.toContain('data-code-tabs')
  })

  it('escapes the code it inlines', () => {
    const html = docsMarkdownToHtml(
      [fence('html', '<img src=x onerror=alert(1)>'), fence('json', '{}')].join('\n'),
    )
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x')
  })

  it('declines an unterminated run and renders exactly what marked would', () => {
    const source = '```js\nfetch(url)\n```\n```json\n{ oops\n\n# whatever marked does with this'
    expect(docsMarkdownToHtml(source)).toBe(marked.parse(source, { async: false }))
  })

  it('keeps every snippet in the output, so an undecorated group stays readable', () => {
    const html = docsMarkdownToHtml(
      [fence('bash', 'curl url'), fence('json', '{"a":1}')].join('\n'),
    )
    expect(html).toContain('curl url')
    expect(html).toContain('{&quot;a&quot;:1}')
  })
})

describe('callouts (§4.2)', () => {
  // The marker survives to the DOM, where the decorator reads it: marked
  // renders GFM alerts as ordinary blockquotes, which is exactly the fallback
  // the syntax was chosen for.
  it('renders as a blockquote carrying its marker', () => {
    const html = docsMarkdownToHtml('> [!WARNING]\n> Rate limits apply.')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('[!WARNING]')
  })
})
