import { makeDraft } from './draft.js'
import { readJson } from './postman.js'

// HAR 1.2 import — the counterpart of `src/export/har.js`, and above all what a
// browser's network panel exports. A HAR is a recording of a session, so it
// carries far more than the API under test: filtering it down is the reader's
// job (the candidates list shows every entry), not ours.

export function parseHar(input) {
  const { value, error } = readJson(input)
  if (error) return { requests: [], warnings: [], errors: [error] }
  const entries = value?.log?.entries
  if (!Array.isArray(entries))
    return { requests: [], warnings: [], errors: [{ code: 'har-invalid' }] }

  const requests = []
  for (const entry of entries) {
    const request = entry?.request
    if (!request || typeof request !== 'object' || typeof request.url !== 'string') continue
    requests.push(toDraft(request))
  }
  if (!requests.length)
    return { requests: [], warnings: [], errors: [{ code: 'import-no-request' }] }
  return { requests, warnings: [], errors: [] }
}

function toDraft(request) {
  const draft = makeDraft({
    method: String(request.method ?? 'GET').toUpperCase(),
    url: request.url,
  })
  draft.name = `${draft.method} ${shortUrl(request.url)}`
  for (const header of Array.isArray(request.headers) ? request.headers : []) {
    if (!header || typeof header !== 'object' || !header.name) continue
    draft.headers.push({ name: String(header.name), value: String(header.value ?? '') })
  }
  // A recording always carries the session's cookies; a browser `fetch` cannot
  // set them back (T3). Said once per entry rather than per cookie.
  if (Array.isArray(request.cookies) && request.cookies.length) {
    draft.warnings.push({
      code: 'import-cookie-dropped',
      value: request.cookies
        .map((c) => c?.name)
        .filter(Boolean)
        .join(', '),
    })
  }
  readPostData(request.postData, draft)
  return draft
}

// `params` when the recorded body was a form, `text` otherwise. Both may be
// present — the spec says so — and the field list is the more faithful of the
// two: it survived the browser's own parsing.
function readPostData(postData, draft) {
  if (!postData || typeof postData !== 'object') return
  const params = Array.isArray(postData.params) ? postData.params : []
  if (params.length) {
    draft.fields = params
      .filter((p) => p?.name)
      .map((p) => ({
        name: String(p.name),
        value: p.fileName ? '' : String(p.value ?? ''),
        fileName: p.fileName ? String(p.fileName) : undefined,
      }))
    draft.bodyMode = /multipart/i.test(String(postData.mimeType ?? '')) ? 'formdata' : 'urlencoded'
    return
  }
  if (typeof postData.text === 'string' && postData.text !== '') {
    draft.body = postData.text
    draft.bodyMode = 'raw'
  }
}

function shortUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.pathname + parsed.search
  } catch {
    return url
  }
}
