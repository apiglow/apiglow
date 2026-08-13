import { applicableSchemes } from '../openapi/auth.js'
import { bodyKind, isFieldsKind, mediaEssence } from '../openapi/body-kind.js'
import { readQueryValues } from '../openapi/params.js'
import { isTransportHeader } from './draft.js'

// From a draft (§4.6) to an operation of the loaded model, and to the try-it
// state that pre-fills it. This is the only module in `src/import/` that knows
// the model exists: the parsers stay format work, the matching stays model work.
//
// Nothing here guesses silently. A draft that fits several operations comes back
// with all of them and lets the reader choose; a value that cannot be placed
// comes back as a warning rather than being dropped.

export function matchOperation(model, draft, { baseUrls = [] } = {}) {
  const target = splitUrl(draft?.url)
  if (!target) return { candidates: [], warnings: [{ code: 'import-url-invalid' }] }
  const method = String(draft.method ?? 'GET').toUpperCase()
  // The same path read with and without each server prefix: a pasted command
  // carries the full URL, a copied snippet often carries only the route.
  const paths = candidatePaths(target.pathname, model, baseUrls)

  const candidates = []
  for (const op of model?.operations ?? []) {
    if (String(op.method ?? '').toUpperCase() !== method) continue
    let best = null
    for (const { pathname, stripped } of paths) {
      const aligned = alignPath(op.path, pathname)
      if (!aligned) continue
      // A literal segment matching is evidence; a parameter segment matching is
      // not — it matches anything. Stripping a declared server prefix is worth
      // less than one literal, but it does separate two otherwise equal fits.
      const score = aligned.literals * 2 + (stripped ? 1 : 0)
      if (!best || score > best.score) best = { score, values: aligned.values }
    }
    if (best) candidates.push({ op, score: best.score, pathValues: best.values })
  }
  candidates.sort((a, b) => b.score - a.score)

  return {
    candidates: candidates.map((candidate) => ({
      op: candidate.op,
      score: candidate.score,
      ...buildRequest(model, candidate.op, draft, candidate.pathValues, target.params),
    })),
    warnings: [],
  }
}

// True when the top two candidates fit equally well: the caller must ask rather
// than pick. Exported because the dialog says so out loud.
export function isAmbiguous(candidates) {
  return candidates.length > 1 && candidates[0].score === candidates[1].score
}

// --- URL ------------------------------------------------------------------

function splitUrl(raw) {
  // A leading `{{base}}` is what Postman and our own share links write where a
  // server URL goes: it is not part of the route, and it is not a URL either.
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^\{\{[\w.-]+\}\}/, '')
  if (!cleaned) return null
  try {
    const parsed = new URL(cleaned, 'http://apidoc-import.invalid')
    return { pathname: parsed.pathname, params: parsed.searchParams }
  } catch {
    return null
  }
}

function candidatePaths(pathname, model, baseUrls) {
  const out = [{ pathname, stripped: false }]
  const prefixes = new Set()
  for (const url of [
    ...(model?.servers ?? []).map((s) => s.url),
    ...(model?.operations ?? []).flatMap((op) => (op.servers ?? []).map((s) => s.url)),
    ...baseUrls,
  ]) {
    const prefix = serverPathPrefix(url)
    if (prefix) prefixes.add(prefix)
  }
  for (const prefix of prefixes) {
    if (pathname === prefix) out.push({ pathname: '/', stripped: true })
    else if (pathname.startsWith(`${prefix}/`))
      out.push({ pathname: pathname.slice(prefix.length), stripped: true })
  }
  return out
}

