import { OBJECTS } from './openapi-objects.js'

// The CommonMark fields of a document, read the way a Markdown renderer reads
// them — for the rules that judge what a rendered description shows
// (`markdown-unsafe`, `markdown-links`). No Markdown library: the audit bundle
// must not carry `marked` (docs/architecture.md §14.8), and the two rules only
// need to know where raw HTML and link targets sit, and which text is code.

// Every `description` the specification declares CommonMark ("Throughout the
// specification description fields are noted as supporting CommonMark", Rich
// Text Formatting), schema descriptions included — each node once, at the
// place it is written: `ctx.objects` already types every Schema of the source,
// which `ctx.schemas` (the dereferenced document, reached from operations and
// `components.schemas` only) would report under each operation using it.
// → [{ type, dataPath, text, code }], `code` the text with its code blanked
// (`blankCode`). Cached per context: two rules read the same fields.
const fieldsByContext = new WeakMap()

export function markdownFields(ctx) {
  let fields = fieldsByContext.get(ctx)
  if (fields) return fields
  fields = []
  for (const { type, node, dataPath } of ctx.objects) {
    if (type !== 'Schema' && !OBJECTS[type]?.description) continue
    const text = node.description
    if (
      typeof text !== 'string' ||
      (!text.includes('<') && !text.includes('](') && !text.includes(']:'))
    )
      continue
    fields.push({ type, dataPath: `${dataPath}/description`, text, code: blankCode(text) })
  }
  fieldsByContext.set(ctx, fields)
  return fields
}

// The text with what a renderer shows verbatim — fenced and indented code
// blocks, code spans — and HTML comments replaced by spaces, offsets and line
// breaks kept. A `<script>` between backticks is printed, not stripped, and a
// link in a code block is no link. Indented code is taken broadly (a paragraph
// continued inside a list item reads as code here): erring toward code can
// only hide a finding, never invent one.
export function blankCode(text) {
  const lines = text.split('\n')
  let fence = null
  let indented = false
  let previousBlank = true
  for (const [index, line] of lines.entries()) {
    const blank = !line.trim()
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      lines[index] = spaces(line)
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = open[1]
      indented = false
      lines[index] = spaces(line)
      previousBlank = false
      continue
    }
    if (!blank && indentOf(line) >= 4 && (previousBlank || indented)) {
      indented = true
      lines[index] = spaces(line)
    } else if (!blank) indented = false
    previousBlank = blank
  }
  return blankInline(lines.join('\n'))
}

// Code spans and HTML comments, in one left-to-right pass. A backslash escapes
// a backtick outside code; a code span ends at the next run of exactly as many
// backticks, and never past the paragraph's end (a blank line).
function blankInline(text) {
  let out = ''
  let i = 0
  // The end of the paragraph `i` is in: positions only grow, so the blank line
  // found for one code span serves every later one before it.
  let paragraphEnd = -1
  const limitFrom = (from) => {
    if (from > paragraphEnd) {
      BLANK_LINE.lastIndex = from
      paragraphEnd = BLANK_LINE.exec(text)?.index ?? text.length
    }
    return paragraphEnd
  }
  while (i < text.length) {
    const char = text[i]
    if (char === '\\' && i + 1 < text.length) {
      out += text.slice(i, i + 2)
      i += 2
      continue
    }
    if (char === '<' && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      const stop = end < 0 ? text.length : end + 3
      out += spaces(text.slice(i, stop))
      i = stop
      continue
    }
    if (char === '`') {
      let run = 1
      while (text[i + run] === '`') run += 1
      const close = closingRun(text, i + run, run, limitFrom(i + run))
      if (close < 0) {
        out += text.slice(i, i + run)
        i += run
        continue
      }
      out += spaces(text.slice(i, close + run))
      i = close + run
      continue
    }
    out += char
    i += 1
  }
  return out
}

const BLANK_LINE = /\n[ \t]*\n/g

function closingRun(text, from, length, limit) {
  for (let i = text.indexOf('`', from); i >= 0 && i < limit; i = text.indexOf('`', i)) {
    let run = 1
    while (text[i + run] === '`') run += 1
    if (run === length) return i
    i += run
  }
  return -1
}

function spaces(text) {
  return text.replace(/[^\n]/g, ' ')
}

