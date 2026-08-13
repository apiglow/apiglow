import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { buildModel } from '../src/openapi/loader.js'
import { encodePair } from '../src/openapi/params.js'
import { buildRequest } from '../src/openapi/request-builder.js'
import { isXmlMedia, xmlSample } from '../src/openapi/sample-xml.js'

// Session 4 of docs/openapi-coverage.md: everything that decides what actually
// leaves the browser once the values are typed — the Encoding Object, the two
// serialization flags, cookie parameters, and the XML syntax the JSON sampler
// could not express.

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const load = async (name, options) =>
  buildModel(await $RefParser.dereference(fixture(name)), options)

const opById = (model, id) => model.operations.find((o) => o.id === id)
const paramOf = (op, name) => op.parameters.find((p) => p.name === name)
const contentOf = (op, mediaType) => op.requestBody.contents.find((c) => c.mediaType === mediaType)

describe('encoding normalization', () => {
  it('resolves style/explode defaults and keeps the declared content type', async () => {
    const model = await load('request-3.2.json')
    const multipart = contentOf(opById(model, 'upload'), 'multipart/form-data')
    expect(multipart.encodings.map((e) => e.property)).toEqual(['metadata', 'cover'])
    expect(multipart.encodings[0]).toMatchObject({
      property: 'metadata',
      contentType: 'application/json',
      // Same defaults a query parameter gets: a form body is a query string
      // written in another place.
      style: 'form',
      explode: true,
    })
  })

  it('gives a part header the value the document declared for it', async () => {
    const model = await load('request-3.2.json')
    const multipart = contentOf(opById(model, 'upload'), 'multipart/form-data')
    // `Content-Type` is dropped: the spec says `contentType` is where a part's
    // media type is stated, and two places stating it is one too many.
    expect(multipart.encodings[0].headers).toEqual([
      {
        name: 'X-Part-Trace',
        schema: expect.objectContaining({ default: 'trace-1' }),
        value: 'trace-1',
      },
    ])
  })

  it('models the 3.2 positional forms next to the named one', async () => {
    const model = await load('request-3.2.json')
    const multipart = contentOf(opById(model, 'upload'), 'multipart/form-data')
    expect(multipart.prefixEncoding).toEqual([
      { contentType: 'text/plain', style: 'form', explode: true },
    ])
    expect(multipart.itemEncoding).toEqual({
      contentType: 'application/json',
      style: 'form',
      explode: true,
    })
  })
})

describe('parameter serialization flags', () => {
  it('normalizes allowReserved and allowEmptyValue', async () => {
    const search = opById(await load('request-3.2.json'), 'search')
    expect(paramOf(search, 'q').allowReserved).toBe(true)
    expect(paramOf(search, 'verbose').allowEmptyValue).toBe(true)
    // Absent, not false: the model prunes what the document did not say.
    expect(paramOf(search, 'session').allowReserved).toBeUndefined()
  })

  it('keeps RFC 3986 reserved characters when allowReserved is set', () => {
    expect(encodePair('q', 'a/b?c=d')).toBe('q=a%2Fb%3Fc%3Dd')
    expect(encodePair('q', 'a/b?c=d', { allowReserved: true })).toBe('q=a/b?c=d')
    // A space is never structure: `%20` rather than URLSearchParams' `+`,
    // which would be a second lie about a value kept verbatim.
    expect(encodePair('q', 'a b', { allowReserved: true })).toBe('q=a%20b')
  })

  it('sends an allowReserved value unescaped and an ordinary one escaped', async () => {
    const search = opById(await load('request-3.2.json'), 'search')
    const built = buildRequest({
      op: search,
      baseUrl: 'https://api.test',
      queryValues: { q: 'pets/dogs?live=1', session: '' },
    })
    expect(built.url).toBe('https://api.test/search?q=pets/dogs?live=1')
  })

  it('sends `name=` only when the empty value was explicitly asked for', async () => {
    const search = opById(await load('request-3.2.json'), 'search')
    const silent = buildRequest({
      op: search,
      baseUrl: 'https://api.test',
      queryValues: { verbose: '' },
    })
    expect(silent.url).toBe('https://api.test/search')
    const asked = buildRequest({
      op: search,
      baseUrl: 'https://api.test',
      queryValues: { verbose: '' },
      emptyValues: ['verbose'],
    })
    expect(asked.url).toBe('https://api.test/search?verbose=')
  })
})

