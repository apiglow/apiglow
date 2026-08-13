import { describe, expect, it } from 'vitest'
import { buildAuthInjection } from '../src/openapi/auth.js'
import {
  applyProxy,
  buildRequest,
  conditionalRequest,
  effectiveBaseUrl,
  extractQueryValues,
  followRequest,
} from '../src/openapi/request-builder.js'

const op = {
  method: 'post',
  path: '/pets/{petId}/toys',
  parameters: [],
}

const vars = {
  host: { value: 'https://api.example.com', sensitive: false },
  token: { value: 'tok-1', sensitive: true },
}

describe('buildRequest', () => {
  it('assembles URL, query, headers and interpolated body', () => {
    const r = buildRequest({
      op,
      baseUrl: '{{host}}/v1/',
      pathValues: { petId: '42' },
      queryValues: { verbose: 'true', empty: '' },
      headerRows: [{ name: 'X-Token', value: '{{token}}' }],
      body: '{"name": "ball"}',
      mediaType: 'application/json',
      variables: vars,
    })
    expect(r.url).toBe('https://api.example.com/v1/pets/42/toys?verbose=true')
    expect(r.headers).toEqual({ 'X-Token': 'tok-1', 'Content-Type': 'application/json' })
    expect(r.body).toBe('{"name": "ball"}')
    expect(r.missing).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.used.map((u) => u.name).sort()).toEqual(['host', 'token'])
  })

  it('sends a 3.2 query string as-is, without re-encoding', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://api.example.com',
      pathValues: { petId: '1' },
      queryString: "?$.pets[?(@.name=='{{who}}')]",
      variables: { who: { value: 'Rex', sensitive: false } },
    })
    expect(r.url).toBe("https://api.example.com/pets/1/toys?$.pets[?(@.name=='Rex')]")
  })

  it('places the query string before the injected pairs', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://api.example.com',
      pathValues: { petId: '1' },
      queryString: 'raw=1',
      queryValues: { verbose: 'true' },
      authInjection: { query: { api_key: 'k' } },
    })
    expect(r.url).toBe('https://api.example.com/pets/1/toys?raw=1&verbose=true&api_key=k')
    // Echoed back: a caller that has to SAY what auth is travelling cannot
    // recognize this one in the finished request — it is in the URL, not in a
    // header — and matching header names instead reported nothing at all.
    expect(r.authInjection).toEqual({ query: { api_key: 'k' } })
  })

  it('blocks on missing variable without ever partially resolving', () => {
    const r = buildRequest({
      op,
      baseUrl: '{{nope}}/v1',
      pathValues: { petId: '1' },
      variables: {},
    })
    expect(r.missing).toEqual(['nope'])
    expect(r.url).toContain('{{nope}}')
  })

  it('reports an empty path param', () => {
    const r = buildRequest({ op, baseUrl: 'https://x', pathValues: {}, variables: {} })
    expect(r.errors).toEqual([{ code: 'path-param-missing', name: 'petId' }])
  })

  it('encodes path param values', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: 'a/b c' },
      variables: {},
    })
    expect(r.url).toBe('https://x/pets/a%2Fb%20c/toys')
  })

  it('validates the JSON body after interpolation (well-formed + 1st-level required)', () => {
    const bad = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      body: '{oops',
      mediaType: 'application/json',
      variables: {},
    })
    expect(bad.errors).toContainEqual({ code: 'body-invalid-json' })

    const incomplete = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      body: '{"tag": "dog"}',
      mediaType: 'application/json',
      bodySchema: { required: ['name', 'tag'] },
      variables: {},
    })
    expect(incomplete.errors).toEqual([{ code: 'body-missing-required', name: 'name' }])
  })

  it('auth is injected but a manual header of the same name wins', () => {
    const auth = buildAuthInjection(
      { name: 'b', type: 'http', scheme: 'bearer' },
      { 'auth.b': { value: 'secret', sensitive: true } },
    )
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      headerRows: [{ name: 'Authorization', value: 'Bearer manual' }],
      authInjection: auth,
      variables: {},
    })
    expect(r.headers.Authorization).toBe('Bearer manual')

    const noOverride = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      authInjection: auth,
      variables: {},
    })
    expect(noOverride.headers.Authorization).toBe('Bearer secret')
    expect(noOverride.used).toContainEqual({ name: 'auth.b', value: 'secret', sensitive: true })
  })

  it('builds a multipart body as form fields, without a manual Content-Type', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      formFields: [
        { name: 'file', value: '', fileName: 'photo.jpg' },
        { name: 'categorie', value: '{{token}}' },
        { name: 'vide', value: '' },
      ],
      mediaType: 'multipart/form-data',
      bodySchema: { required: ['file', 'categorie'] },
      variables: vars,
    })
    expect(r.form).toEqual([
      { name: 'file', fileName: 'photo.jpg' },
      { name: 'categorie', value: 'tok-1' },
    ])
    expect(r.body).toBeNull()
    // fetch must generate the boundary itself: no Content-Type set.
    expect(Object.keys(r.headers)).toEqual([])
    expect(r.errors).toEqual([])
  })

  it('reports missing required multipart fields (file not chosen)', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      formFields: [{ name: 'categorie', value: 'RIB' }],
      mediaType: 'multipart/form-data',
      bodySchema: { required: ['file', 'categorie'] },
      variables: {},
    })
    expect(r.errors).toEqual([{ code: 'body-missing-required', name: 'file' }])
  })

  // urlencoded shares the field editor with multipart but not the wire
  // shape: the pairs are serialized here so the history, the preview and
  // every snippet show the exact bytes.
  it('folds urlencoded fields into a query-string body', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      formFields: [
        { name: 'name', value: 'Rex the {{who}}' },
        { name: 'status', value: 'available' },
        { name: 'skipped', value: '' },
      ],
      mediaType: 'application/x-www-form-urlencoded',
      variables: { who: { value: 'dog', sensitive: false } },
    })
    expect(r.body).toBe('name=Rex+the+dog&status=available')
    expect(r.form).toBeNull()
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('leaves multipart structured and sets no Content-Type (fetch owns the boundary)', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      formFields: [
        { name: 'file', fileName: 'cat.png' },
        { name: 'caption', value: 'hi' },
      ],
      mediaType: 'multipart/form-data',
      variables: {},
    })
    expect(r.form).toEqual([
      { name: 'file', fileName: 'cat.png' },
      { name: 'caption', value: 'hi' },
    ])
    expect(r.body).toBeNull()
    expect(r.headers['Content-Type']).toBeUndefined()
  })

  it('carries a binary body as metadata only, never as content', () => {
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      file: { name: 'cat.png', size: 2048, type: 'image/png', bytes: 'never-read' },
      mediaType: 'application/octet-stream',
      variables: {},
    })
    expect(r.file).toEqual({ name: 'cat.png', size: 2048, type: 'image/png' })
    expect(r.body).toBeNull()
    expect(r.headers['Content-Type']).toBe('application/octet-stream')
    expect(r.errors).toEqual([])
  })

  it('blocks a required binary body with nothing picked', () => {
    const binaryOp = { ...op, requestBody: { required: true } }
    const r = buildRequest({
      op: binaryOp,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      mediaType: 'application/octet-stream',
      variables: {},
    })
    expect(r.errors).toEqual([{ code: 'body-file-missing' }])
  })

  // An empty text body is a payload someone may want to send; only the file
  // case has literally nothing to put on the wire.
  it('does not block an empty required JSON body', () => {
    const jsonOp = { ...op, requestBody: { required: true } }
    const r = buildRequest({
      op: jsonOp,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      mediaType: 'application/json',
      variables: {},
    })
    expect(r.errors).toEqual([])
  })

  it('carries auth cookies in a Cookie header (picked up by cURL)', () => {
    const auth = buildAuthInjection(
      { name: 'k', type: 'apiKey', in: 'cookie', paramName: 'session' },
      { 'auth.k': { value: 's1', sensitive: true } },
    )
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      pathValues: { petId: '1' },
      authInjection: auth,
      variables: {},
    })
    expect(r.headers.Cookie).toBe('session=s1')
    expect(r.hasCookies).toBe(true)
  })
})

