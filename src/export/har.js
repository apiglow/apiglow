import { fileBodyLabel } from '../openapi/body-kind.js'
import { redactEntry } from './redact.js'

// HAR 1.2 export (bonus docs/architecture.md §5.7) — mechanical derivation of the history
// entry. Pure function, tested by snapshot.

function toNameValue(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  return entries.map(([name, value]) => ({ name, value }))
}

function queryString(rawUrl) {
  try {
    return [...new URL(rawUrl).searchParams.entries()].map(([name, value]) => ({ name, value }))
  } catch {
    return []
  }
}

export function toHar(entry, { redact = true } = {}) {
  const source = redact ? redactEntry(entry) : entry
  const respHeaders = source.response?.headers ?? []
  const contentType =
    (Array.isArray(respHeaders) ? respHeaders : Object.entries(respHeaders)).find(
      ([name]) => name.toLowerCase() === 'content-type',
    )?.[1] ?? ''
  const postData = harPostData(source.request)
  const httpVersion = harHttpVersion(entry.transfer)
  return {
    log: {
      version: '1.2',
      creator: { name: 'apiglow', version: '0.1.0' },
      entries: [
        {
          startedDateTime: new Date(entry.timestamp).toISOString(),
          time: entry.durationMs,
          request: {
            method: entry.method.toUpperCase(),
            url: source.request.url,
            httpVersion,
            headers: toNameValue(source.request.headers),
            queryString: queryString(source.request.url),
            cookies: [],
            headersSize: -1,
            bodySize: requestBodySize(source.request),
            ...(postData ? { postData } : {}),
          },
          response: source.response
            ? {
                status: source.response.status,
                statusText: source.response.statusText ?? '',
                httpVersion,
                headers: toNameValue(source.response.headers),
                cookies: [],
                content: {
                  ...contentSize(entry.transfer, source.response.body),
                  mimeType: contentType,
                  text: source.response.body ?? '',
                },
                redirectURL: '',
                headersSize: -1,
                bodySize: entry.transfer?.encodedBodySize ?? source.response.body?.length ?? 0,
                ...transferSizeField(entry.transfer),
              }
            : emptyResponse(httpVersion),
          cache: {},
          timings: harTimings(entry),
        },
      ],
    },
  }
}

// HAR 1.2 requires `time` = sum of non-negative timings: both values are
// therefore derived from already-rounded integers, never recomputed as a
// float.
// `wait` covers network + server: the outbound leg isn't decomposable on the
// client side (`send` would just be invented), hence the 0.
// Entries from before two-stage measurement: `headersMs` is missing, and we
// don't guess a split — everything falls back into `wait`, as before.
function harTimings(entry) {
  const total = entry.durationMs ?? 0
  if (entry.headersMs == null) return { send: 0, wait: total, receive: 0 }
  const wait = Math.min(entry.headersMs, total)
  return { send: 0, wait, receive: total - wait }
}

// What the browser measured on the wire, when it was allowed to
// (docs/network-insights.md §5.3). Without a snapshot the export keeps the
// decoded body's length in both fields, as it always has: the character count
// is all there ever was to go on.
function contentSize(transfer, body) {
  const decoded = transfer?.decodedBodySize
  if (!decoded) return { size: body?.length ?? 0 }
  return { size: decoded, compression: decoded - (transfer.encodedBodySize ?? 0) }
}

// The ALPN id the connection negotiated, verbatim (`http/1.1`, `h2`, `h3`…),
// on both legs — one connection, one protocol. Rewriting it into a "HTTP/x.y"
// label would be inventing a spelling the wire never used, and only `h2` has an
// unambiguous one anyway.
// Unknown protocol — no timing entry, cross-origin without
// `Timing-Allow-Origin`, or an entry archived before the snapshot existed — is
// the empty string: HAR requires the field, and claiming a version nobody
// observed would be the one thing worse than saying nothing.
function harHttpVersion(transfer) {
  return transfer?.protocol ?? ''
}

// Not in HAR 1.2: `_transferSize` is Chrome's own field, and every tool that
// reads a Chrome-exported HAR already knows it. Bytes on the wire, headers
// included — which is why it is the one size `bodySize` cannot carry.
function transferSizeField(transfer) {
  if (!transfer?.encodedBodySize) return {}
  return { _transferSize: transfer.transferSize ?? 0 }
}

function contentTypeOf(headers, fallback = 'text/plain') {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  return entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? fallback
}

// HAR 1.2 `postData`: `params` for a form body, `text` otherwise. A binary
// body has neither — the format has no file mode, so the file is named in
// `comment` and the payload stays out, which is honest: its bytes were never
// stored in the first place.
function harPostData(request) {
  if (request.form) {
    return {
      // Multipart carries no Content-Type header of ours (fetch writes it
      // with the boundary), hence the fallback rather than "text/plain".
      mimeType: contentTypeOf(request.headers, 'multipart/form-data'),
      params: request.form.map((f) =>
        f.fileName !== undefined
          ? { name: f.name, fileName: f.fileName }
          : { name: f.name, value: f.value },
      ),
      text: request.body ?? '',
    }
  }
  if (request.bodyFile) {
    return {
      mimeType: contentTypeOf(request.headers, request.bodyFile.type || 'application/octet-stream'),
      text: '',
      comment: fileBodyLabel(request.bodyFile),
    }
  }
  if (request.body) return { mimeType: contentTypeOf(request.headers), text: request.body }
  return null
}

function requestBodySize(request) {
  if (request.bodyFile) return request.bodyFile.size ?? 0
  return request.body ? request.body.length : 0
}

// HAR requires a response object even for a network failure.
function emptyResponse(httpVersion) {
  return {
    status: 0,
    statusText: '',
    httpVersion,
    headers: [],
    cookies: [],
    content: { size: 0, mimeType: '', text: '' },
    redirectURL: '',
    headersSize: -1,
    bodySize: 0,
  }
}
