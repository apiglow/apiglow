// The CommonMark fields of a document, read the way this documentation's
// Markdown renderer reads them — for the rules that judge what a rendered description shows
// (`markdown-unsafe`, `markdown-links`). No Markdown library: the audit bundle
// must not carry `marked` (docs/architecture.md §14.8), and the two rules only
// need to know where raw HTML and link targets sit, and which text is code.

// Every `description` this documentation renders as Markdown, read the way it
// renders it — each node once, at the place it is written: `ctx.objects`
// already types every Schema of the source, where `ctx.schemas` (the
// dereferenced document) reports one brought in by another component — a
// parameter, a response — once, under the first operation using it. A field is read as a block
// (`markdownBlock`: paragraphs, code blocks, reference definitions) or inline
// (`markdownInline`, marked's `parseInline`: none of those — an indented line
// is text, a fence is a code span, `[label]: url` defines nothing), or both
// when two views show it. A description shown as plain text (a tag's tooltip,
// a server's, an External Documentation's label) or not shown at all (a
// Server Variable's, an Example's, a Path Item's) has nothing stripped and no
// link: it is not read. → [{ type, dataPath, text, renders: [{ inline, code
// }] }], `code` the text with its code blanked (`blankCode`). Cached per
// context: two rules read the same fields.
const RENDERS = {
  // shell/views.js, api-endpoint-doc.js — a callback's operation is inline.
  Info: [false],
  Operation: [false],
  // auth-overview.js as a block, an operation's security box inline.
  SecurityScheme: [false, true],
  // api-endpoint-doc.js, schema-view.js.
  Parameter: [true],
  RequestBody: [true],
  Response: [true],
  Header: [true],
  Link: [true],
  Schema: [true],
}
const fieldsByContext = new WeakMap()

export function markdownFields(ctx) {
  let fields = fieldsByContext.get(ctx)
  if (fields) return fields
  fields = []
  const callbacks = []
  // A 3.1 Schema `$ref` with siblings is typed twice, Reference and Schema.
  const taken = new Set()
  for (const { type, expected, node, dataPath } of ctx.objects) {
    if (type === 'Callback') callbacks.push(`${dataPath}/`)
    let modes = RENDERS[type === 'Reference' ? expected : type]
    if (!modes || taken.has(node)) continue
    taken.add(node)
    if (type === 'Operation' && callbacks.some((prefix) => dataPath.startsWith(prefix))) {
      modes = [true]
    }
    const text = node.description
    if (
      typeof text !== 'string' ||
      (!text.includes('<') && !text.includes('](') && !text.includes(']:'))
    )
      continue
    fields.push({
      type,
      dataPath: `${dataPath}/description`,
      text,
      renders: modes.map((inline) => ({ inline, code: blankCode(text, inline) })),
    })
  }
  fieldsByContext.set(ctx, fields)
  return fields
}

// The text with what a renderer shows verbatim — fenced and indented code
// blocks, code spans — and HTML comments replaced by spaces, offsets and line
// breaks kept. A `<script>` between backticks is printed, not stripped, and a
// link in a code block is no link. Inline (`inline`), there are no blocks: a
// fence is a code span like any other backtick run, and an indented line is
// text. As a block, an indented line opens code only where no paragraph is
// open — after a blank line, a heading, a thematic break or a fence, never
// under a paragraph's text, which it continues. A paragraph continued inside a
// list item still reads as code here: erring toward code can only hide a
// finding, never invent one.
export function blankCode(text, inline = false) {
  if (inline) return blankInline(text, false)
  const lines = text.split('\n')
  let fence = null
  let paragraph = false
  for (const [index, line] of lines.entries()) {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      lines[index] = spaces(line)
      continue
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = open[1]
      paragraph = false
      lines[index] = spaces(line)
      continue
    }
    if (!line.trim()) paragraph = false
    else if (indentOf(line) >= 4) {
      if (!paragraph) lines[index] = spaces(line)
    } else {
      paragraph = !(
        ATX_HEADING.test(line) ||
        THEMATIC_BREAK.test(line) ||
        (paragraph && SETEXT_UNDERLINE.test(line))
      )
    }
  }
  return blankInline(lines.join('\n'), true)
}

const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/

