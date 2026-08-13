// Parameter serialization: `style` + `explode` (OpenAPI §4.8.11), the piece
// that turns a structured value into wire form. Pure, tested, shared by the
// request builder (send) and the URL reader (reload a history entry, a
// shared link).
//
// An editor value is therefore a string (scalar), a list of strings (array
// parameter) or a flat map of strings (object parameter) — the three shapes
// the fields produce, and the three the state, the share link and a scenario
// step carry.

// Delimiter of the non-exploded form, per style. `form` and `simple` share
// the comma; `matrix`/`label` add a prefix on top (see pathValue).
const DELIMITERS = {
  form: ',',
  simple: ',',
  spaceDelimited: ' ',
  pipeDelimited: '|',
  matrix: ',',
  label: '.',
}

// A parameter described by `content` carries a serialized document (JSON,
// XML…) under its own name: its schema describes what is INSIDE the value,
// never how to spread it over the query — it stays one raw string.
const isSpread = (param) => param?.mediaType === undefined

export function isMultiValue(param) {
  return isSpread(param) && param?.schema?.kind === 'array'
}

// An object parameter only becomes a form (and a per-property serialization)
// when the schema says which properties exist. A free-form object has nothing
// to build a form from: single field, value sent as typed.
export function isObjectValue(param) {
  return isSpread(param) && param?.schema?.kind === 'object' && !!param.schema.properties?.length
}

// Finds the parameter that governs a name at a given location. Returns null
// for an undeclared name (query pair added by a reload, auth injection):
// the caller then falls back to the OpenAPI defaults.
export function findParam(op, location, name) {
  return op?.parameters?.find((p) => p.in === location && p.name === name) ?? null
}

// The separator a parameter's declared `style` puts between elements on the
// wire. Exported for the editors, which write the value the same way they read
// it back — with a hardcoded comma they round-tripped a `pipeDelimited`
// parameter into a single element containing pipes.
export function listDelimiter(param) {
  return DELIMITERS[param?.style] ?? ','
}

// Editor value → list of element values. The editor produces an array for an
// array parameter, but a string still arrives from a hand-written scenario
// step or a URL read back: it is then split on the delimiter of the declared
// style, which is exactly how it was written on the wire. A `{{var}}`
// resolving to "a,b" therefore stays one element — splitting happens before
// interpolation, deliberately: a variable's value is a value, not a list.
export function toValueList(param, value) {
  if (Array.isArray(value)) return value.map((v) => String(v ?? ''))
  const raw = value === undefined || value === null ? '' : String(value)
  if (raw === '') return []
  if (!isMultiValue(param)) return [raw]
  return raw.split(DELIMITERS[param.style] ?? ',')
}

// Editor value → [property, value] entries, empties dropped. Property order
// follows the schema, not the input: two identical requests must produce the
// same URL (and the same history entry).
export function toValueEntries(param, value) {
  const source = isPlainObject(value) ? value : entriesFromString(param, value)
  const declared = (param?.schema?.properties ?? []).map((p) => p.name)
  const names = [...declared, ...Object.keys(source).filter((n) => !declared.includes(n))]
  return names
    .filter((name) => source[name] !== undefined && source[name] !== null && source[name] !== '')
    .map((name) => [name, String(source[name])])
}

// Non-exploded wire form read back: "role,admin,firstName,Alex". An odd
// trailing key without its value is dropped rather than made up.
function entriesFromString(param, value) {
  const raw = value === undefined || value === null ? '' : String(value)
  if (raw === '') return {}
  const parts = raw.split(DELIMITERS[param?.style] ?? ',')
  const out = {}
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1]
  return out
}

// [name, value] pairs to append to the query string. Values are already
// interpolated and stripped of their empties.
export function queryPairs(name, param, values) {
  if (!values.length) return []
  // Defaults when the parameter isn't declared: `form` + explode, i.e. one
  // pair per value — the least lossy reading of a multi-valued name.
  const style = param?.style ?? 'form'
  if (style === 'form' && (param?.explode ?? true)) return values.map((value) => [name, value])
  return [[name, values.join(DELIMITERS[style] ?? ',')]]
}

// Same, for an object parameter: `deepObject` brackets each property,
// `form` + explode drops the parameter name and sends the properties as
// plain pairs, the non-exploded forms flatten key,value,key,value.
export function objectQueryPairs(name, param, entries) {
  if (!entries.length) return []
  const style = param?.style ?? 'form'
  if (style === 'deepObject') return entries.map(([key, value]) => [`${name}[${key}]`, value])
  if (style === 'form' && (param?.explode ?? true)) return entries
  return [[name, entries.flat().join(DELIMITERS[style] ?? ',')]]
}

// Replacement text of a `{name}` template in the path. Elements are encoded
// individually: the delimiter (and the `;`/`.`/`=` of matrix and label) is
// structure, not content.
export function pathValue(name, param, values) {
  const style = param?.style ?? 'simple'
  const explode = param?.explode ?? false
  const encoded = values.map((value) => encodeURIComponent(value))
  if (style === 'matrix') {
    return explode
      ? encoded.map((value) => `;${name}=${value}`).join('')
      : `;${name}=${encoded.join(',')}`
  }
  if (style === 'label') return `.${encoded.join(explode ? '.' : ',')}`
  return encoded.join(',')
}

