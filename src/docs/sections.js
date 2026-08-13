// Section splitting of a docs page (docs/docs-pages.md §6): what the Cmd+K
// palette indexes once it goes from titles to content. A section is a heading
// and the prose under it, so a result can deep-link to
// `#/page/{slug}/{anchor}` rather than dropping the reader at the top of a
// long guide.
//
// Pure module, working on the SOURCE rather than the rendered DOM — the index
// is built for pages nobody has opened. The anchors it produces must be the
// ids the rendered page will carry, which is why the id assignment itself is
// shared with the renderer (`headingIds` below) instead of reimplemented.

import { slugify } from '../openapi/model.js'
import { stripFrontmatter } from './markdown.js'

// Heading ids: slug of the text, uniquified in document order. Used by
// `decorateHeadings` on the rendered page and by the splitter here — one
// implementation, so a search result's anchor cannot drift from the id it
// points at.
export function headingIds() {
  const seen = new Map()
  return (headingText) => {
    const base = slugify(headingText) || 'section'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }
}

// h1–h4, matching what `decorateHeadings` gives an id to: a section keyed on a
// heading the page will not anchor would produce a link that goes nowhere.
const ATX_HEADING = /^ {0,3}(#{1,4})\s+(.*?)\s*#*\s*$/
// `Title` over `=====` or `-----`: marked renders these as h1/h2, so the
// renderer gives them an id and the splitter has to count them too — skipping
// them would shift every anchor after the first one on the page.
const SETEXT_UNDERLINE = /^ {0,3}(=+|-{2,})[^\S\n]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/

// Enough inline markdown removed for the text to read as prose. Not a parser:
// this feeds a substring search, where a leftover asterisk costs nothing and a
// missing word costs a result.
function inlineText(line) {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}>+\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/[*_`~]+/g, '')
    .trim()
}

function pushSection(sections, current) {
  const text = current.lines.join(' ').replace(/\s+/g, ' ').trim()
  // A heading with nothing under it is still worth a result: it is the label
  // the reader is looking for. A preamble with no text at all is not.
  if (!text && !current.heading) return
  sections.push({ anchor: current.anchor, heading: current.heading, text })
}

function splitMarkdown(source) {
  const nextId = headingIds()
  const sections = []
  let current = { anchor: null, heading: null, lines: [] }
  let fence = null
  for (const line of stripFrontmatter(source).split('\n')) {
    const fenceMark = FENCE.exec(line)
    if (fence) {
      if (fenceMark && line.trim().startsWith(fence)) fence = null
      // Code stays in the text: a reader searching for a call they saw in a
      // snippet is searching this page.
      else current.lines.push(line.trim())
      continue
    }
    if (fenceMark) {
      fence = fenceMark[1][0].repeat(3)
      continue
    }
    const atx = ATX_HEADING.exec(line)
    if (!atx) {
      const text = inlineText(line)
      // A setext underline turns the line just collected into the heading.
      if (!text) continue
      if (SETEXT_UNDERLINE.test(line) && current.lines.length) {
        const label = current.lines.pop()
        pushSection(sections, current)
        current = { anchor: nextId(label), heading: label, lines: [] }
        continue
      }
      current.lines.push(text)
      continue
    }
    pushSection(sections, current)
    const label = inlineText(atx[2])
    current = { anchor: nextId(label), heading: label, lines: [] }
  }
  pushSection(sections, current)
  return sections
}

// `.html` pages are split the same way, by scanning for heading tags. A regex
// over HTML is not a parser and is not meant to be: this feeds a substring
// search, and the worst a malformed document costs is a slightly ragged
// excerpt. Rendering, where it would matter, goes through DOMPurify.
const HTML_HEADING = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function splitHtml(source) {
  const nextId = headingIds()
  const html = String(source ?? '')
  const sections = []
  let cursor = 0
  let current = { anchor: null, heading: null }
  HTML_HEADING.lastIndex = 0
  let match = HTML_HEADING.exec(html)
  while (match) {
    pushSection(sections, { ...current, lines: [htmlToText(html.slice(cursor, match.index))] })
    const label = htmlToText(match[2])
    current = { anchor: nextId(label), heading: label }
    cursor = match.index + match[0].length
    match = HTML_HEADING.exec(html)
  }
  pushSection(sections, { ...current, lines: [htmlToText(html.slice(cursor))] })
  return sections
}

// → [{ anchor, heading, text }] in document order. A `.txt` page indexes as a
// single section: it has no headings, so there is nothing to anchor to.
export function splitSections(source, format = 'markdown') {
  if (format === 'text') {
    const text = String(source ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    return text ? [{ anchor: null, heading: null, text }] : []
  }
  return format === 'html' ? splitHtml(source) : splitMarkdown(source)
}
