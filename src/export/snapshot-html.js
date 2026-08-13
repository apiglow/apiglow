// The static page the bake writes for each route (docs/seo.md §4): the
// Markdown mirror rendered once, wrapped in the head a crawler reads and a
// link back into the interactive documentation. Pure function, snapshot-tested.
//
// No script and no redirect. The snapshot is honest static content, not a
// cloaking trampoline: what a crawler reads is what a human landing here from
// a search result reads, and the interactive documentation is one link away.
//
// Two sanitation duties DOMPurify carries at runtime (rule 5) are done here
// instead, because a Node bake has no DOM and jsdom is not a dependency this
// project takes (docs/architecture.md §14.2):
//   - raw HTML inside the Markdown is escaped rather than rendered — the
//     documented fallback, where a build-time mirror degrades and the runtime
//     view stays rich;
//   - a link or image destination that could execute is dropped. marked stopped
//     filtering URLs on the assumption that a sanitizer runs after it, and here
//     nothing does: `[click](javascript:…)` inside a schema description would
//     otherwise ship as a live link on a page we generated.

import { Marked } from 'marked'

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(value) {
  return String(value ?? '').replaceAll(/[&<>"']/g, (char) => ESCAPES[char])
}

const EXECUTABLE_FREE = new Set(['http', 'https', 'mailto', 'tel'])

// The scheme is what precedes the first colon, and only when no `/`, `?` or `#`
// comes first — `docs/ref:1` is a relative path, not a `docs/ref` scheme.
// Whitespace and control characters go before the test because a browser drops
// them before parsing: `java\tscript:alert(1)` is a live URL to everything but
// a naive reader.
function safeUrl(href) {
  const raw = String(href ?? '').trim()
  // Everything up to the space character — whitespace and the C0 controls in
  // one comparison, without a control character written into a regexp.
  const probe = [...raw].filter((char) => char > ' ').join('')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe.split(/[/?#]/)[0])
  if (!scheme) return raw
  return EXECUTABLE_FREE.has(scheme[1].toLowerCase()) ? raw : ''
}

const snapshotMarked = new Marked({ async: false, gfm: true })

snapshotMarked.use({
  renderer: {
    html({ text, block }) {
      const escaped = escapeHtml(String(text).trim())
      return block ? `<p>${escaped}</p>\n` : escaped
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens)
      const url = safeUrl(href)
      if (!url) return text
      const label = title ? ` title="${escapeHtml(title)}"` : ''
      return `<a href="${escapeHtml(url)}"${label}>${text}</a>`
    },
    image({ href, title, text }) {
      const url = safeUrl(href)
      if (!url) return escapeHtml(text)
      const label = title ? ` title="${escapeHtml(title)}"` : ''
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${label}>`
    },
  },
})

// Enough to read a long page of prose and code on a phone, and nothing more:
// the snapshot is a fallback surface, and every rule here is one the reader of
// the real documentation never sees.
const STYLE = `:root{color-scheme:light dark}
body{margin:0;padding:2rem 1rem;font:16px/1.6 system-ui,sans-serif}
main{max-width:48rem;margin:0 auto}
.snapshot-open{margin:0 0 2rem;font-weight:600}
pre{overflow-x:auto;padding:.75rem;border-radius:.5rem;background:rgba(127,127,127,.15)}
code{font-size:.9em}
table{border-collapse:collapse}
th,td{border:1px solid rgba(127,127,127,.4);padding:.25rem .5rem;text-align:left}`

// `<` only ever occurs inside a JSON string, and a description carrying
// `</script>` would otherwise close this element from the inside — the guard
// `shell/head.js` applies to the same objects at runtime.
function jsonLdBlock(data) {
  if (!data) return []
  const json = JSON.stringify(data).replaceAll('<', '\\u003c')
  return [`<script type="application/ld+json">${json}</script>`]
}

// `labels` carries the page's own chrome, so the generator stays free of the
// i18n runtime: the bake resolves it from the bundle `--language` selected and
// hands the strings over, English being what a caller that says nothing gets.
// The keys are named here rather than in the CLI so the catalog guard (rule 9)
// can see that this string is asked for.
export const SNAPSHOT_LABEL_KEYS = { openApp: 'snapshot.openApp' }
const DEFAULT_LABELS = { openApp: 'Open in the interactive documentation' }

export function toSnapshotHtml({
  markdown = '',
  title = '',
  description = '',
  jsonLd = null,
  canonical = '',
  appUrl = '',
  markdownUrl = '',
  lang = 'en',
  labels = {},
} = {}) {
  const { openApp } = { ...DEFAULT_LABELS, ...labels }
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : '',
    // The one canonical the strategy allows: a served URL, pointing at itself.
    // Under hash routing the app has no per-route URL to claim (docs/seo.md §3).
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : '',
    // The mirror an agent fetches, declared where a crawler already looks for
    // alternate representations rather than only inside `llms.txt`.
    markdownUrl
      ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(markdownUrl)}">`
      : '',
    ...jsonLdBlock(jsonLd),
    `<style>${STYLE}</style>`,
  ].filter(Boolean)

  const body = [
    '<main>',
    appUrl
      ? `<p class="snapshot-open"><a href="${escapeHtml(appUrl)}">${escapeHtml(openApp)}</a></p>`
      : '',
    '<article>',
    snapshotMarked.parse(markdown).trim(),
    '</article>',
    '</main>',
  ].filter(Boolean)

  const html = [
    '<!doctype html>',
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    ...head,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
  ]
  return `${html.join('\n')}\n`
}
