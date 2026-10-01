import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { blankCode } from '../src/audit/markdown-text.js'
import { documentHasOperations } from '../src/audit/rules/document-has-operations.js'
import { markdownLinks } from '../src/audit/rules/markdown-links.js'
import { markdownUnsafe } from '../src/audit/rules/markdown-unsafe.js'
import { operationSummaryPresent } from '../src/audit/rules/operation-summary-present.js'
import { operationSummaryStyle } from '../src/audit/rules/operation-summary-style.js'
import { placeholderText } from '../src/audit/rules/placeholder-text.js'
import { tagDeclared } from '../src/audit/rules/tag-declared.js'
import { tagDescribed } from '../src/audit/rules/tag-described.js'
import { tagUnused } from '../src/audit/rules/tag-unused.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// Prose, Markdown and navigation rules (docs/audit.md §4.2 and §4.5).

const run = (rule, document) => runRule(rule, auditContext(document))
const op = (extra = {}) => ({ responses: okResponse, ...extra })
const described = (description) => doc({ paths: { '/a': { get: op({ description }) } } })
const LONG = 'Lists the pets of the store, newest first.'

describe('placeholder-text', () => {
  it('passes real labels and skips blank ones', () => {
    const result = run(
      placeholderText,
      doc({
        openapi: '3.2.0',
        info: { title: 'Pet Store', summary: 'Sell pets online', version: '1' },
        tags: [
          { name: 'pets', summary: 'Pets' },
          { name: 'store', summary: '  ' },
        ],
        paths: { '/a': { get: op({ responses: { 200: { summary: 'The pet' } } }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 4, findings: [] })
  })

  it('flags a placeholder in each label field', () => {
    const result = run(
      placeholderText,
      doc({
        openapi: '3.2.0',
        info: { title: 'Title', summary: 'TODO', version: '1' },
        tags: [{ name: 'pets', summary: 'tbd' }],
        paths: { '/a': { get: op({ responses: { 200: { summary: 'string' } } }) } },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params, f.opRef ?? f.location])).toEqual([
      ['/info/title', { field: 'info.title', value: 'Title' }, 'info.title'],
      ['/info/summary', { field: 'info.summary', value: 'TODO' }, 'info.summary'],
      [
        '/paths/~1a/get/responses/200/summary',
        { field: 'responses.summary', value: 'string' },
        'get-a',
      ],
      ['/tags/0/summary', { field: 'tags.summary', value: 'tbd' }, 'tags.0.summary'],
    ])
    expect(result.findings[0].severity).toBe('warning')
  })
})

describe('operation-summary-present', () => {
  it('passes a described operation with a summary, and skips one without a description', () => {
    const result = run(
      operationSummaryPresent,
      doc({
        paths: {
          '/a': { get: op({ summary: 'List pets', description: LONG }), post: op() },
          '/b': { get: op({ summary: 'Only a summary' }) },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a described operation and webhook named by their path, name or placeholder', () => {
    const result = run(
      operationSummaryPresent,
      doc({
        paths: {
          '/pets/{id}': {
            get: op({
              description: LONG,
              callbacks: {
                onEvent: { '{$request.body#/url}': { post: op({ description: LONG }) } },
              },
            }),
            put: op({ summary: 'TODO', description: LONG }),
          },
        },
        webhooks: { petAdopted: { post: op({ description: LONG }) } },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.dataPath, f.params.label])).toEqual([
      ['/paths/~1pets~1{id}/get/summary', '/pets/{id}'],
      ['/paths/~1pets~1{id}/put/summary', 'TODO'],
      ['/webhooks/petAdopted/post/summary', 'petAdopted'],
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'info', category: 'readiness' })
  })
})

describe('operation-summary-style', () => {
  it('passes plain summaries and skips blank ones', () => {
    const result = run(
      operationSummaryStyle,
      doc({
        paths: {
          '/a': {
            get: op({ summary: 'List pets (paginated) — 2 * 3 < 7' }),
            put: op({ summary: ' ' }),
            post: op(),
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags Markdown, HTML and line breaks, callbacks included', () => {
    const summaries = [
      '**Create** a pet',
      'Delete a __pet__',
      'Get the `Pet`',
      'See [docs](https://x.example)',
      'Update <b>now</b>',
      'Two\nlines',
    ]
    const methods = ['post', 'delete', 'get', 'head', 'patch', 'put']
    const pathItem = Object.fromEntries(
      methods.map((method, index) => [method, op({ summary: summaries[index] })]),
    )
    pathItem.options = op({
      callbacks: { cb: { '{$request.body#/url}': { post: op({ summary: '*Event* `x`' }) } } },
    })
    const result = run(operationSummaryStyle, doc({ paths: { '/a': pathItem } }))
    expect(result.checks).toBe(7)
    // In path-item order: get, put, post, delete, options (its callback), head, patch.
    expect(result.findings.map((f) => f.params.markup)).toEqual([
      '`',
      '↵',
      '**',
      '__',
      '`',
      '[docs](https://x.example)',
      '<b>',
    ])
  })
})

describe('tag-described', () => {
  it('passes a tag whose description says something, label tags included', () => {
    const result = run(
      tagDescribed,
      doc({
        openapi: '3.2.0',
        tags: [
          { name: 'pets', description: 'Adopt, list and retire pets.' },
          { name: 'beta', kind: 'badge', description: 'Shape may still change.' },
        ],
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags a missing description, a name read back and a placeholder', () => {
    const result = run(
      tagDescribed,
      doc({
        tags: [
          { name: 'pets' },
          { name: 'userAccounts', description: 'User accounts' },
          { name: 'store', description: 'TODO' },
        ],
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.location, f.params.name])).toEqual([
      ['/tags/0/description', 'tags.0', 'pets'],
      ['/tags/1/description', 'tags.1', 'userAccounts'],
      ['/tags/2/description', 'tags.2', 'store'],
    ])
  })
})

describe('tag-declared', () => {
  it('passes declared tags and ignores webhook tags', () => {
    const result = run(
      tagDeclared,
      doc({
        tags: [{ name: 'pets' }],
        paths: { '/a': { get: op({ tags: ['pets'] }), post: op({ tags: ['pets'] }) } },
        webhooks: { w: { post: op({ tags: ['events'] }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags each undeclared tag once, on the first operation carrying it', () => {
    const result = run(
      tagDeclared,
      doc({
        tags: [{ name: 'pets' }],
        paths: {
          '/a': { get: op({ tags: ['pets', 'store'] }), post: op({ tags: ['store'] }) },
          '/b': { get: op({ tags: ['users', 42] }) },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.dataPath, f.opRef, f.params.name])).toEqual([
      ['/paths/~1a/get/tags/1', 'get-a', 'store'],
      ['/paths/~1b/get/tags/0', 'get-b', 'users'],
    ])
  })
})

describe('tag-unused', () => {
  it('passes tags carried by an operation, a webhook, a callback, or a carried tag’s parent', () => {
    const result = run(
      tagUnused,
      doc({
        openapi: '3.2.0',
        tags: [
          { name: 'pets' },
          { name: 'events' },
          { name: 'hooks' },
          { name: 'animals' },
          { name: 'dogs', parent: 'animals' },
        ],
        paths: {
          '/a': {
            get: op({
              tags: ['pets'],
              callbacks: { cb: { '{$request.body#/url}': { post: op({ tags: ['hooks'] }) } } },
            }),
            post: op({ tags: ['dogs'] }),
          },
        },
        webhooks: { w: { post: op({ tags: ['events'] }) } },
      }),
    )
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('flags a tag nothing carries, and survives a parent loop', () => {
    const result = run(
      tagUnused,
      doc({
        openapi: '3.2.0',
        tags: [
          { name: 'pets' },
          { name: 'legacy' },
          { name: 'a', parent: 'b' },
          { name: 'b', parent: 'a' },
        ],
        paths: { '/a': { get: op({ tags: ['pets', 'a'] }) } },
      }),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((f) => [f.dataPath, f.location, f.params.name])).toEqual([
      ['/tags/1', 'tags.1', 'legacy'],
    ])
  })
})

describe('markdown text', () => {
  it('blanks code spans, fenced and indented code, and HTML comments, keeping offsets', () => {
    const text = 'a `<x>` b\n\n```\n<script>\n```\n\n    <iframe>\n\nc <!-- <svg> --> d ``e`f``'
    const code = blankCode(text)
    expect(code).toHaveLength(text.length)
    expect(code.split('\n').length).toBe(text.split('\n').length)
    expect(code).not.toMatch(/[<`]/)
    expect(code).toMatch(/^a +b$/m)
    expect(code).toMatch(/^c +d +$/m)
  })

  it('leaves an escaped backtick and an unmatched one as text', () => {
    expect(blankCode('\\`a` <b>')).toBe('\\`a` <b>')
  })
})

describe('markdown-unsafe', () => {
  it('has nothing to check in a description without HTML or links', () => {
    const result = run(markdownUnsafe, described('Plain **Markdown**, `<script>` in code.'))
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('passes the HTML and links the sanitizer keeps', () => {
    const descriptions = [
      '<b>bold</b> <details open><summary>More</summary>text</details>',
      '<a href="https://example.com" title="x" data-id="1" aria-label="y">x</a>',
      '<img src="data:image/png;base64,AAAA" alt="dot" width="10">',
      '![dot](data:image/png;base64,AAAA) [mail](mailto:a@b.example) [rel](./a.md)',
      'Map<String, Object> and \\<div> stay text',
      '<table><tr><td align="center">1</td></tr></table>',
    ]
    const paths = Object.fromEntries(
      descriptions.map((description, index) => [`/p${index}`, { get: op({ description }) }]),
    )
    const result = run(markdownUnsafe, doc({ paths }))
    expect(result.checks).toBe(5)
    expect(result.findings).toEqual([])
  })

  it('flags the first stripped construct, as written', () => {
    const descriptions = [
      'Watch: <iframe src="https://video.example"></iframe>',
      '<div onclick="go()">x</div>',
      '<a href="javascript:alert(1)">x</a>',
      '[x](vbscript:msgbox) then <script>',
      '[file](data:application/json,{}) download',
      'Returns a List<Pet>.',
      'GET /users/<id>',
      '<button>Pay</button> <style>body{}</style>',
      '<a href="https://x.example" target="_blank">x</a>',
      '<SVG><circle/></SVG>',
      '<div for="x">y</div>',
    ]
    const paths = Object.fromEntries(
      descriptions.map((description, index) => [
        `/p${String(index).padStart(2, '0')}`,
        { get: op({ description }) },
      ]),
    )
    const result = run(markdownUnsafe, doc({ paths }))
    expect(result.checks).toBe(11)
    expect(result.findings.map((f) => f.params.construct)).toEqual([
      '<iframe>',
      'onclick',
      'javascript:',
      'vbscript:',
      'data:',
      '<Pet>',
      '<id>',
      '<button>',
      'target',
      '<SVG>',
      'for',
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      category: 'readiness',
      opRef: 'get-p00',
      dataPath: '/paths/~1p00/get/description',
    })
  })

  it('reads every CommonMark description, schemas and components included, each once', () => {
    const shared = { type: 'string', description: 'A <link rel="x">' }
    const result = run(
      markdownUnsafe,
      doc({
        info: { title: 'A', version: '1', description: '<script>x</script>' },
        servers: [{ url: 'https://a.example', description: '<embed src="x">' }],
        tags: [{ name: 't', description: '<object data="x"></object>' }],
        components: { schemas: { Shared: shared, Other: { $ref: '#/components/schemas/Shared' } } },
        paths: {
          '/a': {
            get: op({
              parameters: [{ name: 'q', in: 'query', schema: shared, description: '<math>' }],
            }),
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.construct])).toEqual([
      ['/info/description', '<script>'],
      ['/servers/0/description', '<embed>'],
      ['/paths/~1a/get/parameters/0/description', '<math>'],
      ['/paths/~1a/get/parameters/0/schema/description', '<link>'],
      ['/tags/0/description', '<object>'],
    ])
  })
})

describe('markdown-links', () => {
  it('passes absolute targets, fragments and protocol-relative links', () => {
    const descriptions = [
      'See [the guide](https://docs.example.com/guide) and [errors](#errors).',
      '![logo](//cdn.example.com/logo.png) <a href="mailto:a@b.example">mail</a>',
      '[route](#/op/listPets) [empty]()',
    ]
    const paths = Object.fromEntries(
      descriptions.map((description, index) => [`/p${index}`, { get: op({ description }) }]),
    )
    const result = run(markdownLinks, doc({ paths }))
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('has nothing to check without a link, and ignores links in code', () => {
    const result = run(markdownLinks, described('No link here; `[x](./y.md)` is code.'))
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags the first relative target of each field', () => {
    const descriptions = [
      'See [auth](./auth.md) and [more](../more.md).',
      '![diagram](diagram.png)',
      'Read [the errors][errors].\n\n[errors]: /docs/errors "Errors"',
      '<a href="guide.html">guide</a> and <img src="img/x.png">',
      '[x](https://a.example) then [y](<../y z.md>)',
      'A [query](?page=2) link',
    ]
    const paths = Object.fromEntries(
      descriptions.map((description, index) => [`/p${index}`, { get: op({ description }) }]),
    )
    const result = run(markdownLinks, doc({ paths }))
    expect(result.checks).toBe(6)
    expect(result.findings.map((f) => f.params.target)).toEqual([
      './auth.md',
      'diagram.png',
      '/docs/errors',
      'guide.html',
      '../y z.md',
      '?page=2',
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'warning', opRef: 'get-p0' })
  })

  it('ignores an unused definition, a footnote and a stripped iframe', () => {
    const result = run(
      markdownLinks,
      described(
        'Text [ok](https://a.example).\n\n[unused]: ./nowhere.md\n\n[^1]: note\n\n<iframe src="./x"></iframe>',
      ),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('document-has-operations', () => {
  it('passes a document with an operation, or with only webhooks', () => {
    expect(run(documentHasOperations, doc({ paths: { '/a': { get: op() } } }))).toMatchObject({
      checks: 1,
      findings: [],
    })
    expect(
      run(documentHasOperations, doc({ paths: {}, webhooks: { w: { post: op() } } })),
    ).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a document with nothing to document', () => {
    const result = run(
      documentHasOperations,
      doc({ paths: { '/a': { parameters: [] } }, components: { schemas: { A: {} } } }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        location: 'paths',
        dataPath: '/paths',
        params: {},
      }),
    ])
  })
})
