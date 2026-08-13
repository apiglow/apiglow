import { fileBodyLabel } from './body-kind.js'
import { diagnoseFailure, extractTransfer } from './insights.js'
import { applyProxy } from './request-builder.js'

// Actual send pipeline (docs/architecture.md §5.5): proxy, fetch, round-trip measurement,
// streamed body reading, then building the history entry.
//
// Extracted from the try-it panel so that the scenario runner
// (docs/scenarios.md §6) sends exactly the same requests and produces
// identically shaped history entries. No DOM here: the progress
// meter is an optional observer (`meter`).

const BODYLESS_METHODS = ['GET', 'HEAD']

/**
 * @param {object} built - output of `buildRequest` (already validated: `missing` and
 *   `errors` empty — the caller blocks the send otherwise, rule 11).
 */
export async function send(
  built,
  {
    proxyUrl = null,
    proxyEnabled = false,
    credentials = 'same-origin',
    // Multipart body files, by field name: `built.form` only carries
    // their name, the File object lives in the editor's state.
    files = {},
    // Binary body: the single File, same discipline — `built.file` carries
    // its identity, the bytes only exist here, at send time.
    file = null,
    // Duck-typed on `createSendMeter` (start/headers/progress/done/fail): the
    // panel passes its own meter as-is, the runner omits it.
    meter = null,
    // A deadline the caller owns. The only user today is a scenario step
    // carrying Arazzo's `timeout`, but the plumbing is the sender's: nothing
    // here knows why the signal fires, only that an abort is not a network
    // failure.
    signal = null,
    // Injectable for tests: `fetch` isn't replaceable at the
    // module level (frozen ESM import).
    fetchImpl = null,
    // Same reason, and it sends a real probe request of its own: a test that
    // doesn't inject it would go to the network.
    diagnose = diagnoseFailure,
  } = {},
) {
  const doFetch = fetchImpl ?? globalThis.fetch
  const proxied = !!(proxyEnabled && proxyUrl)
  const url = proxied ? applyProxy(proxyUrl, built.url) : built.url
  const method = built.method.toUpperCase()

  // Multipart body: rebuilt as FormData (the Files come from the caller);
  // fetch sets the Content-Type itself with the boundary. History gets
  // a text representation `field=value` / `field=@file` — the file's content
  // isn't kept, a replay won't resend it.
  let fetchBody = canHaveBody(method) && built.body !== null ? built.body : undefined
  if (built.form && canHaveBody(method)) {
    const formData = new FormData()
    for (const field of built.form) {
      if (field.fileName !== undefined) {
        const file = files[field.name]
        // A declared `contentType` overrides what the OS guessed from the
        // extension: the document knows what the endpoint parses.
        if (file) formData.append(field.name, retyped(file, field.contentType))
      } else if (field.contentType) {
        // The only way a browser gives a part its own Content-Type is to make
        // it a Blob — which also gives it a filename. Declaring a type on a
        // text part (a JSON part of a multipart body) is asking for exactly
        // that; sending it as a bare field would drop the type silently.
        formData.append(field.name, new Blob([field.value], { type: field.contentType }))
      } else {
        formData.append(field.name, field.value)
      }
    }
    fetchBody = formData
  }
  // The File goes to fetch untouched (it is a Blob): the browser streams it
  // and sets Content-Length itself. Nothing reads its bytes on the way.
  if (built.file && canHaveBody(method)) fetchBody = file ?? undefined

  const result = {
    url,
    proxied,
    requestBody: requestBodyFor(built),
    response: null,
    error: null,
    cause: null,
    durationMs: 0,
    // Round-trip breakdown: `durationMs - headersMs` is the body reception
    // time. Only the HAR export uses it (timings.receive), and it needs
    // to be stored — there's no way to reconstruct it afterwards.
    headersMs: 0,
    sizeBytes: 0,
    // Resource Timing snapshot (docs/network-insights.md §5.1). Null when the
    // API doesn't allow reading it — no data, no insight.
    transfer: null,
    // Verdict of a failure that never produced an HTTP response (§3). Null on
    // success and on HTTP-level errors.
    diagnosis: null,
    // The send was cut short by the caller's own signal. Separate from
    // `error`, which it also sets: a reader has to be able to tell "we gave
    // up" from "the network did".
    aborted: false,
  }

  // Single source of the meter and `durationMs`: taken before the
  // meter starts, which forces a reflow — two separate readings would offset them.
  const startedAt = performance.now()
  meter?.start(startedAt)
  try {
    const response = await doFetch(url, {
      method,
      headers: built.headers,
      body: fetchBody,
      credentials,
      ...(signal ? { signal } : {}),
    })
    const headersAt = performance.now()
    result.headersMs = Math.round(headersAt - startedAt)
    meter?.headers({ atMs: headersAt, serverMs: serverTimingFromHeaders(response) })
    const { body, sizeBytes } = await readBodyWithProgress(response, (received, total) =>
      meter?.progress(received, total),
    )
    // Taken here and nowhere else: `durationMs` is the complete round-trip
    // (headers + body read), i.e. exactly the meter's total. What follows
    // (serialization, Resource Timing) isn't part of it.
    const endedAt = performance.now()
    result.durationMs = Math.round(endedAt - startedAt)
    result.sizeBytes = sizeBytes
    result.response = {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body,
    }
    // One lookup, two readings: the server-timing markers the meter shows and
    // the transfer snapshot the insights read (§5.1).
    const timing = resourceEntry(response.url || url)
    result.transfer = extractTransfer(timing)
    meter?.done({ atMs: endedAt, sizeBytes, serverMs: serverTimingFromResourceEntry(timing) })
  } catch (err) {
    result.durationMs = Math.round(performance.now() - startedAt)
    meter?.fail()
    // The browser's raw message is the only info available: it's
    // kept as-is (history, exports) — never summarized. The original object
    // stays separate, for the console: it carries the stack, the history entry
    // can't store it.
    result.error = `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`
    result.cause = err
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      // Our own deadline, not the API's failure. Diagnosing it would probe a
      // server we never gave time to answer — and would then blame it for a
      // limit we set. Returning here also spares the probe's own timeout,
      // which is the slowest thing in this function.
      result.aborted = true
      return result
    }
    // Last, and only here: the probe takes as long as an unreachable server
    // takes to time out. The meter has already reported the failure, the raw
    // error is already recorded, and what the probe adds is a reading of it —
    // never a replacement (docs/network-insights.md §3).
    result.diagnosis = await diagnose({ url, proxied })
  }
  return result
}

