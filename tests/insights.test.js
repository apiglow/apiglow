import { describe, expect, it } from 'vitest'
import {
  analyzeResponseHeaders,
  diagnoseFailure,
  extractTransfer,
} from '../src/openapi/insights.js'

// Fixed instant so every countdown is a stable number.
const NOW = Date.parse('2026-08-07T12:00:00Z')

const analyze = (headers, over = {}) =>
  analyzeResponseHeaders(Object.entries(headers), {
    status: 200,
    method: 'GET',
    url: 'https://api.test/v1/pets?page=2',
    now: NOW,
    ...over,
  })

const insight = (headers, kind, over) => analyze(headers, over).find((i) => i.kind === kind) ?? null

describe('response header registry', () => {
  it('returns nothing for a response carrying none of the recognized headers', () => {
    expect(analyze({ 'content-type': 'application/json', server: 'nginx' })).toEqual([])
  })

  it('reads header names case-insensitively and joins a repeated header', () => {
    const insights = analyzeResponseHeaders(
      [
        ['Link', '</v1/pets?page=3>; rel="next"'],
        ['LINK', '</v1/pets?page=1>; rel="prev"'],
        ['ETag', 'W/"abc"'],
      ],
      { status: 200, method: 'GET', url: 'https://api.test/v1/pets?page=2', now: NOW },
    )
    expect(insights.find((i) => i.kind === 'pagination').links.map((l) => l.rel)).toEqual([
      'next',
      'prev',
    ])
    expect(insights.find((i) => i.kind === 'validators').etag).toBe('W/"abc"')
  })

  it('orders the insights the way the strip renders them', () => {
    const insights = analyze(
      {
        etag: '"v1"',
        link: '</v1/pets?page=3>; rel="next"',
        'ratelimit-remaining': '57',
        'x-request-id': 'req-1',
        'retry-after': '30',
        deprecation: 'true',
      },
      { status: 503 },
    )
    expect(insights.map((i) => i.kind)).toEqual([
      'rate-limit',
      'retry-after',
      'deprecation',
      'pagination',
      'correlation',
      'validators',
    ])
  })
})

describe('rate limit', () => {
  it('reads the IETF draft triplet', () => {
    expect(
      insight(
        { 'ratelimit-limit': '100', 'ratelimit-remaining': '57', 'ratelimit-reset': '32' },
        'rate-limit',
      ),
    ).toEqual({ kind: 'rate-limit', limit: 100, remaining: 57, resetSeconds: 32, low: false })
  })

  it('falls back to the legacy X- variants', () => {
    expect(
      insight(
        { 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '4', 'x-ratelimit-reset': '15' },
        'rate-limit',
      ),
    ).toMatchObject({ limit: 60, remaining: 4, resetSeconds: 15 })
  })

  it('prefers the standard name when a server sends both', () => {
    expect(
      insight({ 'ratelimit-remaining': '57', 'x-ratelimit-remaining': '3' }, 'rate-limit'),
    ).toMatchObject({ remaining: 57 })
  })

  // GitHub and friends send an absolute instant where the draft says delta —
  // no real delta is decades long, so the magnitude decides.
  it('turns a legacy epoch reset into a delay', () => {
    expect(
      insight({ 'x-ratelimit-reset': String(NOW / 1000 + 45) }, 'rate-limit').resetSeconds,
    ).toBe(45)
    expect(insight({ 'x-ratelimit-reset': String(NOW + 45000) }, 'rate-limit').resetSeconds).toBe(
      45,
    )
  })

  it('never counts down below zero once the reset instant is past', () => {
    expect(
      insight({ 'ratelimit-reset': String(NOW / 1000 - 600) }, 'rate-limit').resetSeconds,
    ).toBe(0)
  })

  it('tolerates the quota-policy tail of the draft syntax', () => {
    expect(insight({ 'ratelimit-limit': '100, 100;w=60' }, 'rate-limit')).toMatchObject({
      limit: 100,
    })
  })

  it('flags the last tenth of the quota as low', () => {
    expect(
      insight({ 'ratelimit-limit': '100', 'ratelimit-remaining': '10' }, 'rate-limit').low,
    ).toBe(true)
    expect(
      insight({ 'ratelimit-limit': '100', 'ratelimit-remaining': '11' }, 'rate-limit').low,
    ).toBe(false)
  })

  it('flags an exhausted quota even when no limit is advertised', () => {
    expect(insight({ 'ratelimit-remaining': '0' }, 'rate-limit').low).toBe(true)
    expect(insight({ 'ratelimit-remaining': '1' }, 'rate-limit').low).toBe(false)
  })

  it('reports the fields it has and nothing more', () => {
    expect(insight({ 'ratelimit-remaining': '57' }, 'rate-limit')).toEqual({
      kind: 'rate-limit',
      limit: null,
      remaining: 57,
      resetSeconds: null,
      low: false,
    })
  })

  it('yields no insight on a malformed value', () => {
    expect(
      insight({ 'ratelimit-limit': 'many', 'ratelimit-remaining': '' }, 'rate-limit'),
    ).toBeNull()
  })
})

