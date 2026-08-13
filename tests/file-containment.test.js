import { describe, expect, it } from 'vitest'
import { curlFromEntry } from '../src/export/curl.js'
import { toDebugReport } from '../src/export/debug.js'
import { toHar } from '../src/export/har.js'
import { toMarkdownReport } from '../src/export/markdown.js'
import { toPostmanCollection } from '../src/export/postman.js'
import { decodeShareState, encodeShareState } from '../src/export/share.js'
import { buildRequest } from '../src/openapi/request-builder.js'
import { historyEntry } from '../src/openapi/send.js'

// Invariant 13: a picked file's CONTENTS never leave the tab. The exports and
// the share link are safe by construction — they only ever receive what
// `buildRequest` returns — and until now nothing asserted the construction.
// This file guards the choke point itself: hand a real File to the builder and
// prove that what comes out, and everything fed from it, carries a descriptor
// and never the bytes.

const bytes = 'PNG-CONTENT-THAT-MUST-NEVER-TRAVEL'
const picked = () => new File([bytes], 'cat.png', { type: 'image/png' })

const op = {
  id: 'uploadPet',
  method: 'POST',
  path: '/pets/{petId}/photo',
  parameters: [{ name: 'petId', in: 'path', required: true, schema: { kind: 'primitive' } }],
  requestBody: { required: true, contents: [{ mediaType: 'image/png' }] },
}

// Anything holding bytes rather than describing them: a Blob/File, an
// ArrayBuffer, a typed array, or a string carrying the content itself.
function findContentLeak(value, path = '$') {
  if (value == null) return null
  if (typeof value === 'string') return value.includes(bytes) ? path : null
  if (typeof Blob !== 'undefined' && value instanceof Blob) return path
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return path
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const leak = findContentLeak(item, `${path}[${i}]`)
      if (leak) return leak
    }
    return null
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const leak = findContentLeak(item, `${path}.${key}`)
      if (leak) return leak
    }
  }
  return null
}

describe('a picked file never leaves the tab', () => {
  const built = () =>
    buildRequest({
      op,
      baseUrl: 'https://api.test/v1',
      pathValues: { petId: '42' },
      // What the editor hands over: the picker's metadata, never the File.
      file: picked(),
      kind: 'binary',
      mediaType: 'image/png',
    })

  it('is reduced to name, size and type by the request builder', () => {
    const request = built()
    expect(request.file).toEqual({ name: 'cat.png', size: bytes.length, type: 'image/png' })
    expect(request.file).not.toBeInstanceOf(File)
    expect(findContentLeak(request)).toBeNull()
  })

  it('reaches history as that descriptor and nothing else', () => {
    const entry = historyEntry({ op, built: built() })
    expect(entry.request.bodyFile).toEqual({
      name: 'cat.png',
      size: bytes.length,
      type: 'image/png',
    })
    expect(findContentLeak(entry)).toBeNull()
    // The display line names the file; it does not carry it.
    expect(entry.request.body).toBe(`@cat.png (${bytes.length} B, image/png)`)
  })

  it('cannot put the contents into any export generator', () => {
    const entry = historyEntry({ op, built: built() })
    entry.response = { status: 201, headers: {}, body: '{"ok":true}' }
    const generated = {
      curl: curlFromEntry(entry),
      debug: toDebugReport(entry),
      har: toHar(entry),
      markdown: toMarkdownReport(entry),
      postman: toPostmanCollection(entry),
    }
    for (const [name, output] of Object.entries(generated)) {
      expect([name, findContentLeak(output)]).toEqual([name, null])
      // Each one still says a file was sent — containment is not silence.
      expect(JSON.stringify(output)).toContain('cat.png')
    }
  })

  it('is dropped entirely from a share link', () => {
    // The panel refuses to serialize a file body (`shareUrl()`): the content
    // only ever existed in this tab, so a link that claimed to carry it would
    // reopen as something else.
    const encoded = encodeShareState({
      path: { petId: '42' },
      query: {},
      headers: [],
      body: null,
    })
    const decoded = decodeShareState(encoded)
    expect(decoded.path).toEqual({ petId: '42' })
    expect(decoded.body ?? undefined).toBeUndefined()
    expect(findContentLeak(decoded)).toBeNull()
  })

  it('keeps multipart parts to their filename too', () => {
    const multipart = buildRequest({
      op,
      baseUrl: 'https://api.test/v1',
      pathValues: { petId: '42' },
      formFields: [
        { name: 'avatar', fileName: 'cat.png' },
        { name: 'caption', value: 'my cat' },
      ],
      kind: 'multipart',
      mediaType: 'multipart/form-data',
    })
    expect(multipart.form).toEqual([
      { name: 'avatar', fileName: 'cat.png' },
      { name: 'caption', value: 'my cat' },
    ])
    expect(findContentLeak(historyEntry({ op, built: multipart }))).toBeNull()
  })
})
