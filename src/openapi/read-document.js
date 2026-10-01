import { isAlias, LineCounter, parseDocument, Scalar, visit } from 'yaml'

// A document read whatever state it is in (docs/architecture.md §14.21): text →
// { document, problems }. `document` is the best reading of the text — what a
// strict parser would have returned had it accepted it, `undefined` when the
// text holds nothing — and `problems` says what is wrong with the text, each at
// its 1-based line and column, `detail` being the parser's own one-line
// message: [{ code, line, column, detail }]. A text read as YAML also hands
// back `ast`, the parsed `yaml` Document, whose nodes keep their source ranges
// (the CLI's positions walk it rather than parse the text twice). The loader
// turns to it only once
// the strict read has failed, so a healthy schema never pays for this module;
// the browser fetches it as a file of its own, next to app.js.

// What is taken for JSON — the loader restates it, to decide without loading
// this module. Anything else is YAML.
const LOOKS_LIKE_JSON = /^\s*[[{]/

// The `json` problem: the text looks like JSON and is not. `document-syntax`
// restates it, to name the format without importing a YAML parser.
const JSON_PROBLEM = 'json'

// An anchor may be reused freely — a shared error response under every
// operation is a normal document — but expanding aliases of aliases grows
// exponentially (the "billion laughs"): `yaml` refuses once the expanded uses
// of one anchor pass this count.
const MAX_ALIAS_COUNT = 10_000

export function readDocument(input) {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  if (!LOOKS_LIKE_JSON.test(text)) return readYaml(text)
  try {
    return { document: JSON.parse(text), problems: [] }
  } catch (err) {
    // YAML 1.2 reads JSON, and reads past what makes it invalid JSON — a
    // trailing comma, a missing brace — so the document still comes back. The
    // problem reported is the JSON one: the author wrote JSON, and what the
    // YAML reading stumbled on is a consequence of it.
    const yaml = readYaml(text)
    return {
      document: yaml.document,
      problems: [jsonProblem(text, err, yaml.problems[0])],
    }
  }
}

function readYaml(text) {
  const lines = new LineCounter()
  const doc = parseDocument(text, {
    lineCounter: lines,
    // JSON has no say on duplicate keys and YAML forbids them; either way the
    // last one wins in the document, as it does in every parser.
    uniqueKeys: true,
    // `<<` merge keys: YAML 1.1, and what ref-parser's YAML parser reads too —
    // the recovered document must be the one a healthy read would have given.
    merge: true,
    prettyErrors: false,
    // 'error' rather than 'silent': the parser keeps quiet either way, and only
    // this level still records a second document in the stream as an error.
    logLevel: 'error',
  })
  const at = (offset) => {
    const { line, col } = lines.linePos(offset)
    return { line, column: col }
  }
  const problems = doc.errors.map((error) => ({
    code: error.code,
    ...at(error.pos[0]),
    detail: firstLine(error.message),
  }))
  // An alias to an anchor that is not set before it makes the whole
  // conversion throw: it reads as null instead, and is a problem of its own.
  const anchors = new Set()
  visit(doc, (_key, node) => {
    if (isAlias(node)) {
      if (anchors.has(node.source)) return undefined
      problems.push({
        code: 'BAD_ALIAS',
        ...at(node.range?.[0] ?? 0),
        detail: `Unresolved alias (the anchor must be set before the alias): ${node.source}`,
      })
      return new Scalar(null)
    }
    if (node?.anchor) anchors.add(node.anchor)
    return undefined
  })
  return { document: toJS(doc, problems, at), problems: placed(problems), ast: doc }
}

// In line order, one per place: a defect the parser trips over twice — a
// mis-indented line is both a nested mapping and a multi-line key — is one
// thing to fix.
function placed(problems) {
  const seen = new Set()
  return problems
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .filter(({ line, column }) => !seen.has(`${line}:${column}`) && seen.add(`${line}:${column}`))
}

// `toJS` refuses an alias expansion over the cap: every alias then reads as
// null, which keeps the rest of the document.
function toJS(doc, problems, at) {
  try {
    return doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) ?? undefined
  } catch (err) {
    let first = null
    visit(doc, {
      Alias(_key, node) {
        first ??= node
        return new Scalar(null)
      },
    })
    problems.push({ code: 'ALIAS_COUNT', ...at(first?.range?.[0] ?? 0), detail: err.message })
    try {
      return doc.toJS() ?? undefined
    } catch {
      return undefined
    }
  }
}

// V8 says "at position N (line L column C)", Firefox "at line L column C", and
// some say nothing of where. Unplaced, the problem goes where the YAML reading
// stumbled, or at the end for an input cut short.
function jsonProblem(text, err, fallback) {
  const message = firstLine(err?.message ?? String(err))
  const lineColumn = /line (\d+) column (\d+)/.exec(message)
  const position = /position (\d+)/.exec(message)
  let where
  if (lineColumn) where = { line: Number(lineColumn[1]), column: Number(lineColumn[2]) }
  else if (position) where = offsetPosition(text, Number(position[1]))
  else if (/end of/i.test(message)) where = offsetPosition(text, text.length)
  else if (fallback) where = { line: fallback.line, column: fallback.column }
  else where = { line: 1, column: 1 }
  return { code: JSON_PROBLEM, ...where, detail: message }
}

function offsetPosition(text, offset) {
  let line = 1
  let start = 0
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
      start = i + 1
    }
  }
  return { line, column: offset - start + 1 }
}

function firstLine(message) {
  return String(message).split('\n')[0].trim()
}
