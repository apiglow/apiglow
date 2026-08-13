// Class selectors declared in src/styles/app.css that nothing applies.
//
// `hljs-*` is allowlisted: highlight.js emits those class names at runtime,
// so they are unreferenced in our source by construction, not by accident.
import { headline, read, section, walk } from './lib.mjs'

const SHEET = 'src/styles/app.css'
const RUNTIME_EMITTED = /^hljs(-|$)/

const css = read(SHEET)

// Selectors are what sits between the end of one rule and the `{` of the
// next; splitting on `{`/`}` is enough for a stylesheet with no nested
// braces in values.
const selectors = []
for (const chunk of css.split('}')) {
  const head = chunk.slice(0, chunk.indexOf('{'))
  if (chunk.includes('{') && !head.trimStart().startsWith('@')) selectors.push(head)
}

const classes = new Set()
for (const sel of selectors) {
  for (const m of sel.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) classes.add(m[1])
}

const blob = [...walk('src'), ...walk('demo', '.html'), ...walk('demo'), ...walk('tests')]
  .map(read)
  .join('\n')

const allowlisted = [...classes].filter((c) => RUNTIME_EMITTED.test(c))
const orphans = [...classes]
  .filter((c) => !RUNTIME_EMITTED.test(c))
  .filter((c) => !new RegExp(`\\b${c.replace(/[-]/g, '\\-')}\\b`).test(blob))

headline(
  'orphan CSS classes',
  orphans.length,
  `of ${classes.size} class selectors in ${SHEET} (${allowlisted.length} hljs-* allowlisted)`,
)
section('declared but never applied', orphans)