function serverPathPrefix(url) {
  if (!url) return ''
  try {
    return new URL(url, 'http://apidoc-import.invalid').pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function segments(path) {
  return String(path ?? '')
    .split('/')
    .filter(Boolean)
    .map(decodeSegment)
}

function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function alignPath(template, pathname) {
  const wanted = segments(template)
  const actual = segments(pathname)
  if (wanted.length !== actual.length) return null
  const values = {}
  let literals = 0
  for (let i = 0; i < wanted.length; i++) {
    const param = /^\{(.+)\}$/.exec(wanted[i])
    if (param) values[param[1]] = actual[i]
    else if (wanted[i] === actual[i]) literals++
    else return null
  }
  return { values, literals }
}

// --- try-it state ---------------------------------------------------------

function buildRequest(model, op, draft, pathValues, searchParams) {
  const warnings = [...(draft.warnings ?? [])]
  const query = readQueryValues(searchParams, op)
  const headers = []
  for (const header of draft.headers ?? []) {
    if (isTransportHeader(header.name)) continue
    if (header.name.toLowerCase() === 'cookie') {
      warnings.push({ code: 'import-cookie-dropped', value: header.value })
      continue
    }
    headers.push({ name: header.name, value: header.value })
  }

  const contents = op.requestBody?.contents ?? []
  const declared = findHeaderIndex(headers, 'content-type')
  const mediaTypeIndex = pickMediaType(contents, declared >= 0 ? headers[declared].value : null)
  // The media type drives the editor on both sides (rule 20), so a header that
  // merely repeats what the picked entry already says is noise in the header
  // table. One that says something else stays: it is an override the reader
  // asked for.
  if (declared >= 0 && mediaTypeIndex !== null) headers.splice(declared, 1)

  const credentials = extractCredentials(model, op, draft, headers, query, warnings)
  const body = placeBody(contents[mediaTypeIndex ?? 0] ?? null, draft, warnings)

  return {
    request: {
      path: pathValues,
      query,
      cookie: {},
      queryString: '',
      headers,
      mediaTypeIndex: mediaTypeIndex ?? 0,
      ...body,
      ...(credentials.schemeName ? { authSchemeName: credentials.schemeName } : {}),
    },
    // Run-scope overlay, not stored variables: an imported secret lives as long
    // as the tab does (see the session notes in docs/openapi-coverage.md).
    variables: credentials.variables,
    warnings,
  }
}

function findHeaderIndex(headers, name) {
  return headers.findIndex((h) => h.name.toLowerCase() === name)
}

// Which declared media type the imported Content-Type designates. `null` = the
// document declares none that fits (or declares no body at all).
function pickMediaType(contents, contentType) {
  if (!contents.length) return null
  if (!contentType) return null
  const essence = mediaEssence(contentType)
  const exact = contents.findIndex((c) => mediaEssence(c.mediaType) === essence)
  if (exact >= 0) return exact
  // `application/vnd.acme+json` against a document declaring `application/json`:
  // the family is what the editor needs, not the vendor tree.
  const family = essence.split('/')[0]
  const loose = contents.findIndex((c) => mediaEssence(c.mediaType).split('/')[0] === family)
  return loose >= 0 ? loose : null
}

// The body goes where the OPERATION says it goes, never where the source said:
// a urlencoded body imported as text would land in a textarea the panel does not
// show, and the reader would see an empty form (rule 20 — the editor's shape is
// the media type's business).
function placeBody(content, draft, warnings) {
  if (!content) {
    if (draft.body || draft.fields) warnings.push({ code: 'import-body-undeclared' })
    return { body: null, formFields: null }
  }
  const kind = bodyKind(content)
  if (kind === 'binary') {
    // The operation wants bytes and no import format carries them: the file gets
    // picked again in the panel, which is where a File can exist at all.
    warnings.push({ code: 'import-body-file' })
    return { body: null, formFields: null }
  }
  if (isFieldsKind(kind)) {
    if (draft.fields) return { body: null, formFields: draft.fields }
    // A urlencoded body arrives as text (`-d 'a=1&b=2'`): it IS the field list,
    // written the way the wire writes it.
    if (draft.body != null) {
      const params = new URLSearchParams(draft.body)
      return {
        body: null,
        formFields: [...params.entries()].map(([name, value]) => ({ name, value })),
      }
    }
    return { body: null, formFields: null }
  }
  if (draft.fields) {
    // The reverse mismatch: a field list for an operation whose body is text.
    warnings.push({ code: 'import-fields-undeclared' })
    return { body: null, formFields: null }
  }
  return { body: draft.body, formFields: null }
}

// --- credentials ----------------------------------------------------------

// An imported credential is matched against the operation's own security
// schemes and becomes the conventional `auth.X` variable — the same one the
// try-it cartouche fills. Unmatched, it stays a header: the reader asked for it
// explicitly, and inventing a scheme for it would be worse than showing it.
function extractCredentials(model, op, draft, headers, query, warnings) {
  const { schemes } = applicableSchemes(model, op)
  const variables = {}
  let schemeName = null
  const take = (scheme, values) => {
    schemeName = schemeName ?? scheme.name
    for (const [name, value] of Object.entries(values)) {
      variables[name] = { value, sensitive: true }
    }
  }

  // apiKey, in a header or in the query: recognizable by the parameter name the
  // document itself declared.
  for (const scheme of schemes) {
    if (scheme.type !== 'apiKey' || !scheme.paramName) continue
    if (scheme.in === 'query') {
      const value = query[scheme.paramName]
      if (typeof value === 'string') {
        delete query[scheme.paramName]
        take(scheme, { [`auth.${scheme.name}`]: value })
      }
      continue
    }
    if (scheme.in === 'header') {
      const index = findHeaderIndex(headers, scheme.paramName.toLowerCase())
      if (index >= 0) {
        take(scheme, { [`auth.${scheme.name}`]: headers[index].value })
        headers.splice(index, 1)
      }
    }
  }

  const explicit = draft.auth ? fromAuth(draft.auth) : null
  const index = findHeaderIndex(headers, 'authorization')
  const carried = explicit ?? (index >= 0 ? fromAuthorization(headers[index].value) : null)
  if (!carried) return { variables, schemeName }

  const scheme = pickScheme(schemes, carried)
  if (!scheme) {
    if (!explicit) warnings.push({ code: 'import-credential-unmatched' })
    else warnings.push({ code: 'import-auth-unmatched', scheme: carried.scheme })
    return { variables, schemeName }
  }
  if (index >= 0) headers.splice(index, 1)
  if (carried.scheme === 'basic') {
    take(scheme, {
      [`auth.${scheme.name}.username`]: carried.username,
      [`auth.${scheme.name}.password`]: carried.password,
    })
    // The username is not the secret half, and the credentials card shows it in
    // clear text — a run variable saying otherwise would mask what the card
    // displays.
    variables[`auth.${scheme.name}.username`].sensitive = false
  } else if (carried.scheme === 'apikey') {
    take(scheme, { [`auth.${scheme.name}`]: carried.value })
  } else {
    take(scheme, { [`auth.${scheme.name}`]: carried.token })
  }
  return { variables, schemeName }
}

function fromAuth(auth) {
  if (auth.scheme === 'basic')
    return { scheme: 'basic', username: auth.username ?? '', password: auth.password ?? '' }
  if (auth.scheme === 'bearer')
    return { scheme: 'bearer', token: auth.token ?? '', prefix: 'bearer' }
  if (auth.scheme === 'apikey')
    return { scheme: 'apikey', name: auth.name ?? '', value: auth.value ?? '', in: auth.in }
  return null
}

// `Basic dXNlcjpwYXNz`, `Bearer eyJ…`, or an exotic `Token abc` an http scheme
// may legitimately name.
function fromAuthorization(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return null
  const space = value.indexOf(' ')
  const prefix = (space > 0 ? value.slice(0, space) : '').toLowerCase()
  const rest = space > 0 ? value.slice(space + 1).trim() : value
  if (prefix === 'basic') {
    const decoded = decodeBasic(rest)
    if (!decoded) return null
    return { scheme: 'basic', ...decoded }
  }
  return { scheme: 'bearer', token: rest, prefix: prefix || 'bearer' }
}

function decodeBasic(encoded) {
  let decoded
  try {
    decoded = atob(encoded)
  } catch {
    return null
  }
  const colon = decoded.indexOf(':')
  if (colon < 0) return null
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

function pickScheme(schemes, carried) {
  if (carried.scheme === 'basic')
    return schemes.find((s) => s.type === 'http' && s.scheme === 'basic') ?? null
  if (carried.scheme === 'apikey') {
    return (
      schemes.find(
        (s) =>
          s.type === 'apiKey' &&
          s.paramName?.toLowerCase() === carried.name.toLowerCase() &&
          (carried.in ? s.in === carried.in : true),
      ) ?? null
    )
  }
  // `Bearer` is what an oauth2 or openIdConnect scheme injects too, so the http
  // scheme is only preferred, never required.
  return (
    schemes.find(
      (s) => s.type === 'http' && (s.scheme ?? 'bearer').toLowerCase() === carried.prefix,
    ) ??
    schemes.find((s) => s.type === 'oauth2' || s.type === 'openIdConnect') ??
    null
  )
}
