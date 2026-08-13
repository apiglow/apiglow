// Markdown pipeline of the docs pages (docs/docs-pages.md §4). Separate from
// `components/markdown.js`, which renders the OpenAPI document's own
// descriptions: the enrichments below are a prose feature, and a schema
// description has no business growing tabs.
//
// Pure module — HTML in, HTML out. Sanitization, heading anchors, callout and
// tab decoration all happen on the DOM side, where they belong.

import { Marked } from 'marked'
import { methodBadgeClass } from '../components/method-colors.js'
import { t } from '../i18n/index.js'
import { opHash } from '../router.js'
import { lookupOperation } from './operations.js'

// A leading YAML block is stripped and ignored (§4.1): files authored for
// another tool render cleanly here, and using its fields is a future track —
// silently rendering `title: …` as a paragraph is the one outcome nobody
// wants.
const FRONTMATTER = /^---[^\S\n]*\r?\n[\s\S]*?\r?\n---[^\S\n]*(?:\r?\n|$)/

export function stripFrontmatter(source) {
  return String(source ?? '').replace(FRONTMATTER, '')
}

// Scheme of the API references (§4.4), on a link destination or as a fence
// language.
const APIDOC_SCHEME = 'apidoc:'
const OPERATION_FENCE = 'apidoc:operation'

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[^\S\n]*(.*)$/

