import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import go from 'highlight.js/lib/languages/go'
import http from 'highlight.js/lib/languages/http'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import xml from 'highlight.js/lib/languages/xml'
import { marked } from 'marked'
import { docsMarkdownToHtml } from '../docs/markdown.js'
import { headingIds } from '../docs/sections.js'

// All HTML coming from external content (OpenAPI descriptions, .md pages) goes
// through DOMPurify, without exception (rule 5).

// Lightweight hljs build (docs/architecture.md §2): only the languages useful to an API doc.
// Token colors are defined in app.css on the DaisyUI theme
// variables — no embedded hljs stylesheet.
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('http', http)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('php', php)
hljs.registerLanguage('go', go)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('java', java)
hljs.registerLanguage('csharp', csharp)

function sanitize(html) {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

// <details>/<summary> mixed into Markdown (schema changelogs): marked
// treats the whole HTML block up to the first blank line as raw HTML,
// which freezes the Markdown it contains. Isolating these tags onto their own
// paragraphs hands the content back to the Markdown parser.
function isolateDetailsTags(source) {
  return String(source)
    .replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, (m) => `\n\n${m}\n\n`)
    .replace(/<\/?details[^>]*>/gi, (m) => `\n\n${m}\n\n`)
}

// Full Markdown block → <div class="md-content"> styled by app.css.
export function markdownBlock(source) {
  if (!source) return null
  const div = document.createElement('div')
  div.className = 'md-content'
  div.innerHTML = sanitize(marked.parse(isolateDetailsTags(source), { async: false }))
  return div
}

// Docs page (docs/docs-pages.md §4.1): same sanitization, richer markdown —
// frontmatter stripped, adjacent fences grouped, `apidoc:` references
// resolved. Kept apart from `markdownBlock` on purpose: those enrichments are
// a prose feature, and an OpenAPI description has no business growing tabs.
export function docsMarkdownBlock(source) {
  if (!source) return null
  const div = document.createElement('div')
  div.className = 'md-content'
  div.innerHTML = sanitize(docsMarkdownToHtml(isolateDetailsTags(source)))
  return div
}

// Docs page authored as HTML (docs/docs-pages.md §4.1): the same DOMPurify
// profile as every other external content (rule 5). The markdown-only
// enrichments deliberately do not apply — the author wrote HTML, and
// re-scanning it for fence runs or alert markers would be guesswork.
export function htmlBlock(source) {
  const div = document.createElement('div')
  div.className = 'md-content'
  div.innerHTML = sanitize(String(source ?? ''))
  return div
}

// Inline variant (no <p>) for short descriptions in a cell/row.
export function markdownInline(source) {
  if (!source) return null
  const span = document.createElement('span')
  span.className = 'md-content'
  span.innerHTML = sanitize(marked.parseInline(String(source), { async: false }))
  return span
}

// Syntax highlighting for already-sanitized code blocks.
export function highlightCode(root) {
  for (const block of root.querySelectorAll('pre code')) hljs.highlightElement(block)
}

// Highlighting of a source whose language is known, rendered as HTML ready to
// inject. hljs already escapes HTML but the source contains user
// input: DOMPurify runs behind it on principle (rule 5). Unlike
// highlightElement, reusable on the same node on every refresh.
export function highlightSource(code, language) {
  return sanitize(hljs.highlight(String(code), { language }).value)
}

// Re-indented body, or null if it's not JSON: an API responds minified,
// and a body on a single line isn't readable. Here rather than in each
// response view (try-it, webhook simulator, history) — it's the same
// need and the same response.
export function prettyJson(textBody) {
  try {
    return JSON.stringify(JSON.parse(textBody), null, 2)
  } catch {
    return null
  }
}

// Heading anchors (docs/architecture.md §5.8): id = slug of the text (uniquified), ¶ link whose
// href is provided by the caller (the page component knows its route).
export function decorateHeadings(root, makeHref) {
  // Same id assignment as the search index's section splitter, shared rather
  // than reimplemented: a result's anchor has to be the id this page carries.
  const nextId = headingIds()
  for (const heading of root.querySelectorAll('h1, h2, h3, h4')) {
    const id = nextId(heading.textContent)
    heading.id = id
    const link = document.createElement('a')
    link.href = makeHref(id)
    link.textContent = '¶'
    link.className = 'md-anchor'
    // Hidden from the accessibility tree AND from the tab order: an
    // aria-hidden element that keeps focus is a violation in its own right,
    // and a screen-reader user tabbing onto an unnamed link would have no way
    // to know what they landed on. The heading itself is the destination.
    link.setAttribute('aria-hidden', 'true')
    link.tabIndex = -1
    heading.append(link)
  }
}
