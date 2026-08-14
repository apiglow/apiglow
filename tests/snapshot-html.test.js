import { describe, expect, it } from 'vitest'
import { toSnapshotHtml } from '../src/export/snapshot-html.js'

// The static page a crawler and a human both land on (docs/seo.md §4). It is
// the one surface of this project rendered with no DOM and no DOMPurify, so
// what the template refuses to emit is the whole of its safety.

const markdown = [
  '# List pets',
  '',
  'Returns every pet, `{{petId}}` included.',
  '',
  '```http',
  'GET https://api.example.com/pets',
  '```',
  '',
  '| Name | Type |',
  '| ---- | ---- |',
  '| id   | int  |',
].join('\n')

const options = {
  markdown,
  title: 'List pets — Petstore',
  description: 'Returns every pet.',
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'APIReference',
    name: 'List pets',
    identifier: 'listPets',
  },
  canonical: 'https://docs.example.com/api/op/listPets.html',
  appUrl: 'https://docs.example.com/api/index.html#/op/listPets',
  markdownUrl: 'https://docs.example.com/api/op/listPets.md',
  llmsUrl: 'https://docs.example.com/api/llms.txt',
}

describe('baked HTML snapshot', () => {
  it('wraps the mirror in the head a crawler reads', () => {
    expect(toSnapshotHtml(options)).toMatchSnapshot()
  })

  // Honest static content, not a cloaking trampoline: what the crawler reads
  // is what the reader reads, and the app is one link away.
  it('carries no script and no redirect', () => {
    const html = toSnapshotHtml(options)
    expect(html).not.toMatch(/<script(?![^>]*application\/ld\+json)/)
    expect(html).not.toContain('http-equiv="refresh"')
    expect(html).toContain(
      '<a href="https://docs.example.com/api/index.html#/op/listPets">Open in the interactive documentation</a>',
    )
  })

  // The documented fallback (§4): a build-time mirror degrades where the
  // runtime view stays rich, rather than shipping markup nothing sanitized.
  it('escapes raw HTML instead of rendering it', () => {
    const html = toSnapshotHtml({
      markdown: 'Text <img src=x onerror="alert(1)"> and\n\n<div onclick="x()">a block</div>',
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<div')
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).toContain('&lt;div onclick=&quot;x()&quot;&gt;a block&lt;/div&gt;')
  })

  // marked stopped filtering URLs on the assumption a sanitizer runs after it.
  // Here nothing does, and the prose comes from a schema we did not write.
  it('drops a destination that could execute, and keeps the ones that cannot', () => {
    const html = toSnapshotHtml({
      markdown: [
        '[bad](javascript:alert(1))',
        '[spaced](java script:alert(2))',
        '[img](vbscript:x) ![i](data:text/html,<script>)',
        '[ok](https://a.example/x) [rel](./other.md) [mail](mailto:a@b.example)',
      ].join('\n\n'),
    })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('vbscript:')
    expect(html).not.toContain('data:text/html')
    expect(html).toContain('<a href="https://a.example/x">ok</a>')
    expect(html).toContain('<a href="./other.md">rel</a>')
    expect(html).toContain('<a href="mailto:a@b.example">mail</a>')
    // Dropping the destination keeps the words: the sentence still reads.
    expect(html).toContain('bad')
  })

  // Same guard as `shell/head.js` on the same objects: a description carrying
  // the closing tag would end the element from the inside.
  it('never lets JSON-LD close its own element', () => {
    const html = toSnapshotHtml({
      jsonLd: { '@type': 'TechArticle', description: 'a </script><img> b' },
    })
    expect(html).not.toContain('</script><img>')
    expect(html).toContain('\\u003c/script>')
  })

  it('declares the language, the Markdown mirror and the covering llms.txt', () => {
    const html = toSnapshotHtml({ ...options, lang: 'fr' })
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain(
      '<link rel="alternate" type="text/markdown" href="https://docs.example.com/api/op/listPets.md">',
    )
    expect(html).toContain('<link rel="describedby" href="https://docs.example.com/api/llms.txt">')
  })

  // The bake resolves the chrome from the bundle `--language` selected; the
  // generator itself stays free of the i18n runtime.
  it('takes its chrome text from the caller', () => {
    expect(
      toSnapshotHtml({ ...options, labels: { openApp: 'Ouvrir la documentation' } }),
    ).toContain('>Ouvrir la documentation</a>')
  })

  it('omits what the caller did not give it', () => {
    const html = toSnapshotHtml({ markdown: '# Bare' })
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('rel="describedby"')
    expect(html).not.toContain('name="description"')
    expect(html).not.toContain('ld+json')
    expect(html).not.toContain('<p class="snapshot-open">')
    expect(html).toContain('<h1>Bare</h1>')
  })
})