function indentOf(line) {
  let width = 0
  for (const char of line) {
    if (char === ' ') width += 1
    else if (char === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

// Raw HTML tags, per CommonMark's grammar (§6.6): an open tag is a name, then
// attributes — unquoted, single- or double-quoted values — then an optional
// `/` and `>`. `List<String>` is a tag (and gone once sanitized);
// `Map<String, Object>` is not, and prints as typed. A backslash before `<`
// makes it text.
const OPEN_TAG =
  /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z_:][\w.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*)\s*\/?>/g
const CLOSE_TAG = /<\/[A-Za-z][A-Za-z0-9-]*\s*>/
const ATTRIBUTE = /([A-Za-z_:][\w.:-]*)(?:\s*=\s*([^\s"'=<>`]+|'[^']*'|"[^"]*"))?/g

// → [{ name, raw, index, attributes: [{ name, value }] }], open tags in text
// order. `value` is null for an attribute written without one.
export function openTags(code) {
  const tags = []
  for (const match of code.matchAll(OPEN_TAG)) {
    if (escaped(code, match.index)) continue
    const attributes = []
    for (const [, name, value] of match[2].matchAll(ATTRIBUTE)) {
      attributes.push({ name, value: value === undefined ? null : unquote(value) })
    }
    tags.push({ name: match[1], raw: match[0], index: match.index, attributes })
  }
  return tags
}

export function hasRawHtml(code) {
  return openTags(code).length > 0 || CLOSE_TAG.test(code)
}

function escaped(text, index) {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function unquote(value) {
  return /^(["']).*\1$/s.test(value) ? value.slice(1, -1) : value
}

// Link and image targets written in Markdown syntax → [{ target, index, image }],
// in text order: inline links and images (`[text](target "title")`, the target
// possibly in angle brackets) and the link reference definitions some
// reference uses (`[label]: target`). A definition must open its own block —
// it cannot interrupt a paragraph — and one nothing refers to renders nothing.
// `[^1]:` is left alone: it is how footnotes are written, whatever CommonMark
// makes of it.
const INLINE_LINK =
  /\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g
const DEFINITION =
  /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(?:\n[ \t]*)?(<[^<>\n]*>|\S+)[ \t]*(?:\n?[ \t]*(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/gm

export function markdownLinks(code) {
  const links = []
  for (const match of code.matchAll(INLINE_LINK)) {
    if (escaped(code, match.index)) continue
    const open = openingBracket(code, match.index)
    links.push({
      target: stripAngles(match[1]),
      index: open < 0 ? match.index : open,
      image: open > 0 && code[open - 1] === '!',
    })
  }
  const labels = bracketLabels(code)
  for (const match of code.matchAll(DEFINITION)) {
    if (!opensBlock(code, match.index)) continue
    const label = normalizeLabel(match[1])
    if ((labels.get(label) ?? 0) < 2) continue
    links.push({ target: stripAngles(match[2]), index: match.index, image: false })
  }
  return links.sort((a, b) => a.index - b.index)
}

// The `[` a link text opens with, nested brackets counted; -1 when the `]` closes
// nothing on its line.
function openingBracket(code, close) {
  let depth = 0
  for (let i = close - 1; i >= 0 && code[i] !== '\n'; i -= 1) {
    if (code[i] === ']' && !escaped(code, i)) depth += 1
    else if (code[i] === '[' && !escaped(code, i)) {
      if (!depth) return i
      depth -= 1
    }
  }
  return -1
}

function stripAngles(target) {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
}

// How often each bracketed text appears, the definition's own label included:
// a reference (`[text][label]`, `[label][]`, `[label]`) is a second one.
function bracketLabels(code) {
  const counts = new Map()
  for (const [, label] of code.matchAll(/\[([^\]\n]+)\]/g)) {
    const key = normalizeLabel(label)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

function opensBlock(code, index) {
  if (index === 0) return true
  const before = code.slice(0, index - 1)
  const previous = before.slice(before.lastIndexOf('\n') + 1)
  return !previous.trim() || DEFINITION_LINE.test(previous)
}

const DEFINITION_LINE = /^ {0,3}\[[^\]]+\]:/

// A target that resolves against wherever the text is rendered: no scheme, not
// protocol-relative (`//host` names its host), not a lone fragment (a jump
// within the rendered page) and not empty (the page itself).
export function isRelativeTarget(target) {
  const value = target.trim()
  if (!value || value.startsWith('#') || value.startsWith('//')) return false
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}