// Request history entry, built BEFORE sending: the export sees the
// request as soon as it's ready, and the object is completed in place by
// `applyResult` when the response arrives.
export function historyEntry({ op, env = null, built, proxied = false }) {
  return {
    timestamp: Date.now(),
    envId: env?.id ?? null,
    envName: env?.name ?? null,
    opId: op.id,
    operationId: op.operationId ?? null,
    method: built.method,
    path: op.path,
    proxied,
    // `url` stays the real target, never the proxied URL: it's what gets
    // replayed and exported.
    request: {
      method: built.method,
      url: built.url,
      headers: built.headers,
      body: requestBodyFor(built),
      // Structured shape of a body that isn't just text, carried alongside
      // its display string: exports render it faithfully instead of parsing
      // `body` back, and replay can tell it apart from a payload it could
      // resend. File CONTENTS are never here — only names and sizes, so a
      // persisted entry stays bounded (rule 13).
      ...(built.form ? { form: built.form } : {}),
      ...(built.file ? { bodyFile: built.file } : {}),
    },
    sensitiveValues: built.used.filter((u) => u.sensitive).map((u) => u.value),
    // All resolved variables (name + value): enables cURL "template"
    // export with {{var}} instead of values (docs/architecture.md §5.7).
    usedVariables: built.used,
    response: null,
    error: null,
    durationMs: 0,
    headersMs: 0,
    // Network insights (docs/network-insights.md, decision 3): only what can't
    // be recomputed from the entry is stored. Header insights are not here —
    // the stored headers stay their single source of truth.
    diagnosis: null,
    transfer: null,
  }
}

export function applyResult(entry, result) {
  entry.proxied = result.proxied
  entry.request.body = result.requestBody
  entry.response = result.response
  entry.error = result.error
  entry.durationMs = result.durationMs
  entry.headersMs = result.headersMs
  entry.diagnosis = result.diagnosis
  entry.transfer = result.transfer
  return entry
}

// A File with the declared content type instead of the one the OS inferred.
// Rebuilt rather than mutated: `type` is read-only on a File.
function retyped(file, contentType) {
  if (!contentType || file.type === contentType) return file
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified })
}

function canHaveBody(method) {
  return !BODYLESS_METHODS.includes(method.toUpperCase())
}

// What the history DISPLAYS as body: the multipart text representation, the
// file's identity line, or the raw body. The structured forms travel next to
// it (`request.form`, `request.bodyFile`) — that is what exports and replay
// read, so this string never has to be parsed back.
function requestBodyFor(built) {
  if (!canHaveBody(built.method)) return null
  if (built.form) return built.form.map(formEntryLine).join('\n')
  if (built.file) return fileBodyLabel(built.file)
  return built.body
}

function formEntryLine(field) {
  return field.fileName !== undefined
    ? `${field.name}=@${field.fileName}`
    : `${field.name}=${field.value}`
}

// Reads the body as a stream to get real progress and size.
// `response.text()` remains the fallback when the stream isn't exposed (polyfills,
// opaque responses). The resulting text is identical in both cases.
export async function readBodyWithProgress(response, onProgress) {
  if (!response.body?.getReader) {
    const body = await response.text()
    return { body, sizeBytes: new Blob([body]).size }
  }
  const contentLength = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    body += decoder.decode(value, { stream: true })
    onProgress?.(received, contentLength)
  }
  body += decoder.decode()
  return { body, sizeBytes: received }
}

// Real server time, when the API allows reading it — two sources, both
// subject to CORS: the `Server-Timing` header (to expose via
// Access-Control-Expose-Headers) and Resource Timing (to allow via
// Timing-Allow-Origin). On an ordinary third-party API, both return null
// and the round trip stays a single honest number.
export function serverTimingFromHeaders(response) {
  const header = response.headers.get('server-timing')
  if (!header) return null
  const metrics = new Map()
  for (const item of header.split(',')) {
    const [name, ...params] = item.split(';')
    const dur = params.map((p) => /^\s*dur\s*=\s*([\d.]+)/.exec(p)).find(Boolean)
    if (dur) metrics.set(name.trim().toLowerCase(), Number(dur[1]))
  }
  if (!metrics.size) return null
  for (const key of ['total', 'app', 'server', 'backend']) {
    if (metrics.has(key)) return metrics.get(key)
  }
  return Math.max(...metrics.values())
}

// Only call once the response is complete: the Resource Timing entry is only
// published at that point. Taking the last entry mis-attributes the snapshot
// when two sends to the same URL overlap — the known, accepted limit of both
// readings (docs/network-insights.md §5.1).
function resourceEntry(url) {
  try {
    const entries = performance.getEntriesByName(url, 'resource')
    return entries[entries.length - 1] ?? null
  } catch {
    return null
  }
}

function serverTimingFromResourceEntry(entry) {
  // Without Timing-Allow-Origin, these markers are 0 cross-origin.
  if (!entry?.requestStart || !entry?.responseStart) return null
  return entry.responseStart - entry.requestStart
}