describe('Retry-After', () => {
  it('reads delta-seconds', () => {
    expect(insight({ 'retry-after': '30' }, 'retry-after', { status: 429 })).toEqual({
      kind: 'retry-after',
      seconds: 30,
    })
  })

  it('turns an HTTP-date into the remaining delay', () => {
    const target = new Date(NOW + 120_000).toUTCString()
    expect(insight({ 'retry-after': target }, 'retry-after', { status: 503 }).seconds).toBe(120)
  })

  it('is ignored outside the two statuses that define it', () => {
    expect(insight({ 'retry-after': '30' }, 'retry-after', { status: 200 })).toBeNull()
    expect(insight({ 'retry-after': '30' }, 'retry-after', { status: 500 })).toBeNull()
  })

  it('yields no insight on an unparsable value', () => {
    expect(insight({ 'retry-after': 'soon' }, 'retry-after', { status: 429 })).toBeNull()
  })
})

describe('deprecation', () => {
  it('reads the boolean form of the early drafts', () => {
    expect(insight({ deprecation: 'true' }, 'deprecation')).toEqual({
      kind: 'deprecation',
      deprecated: true,
      deprecatedDate: null,
      sunsetDate: null,
    })
  })

  it('reads the RFC 9745 structured timestamp', () => {
    expect(insight({ deprecation: '@1735689600' }, 'deprecation').deprecatedDate).toBe(
      1_735_689_600_000,
    )
  })

  it('reads an HTTP-date, the form of the drafts in between', () => {
    expect(insight({ deprecation: 'Wed, 01 Jan 2025 00:00:00 GMT' }, 'deprecation')).toMatchObject({
      deprecated: true,
      deprecatedDate: Date.parse('2025-01-01T00:00:00Z'),
    })
  })

  it('says nothing when the server says false', () => {
    expect(insight({ deprecation: 'false' }, 'deprecation')).toBeNull()
  })

  it('carries the sunset date alongside', () => {
    expect(
      insight({ deprecation: 'true', sunset: 'Sat, 01 Nov 2025 00:00:00 GMT' }, 'deprecation')
        .sunsetDate,
    ).toBe(Date.parse('2025-11-01T00:00:00Z'))
  })

  // A resource can be scheduled for removal without ever being flagged
  // deprecated: the date alone is the finding.
  it('reports a lone Sunset', () => {
    expect(insight({ sunset: 'Sat, 01 Nov 2025 00:00:00 GMT' }, 'deprecation')).toMatchObject({
      deprecated: false,
      sunsetDate: Date.parse('2025-11-01T00:00:00Z'),
    })
  })

  it('yields no insight on unparsable values', () => {
    expect(insight({ deprecation: 'yes', sunset: 'someday' }, 'deprecation')).toBeNull()
  })
})

