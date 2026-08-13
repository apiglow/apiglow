import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyResult,
  historyEntry,
  readBodyWithProgress,
  send,
  serverTimingFromHeaders,
} from '../src/openapi/send.js'

const response = (body, headers = {}) => new Response(body, { headers })

// minimal `built` — output of `buildRequest` already validated (missing/errors empty).
const builtRequest = (over = {}) => ({
  method: 'POST',
  url: 'https://api.test/v1/pets',
  headers: { 'Content-Type': 'application/json' },
  body: '{"name":"Rex"}',
  form: null,
  hasCookies: false,
  missing: [],
  errors: [],
  used: [],
  ...over,
})

// The real diagnosis sends a probe request: every failing send here injects a
// stand-in, and the ones asserting on the verdict inject a speaking one. The
// decision table itself is covered in insights.test.js.
const noDiagnosis = async () => null

// Captures fetch arguments and returns a controlled response.
const fakeFetch = (result = new Response('{}', { status: 200 })) => {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    if (result instanceof Error) throw result
    return result
  }
  fn.calls = calls
  return fn
}

describe('send', () => {
  it('returns the full response and the round-trip duration', async () => {
    const fetchImpl = fakeFetch(
      new Response('{"id":7}', { status: 201, headers: { 'x-req-id': 'abc' } }),
    )
    const result = await send(builtRequest(), { fetchImpl })
    expect(result.url).toBe('https://api.test/v1/pets')
    expect(result.proxied).toBe(false)
    expect(result.error).toBeNull()
    expect(result.response.status).toBe(201)
    expect(result.response.body).toBe('{"id":7}')
    expect(result.response.headers).toContainEqual(['x-req-id', 'abc'])
    expect(result.sizeBytes).toBe(8)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.headersMs).toBeLessThanOrEqual(result.durationMs)
    expect(fetchImpl.calls[0].init).toMatchObject({
      method: 'POST',
      body: '{"name":"Rex"}',
      credentials: 'same-origin',
    })
  })

  it('calls the proxied URL but does not touch the real target', async () => {
    const fetchImpl = fakeFetch()
    const result = await send(builtRequest(), {
      fetchImpl,
      proxyUrl: 'https://proxy.io/?url={{target}}',
      proxyEnabled: true,
    })
    expect(result.proxied).toBe(true)
    expect(fetchImpl.calls[0].url).toBe('https://proxy.io/?url=https%3A%2F%2Fapi.test%2Fv1%2Fpets')
    expect(result.url).toBe('https://proxy.io/?url=https%3A%2F%2Fapi.test%2Fv1%2Fpets')
  })

  // tryIt.requestCredentials: the cookie-authenticated API case documented in
  // the README — the only way the browser attaches a cross-origin cookie.
  it('forwards the configured credentials mode to fetch', async () => {
    const fetchImpl = fakeFetch()
    await send(builtRequest(), { fetchImpl, credentials: 'include' })
    expect(fetchImpl.calls[0].init.credentials).toBe('include')
  })

  it('ignores the proxy until the user has enabled it', async () => {
    const fetchImpl = fakeFetch()
    await send(builtRequest(), { fetchImpl, proxyUrl: 'https://proxy.io/?url={{target}}' })
    expect(fetchImpl.calls[0].url).toBe('https://api.test/v1/pets')
  })

  it('does not send a body on a method that does not carry one', async () => {
    const fetchImpl = fakeFetch()
    const result = await send(builtRequest({ method: 'GET', body: 'ignored' }), { fetchImpl })
    expect(fetchImpl.calls[0].init.body).toBeUndefined()
    expect(result.requestBody).toBeNull()
  })

  it('rebuilds a multipart body into FormData and keeps only the text trace', async () => {
    const fetchImpl = fakeFetch()
    const built = builtRequest({
      form: [
        { name: 'label', value: 'photo' },
        { name: 'avatar', fileName: 'cat.png' },
      ],
    })
    const file = new File(['xx'], 'cat.png', { type: 'image/png' })
    const result = await send(built, { fetchImpl, files: { avatar: file } })
    const sent = fetchImpl.calls[0].init.body
    expect(sent).toBeInstanceOf(FormData)
    expect(sent.get('label')).toBe('photo')
    expect(sent.get('avatar')).toBe(file)
    // The file content is not kept: a replay will not resend it.
    expect(result.requestBody).toBe('label=photo\navatar=@cat.png')
  })

  // Encoding Object (§4.4): the only way a browser gives a part its own
  // Content-Type is to make it a Blob, and a picked File is retyped rather
  // than left with whatever the OS guessed from its extension.
  it('gives each part the content type its encoding declared', async () => {
    const fetchImpl = fakeFetch()
    const built = builtRequest({
      form: [
        { name: 'metadata', value: '{"a":1}', contentType: 'application/json' },
        { name: 'cover', fileName: 'cat.bin', contentType: 'image/png' },
      ],
    })
    const file = new File(['xx'], 'cat.bin', { type: 'application/octet-stream' })
    await send(built, { fetchImpl, files: { cover: file } })
    const sent = fetchImpl.calls[0].init.body
    expect(sent.get('metadata').type).toBe('application/json')
    expect(sent.get('cover').type).toBe('image/png')
    expect(sent.get('cover').name).toBe('cat.bin')
  })

  it('streams a binary body as the File itself and keeps only its identity', async () => {
    const fetchImpl = fakeFetch()
    const built = builtRequest({
      body: null,
      headers: { 'Content-Type': 'application/octet-stream' },
      file: { name: 'cat.png', size: 2, type: 'image/png' },
    })
    const file = new File(['xx'], 'cat.png', { type: 'image/png' })
    const result = await send(built, { fetchImpl, file })
    expect(fetchImpl.calls[0].init.body).toBe(file)
    expect(result.requestBody).toBe('@cat.png (2 B, image/png)')
  })

  it('converts a network failure into a text error, without throwing', async () => {
    const result = await send(builtRequest(), {
      fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
      diagnose: noDiagnosis,
    })
    expect(result.error).toBe('TypeError: Failed to fetch')
    expect(result.response).toBeNull()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.aborted).toBe(false)
  })

  it('passes a caller signal through to fetch', async () => {
    const fetchImpl = fakeFetch()
    const signal = AbortSignal.timeout(5000)
    await send(builtRequest(), { fetchImpl, signal })
    expect(fetchImpl.calls[0].init.signal).toBe(signal)
    // No signal, no key: an undefined one would still reach fetch.
    const plain = fakeFetch()
    await send(builtRequest(), { fetchImpl: plain })
    expect('signal' in plain.calls[0].init).toBe(false)
  })

  it('marks an aborted send and does not diagnose the server for our deadline', async () => {
    let probed = false
    const timeout = new Error('signal timed out')
    timeout.name = 'TimeoutError'
    const result = await send(builtRequest(), {
      fetchImpl: fakeFetch(timeout),
      diagnose: async () => {
        probed = true
        return { verdict: 'unreachable' }
      },
    })
    expect(result.aborted).toBe(true)
    expect(result.error).toBe('TimeoutError: signal timed out')
    expect(result.diagnosis).toBeNull()
    expect(probed).toBe(false)
  })

  it('drives the progress panel in order, including failure', async () => {
    const seen = []
    const meter = {
      start: () => seen.push('start'),
      headers: () => seen.push('headers'),
      progress: () => seen.push('progress'),
      done: () => seen.push('done'),
      fail: () => seen.push('fail'),
    }
    await send(builtRequest(), { fetchImpl: fakeFetch(new Response('{}')), meter })
    expect(seen.filter((s) => s !== 'progress')).toEqual(['start', 'headers', 'done'])

    seen.length = 0
    await send(builtRequest(), {
      fetchImpl: fakeFetch(new TypeError('boom')),
      meter,
      diagnose: noDiagnosis,
    })
    expect(seen).toEqual(['start', 'fail'])
  })
})