describe('array parameters (style + explode)', () => {
  const arrayOp = (over = {}) => ({
    method: 'get',
    path: '/pets/findByTags',
    parameters: [
      {
        name: 'tags',
        in: 'query',
        style: 'form',
        explode: true,
        schema: { kind: 'array', items: { kind: 'string' } },
        ...over,
      },
    ],
  })

  it('repeats the name for the OpenAPI default (form + explode)', () => {
    const r = buildRequest({
      op: arrayOp(),
      baseUrl: 'https://x',
      queryValues: { tags: ['cat', 'dog'] },
      variables: {},
    })
    expect(r.url).toBe('https://x/pets/findByTags?tags=cat&tags=dog')
  })

  it('joins on the style delimiter when not exploded', () => {
    const r = buildRequest({
      op: arrayOp({ style: 'pipeDelimited', explode: false }),
      baseUrl: 'https://x',
      queryValues: { tags: ['cat', 'dog'] },
      variables: {},
    })
    expect(r.url).toBe('https://x/pets/findByTags?tags=cat%7Cdog')
  })

  it('interpolates and blocks element by element', () => {
    const r = buildRequest({
      op: arrayOp(),
      baseUrl: 'https://x',
      queryValues: { tags: ['{{kind}}', '', '{{nope}}'] },
      variables: { kind: { value: 'cat', sensitive: false } },
    })
    expect(r.missing).toEqual(['nope'])
    expect(r.url).toBe('https://x/pets/findByTags?tags=cat&tags=%7B%7Bnope%7D%7D')
  })

  it('serializes an array path parameter with its style', () => {
    const op32 = {
      method: 'get',
      path: '/pets/{ids}',
      parameters: [
        {
          name: 'ids',
          in: 'path',
          style: 'simple',
          explode: false,
          schema: { kind: 'array', items: { kind: 'integer' } },
        },
      ],
    }
    const r = buildRequest({ op: op32, baseUrl: 'https://x', pathValues: { ids: ['3', '4'] } })
    expect(r.url).toBe('https://x/pets/3,4')
    expect(r.errors).toEqual([])
  })

  it('reports an array path parameter left empty', () => {
    const op32 = {
      method: 'get',
      path: '/pets/{ids}',
      parameters: [
        { name: 'ids', in: 'path', style: 'simple', schema: { kind: 'array', items: {} } },
      ],
    }
    const r = buildRequest({ op: op32, baseUrl: 'https://x', pathValues: { ids: [] } })
    expect(r.errors).toEqual([{ code: 'path-param-missing', name: 'ids' }])
  })

  it('round-trips through the URL: sent, then reloaded into the editor', () => {
    const op = arrayOp()
    const r = buildRequest({
      op,
      baseUrl: 'https://x',
      queryValues: { tags: ['cat', 'dog'] },
      variables: {},
    })
    expect(extractQueryValues(r.url, op)).toEqual({ tags: ['cat', 'dog'] })
  })
})