// Code spans and HTML comments, in one left-to-right pass. A backslash escapes
// a backtick outside code; a code span ends at the next run of exactly as many
// backticks — as a block (`paragraphs`), never past the paragraph's end (a
// blank line); inline, anywhere further on.
function blankInline(text, paragraphs) {
  let out = ''
  let i = 0
  // The end of the paragraph `i` is in: positions only grow, so the blank line
  // found for one code span serves every later one before it.
  let paragraphEnd = -1
  const limitFrom = (from) => {
    if (!paragraphs) return text.length
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
const ATTRIBUTE = /([A-Za-z_:][\w.:-]*)(?:\s*=\s*([^\s"'=<>`]+|'[^']*'|"[^"]*"))?/g

// → [{ name, index, attributes: [{ name, value }] }], open tags in text
// order. `value` is null for an attribute written without one.
export function openTags(code) {
  const tags = []
  for (const match of code.matchAll(OPEN_TAG)) {
    if (escaped(code, match.index)) continue
    const attributes = []
    for (const [, name, value] of match[2].matchAll(ATTRIBUTE)) {
      attributes.push({ name, value: value === undefined ? null : unquote(value) })
    }
    tags.push({ name: match[1], index: match.index, attributes })
  }
  return tags
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
// possibly in angle brackets), autolinks (`<scheme:…>`, which marked turns into
// an `<a href>` like any link) and — as a block only (`inline` false) — the
// link reference definitions some reference uses (`[label]: target`). A
// definition must open its own block — it cannot interrupt a paragraph — and
// one nothing refers to renders nothing. `[^1]:` is left alone: it is how
// footnotes are written, whatever CommonMark makes of it.
//
// One forward pass: each unescaped `]` closes the last `[` still open — as a
// block, in its own paragraph — and makes a link when `(target)` follows; a
// `]` with no `[` open is text.
const INLINE_LINK =
  /\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/y
// biome-ignore lint/suspicious/noControlCharactersInRegex: marked's own autolink grammar.
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\x00-\x1f]*)>/y
const BLANK_LINE_AT = /\n[ \t]*\n/y
const DEFINITION =
  /^ {0,3}\[([^\]^[][^[\]]*)\]:[ \t]*(?:\n[ \t]*)?(<[^<>\n]*>|\S+)[ \t]*(?:\n?[ \t]*(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/gm

export function markdownLinks(code, inline = false) {
  const links = []
  let openers = []
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i]
    if (char === '\\') i += 1
    else if (char === '\n' && !inline) {
      BLANK_LINE_AT.lastIndex = i
      if (BLANK_LINE_AT.test(code)) openers = []
    } else if (char === '[') openers.push(i)
    else if (char === ']') {
      const open = openers.pop()
      if (open === undefined) continue
      INLINE_LINK.lastIndex = i
      const match = INLINE_LINK.exec(code)
      if (!match) continue
      const image = open > 0 && code[open - 1] === '!' && !escaped(code, open - 1)
      links.push({ target: stripAngles(match[1]), index: open, image })
      i = INLINE_LINK.lastIndex - 1
    } else if (char === '<') {
      AUTOLINK.lastIndex = i
      const match = AUTOLINK.exec(code)
      if (!match) continue
      links.push({ target: match[1], index: i, image: false })
      i = AUTOLINK.lastIndex - 1
    }
  }
  if (!inline && code.includes(']:')) {
    let labels = null
    for (const match of code.matchAll(DEFINITION)) {
      if (!opensBlock(code, match.index)) continue
      labels ??= bracketLabels(code)
      if ((labels.get(normalizeLabel(match[1])) ?? 0) < 2) continue
      links.push({ target: stripAngles(match[2]), index: match.index, image: false })
    }
  }
  return links.sort((a, b) => a.index - b.index)
}

function stripAngles(target) {
  return target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
}

// How often each bracketed text appears, the definition's own label included:
// a reference (`[text][label]`, `[label][]`, `[label]`) is a second one. An
// inline link's text (`[label](…)`) refers to no definition.
function bracketLabels(code) {
  const counts = new Map()
  for (const [, label] of code.matchAll(/\[([^[\]\n]+)\](?!\()/g)) {
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
  const previous = code.slice(code.lastIndexOf('\n', index - 2) + 1, index - 1)
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
