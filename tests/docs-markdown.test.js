import { afterEach, describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { docsMarkdownToHtml, stripFrontmatter } from '../src/docs/markdown.js'
import { setDocsPageIndex } from '../src/docs/pages.js'
import { setRouteSpecId } from '../src/router.js'

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

describe('page references (§4.4)', () => {
  afterEach(() => {
    setDocsPageIndex(null)
    setRouteSpecId(null)
  })

  it('turns apidoc:page/{slug} into a route, with no badge', () => {
    setDocsPageIndex([{ slug: 'pagination' }, { slug: 'errors' }])
    const html = docsMarkdownToHtml('See [Pagination](apidoc:page/pagination).')
    expect(html).toContain('<a href="#/page/pagination">Pagination</a>')
    expect(html).not.toContain('badge')
  })

  it('carries the multi-spec prefix, because the router builds the href', () => {
    setDocsPageIndex([{ slug: 'pagination' }])
    setRouteSpecId('payments')
    expect(docsMarkdownToHtml('[x](apidoc:page/pagination)')).toContain(
      'href="#/s/payments/page/pagination"',
    )
  })

  it('renders an unknown slug broken, and says it is a page that is missing', () => {
    setDocsPageIndex([{ slug: 'pagination' }])
    const html = docsMarkdownToHtml('[ghost](apidoc:page/nope)')
    expect(html).toContain('apidoc-op-broken')
    expect(html).toContain('No page matches &quot;nope&quot;')
    expect(html).not.toContain('<a')
  })
})

// §4.6 — MDX-shaped syntax, our own parser. The contract lives here because
// the parser is pure; what the DOM does with a prose tablist is e2e's job.
describe('prose components (§4.6)', () => {
  const container = (tag, children) => `<${tag}>\n\n${children}\n\n</${tag}>\n`

  afterEach(() => {
    setDocsPageIndex(null)
  })

  it('renders a card grid, the title escaped and the body full markdown', () => {
    const html = docsMarkdownToHtml(
      container(
        'Cards',
        '<Card title="Quick & fast" href="/start.html">\nA **bold** promise.\n</Card>',
      ),
    )
    expect(html).toContain('<div class="md-cards" data-cards>')
    expect(html).toContain('<a class="md-card" href="/start.html">')
    expect(html).toContain('<span class="md-card-title">Quick &amp; fast</span>')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('resolves an apidoc: href on a card, page and operation alike', () => {
    setDocsPageIndex([{ slug: 'pagination' }])
    const html = docsMarkdownToHtml(
      container('Cards', '<Card title="Pagination" href="apidoc:page/pagination">\nx\n</Card>'),
    )
    expect(html).toContain('href="#/page/pagination"')
  })

  it('shows a card whose reference resolves to nothing as broken, not as a link', () => {
    setDocsPageIndex([{ slug: 'pagination' }])
    const html = docsMarkdownToHtml(
      container('Cards', '<Card title="Ghost" href="apidoc:page/nope">\nx\n</Card>'),
    )
    expect(html).toContain('md-card-broken')
    expect(html).toContain('apidoc-op-broken')
    expect(html).not.toContain('<a class="md-card"')
  })

  it('renders steps as an ordered list, the title a paragraph and not a heading', () => {
    const html = docsMarkdownToHtml(
      container(
        'Steps',
        '<Step title="Install">\n```bash\nnpm i\n```\n</Step>\n\n<Step>\nNo title.\n</Step>',
      ),
    )
    expect(html).toContain('<ol class="md-steps" data-steps>')
    expect(html).toContain('<p class="md-step-title">Install</p>')
    expect(html).toContain('<code class="language-bash">npm i')
    expect(html).not.toContain('<h')
    // The second step declares no title, and gets none rather than an empty one.
    expect(html.match(/md-step-title/g)).toHaveLength(1)
  })

  it('renders prose tabs as labelled panels, the shape code tabs already use', () => {
    const html = docsMarkdownToHtml(
      container(
        'Tabs',
        '<Tab label="Cloud">\nNothing to install.\n</Tab>\n\n<Tab label="Self-hosted">\n> [!NOTE]\n> Run it.\n</Tab>',
      ),
    )
    expect(html).toContain('<div class="md-prose-tabs" data-prose-tabs>')
    expect(html).toContain('<section data-tab-label="Cloud">')
    expect(html).toContain('<section data-tab-label="Self-hosted">')
    // Full markdown inside a panel: the callout marker reaches the decorator.
    expect(html).toContain('[!NOTE]')
  })

  it('leaves a container written inside a code fence literal', () => {
    const source = ['```markdown', '<Steps>', '', '<Step>x</Step>', '', '</Steps>', '```'].join(
      '\n',
    )
    const html = docsMarkdownToHtml(source)
    expect(html).toContain('&lt;Steps&gt;')
    expect(html).not.toContain('md-steps')
  })

  it('is not our token when a required attribute is missing', () => {
    const source = container('Cards', '<Card title="No destination">\nx\n</Card>')
    expect(docsMarkdownToHtml(source)).not.toContain('md-cards')
    // Degraded, not swallowed: the prose inside survives to the sanitizer.
    expect(docsMarkdownToHtml(source)).toContain('x')
  })

  it('is not our token when a child is never closed', () => {
    const source = '<Tabs>\n\n<Tab label="Cloud">\nx\n\n</Tabs>\n'
    expect(docsMarkdownToHtml(source)).not.toContain('md-prose-tabs')
  })

  it('is not our token when the container is never closed', () => {
    const source = '<Steps>\n\n<Step title="a">\nx\n</Step>\n'
    expect(docsMarkdownToHtml(source)).not.toContain('md-steps')
  })

  it('ignores an unknown attribute and drops what is not a child', () => {
    const html = docsMarkdownToHtml(
      container(
        'Steps',
        'Stray prose.\n\n<Step title="a" icon="rocket">\nkept\n</Step>\n\nMore stray prose.',
      ),
    )
    expect(html).toContain('kept')
    expect(html).not.toContain('rocket')
    expect(html).not.toContain('Stray prose')
    expect(html).not.toContain('More stray prose')
  })

  it('leaves a {{var}} untouched for the post-sanitize walk (§12)', () => {
    const html = docsMarkdownToHtml(
      container('Steps', '<Step title="Authenticate">\nYour key: `{{apiKey}}`.\n</Step>'),
    )
    expect(html).toContain('{{apiKey}}')
  })

  it('accepts the tags without blank lines around them', () => {
    const html = docsMarkdownToHtml(
      '<Tabs>\n<Tab label="A">\none\n</Tab>\n<Tab label="B">\ntwo\n</Tab>\n</Tabs>\n',
    )
    expect(html).toContain('data-tab-label="A"')
    expect(html).toContain('data-tab-label="B"')
  })

  it('leaves the rest of the page alone after a container', () => {
    const html = docsMarkdownToHtml(`${container('Steps', '<Step>\nx\n</Step>')}\n## After\n`)
    expect(html).toContain('<h2>After</h2>')
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
