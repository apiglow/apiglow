import { makeDraft } from './draft.js'

// Postman Collection v2.1 import — the counterpart of `src/export/postman.js`,
// and the format Insomnia and Bruno also export to, which is why it is the one
// collection format worth reading.
//
// A collection describes MANY requests: everything below flattens the folder
// tree into one draft per item and lets `match.js` decide what each one is.

const V21_RE = /collection\/v2\.1\.0/

// Folder nesting is unbounded in the format; a collection deep enough to hit
// this is a collection nobody navigates either (rule 7's spirit).
const MAX_DEPTH = 12

export function parsePostman(input) {
  const { value, error } = readJson(input)
  if (error) return { requests: [], warnings: [], errors: [error] }
  if (!value || typeof value !== 'object' || !Array.isArray(value.item)) {
    return { requests: [], warnings: [], errors: [{ code: 'postman-invalid' }] }
  }
  const warnings = []
  const schema = typeof value.info?.schema === 'string' ? value.info.schema : ''
  if (!V21_RE.test(schema)) warnings.push({ code: 'postman-schema-unknown', schema })
  // Collection variables are the format's environments, and ours are a stored,
  // user-owned object: creating them silently on an import would be writing
  // into the reader's workspace without being asked.
  for (const variable of Array.isArray(value.variable) ? value.variable : []) {
    if (variable?.key) warnings.push({ code: 'postman-variable', name: String(variable.key) })
  }

  const requests = []
  collect(value.item, requests, 0)
  if (!requests.length) return { requests: [], warnings, errors: [{ code: 'import-no-request' }] }
  return { requests, warnings, errors: [] }
}

function collect(items, out, depth) {
  if (!Array.isArray(items) || depth > MAX_DEPTH) return
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (Array.isArray(item.item)) collect(item.item, out, depth + 1)
    else if (item.request) out.push(toDraft(item))
  }
}

function toDraft(item) {
  // The shorthand form: `request` is the URL string and everything else is a
  // default.
  const request = typeof item.request === 'string' ? { url: item.request } : (item.request ?? {})
  const draft = makeDraft({
    name: typeof item.name === 'string' ? item.name : null,
    method: String(request.method ?? 'GET').toUpperCase(),
    url: readUrl(request.url),
  })
  for (const header of Array.isArray(request.header) ? request.header : []) {
    if (!header || typeof header !== 'object' || header.disabled === true) continue
    if (!header.key) continue
    draft.headers.push({ name: String(header.key), value: String(header.value ?? '') })
  }
  readBody(request.body, draft)
  readAuth(request.auth, draft)
  return draft
}

// `url` is either a raw string or the decomposed object. `raw` is authoritative
// when present — Postman keeps it in sync and it is the only field carrying the
// `{{variable}}` spellings verbatim.
function readUrl(url) {
  if (typeof url === 'string') return substitutePathVariables(url, [])
  if (!url || typeof url !== 'object') return ''
  const variables = Array.isArray(url.variable) ? url.variable : []
  if (typeof url.raw === 'string') return substitutePathVariables(url.raw, variables)
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
  const path = Array.isArray(url.path) ? url.path.join('/') : (url.path ?? '')
  const query = (Array.isArray(url.query) ? url.query : [])
    .filter((q) => q?.key && q.disabled !== true)
    .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value ?? '')}`)
    .join('&')
  const protocol = url.protocol ? `${url.protocol}://` : ''
  const port = url.port ? `:${url.port}` : ''
  const base = `${protocol}${host}${port}${path ? `/${path}` : ''}`
  return substitutePathVariables(query ? `${base}?${query}` : base, variables)
}

// Postman writes a path parameter as `:petId` and keeps its value aside. Left
// in place, the segment would land in the try-it's path field as `:petId` —
// which is nobody's pet id. Without a value it stays as written: it is still a
// segment the matcher aligns against `{petId}`.
function substitutePathVariables(raw, variables) {
  let out = String(raw)
  for (const variable of variables) {
    if (!variable?.key || variable.value === undefined || variable.value === '') continue
    out = out.replaceAll(`:${variable.key}`, String(variable.value))
  }
  return out
}

function readBody(body, draft) {
  if (!body || typeof body !== 'object') return
  const mode = body.mode
  if (mode === 'raw') {
    draft.body = typeof body.raw === 'string' ? body.raw : ''
    draft.bodyMode = 'raw'
    return
  }
  if (mode === 'urlencoded' || mode === 'formdata') {
    const rows = Array.isArray(body[mode]) ? body[mode] : []
    draft.fields = rows
      .filter((row) => row && typeof row === 'object' && row.key && row.disabled !== true)
      .map((row) => ({
        name: String(row.key),
        value: row.type === 'file' ? '' : String(row.value ?? ''),
        // A file's content lives on the exporting machine: only the name comes
        // over, exactly as it does for a captured scenario step.
        fileName: row.type === 'file' ? fileName(row.src) : undefined,
      }))
    draft.bodyMode = mode
    return
  }
  if (mode === 'file') {
    draft.bodyMode = 'file'
    draft.warnings.push({ code: 'import-file-body', name: fileName(body.file?.src) ?? '' })
    return
  }
  if (mode === 'graphql') {
    // GraphQL is a JSON body with two well-known keys: rebuilt rather than
    // dropped, because that is exactly what Postman itself sends.
    draft.body = JSON.stringify({
      query: String(body.graphql?.query ?? ''),
      ...(body.graphql?.variables ? { variables: body.graphql.variables } : {}),
    })
    draft.bodyMode = 'raw'
    return
  }
  if (mode) draft.warnings.push({ code: 'postman-body-mode', mode: String(mode) })
}

function fileName(src) {
  if (typeof src !== 'string' || !src) return undefined
  return src.split(/[\\/]/).pop()
}

// Postman stores auth as a list of `{ key, value }` under the type's own name.
function readAuth(auth, draft) {
  if (!auth || typeof auth !== 'object' || !auth.type) return
  const entries = Object.fromEntries(
    (Array.isArray(auth[auth.type]) ? auth[auth.type] : [])
      .filter((row) => row?.key)
      .map((row) => [String(row.key), String(row.value ?? '')]),
  )
  if (auth.type === 'basic') {
    draft.auth = {
      scheme: 'basic',
      username: entries.username ?? '',
      password: entries.password ?? '',
    }
  } else if (auth.type === 'bearer') {
    draft.auth = { scheme: 'bearer', token: entries.token ?? '' }
  } else if (auth.type === 'apikey') {
    draft.auth = {
      scheme: 'apikey',
      name: entries.key ?? '',
      value: entries.value ?? '',
      in: entries.in === 'query' ? 'query' : 'header',
    }
  } else {
    draft.warnings.push({ code: 'import-auth-unsupported', scheme: String(auth.type) })
  }
}

export function readJson(input) {
  if (input && typeof input === 'object') return { value: input, error: null }
  const text = String(input ?? '').trim()
  if (!text) return { value: null, error: { code: 'import-empty' } }
  try {
    return { value: JSON.parse(text), error: null }
  } catch {
    return { value: null, error: { code: 'import-invalid-json' } }
  }
}