// The buffer is a browser thing; here the lookup `send` performs is stubbed to
// return the entry a real completed request would have published.
describe('transfer snapshot', () => {
  afterEach(() => vi.restoreAllMocks())

  const publishTiming = (entry) =>
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue(entry ? [entry] : [])

  it('snapshots the Resource Timing entry of the response it just read', async () => {
    publishTiming({
      nextHopProtocol: 'h2',
      transferSize: 1200,
      encodedBodySize: 1000,
      decodedBodySize: 8000,
      requestStart: 10,
      responseStart: 60,
    })
    const result = await send(builtRequest(), { fetchImpl: fakeFetch() })
    expect(result.transfer).toEqual({
      protocol: 'h2',
      transferSize: 1200,
      encodedBodySize: 1000,
      decodedBodySize: 8000,
      fromCache: false,
    })
  })

  it('is null when the API exposes no timing — the ordinary third-party case', async () => {
    publishTiming(null)
    const result = await send(builtRequest(), { fetchImpl: fakeFetch() })
    expect(result.transfer).toBeNull()
  })

  // Same single lookup feeds the meter: the snapshot must not have cost the
  // server-timing reading.
  it('still gives the meter its server time', async () => {
    publishTiming({
      nextHopProtocol: 'h2',
      encodedBodySize: 1000,
      requestStart: 10,
      responseStart: 60,
    })
    let done = null
    await send(builtRequest(), {
      fetchImpl: fakeFetch(),
      meter: { start() {}, headers() {}, progress() {}, done: (arg) => (done = arg), fail() {} },
    })
    expect(done.serverMs).toBe(50)
    expect(performance.getEntriesByName).toHaveBeenCalledTimes(1)
  })

  it('has no snapshot when the send never got a response', async () => {
    const result = await send(builtRequest(), {
      fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
      diagnose: noDiagnosis,
    })
    expect(result.transfer).toBeNull()
  })
})

