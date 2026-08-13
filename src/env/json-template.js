import { replaceVariables } from './interpolate.js'

// A JSON request body is a *template*: `"petId": {{petId}}` leaves the token
// unquoted on purpose, so the value lands as a number — which makes the text
// invalid JSON. Everything that reads the body field by field (the doc's
// mirror of the body, and the edits coming back from it) needs it as an
// object all the same, hence this pair: bare tokens are parked in string
// placeholders for the round-trip, and put back bare on the way out.
//
// A token already inside a string stays quoted: `{{id}}` and `"{{id}}"` don't
// send the same thing, and only the shape written by the author is preserved.

// Lone token, per the grammar of interpolate.js — the only thing ever emitted
// unquoted. Reusing `replaceVariables` keeps that grammar in one place.
const isToken = (raw) => raw !== '' && replaceVariables(raw, () => '') === ''

// Path key of a leaf, in the format of the doc's body editors registry
// (`schema-view.js`): a property name containing a dot stays unambiguous.
const pathKey = (path) => JSON.stringify(path)

// null if the text isn't a JSON template at all. `bare` lists the paths whose
// value is an unquoted token: that's what `stringifyBodyTemplate` needs to
// give the body back in the shape it had.
export function parseBodyTemplate(text) {
  const source = String(text ?? '')
  if (!source.trim()) return null
  const sentinel = sentinelFactory(source)
  const tokens = []
  let json = ''
  let inString = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (inString) {
      json += char
      if (char === '\\') json += source[++i] ?? ''
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      json += char
      continue
    }
    const end = char === '{' && source[i + 1] === '{' ? source.indexOf('}}', i + 2) : -1
    const raw = end === -1 ? '' : source.slice(i, end + 2)
    if (isToken(raw)) {
      json += JSON.stringify(sentinel(tokens.length))
      tokens.push(raw)
      i = end + 1
      continue
    }
    json += char
  }
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const placeholders = new Map(tokens.map((raw, index) => [sentinel(index), raw]))
  const bare = []
  const value = mapLeaves(parsed, [], (leaf, path) => {
    const raw = typeof leaf === 'string' ? placeholders.get(leaf) : undefined
    if (raw === undefined) return leaf
    bare.push(pathKey(path))
    return raw
  })
  return { value, bare }
}

export function stringifyBodyTemplate(value, bare = []) {
  if (value === undefined) return ''
  const bareKeys = new Set(bare)
  const sentinel = sentinelFactory(JSON.stringify(value) ?? '')
  const raws = []
  const staged = mapLeaves(value, [], (leaf, path) => {
    // A path that was bare but now carries a real value (the user typed one
    // in the doc) goes back out quoted: unquoting it would produce a body
    // that is no longer JSON once interpolated.
    if (typeof leaf !== 'string' || !isToken(leaf) || !bareKeys.has(pathKey(path))) return leaf
    raws.push(leaf)
    return sentinel(raws.length - 1)
  })
  let text = JSON.stringify(staged, null, 2)
  raws.forEach((raw, index) => {
    text = text.replace(JSON.stringify(sentinel(index)), raw)
  })
  return text
}

// Placeholder guaranteed absent from the text being parsed: a body could
// legitimately contain the base string, and the substitution must not collide
// with it.
function sentinelFactory(source) {
  let base = '__apidoc_tpl_'
  while (source.includes(base)) base += '_'
  return (index) => `${base}${index}__`
}

function mapLeaves(value, path, fn) {
  if (Array.isArray(value)) return value.map((item, index) => mapLeaves(item, [...path, index], fn))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, mapLeaves(child, [...path, key], fn)]),
    )
  }
  return fn(value, path)
}
