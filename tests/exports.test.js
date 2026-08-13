import { describe, expect, it } from 'vitest'
import { curlFromEntry, toCurl } from '../src/export/curl.js'
import { toDebugReport } from '../src/export/debug.js'
import { toHar } from '../src/export/har.js'
import { toMarkdownReport } from '../src/export/markdown.js'
import { toPostmanCollection } from '../src/export/postman.js'

// Fixed history entry: snapshots must be deterministic.
const getEntry = {
  timestamp: 1750000000000,
  envName: 'staging',
  opId: 'getPet',
  operationId: 'getPet',
  method: 'get',
  path: '/pet/{petId}',
  durationMs: 123,
  headersMs: 110,
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

const failedEntry = {
  ...getEntry,
  response: null,
  error: 'network',
  durationMs: 45,
}

// Bodies that are not text: `body` holds a display line only, the structured
// shape next to it is what every exporter reads.
const fileEntry = {
  ...postEntry,
  opId: 'uploadFile',
  path: '/pet/{petId}/uploadImage',
  sensitiveValues: [],
  request: {
    method: 'post',
    url: 'https://api.example.com/v1/pet/42/uploadImage',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: '@cat.png (2.0 kB, image/png)',
    bodyFile: { name: 'cat.png', size: 2048, type: 'image/png' },
  },
}

const formEntry = {
  ...postEntry,
  opId: 'uploadFile',
  sensitiveValues: ['sk-123'],
  request: {
    method: 'post',
    url: 'https://api.example.com/v1/pet/42/uploadImage',
    headers: {},
    body: 'label=photo\navatar=@cat.png',
    form: [
      { name: 'label', value: 'photo' },
      { name: 'avatar', fileName: 'cat.png' },
    ],
  },
}

describe('cURL export', () => {
  it('redacts secrets by default', () => {
    expect(curlFromEntry(getEntry)).toMatchSnapshot()
  })

  it('unredacted output when redaction is explicitly disabled', () => {
    expect(curlFromEntry(postEntry, { redact: false })).toMatchSnapshot()
  })

  it('template mode: variable values turn back into {{var}}', () => {
    expect(curlFromEntry(getEntry, { substitute: false })).toMatchSnapshot()
  })

  it('multipart body: one --form per field, files as @name', () => {
    const curl = toCurl({
      method: 'post',
      url: 'https://api.example.com/fr/api/library/documents',
      headers: {},
      form: [
        { name: 'file', fileName: 'cni.jpg' },
        { name: 'categorie', value: 'IDENTITE' },
      ],
    })
    expect(curl).toBe(
      "curl -X POST 'https://api.example.com/fr/api/library/documents' \\\n" +
        "  --form 'file=@cni.jpg' \\\n" +
        "  --form 'categorie=IDENTITE'",
    )
  })

  // A per-part header is the one thing a browser cannot express (FormData sets
  // Content-Disposition and nothing else): the export is where the encoding
  // object survives in full.
  it('multipart part: the encoding content type and headers in cURL syntax', () => {
    const curl = toCurl({
      method: 'post',
      url: 'https://api.example.com/upload',
      headers: {},
      form: [
        {
          name: 'metadata',
          value: '{"name":"x"}',
          contentType: 'application/json',
          headers: [{ name: 'X-Part-Trace', value: 'trace-1' }],
        },
      ],
    })
    expect(curl).toBe(
      "curl -X POST 'https://api.example.com/upload' \\\n" +
        `  --form 'metadata={"name":"x"};type=application/json;headers="X-Part-Trace: trace-1"'`,
    )
  })

  // `--data` would strip the newlines and corrupt anything that isn't text.
  it('binary body: --data-binary on the file name', () => {
    expect(curlFromEntry(fileEntry)).toBe(
      "curl -X POST 'https://api.example.com/v1/pet/42/uploadImage' \\\n" +
        "  -H 'Content-Type: application/octet-stream' \\\n" +
        "  --data-binary '@cat.png'",
    )
  })

  it('multipart entry: --form per part, not the display line as a payload', () => {
    const curl = curlFromEntry(formEntry)
    expect(curl).toContain("--form 'avatar=@cat.png'")
    expect(curl).toContain("--form 'label=photo'")
    expect(curl).not.toContain('--data')
  })
})

describe('Postman v2.1 export', () => {
  it('importable collection, redacted by default', () => {
    expect(toPostmanCollection(getEntry)).toMatchSnapshot()
  })

  it('raw JSON body for a POST', () => {
    expect(toPostmanCollection(postEntry, { redact: false })).toMatchSnapshot()
  })

  it('file mode for a binary body, formdata for a multipart one', () => {
    expect(toPostmanCollection(fileEntry).item[0].request.body).toEqual({
      mode: 'file',
      file: { src: 'cat.png' },
    })
    expect(toPostmanCollection(formEntry).item[0].request.body).toEqual({
      mode: 'formdata',
      formdata: [
        { key: 'label', type: 'text', value: 'photo' },
        { key: 'avatar', type: 'file', src: 'cat.png' },
      ],
    })
  })
})

describe('Markdown export', () => {
  it('full report: request + response + context', () => {
    expect(toMarkdownReport(postEntry)).toMatchSnapshot()
  })

  it('network failure: no response section', () => {
    expect(toMarkdownReport(failedEntry)).toMatchSnapshot()
  })
})

describe('HAR 1.2 export', () => {
  const timingsOf = (entry) => toHar(entry).log.entries[0].timings
  const timeOf = (entry) => toHar(entry).log.entries[0].time

  it('full entry', () => {
    expect(toHar(getEntry)).toMatchSnapshot()
  })

  it('separates the wait for headers from the receipt of the body', () => {
    expect(timingsOf(getEntry)).toEqual({ send: 0, wait: 110, receive: 13 })
  })

  // HAR 1.2 has no file mode: the file is named in `comment`, its bytes stay
  // out — they were never stored, and inventing a `text` would be a lie.
  it('names a binary body without inventing its content', () => {
    const request = toHar(fileEntry).log.entries[0].request
    expect(request.bodySize).toBe(2048)
    expect(request.postData).toEqual({
      mimeType: 'application/octet-stream',
      text: '',
      comment: '@cat.png (2.0 kB, image/png)',
    })
  })

  it('lists multipart parts as postData params', () => {
    expect(toHar(formEntry).log.entries[0].request.postData).toMatchObject({
      mimeType: 'multipart/form-data',
      params: [
        { name: 'label', value: 'photo' },
        { name: 'avatar', fileName: 'cat.png' },
      ],
    })
  })

  it('entry predating the two-stage measurement: everything in wait, no invented split', () => {
    expect(timingsOf({ ...getEntry, headersMs: undefined })).toEqual({
      send: 0,
      wait: 123,
      receive: 0,
    })
  })

  // What the browser measured on the wire replaces the character count HAR had
  // to make do with (docs/network-insights.md §5.3).
  it('maps the transfer snapshot onto the standard size fields', () => {
    const withTransfer = {
      ...getEntry,
      transfer: {
        protocol: 'h2',
        transferSize: 1500,
        encodedBodySize: 1200,
        decodedBodySize: 8000,
        fromCache: false,
      },
    }
    const response = toHar(withTransfer).log.entries[0].response
    expect(response.bodySize).toBe(1200)
    expect(response.content.size).toBe(8000)
    expect(response.content.compression).toBe(6800)
    expect(response._transferSize).toBe(1500)
  })

  // Cross-origin without Timing-Allow-Origin there is no snapshot at all, and
  // an entry predating the feature has no field: both keep today's export.
  it('leaves an entry without a snapshot exactly as it was', () => {
    const response = toHar(getEntry).log.entries[0].response
    expect(response.content.size).toBe(response.content.text.length)
    expect(response.bodySize).toBe(response.content.text.length)
    expect('compression' in response.content).toBe(false)
    expect('_transferSize' in response).toBe(false)
  })

  it('network failure: the split never produces a negative receive', () => {
    // Since headers never arrived, the inherited headersMs can exceed the
    // total — HAR forbids a negative duration.
    expect(timingsOf({ ...getEntry, response: null, error: 'network', durationMs: 45 })).toEqual({
      send: 0,
      wait: 45,
      receive: 0,
    })
  })

  it('respects the HAR invariant: time = sum of timings', () => {
    for (const entry of [
      getEntry,
      { ...getEntry, headersMs: undefined },
      { ...getEntry, headersMs: 123 },
    ]) {
      const { send, wait, receive } = timingsOf(entry)
      expect(send + wait + receive).toBe(timeOf(entry))
    }
  })
})

describe('Debug export (everything)', () => {
  it('full dump of request + response + variables, redacted by default', () => {
    expect(toDebugReport(postEntry)).toMatchSnapshot()
  })

  it('unredacted when redaction is disabled', () => {
    expect(toDebugReport(getEntry, { redact: false })).toMatchSnapshot()
  })

  it('network failure: error section, no response', () => {
    expect(toDebugReport(failedEntry)).toMatchSnapshot()
  })
})