describe('pagination links', () => {
  it('parses several rels and resolves them against the request URL', () => {
    expect(
      insight(
        {
          link: '</v1/pets?page=3>; rel="next", </v1/pets?page=1>; rel="prev", <https://api.test/v1/pets?page=9>; rel=last',
        },
        'pagination',
      ),
    ).toEqual({
      kind: 'pagination',
      followable: true,
      links: [
        { rel: 'next', url: 'https://api.test/v1/pets?page=3' },
        { rel: 'prev', url: 'https://api.test/v1/pets?page=1' },
        { rel: 'last', url: 'https://api.test/v1/pets?page=9' },
      ],
    })
  })

  it('orders the rels the way the strip wants them, whatever the header order', () => {
    expect(
      insight(
        { link: '</a>; rel=last, </b>; rel=prev, </c>; rel=first, </d>; rel=next' },
        'pagination',
      ).links.map((l) => l.rel),
    ).toEqual(['next', 'prev', 'first', 'last'])
  })

  it('accepts the registered `previous` spelling as `prev`', () => {
    expect(insight({ link: '</v1/pets?page=1>; rel="previous"' }, 'pagination').links).toEqual([
      { rel: 'prev', url: 'https://api.test/v1/pets?page=1' },
    ])
  })

  it('keeps a cursor URL containing a comma intact', () => {
    expect(insight({ link: '</v1/pets?after=a,b,c>; rel="next"' }, 'pagination').links[0].url).toBe(
      'https://api.test/v1/pets?after=a,b,c',
    )
  })

  it('reads a link-value carrying several rels', () => {
    expect(
      insight({ link: '</v1/pets?page=3>; rel="next last"' }, 'pagination').links.map((l) => l.rel),
    ).toEqual(['next', 'last'])
  })

  it('drops everything that is not an http(s) target', () => {
    expect(
      insight(
        { link: '<javascript:alert(1)>; rel="next", <mailto:a@b.test>; rel="prev"' },
        'pagination',
      ),
    ).toBeNull()
  })

  it('ignores unrelated rels and malformed values', () => {
    expect(
      insight({ link: '</style.css>; rel="stylesheet", no-brackets; rel="next"' }, 'pagination'),
    ).toBeNull()
  })

  it('offers no follow action on an unsafe method', () => {
    expect(
      insight({ link: '</v1/pets?page=3>; rel="next"' }, 'pagination', { method: 'POST' }),
    ).toMatchObject({ followable: false })
  })
})

