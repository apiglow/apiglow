// Inline SVG icon bodies: copies of each other, near-copies, and the
// sizing idiom they use.
//
// Two groups, reported separately on purpose:
//  - byte-identical bodies declared twice = duplication, plain debt;
//  - same path `d` with different attributes = a design question (three
//    checkmark weights may all be wanted). Never conflated.
import { headline, read, section, walk } from './lib.mjs'

// Every inline icon is a string literal starting with `<svg`, declared
// either as a `const NAME =` or as a key of an icon map.
const LITERAL = /(?:const\s+([A-Z0-9_]+)\s*=\s*|([\w$]+)\s*:\s*)?(['`])(<svg[\s\S]*?)\3/g

const bodies = new Map()
let sites = 0
const files = new Set()
const sizedHW = []

for (const file of walk('src')) {
  const text = read(file)
  for (const m of text.matchAll(LITERAL)) {
    const line = text.slice(0, m.index).split('\n').length
    const body = m[4]
    const name = m[1] ?? m[2] ?? '(inline)'
    sites++
    files.add(file)
    if (!bodies.has(body)) bodies.set(body, [])
    bodies.get(body).push(`${file}:${line} ${name}`)
    if (body.includes('h-4 w-4')) sizedHW.push(`${file}:${line} ${name}`)
  }
}

const identical = [...bodies.values()].filter((where) => where.length > 1)
const dupeCount = identical.reduce((n, where) => n + where.length - 1, 0)

// Near-copies: same geometry, different attributes.
const byPath = new Map()
for (const [body, where] of bodies) {
  const key = [...body.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]).join('|')
  if (!key) continue
  if (!byPath.has(key)) byPath.set(key, [])
  byPath.get(key).push({ body, where })
}
const variants = [...byPath.values()].filter((group) => group.length > 1)

headline(
  'duplicate SVG declarations',
  dupeCount,
  `of ${sites} inline icons — ${bodies.size} distinct bodies in ${files.size} files`,
)
section(
  'byte-identical bodies declared more than once',
  identical.map((where) => where.join('  =  ')),
)
section(
  'same path, different attributes — a design question, not debt',
  variants.map((group) => group.map((v) => v.where.join(', ')).join('  ~  ')),
)
headline('\nh-4 w-4 sizing sites', sizedHW.length, '(the rest use size-*)')
section('using h-4 w-4', sizedHW)