// Same, for an object parameter. Exploded, each property becomes its own
// `key=value` unit (RFC 6570 §3.2.8): the separator is the style's, and the
// `=` belongs to the structure.
export function objectPathValue(name, param, entries) {
  const style = param?.style ?? 'simple'
  const explode = param?.explode ?? false
  const encoded = entries.map(([key, value]) => [
    encodeURIComponent(key),
    encodeURIComponent(value),
  ])
  const exploded = encoded.map(([key, value]) => `${key}=${value}`)
  const flat = encoded.flat()
  if (style === 'matrix') {
    return explode ? `;${exploded.join(';')}` : `;${name}=${flat.join(',')}`
  }
  if (style === 'label') return explode ? `.${exploded.join('.')}` : `.${flat.join(',')}`
  return explode ? exploded.join(',') : flat.join(',')
}

// RFC 3986 §2.2 reserved characters. `allowReserved` says the value already
// uses them as structure (a path or a filter expression handed straight to the
// server), so encoding them would be encoding the structure away.
const RESERVED_ESCAPES = new Map(
  ":/?#[]@!$&'()*+,;=".split('').map((char) => [encodeURIComponent(char), char]),
)

// One `name=value` pair, encoded. Without `allowReserved` the encoding is
// URLSearchParams' (space as `+`, and every reserved character escaped), so
// the ordinary path keeps producing byte-for-byte what it always has; with it,
// the reserved characters are put back afterwards and a space becomes `%20` —
// `+` in a value that may legitimately contain one is a second lie.
export function encodePair(name, value, { allowReserved = false } = {}) {
  if (!allowReserved) return new URLSearchParams([[name, value]]).toString()
  return `${encodeURIComponent(name)}=${allowReservedValue(value)}`
}

function allowReservedValue(value) {
  return encodeURIComponent(value).replace(
    /%[0-9A-F]{2}/gi,
    (encoded) => RESERVED_ESCAPES.get(encoded.toUpperCase()) ?? encoded,
  )
}

// Query string → editor values, the exact reverse of the two functions
// above: an array parameter always comes back as a list (even with a single
// element), an object parameter as a map — that is what the fields edit, and
// what a re-send has to serialize again.
export function readQueryValues(searchParams, op = null) {
  const out = {}
  const taken = new Set()
  const declared = new Set(
    (op?.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
  )
  for (const param of op?.parameters ?? []) {
    if (param.in !== 'query' || !isObjectValue(param)) continue
    const value = readObjectParam(searchParams, param, taken, declared)
    if (value) out[param.name] = value
  }
  for (const name of new Set(searchParams.keys())) {
    if (taken.has(name)) continue
    const all = searchParams.getAll(name)
    const param = findParam(op, 'query', name)
    if (isMultiValue(param)) out[name] = all.length > 1 ? all : toValueList(param, all[0])
    // Undeclared name repeated in the URL: keeping only the last one lost
    // half the request.
    else out[name] = all.length > 1 ? all : all[0]
  }
  return out
}

function readObjectParam(searchParams, param, taken, declared) {
  const out = {}
  const style = param.style ?? 'form'
  if (style === 'deepObject') {
    for (const key of searchParams.keys()) {
      const match = /^(.+)\[(.+)\]$/.exec(key)
      if (match?.[1] !== param.name) continue
      out[match[2]] = searchParams.get(key)
      taken.add(key)
    }
  } else if (style === 'form' && (param.explode ?? true)) {
    // Exploded, the parameter name is nowhere in the URL: only the declared
    // properties identify it — and a property colliding with another
    // declared parameter belongs to that one, which is explicit.
    for (const prop of param.schema.properties ?? []) {
      if (!searchParams.has(prop.name) || taken.has(prop.name)) continue
      if (declared.has(prop.name)) continue
      out[prop.name] = searchParams.get(prop.name)
      taken.add(prop.name)
    }
  } else if (searchParams.has(param.name)) {
    Object.assign(out, entriesFromString(param, searchParams.get(param.name)))
    taken.add(param.name)
  }
  return Object.keys(out).length ? out : null
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isScalar = (value) => typeof value === 'string' || typeof value === 'number'

// The contract of a parameter value wherever it is STORED (share link,
// scenario step, imported file): a string, a list of strings for an array
// parameter, a flat map of strings for an object one. `undefined` = out of
// contract, to be dropped — each of those sources is untrusted input.
export function normalizeParamValue(value) {
  if (isScalar(value)) return String(value)
  if (Array.isArray(value)) return value.every(isScalar) ? value.map(String) : undefined
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (!entries.length || !entries.every(([, item]) => isScalar(item))) return undefined
    return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]))
  }
  return undefined
}

// Every template a stored value can hold — a step must be able to say which
// variables it references, whatever the shape of its parameters.
export function paramValueTemplates(map) {
  return Object.values(map ?? {}).flatMap((value) =>
    value && typeof value === 'object' ? Object.values(value) : value,
  )
}
