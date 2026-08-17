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
import { opHash, pageHash } from '../router.js'
import { lookupOperation } from './operations.js'
import { hasDocsPage } from './pages.js'

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
// The one sub-form of the scheme: everything else after `apidoc:` addresses an
// operation. A docs page is named by its slug because that is its identity —
// files and carried bodies move, the route does not.
const PAGE_REF = 'page/'

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

// One reference → the route it names, or null. Built through the router, never
// as a literal `#/op/…` or `#/page/…`: the multi-spec prefix is decided there,
// and a hand-written hash would drop it.
function resolveApidocRef(ref) {
  if (ref.startsWith(PAGE_REF)) {
    const slug = ref.slice(PAGE_REF.length)
    return hasDocsPage(slug) ? { href: pageHash(slug) } : null
  }
  const op = lookupOperation(ref)
  return op ? { href: opHash(op.id), method: op.method } : null
}

// An unresolvable reference renders as visibly broken, never as a dead link:
// same philosophy as rule 11's missing variable — a mistake is signaled where
// it was made, not silently shipped. The two kinds fail with their own
// sentence: telling an author "no operation matches page/pricing" would send
// them looking in the wrong place.
function brokenRef(ref, label) {
  const message = ref.startsWith(PAGE_REF)
    ? t('page.pageRef.missing', { ref: ref.slice(PAGE_REF.length) })
    : t('page.opRef.missing', { ref })
  return `<span class="apidoc-op-broken" title="${escapeHtml(message)}">${label}</span>`
}