describe('applyProxy', () => {
  it('substitutes {{target}} with the encoded target URL', () => {
    expect(applyProxy('https://proxy.io/?url={{target}}', 'https://api.x/v1?a=b')).toBe(
      'https://proxy.io/?url=https%3A%2F%2Fapi.x%2Fv1%3Fa%3Db',
    )
  })
})

// The insight strip's two actions (docs/network-insights.md §4.2): same
// `built` shape as `buildRequest`, taken from a stored entry instead of a form.
describe('replaying a stored request', () => {
  const entry = () => ({
    method: 'GET',
    path: '/pets',
    request: {
      method: 'GET',
      url: 'https://api.test/v1/pets?page=2',
      headers: { Authorization: 'Bearer t', Accept: 'application/json' },
      body: null,
    },
    usedVariables: [{ name: 'token', value: 't', sensitive: true }],
  })

  it('follows the server’s own URL, keeping the stored method and headers', () => {
    expect(followRequest(entry(), 'https://api.test/v1/pets?page=3')).toMatchObject({
      method: 'GET',
      url: 'https://api.test/v1/pets?page=3',
      headers: { Authorization: 'Bearer t', Accept: 'application/json' },
      body: null,
    })
  })

  // The new entry redacts what the first one did, and `send()` is told there is
  // nothing left to resolve.
  it('carries the stored variables and no validation left to do', () => {
    const built = followRequest(entry(), 'https://api.test/v1/pets?page=3')
    expect(built.used).toEqual([{ name: 'token', value: 't', sensitive: true }])
    expect(built.missing).toEqual([])
    expect(built.errors).toEqual([])
  })

  it('replays conditionally on the ETag when there is one', () => {
    const built = conditionalRequest(entry(), { etag: 'W/"v1"', lastModified: null })
    expect(built.headers).toEqual({
      Authorization: 'Bearer t',
      Accept: 'application/json',
      'If-None-Match': 'W/"v1"',
    })
    expect(built.url).toBe('https://api.test/v1/pets?page=2')
  })

  it('falls back to If-Modified-Since', () => {
    const date = 'Wed, 06 Aug 2025 10:00:00 GMT'
    expect(
      conditionalRequest(entry(), { etag: null, lastModified: date }).headers['If-Modified-Since'],
    ).toBe(date)
  })

  // Header names are case-insensitive, object keys are not: a stored validator
  // must not survive next to the one being set.
  it('replaces a validator the stored request already carried', () => {
    const stored = entry()
    stored.request.headers['if-none-match'] = 'W/"old"'
    const headers = conditionalRequest(stored, { etag: 'W/"new"' }).headers
    expect(headers['If-None-Match']).toBe('W/"new"')
    expect('if-none-match' in headers).toBe(false)
  })
})

describe('operation-level server precedence', () => {
  const pinned = { ...op, servers: [{ url: 'https://pinned.example.com/api' }] }

  it('a pinned operation server wins over the caller base URL', () => {
    const r = buildRequest({
      op: pinned,
      baseUrl: 'https://env.example.com',
      pathValues: { petId: '42' },
      variables: vars,
    })
    expect(r.url).toBe('https://pinned.example.com/api/pets/42/toys')
  })

  it('without a pinned server the caller base URL (environment or root) applies', () => {
    const r = buildRequest({
      op,
      baseUrl: '{{host}}/v1',
      pathValues: { petId: '42' },
      variables: vars,
    })
    expect(r.url).toBe('https://api.example.com/v1/pets/42/toys')
  })

  it('effectiveBaseUrl mirrors the same precedence for display surfaces', () => {
    expect(effectiveBaseUrl(pinned, 'https://env.example.com')).toBe(
      'https://pinned.example.com/api',
    )
    expect(effectiveBaseUrl(op, 'https://env.example.com')).toBe('https://env.example.com')
    expect(effectiveBaseUrl(op, undefined)).toBe('')
  })
})