describe('failure diagnosis', () => {
  const verdict = { verdict: 'unreachable', proxied: false }

  it('diagnoses the URL that actually failed, and only on a failure', async () => {
    const asked = []
    const diagnose = async (context) => {
      asked.push(context)
      return verdict
    }
    const proxy = {
      proxyUrl: 'https://proxy.io/?url={{target}}',
      proxyEnabled: true,
      diagnose,
    }

    const ok = await send(builtRequest(), { fetchImpl: fakeFetch(), ...proxy })
    expect(ok.diagnosis).toBeNull()
    expect(asked).toEqual([])

    // The proxy is what was fetched, so the proxy is what is diagnosed (§3.1).
    const failed = await send(builtRequest(), {
      fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
      ...proxy,
    })
    expect(failed.diagnosis).toEqual(verdict)
    expect(asked).toEqual([
      { url: 'https://proxy.io/?url=https%3A%2F%2Fapi.test%2Fv1%2Fpets', proxied: true },
    ])
  })

  // The meter is the immediate signal; the probe can take as long as an
  // unreachable server takes to time out.
  it('runs after the meter has already reported the failure', async () => {
    const seen = []
    await send(builtRequest(), {
      fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
      meter: { start() {}, headers() {}, progress() {}, done() {}, fail: () => seen.push('fail') },
      diagnose: async () => {
        seen.push('diagnose')
        return verdict
      },
    })
    expect(seen).toEqual(['fail', 'diagnose'])
  })

  it('stores the verdict on the history entry', async () => {
    const built = builtRequest()
    const entry = historyEntry({ op: { id: 'op', path: '/pets' }, built })
    applyResult(
      entry,
      await send(built, {
        fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
        diagnose: async () => verdict,
      }),
    )
    expect(entry.diagnosis).toEqual(verdict)
  })
})

