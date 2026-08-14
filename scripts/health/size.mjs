// File length, and where the length actually sits.
//
// A 2000-line file made of forty 50-line functions is not the same debt as
// one made of a single 1200-line function, so every flagged file reports
// its longest function and how many declarations nest inside it.
import { headline, read, section, walk } from './lib.mjs'

const FLAG = 800

// A function-ish opener: `function name(`, `const name = (…) =>`, or a
// class method — anything but a control-flow block.
const OPENER =
  /^(\s*)(?:export\s+)?(?:(?:async\s+)?function\*?\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\*?\s*)?\(|(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(#?[\w$]+)\s*\()/
const CONTROL = /^(?:if|for|while|switch|catch|do|return|else|await|typeof)$/

function declarations(lines) {
  const out = []
  for (const [i, line] of lines.entries()) {
    const head = line.trimEnd()
    // A signature too long for one line ends on the parameter's `(`, and the
    // brace only arrives on the `) {` line Biome puts back at the declaration's
    // own indent. Missing that form hides exactly the functions this detector
    // exists to find — the longest ones are the ones with the most parameters.
    const wrapped = head.endsWith('(')
    if (!head.endsWith('{') && !wrapped) continue
    const m = OPENER.exec(line)
    const name = m?.[2] ?? m?.[3] ?? m?.[4]
    if (!name || CONTROL.test(name)) continue
    const indent = m[1]
    let body = i
    if (wrapped) {
      // `foo(` also opens a call spanning several lines. Only a declaration
      // reaches `) {`; a call's first same-indent `)` closes on `)` or `),`.
      const paren = lines.findIndex((l, j) => j > i && l.startsWith(`${indent})`))
      if (paren < 0 || lines[paren].trimEnd() !== `${indent}) {`) continue
      body = paren
      // The bare `name(…) {` branch also matches `setTimeout(() => {`, a call
      // taking a callback. A declaration closes its parameter list first.
    } else if (m[4] && !head.endsWith(') {')) continue
    // The body ends on the first line closing at the declaration's indent —
    // `}` alone, but also `},` for an object member and `})` for an argument.
    const closer = `${indent}}`
    let end = lines.length - 1
    for (let j = body + 1; j < lines.length; j++) {
      if (lines[j].startsWith(closer)) {
        end = j
        break
      }
    }
    out.push({ name, start: i + 1, end: end + 1, indent: indent.length, length: end - i + 1 })
  }
  return out
}

const flagged = []
const files = walk('src')
let total = 0
for (const file of files) {
  const text = read(file)
  const lines = text.split('\n')
  // `wc -l` semantics: a trailing newline doesn't open a line.
  const count = text.endsWith('\n') ? lines.length - 1 : lines.length
  total += count
  if (count <= FLAG) continue
  const decls = declarations(lines)
  const longest = decls.reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null)
  const nested = longest
    ? decls.filter(
        (d) => d.start > longest.start && d.end <= longest.end && d.indent > longest.indent,
      ).length
    : 0
  flagged.push({ file, lines: count, longest, nested })
}
flagged.sort((a, b) => b.lines - a.lines)

headline(
  'files over 800 lines',
  flagged.length,
  `of ${files.length} files / ${total} lines in src/`,
)
section(
  'flagged',
  flagged.map(
    (f) =>
      `${f.lines}  ${f.file}` +
      (f.longest
        ? ` — longest: ${f.longest.name}() ${f.longest.length} lines, ${f.nested} nested declarations`
        : ''),
  ),
)