describe('correlation id', () => {
  it('takes the most specific id when a response carries several', () => {
    expect(
      insight(
        {
          'cf-ray': '8a2b3c',
          'x-request-id': 'req-42',
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
        'correlation',
      ),
    ).toEqual({
      kind: 'correlation',
      name: 'traceparent',
      value: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    })
  })

  it('falls through the vendor headers in order', () => {
    expect(
      insight({ 'cf-ray': '8a2b3c', 'x-amzn-requestid': 'amz-1' }, 'correlation'),
    ).toMatchObject({ name: 'x-amzn-requestid' })
    expect(insight({ 'cf-ray': '8a2b3c' }, 'correlation')).toMatchObject({ name: 'cf-ray' })
  })

  it('ignores an empty id', () => {
    expect(insight({ 'x-request-id': '   ' }, 'correlation')).toBeNull()
  })
})

describe('validators', () => {
  it('reports the ETag and offers the conditional replay on a safe method', () => {
    expect(insight({ etag: 'W/"v1"' }, 'validators')).toEqual({
      kind: 'validators',
      etag: 'W/"v1"',
      lastModified: null,
      replayable: true,
    })
    expect(insight({ etag: 'W/"v1"' }, 'validators', { method: 'HEAD' }).replayable).toBe(true)
  })

  it('offers no replay on a method HTTP does not call safe', () => {
    expect(insight({ etag: 'W/"v1"' }, 'validators', { method: 'POST' }).replayable).toBe(false)
  })

  it('falls back to Last-Modified', () => {
    const date = 'Wed, 06 Aug 2025 10:00:00 GMT'
    expect(insight({ 'last-modified': date }, 'validators')).toMatchObject({
      etag: null,
      lastModified: date,
    })
  })

  it('drops a Last-Modified no server could answer a conditional request on', () => {
    expect(insight({ 'last-modified': 'yesterday' }, 'validators')).toBeNull()
  })
})

describe('transfer snapshot', () => {
  const timing = (over = {}) => ({
    nextHopProtocol: 'h2',
    transferSize: 1200,
    encodedBodySize: 1000,
    decodedBodySize: 8000,
    ...over,
  })

  it('reads the four numbers and the protocol', () => {
    expect(extractTransfer(timing())).toEqual({
      protocol: 'h2',
      transferSize: 1200,
      encodedBodySize: 1000,
      decodedBodySize: 8000,
      fromCache: false,
    })
  })

  it('is null without a Resource Timing entry', () => {
    expect(extractTransfer(null)).toBeNull()
  })

  // Cross-origin without Timing-Allow-Origin every size reads 0, which is
  // indistinguishable from "no data" — so it is treated as none.
  it('is null when the sizes are the all-zeros of a TAO-less response', () => {
    expect(
      extractTransfer(
        timing({ transferSize: 0, encodedBodySize: 0, decodedBodySize: 0, nextHopProtocol: '' }),
      ),
    ).toBeNull()
  })

  it('keeps the protocol alone when it is the only thing that survived', () => {
    expect(
      extractTransfer(timing({ transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 })),
    ).toEqual({ protocol: 'h2' })
  })

  it('trusts deliveryType where the browser exposes it', () => {
    expect(extractTransfer(timing({ deliveryType: 'cache', transferSize: 0 })).fromCache).toBe(true)
    // A body that did cross the wire is not a cache hit, whatever the sizes suggest.
    expect(extractTransfer(timing({ deliveryType: '', transferSize: 0 })).fromCache).toBe(false)
  })

  it('infers the cache hit where deliveryType does not exist', () => {
    expect(extractTransfer(timing({ transferSize: 0 })).fromCache).toBe(true)
    expect(extractTransfer(timing()).fromCache).toBe(false)
  })

  it('normalizes absent or nonsensical sizes to zero', () => {
    expect(extractTransfer(timing({ decodedBodySize: undefined, transferSize: -1 }))).toMatchObject(
      {
        transferSize: 0,
        decodedBodySize: 0,
      },
    )
  })
})

describe('failure diagnosis', () => {
  const diagnose = (over = {}) =>
    diagnoseFailure({
      url: 'https://api.test/v1/pets',
      online: true,
      pageProtocol: 'https:',
      probe: async () => new Response(null),
      timeoutMs: 50,
      ...over,
    })

  it('blames the connection first of all', async () => {
    // Even a mixed-content URL: with no network, nothing else is knowable.
    expect(await diagnose({ online: false, url: 'http://api.test/v1/pets' })).toEqual({
      verdict: 'offline',
      proxied: false,
    })
  })

  it('names mixed content before probing anything', async () => {
    let probed = false
    const result = await diagnose({
      url: 'http://api.test/v1/pets',
      probe: async () => {
        probed = true
      },
    })
    expect(result.verdict).toBe('mixed-content')
    expect(probed).toBe(false)
  })

  it('leaves an http target alone when the page itself is http', async () => {
    expect(
      (await diagnose({ url: 'http://api.test/v1/pets', pageProtocol: 'http:' })).verdict,
    ).toBe('cors')
  })

  it('suspects CORS when the probe reaches the server', async () => {
    let probedUrl = null
    const result = await diagnose({
      probe: async (url) => {
        probedUrl = url
        return new Response(null)
      },
    })
    expect(result.verdict).toBe('cors')
    expect(probedUrl).toBe('https://api.test/v1/pets')
  })

  it('declares the server unreachable when the probe fails', async () => {
    expect(
      (
        await diagnose({
          probe: async () => {
            throw new TypeError('Failed to fetch')
          },
        })
      ).verdict,
    ).toBe('unreachable')
  })

  it('declares the server unreachable when the probe never answers', async () => {
    expect((await diagnose({ probe: () => new Promise(() => {}) })).verdict).toBe('unreachable')
  })

  it('aborts the probe it stopped waiting for', async () => {
    let signal = null
    await diagnose({
      probe: (_url, init) => {
        signal = init.signal
        return new Promise(() => {})
      },
    })
    expect(signal.aborted).toBe(true)
  })

  // The verdict is on the URL that actually failed; when that is the proxy, the
  // wording has a proxy to blame and not the API (§3.1).
  it('carries the proxied flag through to the verdict', async () => {
    expect(await diagnose({ proxied: true })).toEqual({ verdict: 'cors', proxied: true })
  })
})
