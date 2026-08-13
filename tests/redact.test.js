import { describe, expect, it } from 'vitest'
import { redactEntry, redactText } from '../src/export/redact.js'
import { extractPathValues } from '../src/openapi/request-builder.js'

describe('redaction', () => {
  it('hides every occurrence of each sensitive value', () => {
    expect(redactText('Bearer tok-1 & tok-1', ['tok-1'])).toBe('Bearer •••• & ••••')
    expect(redactText('nothing', ['tok-1'])).toBe('nothing')
    expect(redactText('x', [])).toBe('x')
  })

  it('redacts url, headers (object and array), and bodies of an entry', () => {
    const entry = {
      sensitiveValues: ['s3cret'],
      request: {
        url: 'https://api.x/v1?key=s3cret',
        headers: { Authorization: 'Bearer s3cret' },
        body: '{"token":"s3cret"}',
      },
      response: {
        status: 200,
        headers: [['x-echo', 's3cret']],
        body: 'ok s3cret',
      },
    }
    const r = redactEntry(entry)
    expect(r.request.url).toBe('https://api.x/v1?key=••••')
    expect(r.request.headers.Authorization).toBe('Bearer ••••')
    expect(r.request.body).toBe('{"token":"••••"}')
    expect(r.response.headers).toEqual([['x-echo', '••••']])
    expect(r.response.body).toBe('ok ••••')
    // The original is not mutated
    expect(entry.request.url).toContain('s3cret')
  })

  it('leaves an entry without a response untouched (network failure)', () => {
    const r = redactEntry({
      sensitiveValues: ['x'],
      request: { url: 'u', headers: {}, body: null },
      response: null,
    })
    expect(r.response).toBeNull()
  })
})

describe('extractPathValues', () => {
  it('re-extracts path params by aligning the end of the path', () => {
    expect(extractPathValues('/pet/{petId}', 'https://x/api/v3/pet/42')).toEqual({ petId: '42' })
    expect(extractPathValues('/store/order/{orderId}', 'https://x/store/order/9')).toEqual({
      orderId: '9',
    })
    expect(extractPathValues('/a/{p}/b/{q}', 'https://x/base/a/1/b/2%20z')).toEqual({
      p: '1',
      q: '2 z',
    })
  })

  it('tolerates relative and unreadable URLs', () => {
    expect(extractPathValues('/pet/{petId}', '/api/v3/pet/7')).toEqual({ petId: '7' })
    expect(extractPathValues('/pet/{petId}', '::::')).toEqual({})
  })
})