// A run of fenced blocks with NO blank line between them (§4.3). Returns null
// as soon as the shape isn't one — a single fence, an unterminated one — and
// marked's own tokenizer takes over unchanged.
function readFenceRun(src) {
  // marked offers every block token the WHOLE remaining document, so this runs
  // once per block of the page: splitting before knowing whether the first
  // line even opens a fence makes the parse quadratic in page length.
  const firstBreak = src.indexOf('\n')
  if (!FENCE_OPEN.test(firstBreak === -1 ? src : src.slice(0, firstBreak))) return null
  const lines = src.split('\n')
  const blocks = []
  let cursor = 0
  while (cursor < lines.length) {
    const open = FENCE_OPEN.exec(lines[cursor])
    if (!open) break
    const fence = open[1]
    const info = open[2].trim()
    const body = []
    // A closing fence is the same character, at least as long, alone on its
    // line (CommonMark). Depends only on the opener, so it is built once per
    // block rather than once per line of it.
    const closing = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[^\\S\\n]*$`)
    cursor += 1
    let closed = false
    while (cursor < lines.length) {
      if (closing.test(lines[cursor])) {
        closed = true
        cursor += 1
        break
      }
      body.push(lines[cursor])
      cursor += 1
    }
    // Unterminated: this isn't a tab group, and guessing where it ends would
    // swallow the rest of the page.
    if (!closed) return null
    // An `apidoc:` block is not a language variant of the snippet next to it.
    if (info.startsWith(APIDOC_SCHEME)) return null
    blocks.push({ info, code: body.join('\n') })
  }
  // Adjacency is what opts in. One block is a plain code block, and blocks
  // separated by a blank line stay independent — which is also what makes the
  // syntax degrade to sequential blocks on GitHub.
  if (blocks.length < 2) return null
  // `cursor < lines.length` is exactly "the run did not end at EOF", so the
  // trailing newline is known without comparing the consumed text back.
  const consumed = lines.slice(0, cursor).join('\n')
  return { blocks, raw: cursor < lines.length ? `${consumed}\n` : consumed }
}

// ```js Node.js → language `js`, label "Node.js". Without a label the language
// names the tab; the language is also the sync key, so two pages labeling
// their JavaScript tab differently still follow one another.
function fenceTab({ info, code }) {
  const [lang = '', ...rest] = info.split(/\s+/)
  const label = rest.join(' ') || lang || 'text'
  return { lang: lang.toLowerCase(), label, code }
}

// The renderer emits plain adjacent <pre> blocks inside a marked container:
// with the DOM decoration, a tab group; without it (an export, a copy-paste),
// still every snippet in order, none hidden. `data-*` attributes survive
// DOMPurify, which is what lets the decorator work after sanitization.
const codeTabs = {
  name: 'codeTabs',
  level: 'block',
  start(src) {
    return src.match(/^ {0,3}(`{3,}|~{3,})/m)?.index
  },
  tokenizer(src) {
    const run = readFenceRun(src)
    if (!run) return undefined
    return { type: 'codeTabs', raw: run.raw, tabs: run.blocks.map(fenceTab) }
  },
  renderer(token) {
    const panels = token.tabs
      .map(
        (tab) =>
          `<pre data-tab-label="${escapeHtml(tab.label)}" data-tab-lang="${escapeHtml(tab.lang)}">` +
          `<code${tab.lang ? ` class="language-${escapeHtml(tab.lang)}"` : ''}>` +
          `${escapeHtml(tab.code)}\n</code></pre>`,
      )
      .join('')
    return `<div class="code-tabs" data-code-tabs>${panels}</div>`
  },
}

// --- API references (§4.4) -------------------------------------------------

// `[list pets](apidoc:GET /pets)` is the syntax the spec documents, and a
// markdown link destination cannot hold a space unless it travels in angle
// brackets. Rewriting it here means authors write the documented form and
// CommonMark still gets a legal destination.
const BARE_APIDOC_DEST = /\]\((apidoc:[^()\n<>]*)\)/g

function bracketApidocLinks(source) {
  return source.replace(BARE_APIDOC_DEST, (_, dest) => `](<${dest.trim()}>)`)
}

function methodBadge(method) {
  return `<span class="${methodBadgeClass(method)}">${escapeHtml(method)}</span>`
}

// An unresolvable reference renders as visibly broken, never as a dead link:
// same philosophy as rule 11's missing variable — a mistake is signaled where
// it was made, not silently shipped.
function brokenRef(ref, label) {
  return (
    `<span class="apidoc-op-broken" title="${escapeHtml(t('page.opRef.missing', { ref }))}">` +
    `${label}</span>`
  )
}

const apidocLinkRenderer = {
  link({ href, tokens }) {
    if (!String(href ?? '').startsWith(APIDOC_SCHEME)) return false
    const ref = String(href).slice(APIDOC_SCHEME.length)
    const label = this.parser.parseInline(tokens)
    const op = lookupOperation(ref)
    if (!op) return brokenRef(ref, label)
    // Built through the router, never as a literal `#/op/…`: the multi-spec
    // prefix is decided there, and a hand-written hash would drop it.
    return (
      `<a class="apidoc-op-link" href="${escapeHtml(opHash(op.id))}">` +
      `${methodBadge(op.method)}${label}</a>`
    )
  },
}

function operationCard(ref) {
  const op = lookupOperation(ref)
  if (!op) {
    return `<div class="apidoc-op-card apidoc-op-card-broken">${escapeHtml(
      t('page.opRef.missing', { ref }),
    )}</div>`
  }
  const summary = op.summary
    ? `<span class="apidoc-op-summary">${escapeHtml(op.summary)}</span>`
    : ''
  const deprecated = op.deprecated
    ? `<span class="badge badge-warning badge-xs shrink-0">${escapeHtml(t('doc.deprecated'))}</span>`
    : ''
  // Accessible name spelled out: "GET /pets — List all pets" reads as one
  // destination, where the raw children would read as three.
  const name = [`${op.method.toUpperCase()} ${op.path}`, op.summary].filter(Boolean).join(' — ')
  return (
    `<a class="apidoc-op-card" href="${escapeHtml(opHash(op.id))}" aria-label="${escapeHtml(name)}">` +
    `${methodBadge(op.method)}<code class="apidoc-op-path">${escapeHtml(op.path)}</code>` +
    `${summary}${deprecated}</a>`
  )
}

// A fenced block, one reference per line. In a plain renderer it degrades to a
// legible code fence listing those references — useful when rendered,
// harmless when not. The card is a LINK, never an editable surface: rule 20
// is deliberately not in play here (§4.4).
const operationCardsRenderer = {
  code({ text, lang }) {
    if (String(lang ?? '').trim() !== OPERATION_FENCE) return false
    const refs = String(text)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (!refs.length) return false
    return `<div class="apidoc-op-cards">${refs.map(operationCard).join('')}</div>`
  },
}

const docsMarked = new Marked({ async: false, gfm: true })
docsMarked.use({ extensions: [codeTabs] })
docsMarked.use({ renderer: { ...apidocLinkRenderer, ...operationCardsRenderer } })

// → raw HTML, still to be sanitized by the caller (rule 5).
export function docsMarkdownToHtml(source) {
  return docsMarked.parse(bracketApidocLinks(stripFrontmatter(source)), { async: false })
}
