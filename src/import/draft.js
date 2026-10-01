// The single shape every importer produces (§4.6 of docs/openapi-coverage.md):
// one draft per request, whatever the source format. It is deliberately NOT the
// try-it panel's state — a draft still ignores which operation it belongs to,
// and only `match.js` can turn a URL into path values and a body into fields.
//
// Contract shared with `normalizeScenario` and `decodeShareState`: every input
// here is untrusted (a pasted command, a file picked from disk), so a parser
// never throws. It returns codes the UI translates.

import { isForbiddenRequestHeader } from '../openapi/forbidden.js'

export function makeDraft(overrides = {}) {
  return {
    // Human label for the candidates list. A cURL command has none; a Postman
    // item and a HAR entry do.
    name: null,
    method: 'GET',
    url: '',
    headers: [],
    // Textual body, as the source carried it.
    body: null,
    // Field list when the source described one (multipart, urlencoded).
    // `match.js` decides which of the two the operation wants — the source's
    // own word for it lives in `bodyMode`.
    fields: null,
    // 'raw' | 'urlencoded' | 'formdata' | 'file' | null — what the SOURCE said
    // the body was. Kept next to the payload because a disagreement with the
    // operation's media type is worth a warning, not a silent reshaping.
    bodyMode: null,
    // Credential the source carried outside a header (`-u`, Postman `auth`).
    // An `Authorization` header stays a header until `match.js` recognizes it.
    auth: null,
    warnings: [],
    ...overrides,
  }
}

// Headers an import does not turn into rows: the ones a browser refuses to let
// `fetch` set (importing them would build a request the send silently strips),
// and what a recording adds of its own — the browser's `User-Agent`, a
// `Permissions-Policy` that is not a request header at all, HTTP/2
// pseudo-headers (`:method`, `:authority`…) from a HAR export. `Cookie` passes:
// `match.js` drops it with a warning instead (T3: the cURL export still
// carries it).
const RECORDING_HEADERS = new Set(['user-agent', 'permissions-policy'])

export function isTransportHeader(name) {
  const lower = String(name ?? '').toLowerCase()
  if (lower === 'cookie') return false
  return lower.startsWith(':') || RECORDING_HEADERS.has(lower) || isForbiddenRequestHeader(lower)
}
