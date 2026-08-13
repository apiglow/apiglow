import { describe, expect, it } from 'vitest'
import {
  SNIPPET_LANGUAGES,
  snippetFromEntry,
  toCsharp,
  toGo,
  toRuby,
} from '../src/export/snippets.js'

// Same fixed entries as exports.test.js: deterministic snapshots.
const getEntry = {
  timestamp: 1750000000000,
  envName: 'staging',
  opId: 'getPet',
  operationId: 'getPet',
  method: 'get',
  path: '/pet/{petId}',
  durationMs: 123,
  request: {
    method: 'get',
    url: 'https://api.example.com/v1/pet/42?verbose=true',
    headers: { api_key: 'sk-123', Accept: 'application/json' },
    body: null,
  },
  response: {
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'application/json']],
    body: '{"id":42,"ownerKey":"sk-123"}',
  },
  sensitiveValues: ['sk-123'],
  usedVariables: [
    { name: 'auth.api_key', value: 'sk-123', sensitive: true },
    { name: 'host', value: 'api.example.com', sensitive: false },
  ],
}

const postEntry = {
  ...getEntry,
  opId: 'addPet',
  method: 'post',
  path: '/pet',
  request: {
    method: 'post',
    url: 'https://api.example.com/v1/pet',
    headers: { api_key: 'sk-123', 'Content-Type': 'application/json' },
    body: '{"name":"Rex","secret":"sk-123"}',
  },
  response: {
    status: 201,
    statusText: 'Created',
    headers: [['content-type', 'application/json']],
    body: '{"id":7}',
  },
}

const formRequest = {
  method: 'post',
  url: 'https://api.example.com/fr/api/library/documents',
  headers: { api_key: 'sk-123' },
  form: [
    { name: 'file', fileName: 'cni.jpg' },
    { name: 'categorie', value: 'IDENTITE' },
  ],
}

describe.each(Object.keys(SNIPPET_LANGUAGES))('snippet %s', (lang) => {
  it('GET redacted by default', () => {
    expect(snippetFromEntry(lang, getEntry)).toMatchSnapshot()
  })

  it('POST JSON in clear when redaction is disabled', () => {
    expect(snippetFromEntry(lang, postEntry, { redact: false })).toMatchSnapshot()
  })

  it('template mode: variable values become {{var}} again', () => {
    expect(snippetFromEntry(lang, getEntry, { substitute: false })).toMatchSnapshot()
  })
})

// Driven off the registry like the binary block below: a language added there
// gets its multipart snapshot, instead of quietly having none.
describe('multipart body', () => {
  it.each(Object.keys(SNIPPET_LANGUAGES))('%s: file part and field part', (lang) => {
    expect(SNIPPET_LANGUAGES[lang].generate(formRequest)).toMatchSnapshot()
  })
})

describe('binary body', () => {
  const fileRequest = {
    method: 'post',
    url: 'https://api.example.com/v1/pet/42/uploadImage',
    headers: { 'Content-Type': 'application/octet-stream' },
    file: { name: 'cat.png', size: 2048, type: 'image/png' },
  }

  it.each(Object.keys(SNIPPET_LANGUAGES))('%s: reads the file, never inlines it', (lang) => {
    expect(SNIPPET_LANGUAGES[lang].generate(fileRequest)).toMatchSnapshot()
  })

  it('reaches every generator from a history entry', () => {
    const entry = {
      ...postEntry,
      request: {
        method: 'post',
        url: 'https://api.example.com/v1/pet/42/uploadImage',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: '@cat.png (2.0 kB, image/png)',
        bodyFile: { name: 'cat.png', size: 2048, type: 'image/png' },
      },
    }
    // The display line must never end up quoted as if it were the payload.
    expect(snippetFromEntry('python', entry)).toContain('data=open("cat.png", "rb")')
    expect(snippetFromEntry('python', entry)).not.toContain('2.0 kB')
  })
})

describe('csharp content headers', () => {
  // HttpClient throws if Content-Type reaches request.Headers, so it has to
  // land on the HttpContent instead.
  const req = {
    method: 'post',
    url: 'https://x.dev/pet',
    headers: { 'Content-Type': 'application/xml', api_key: 'sk-1' },
    body: '<pet/>',
  }

  it('routes Content-Type to the content, not to the request headers', () => {
    const snippet = toCsharp(req)
    expect(snippet).not.toContain('request.Headers.Add("Content-Type"')
    expect(snippet).toContain('new StringContent("<pet/>", Encoding.UTF8, "application/xml")')
    expect(snippet).toContain('request.Headers.Add("api_key", "sk-1")')
  })

  it('falls back to application/json when the request declares no type', () => {
    expect(toCsharp({ ...req, headers: {} })).toContain('Encoding.UTF8, "application/json"')
  })
})

describe('escaping', () => {
  it('quotes and line breaks in the body do not invalidate literals', () => {
    const req = {
      method: 'post',
      url: "https://api.example.com/o'brien",
      headers: { 'X-Note': 'says "hi"' },
      body: 'line1\nline2 with \'single\' and "double" and \\backslash',
    }
    for (const lang of Object.keys(SNIPPET_LANGUAGES)) {
      expect(SNIPPET_LANGUAGES[lang].generate(req)).toMatchSnapshot(lang)
    }
  })

  it('ruby: an interpolation sequence in the body is neutralized', () => {
    const snippet = toRuby({
      method: 'post',
      url: 'https://x.dev',
      headers: {},
      body: '{"greeting":"hello #{name} and #@ivar"}',
    })
    expect(snippet).toContain('\\#{name}')
    expect(snippet).toContain('\\#@ivar')
    // A `#` that starts nothing stays readable.
    expect(toRuby({ method: 'get', url: 'https://x.dev/a#b', headers: {} })).toContain(
      'URI("https://x.dev/a#b")',
    )
  })

  it('go: body with backtick switches from raw string to escaped literal', () => {
    const snippet = toGo({
      method: 'post',
      url: 'https://x.dev',
      headers: {},
      body: 'a `raw` trap',
    })
    expect(snippet).toContain('strings.NewReader("a `raw` trap")')
  })
})