describe('cookie parameters (T3)', () => {
  it('folds them into one Cookie header, alongside a cookie credential', async () => {
    const search = opById(await load('request-3.2.json'), 'search')
    const built = buildRequest({
      op: search,
      baseUrl: 'https://api.test',
      cookieValues: { session: 'abc', flags: ['a', 'b'] },
      authInjection: { headers: {}, query: {}, cookies: { token: 'zzz' }, used: [], missing: [] },
    })
    // Exploding inside a single header value would repeat the name where no
    // server reads a list: the style's delimiter joins instead.
    expect(built.headers.Cookie).toBe('session=abc; flags=a,b; token=zzz')
    // Which is exactly what makes the browser drop it — the panel says so.
    expect(built.hasCookies).toBe(true)
  })

  it('never puts a cookie parameter in the query string', async () => {
    const search = opById(await load('request-3.2.json'), 'search')
    const built = buildRequest({
      op: search,
      baseUrl: 'https://api.test',
      cookieValues: { session: 'abc' },
    })
    expect(built.url).toBe('https://api.test/search')
  })
})

describe('encoding applied to a body', () => {
  it('serializes a urlencoded field through its declared style/explode', async () => {
    const upload = opById(await load('request-3.2.json'), 'upload')
    const content = contentOf(upload, 'application/x-www-form-urlencoded')
    const built = buildRequest({
      op: upload,
      baseUrl: 'https://api.test',
      mediaType: content.mediaType,
      bodySchema: content.schema,
      encodings: content.encodings,
      formFields: [
        { name: 'tags', value: 'cat,dog' },
        { name: 'path', value: 'a/b' },
      ],
    })
    // `explode: true` on an array repeats the pair; `allowReserved` on the
    // other field keeps its slash.
    expect(built.body).toBe('tags=cat&tags=dog&path=a/b')
    expect(built.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('carries a multipart part content type and its static headers', async () => {
    const upload = opById(await load('request-3.2.json'), 'upload')
    const content = contentOf(upload, 'multipart/form-data')
    const built = buildRequest({
      op: upload,
      baseUrl: 'https://api.test',
      mediaType: content.mediaType,
      bodySchema: content.schema,
      encodings: content.encodings,
      formFields: [
        { name: 'metadata', value: '{"name":"x"}' },
        { name: 'cover', fileName: 'cat.png' },
      ],
    })
    expect(built.form).toEqual([
      {
        name: 'metadata',
        value: '{"name":"x"}',
        contentType: 'application/json',
        headers: [{ name: 'X-Part-Trace', value: 'trace-1' }],
      },
      { name: 'cover', fileName: 'cat.png', contentType: 'image/png' },
    ])
    // Multipart never gets a manual Content-Type: fetch owns the boundary.
    expect(built.headers['Content-Type']).toBeUndefined()
  })
})

describe('XML', () => {
  it('normalizes 3.0 attribute/wrapped into the 3.2 nodeType', async () => {
    const model = await load('request-3.2.json')
    const book = contentOf(opById(model, 'createBook'), 'application/xml').schema
    const prop = (name) => book.properties.find((p) => p.name === name).schema
    expect(book.xml).toEqual({ name: 'book', namespace: 'https://example.com/ns', prefix: 'b' })
    expect(prop('legacyAttr').xml).toEqual({ nodeType: 'attribute' })
    expect(prop('authors').xml).toEqual({ nodeType: 'element' })
  })

  it('recognizes the XML media types, structured suffix included', () => {
    expect(isXmlMedia('application/xml')).toBe(true)
    expect(isXmlMedia('text/xml; charset=utf-8')).toBe(true)
    expect(isXmlMedia('application/vnd.acme+xml')).toBe(true)
    expect(isXmlMedia('application/json')).toBe(false)
    expect(isXmlMedia(null)).toBe(false)
  })

  it('renders a document: attributes, namespace, wrapped and bare arrays, CDATA', async () => {
    const model = await load('request-3.2.json')
    const book = contentOf(opById(model, 'createBook'), 'application/xml').schema
    expect(xmlSample(book)).toMatchSnapshot()
  })

  it('escapes text and stays bounded on a recursive schema', async () => {
    const model = await load('request-3.2.json')
    const book = contentOf(opById(model, 'createBook'), 'application/xml').schema
    // The prefix belongs to the schema that declares it, not to everything
    // under it: only the root is `b:`-qualified.
    expect(xmlSample(book)).toContain('<title>Dune &amp; Sons &lt;best&gt;</title>')
    // A cyclic node renders nothing rather than recursing (rule 7).
    const cyclic = { kind: 'object', properties: [] }
    cyclic.properties.push({ name: 'self', schema: { ...cyclic, circular: true } })
    expect(xmlSample(cyclic, { declaration: false })).toBe('<root />')
  })
})

describe('$self (3.2)', () => {
  it('carries the document base into the model', async () => {
    const model = await load('request-3.2.json', {
      baseUri: 'https://api.example.com/specs/request.json',
    })
    expect(model.baseUri).toBe('https://api.example.com/specs/request.json')
    // What it is for: a relative server resolves against the document's own
    // URI, not against wherever this copy is served from.
    expect(new URL(model.servers[0].url, model.baseUri).href).toBe('https://api.example.com/v2')
  })

  it('is absent when the document declares none', async () => {
    const model = await load('petstore-3.1.json')
    expect(model.baseUri).toBeUndefined()
  })
})
