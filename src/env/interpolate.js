// {{variable}} interpolation (docs/architecture.md §5.3) — pure function, tested.
//
// Contract: a missing variable is NEVER sent as-is; this
// function leaves the literal in place and flags it in `missing`, and it's
// up to the caller (try-it) to block the send. `used` lists the variables
// actually substituted, to allow redaction (history, exports).

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

// Variable grammar, defined here and nowhere else: anything that
// rewrites templates (interpolation, Arazzo export) goes through this function,
// otherwise the grammar would drift from one consumer to another.
export function replaceVariables(template, replacer) {
  return String(template ?? '').replace(VAR_RE, (raw, name) => replacer(name, raw))
}

// What a variable entry resolves to, spelled here and nowhere else, like the
// grammar above: unset, valueless and empty-string all mean the same thing —
// sending an empty string (token, host…) never makes sense and would hide the
// oversight — and sensitivity is a property of the entry, not of the reader.
// `null` when nothing resolves.
export function resolveVariable(entry) {
  if (entry === undefined || entry.value === undefined || entry.value === '') return null
  return { value: String(entry.value), sensitive: entry.sensitive === true }
}

export function interpolate(template, variables = {}) {
  const missing = new Set()
  const used = new Map()
  const value = replaceVariables(template, (name, raw) => {
    const resolved = resolveVariable(variables[name])
    if (!resolved) {
      missing.add(name)
      return raw
    }
    used.set(name, resolved)
    return resolved.value
  })
  return {
    value,
    missing: [...missing],
    used: [...used.entries()].map(([name, resolved]) => ({ name, ...resolved })),
  }
}

// The same grammar, cut up instead of substituted: a consumer that has to
// render each reference as its own thing — the docs pages turn an unresolvable
// one into a chip, a sensitive one into a mask — needs the pieces, not a
// finished string. Alternating text/reference parts, in source order.
export function splitVariables(template) {
  const source = String(template ?? '')
  const parts = []
  let last = 0
  for (const match of source.matchAll(VAR_RE)) {
    if (match.index > last) parts.push({ text: source.slice(last, match.index) })
    parts.push({ name: match[1], raw: match[0] })
    last = match.index + match[0].length
  }
  if (last < source.length) parts.push({ text: source.slice(last) })
  return parts
}

// Lists the variable names referenced by a template, without resolving them.
export function referencedVariables(template) {
  const names = new Set()
  for (const match of String(template ?? '').matchAll(VAR_RE)) names.add(match[1])
  return [...names]
}
