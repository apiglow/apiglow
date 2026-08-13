// `{{var}}` in a docs page (docs/docs-pages.md §12) — the decision half, kept
// pure: a piece of rendered text plus the variables that resolve, in, and the
// list of things to put on screen, out. The DOM half (chips, the walk itself)
// lives in `components/docs-content.js`, because what a chip looks like is a
// component's business and what a reference MEANS is not.
//
// Rule 11 does not transpose literally here — there is no send to block in
// prose — so its two halves are restated: a value is never guessed at, and a
// reference that resolves to nothing is signalled rather than left as the
// literal.
import { resolveVariable, splitVariables } from '../env/interpolate.js'

// One escape, in the RENDERED text: a backslash immediately before `{{`. What
// the author types to produce it depends on where they type it — `\{{name}}`
// in a fence or a code span, `\\{{name}}` in prose, because markdown eats one
// backslash of its own. By the time the walk sees the text there is exactly
// one, and it is dropped.
const ESCAPE = '\\'

// → segments of four kinds:
//   { kind: 'text', text }              literal, chips aside
//   { kind: 'value', name, value }      resolved and not sensitive
//   { kind: 'masked', name }            resolved and sensitive — no value
//   { kind: 'missing', name }           nothing resolves it
//
// A masked segment deliberately carries NO value: rule 12 by construction
// rather than by redaction, since the caller cannot emit what it never got.
export function segmentVariables(source, variables = {}) {
  const segments = []
  // Literal text accumulates here rather than in the output: an escaped
  // reference has to rejoin the run it interrupted, and text pushed already is
  // text that would have to be reached back into.
  let pending = ''
  const flush = () => {
    if (pending) segments.push({ kind: 'text', text: pending })
    pending = ''
  }
  for (const part of splitVariables(source)) {
    if (part.text !== undefined) {
      pending += part.text
      continue
    }
    if (pending.endsWith(ESCAPE)) {
      pending = pending.slice(0, -1) + part.raw
      continue
    }
    flush()
    // Resolution is the try-it's rule, not a docs one: `resolveVariable` owns
    // it, so an empty base URL reads as an oversight on both sides alike.
    const resolved = resolveVariable(variables[part.name])
    if (!resolved) segments.push({ kind: 'missing', name: part.name })
    else if (resolved.sensitive) segments.push({ kind: 'masked', name: part.name })
    else segments.push({ kind: 'value', name: part.name, value: resolved.value })
  }
  flush()
  return segments
}

// Pre-filter for the walk, so the delimiter stays spelled on this side: most
// text nodes of a page hold no reference at all, and rebuilding them to put
// them back unchanged is the most expensive way to do nothing. Deliberately
// coarse — an escaped token is not a reference and still has to be rebuilt,
// since dropping its backslash is the whole point.
export function mayHoldVariables(text) {
  return String(text ?? '').includes('{{')
}