describe('history entry', () => {
  const op = { id: 'post-pets', operationId: 'createPet', path: '/pets', method: 'POST' }
  const env = { id: 'e1', name: 'Prod' }

  it('describes the request even before sending', () => {
    const built = builtRequest({
      used: [
        { name: 'token', value: 'secret', sensitive: true },
        { name: 'petId', value: '7', sensitive: false },
      ],
    })
    const entry = historyEntry({ op, env, built })
    expect(entry).toMatchObject({
      envId: 'e1',
      envName: 'Prod',
      opId: 'post-pets',
      operationId: 'createPet',
      method: 'POST',
      path: '/pets',
      proxied: false,
      request: { url: 'https://api.test/v1/pets', body: '{"name":"Rex"}' },
      sensitiveValues: ['secret'],
      response: null,
      error: null,
      durationMs: 0,
    })
    expect(entry.usedVariables).toHaveLength(2)
  })

  // The display string alone would have to be parsed back to export or to
  // replay: the structured shape travels next to it, contents excluded.
  it('carries the structured shape of a non-text body next to its display line', () => {
    const withFile = historyEntry({
      op,
      env,
      built: builtRequest({ body: null, file: { name: 'cat.png', size: 2, type: 'image/png' } }),
    })
    expect(withFile.request.bodyFile).toEqual({ name: 'cat.png', size: 2, type: 'image/png' })
    expect(withFile.request.body).toBe('@cat.png (2 B, image/png)')

    const withForm = historyEntry({
      op,
      env,
      built: builtRequest({ body: null, form: [{ name: 'avatar', fileName: 'cat.png' }] }),
    })
    expect(withForm.request.form).toEqual([{ name: 'avatar', fileName: 'cat.png' }])

    // A plain body stays plain: no empty keys added to every stored entry.
    const plain = historyEntry({ op, env, built: builtRequest() })
    expect('bodyFile' in plain.request).toBe(false)
    expect('form' in plain.request).toBe(false)
  })

  it('completes the entry in place, keeping the target URL and not the proxied URL', async () => {
    const built = builtRequest()
    const entry = historyEntry({ op, env, built, proxied: true })
    const result = await send(built, {
      fetchImpl: fakeFetch(new Response('{"id":7}', { status: 201 })),
      proxyUrl: 'https://proxy.io/?url={{target}}',
      proxyEnabled: true,
    })
    applyResult(entry, result)
    expect(entry.request.url).toBe('https://api.test/v1/pets')
    expect(entry.proxied).toBe(true)
    expect(entry.response.status).toBe(201)
    expect(entry.error).toBeNull()
    expect(entry.headersMs).toBeLessThanOrEqual(entry.durationMs)
  })

  // Only what can't be recomputed from the entry is stored (network-insights
  // decision 3); an entry that never got either simply carries nulls.
  it('carries the two network-insight fields, empty until something fills them', async () => {
    const built = builtRequest()
    const entry = historyEntry({ op, env, built })
    expect(entry).toMatchObject({ diagnosis: null, transfer: null })

    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
      { nextHopProtocol: 'h3', transferSize: 300, encodedBodySize: 250, decodedBodySize: 900 },
    ])
    applyResult(entry, await send(built, { fetchImpl: fakeFetch() }))
    expect(entry.transfer).toMatchObject({ protocol: 'h3', fromCache: false })
    expect(entry.diagnosis).toBeNull()
    vi.restoreAllMocks()
  })

  it('records the network failure as-is', async () => {
    const built = builtRequest()
    const entry = historyEntry({ op, env, built })
    applyResult(
      entry,
      await send(built, {
        fetchImpl: fakeFetch(new TypeError('Failed to fetch')),
        diagnose: noDiagnosis,
      }),
    )
    expect(entry.error).toBe('TypeError: Failed to fetch')
    expect(entry.response).toBeNull()
  })
})

describe('Server-Timing', () => {
  it('keeps the total metric when it exists', () => {
    expect(
      serverTimingFromHeaders(response('', { 'server-timing': 'db;dur=12, total;dur=340.5' })),
    ).toBe(340.5)
  })

  it('accepts the usual aliases for application time', () => {
    expect(
      serverTimingFromHeaders(response('', { 'server-timing': 'cache;dur=2, app;dur=88' })),
    ).toBe(88)
  })

  it('falls back to the largest duration without a named metric', () => {
    expect(
      serverTimingFromHeaders(response('', { 'server-timing': 'db;dur=12, render;dur=45' })),
    ).toBe(45)
  })

  it('ignores metrics without a duration', () => {
    expect(
      serverTimingFromHeaders(response('', { 'server-timing': 'miss, cache;desc="hit"' })),
    ).toBeNull()
  })

  it('is null without a header — the case for any third-party API without dedicated CORS', () => {
    expect(serverTimingFromHeaders(response(''))).toBeNull()
  })
})

describe('streamed body reading', () => {
  it('returns the same text as response.text() and the real size in bytes', async () => {
    const body = '{"name":"pet 🐈"}'
    const { body: text, sizeBytes } = await readBodyWithProgress(response(body), () => {})
    expect(text).toBe(body)
    // The emoji weighs 4 bytes: the size is indeed that of the transfer, not the
    // number of characters.
    expect(sizeBytes).toBe(19)
  })

  it('reports progress and Content-Length on each chunk', async () => {
    const chunks = [new Uint8Array(400), new Uint8Array(600)]
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    const seen = []
    await readBodyWithProgress(response(stream, { 'content-length': '1000' }), (received, total) =>
      seen.push([received, total]),
    )
    expect(seen).toEqual([
      [400, 1000],
      [1000, 1000],
    ])
  })

  it('does not fabricate a total when Content-Length is missing', async () => {
    const seen = []
    await readBodyWithProgress(response('abc'), (_received, total) => seen.push(total))
    expect(seen.every((total) => total === 0)).toBe(true)
  })

  it('correctly splits a multi-byte character straddling two chunks', async () => {
    const bytes = new TextEncoder().encode('a pet 🐈')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8))
        controller.enqueue(bytes.slice(8))
        controller.close()
      },
    })
    const { body } = await readBodyWithProgress(response(stream), () => {})
    expect(body).toBe('a pet 🐈')
  })
})