const apidocLinkRenderer = {
  link({ href, tokens }) {
    if (!String(href ?? '').startsWith(APIDOC_SCHEME)) return false
    const ref = String(href).slice(APIDOC_SCHEME.length)
    const label = this.parser.parseInline(tokens)
    const target = resolveApidocRef(ref)
    if (!target) return brokenRef(ref, label)
    // A page reference is an ordinary internal link: the destination is prose
    // like the sentence around it, and there is no method to badge.
    if (!target.method) return `<a href="${escapeHtml(target.href)}">${label}</a>`
    return (
      `<a class="apidoc-op-link" href="${escapeHtml(target.href)}">` +
      `${methodBadge(target.method)}${label}</a>`
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

// --- Prose components (§4.6) -----------------------------------------------

// MDX-shaped syntax, our own parser. `<Steps>` and friends are SYNTAX, not
// components: a block tokenizer consumes them and emits plain semantic HTML
// with `data-*` markers, exactly as `codeTabs` does, so the custom tags never
// reach the DOM and DOMPurify's profile is untouched (rule 5). MDX itself is
// refused — it compiles to JS and evaluates it (§11).
//
// Being a positional block tokenizer is what makes the syntax fence-safe for
// free: marked offers a block to the extensions before its own fence
// tokenizer, so a `<Steps>` written INSIDE a fence is already inside a
// consumed token and renders literally — which a page documenting this
// feature depends on.

const ATTRIBUTE = /([A-Za-z][\w-]*)="([^"\n]*)"/g

function parseAttributes(source) {
  const attrs = {}
  for (const [, name, value] of String(source).matchAll(ATTRIBUTE)) attrs[name] = value
  return attrs
}

// The container's own line, its closing line, and the child tag's two. Every
// tag is alone on its line: that is the house style the syntax is documented
// with, and it is what makes GitHub parse the markdown between them after
// stripping the tags it does not know.
function containerPatterns(tag, child) {
  const attrs = '(?:[ \\t]+[A-Za-z][\\w-]*="[^"\\n]*")*'
  return {
    at: new RegExp(`^ {0,3}<${tag}>`, 'm'),
    open: new RegExp(`^ {0,3}<${tag}>[^\\S\\n]*$`),
    close: new RegExp(`^ {0,3}</${tag}>[^\\S\\n]*$`, 'm'),
    childOpen: new RegExp(`^ {0,3}<${child}(${attrs})[ \\t]*>[^\\S\\n]*$`, 'm'),
    childClose: new RegExp(`^ {0,3}</${child}>[^\\S\\n]*$`, 'm'),
  }
}

// Returns null as soon as the shape isn't one — and that is the whole error
// policy (§4.6): malformed input is not our token, marked handles it as raw
// HTML, DOMPurify drops the unknown tag and the prose inside survives. No
// error marker, because nothing was ever recognized.
function readContainer(src, patterns, required) {
  // marked offers every block token the WHOLE remaining document; testing the
  // first line before doing anything else keeps the parse linear in page
  // length, exactly as `readFenceRun` does.
  const firstBreak = src.indexOf('\n')
  if (firstBreak === -1 || !patterns.open.test(src.slice(0, firstBreak))) return null
  const close = patterns.close.exec(src)
  if (!close) return null
  const children = []
  let rest = src.slice(firstBreak + 1, close.index)
  for (;;) {
    const open = patterns.childOpen.exec(rest)
    if (!open) break
    // Anything between two children — or before the first — is dropped: a
    // container holds its own child tag and nothing else.
    const after = rest.slice(open.index + open[0].length)
    const end = patterns.childClose.exec(after)
    if (!end) return null
    const attrs = parseAttributes(open[1])
    if (required.some((name) => !attrs[name])) return null
    children.push({ attrs, body: after.slice(0, end.index) })
    rest = after.slice(end.index + end[0].length)
  }
  if (!children.length) return null
  const end = close.index + close[0].length
  return { children, raw: src.slice(0, src[end] === '\n' ? end + 1 : end) }
}

// A card grid. The body is full markdown and the title is an attribute, so it
// is escaped text — a heading there would land in the table of contents.
function renderCards(token) {
  const cards = token.children.map((child) => {
    const title = escapeHtml(child.attrs.title)
    const body = `<div class="md-card-body">${this.parser.parse(child.tokens)}</div>`
    const href = child.attrs.href
    // A destination that is not a reference is already its own target: one
    // card markup below, whichever of the two it came from.
    const ref = href.startsWith(APIDOC_SCHEME) ? href.slice(APIDOC_SCHEME.length) : null
    const target = ref === null ? { href } : resolveApidocRef(ref)
    // A reference that resolves to nothing is not a card the reader may
    // follow: same visible failure as a broken link in prose (§4.4).
    if (!target) {
      return (
        `<div class="md-card md-card-broken">` +
        `<span class="md-card-title">${brokenRef(ref, title)}</span>${body}</div>`
      )
    }
    return `<a class="md-card" href="${escapeHtml(target.href)}"><span class="md-card-title">${title}</span>${body}</a>`
  })
  return `<div class="md-cards" data-cards>${cards.join('')}</div>`
}

// An ordered list, because that is what a sequence of steps is. The title is a
// paragraph and NOT a heading: a step title is a label, not a section, and
// inventing a heading level would put junk in the table of contents and break
// the anchor hierarchy. An author who wants the step listed writes a real
// `###` inside it.
function renderSteps(token) {
  const items = token.children.map((child) => {
    const title = child.attrs.title
      ? `<p class="md-step-title">${escapeHtml(child.attrs.title)}</p>`
      : ''
    return `<li>${title}${this.parser.parse(child.tokens)}</li>`
  })
  return `<ol class="md-steps" data-steps>${items.join('')}</ol>`
}

// The same shape `codeTabs` produces — labelled panels in a marked container —
// so the DOM decorator is the same code. Undecorated it is every panel in
// order, none hidden.
function renderTabs(token) {
  const panels = token.children.map(
    (child) =>
      `<section data-tab-label="${escapeHtml(child.attrs.label)}">` +
      `${this.parser.parse(child.tokens)}</section>`,
  )
  return `<div class="md-prose-tabs" data-prose-tabs>${panels.join('')}</div>`
}

// Capitalized and exact (`<Steps>`, not `<steps>`): the JSX convention, and it
// makes the tags unmistakable against real HTML. Containers do not nest, and
// each holds only its own child tag.
const PROSE_COMPONENTS = [
  { name: 'cards', tag: 'Cards', child: 'Card', required: ['title', 'href'], render: renderCards },
  { name: 'steps', tag: 'Steps', child: 'Step', required: [], render: renderSteps },
  { name: 'proseTabs', tag: 'Tabs', child: 'Tab', required: ['label'], render: renderTabs },
]

function proseComponent({ name, tag, child, required, render }) {
  const patterns = containerPatterns(tag, child)
  return {
    name,
    level: 'block',
    start(src) {
      return src.match(patterns.at)?.index
    },
    tokenizer(src) {
      const read = readContainer(src, patterns, required)
      if (!read) return undefined
      return {
        type: name,
        raw: read.raw,
        children: read.children.map(({ attrs, body }) => ({
          attrs,
          tokens: this.lexer.blockTokens(body),
        })),
      }
    },
    renderer: render,
  }
}

const docsMarked = new Marked({ async: false, gfm: true })
docsMarked.use({ extensions: [codeTabs, ...PROSE_COMPONENTS.map(proseComponent)] })
docsMarked.use({ renderer: { ...apidocLinkRenderer, ...operationCardsRenderer } })

// → raw HTML, still to be sanitized by the caller (rule 5).
export function docsMarkdownToHtml(source) {
  return docsMarked.parse(bracketApidocLinks(stripFrontmatter(source)), { async: false })
}
