import { describe, expect, it } from 'vitest'
import { decodeShareState, encodeShareState } from '../src/export/share.js'

const STATE = {
  path: { petId: '42' },
  query: { _locale: 'fr' },
  headers: [
    { name: 'X-Trace', value: 'abc' },
    { name: '', value: 'ignored' },
  ],
  body: '{"name":"Rex"}',
  mediaTypeIndex: 1,
}

describe('sharing a request via URL', () => {
  it('round-trips the full try-it state', () => {
    const decoded = decodeShareState(encodeShareState(STATE))
    expect(decoded).toEqual({
      path: { petId: '42' },
      query: { _locale: 'fr' },
      headers: [{ name: 'X-Trace', value: 'abc' }],
      body: '{"name":"Rex"}',
      mediaTypeIndex: 1,
    })
  })

  it('keeps a multi-valued parameter a list, and cleans each element', () => {
    const encoded = encodeShareState({ ...STATE, query: { tags: ['cat', 'tok-s3cret'] } }, [
      { name: 'auth.k', value: 'tok-s3cret', sensitive: true },
    ])
    expect(encoded).not.toContain('tok-s3cret')
    expect(decodeShareState(encoded).query.tags).toEqual(['cat', '{{auth.k}}'])
  })

  it('produces a URL-safe string, including with UTF-8', () => {
    const encoded = encodeShareState({ ...STATE, body: '{"emoji":"🐶","cjk":"日本語"}' })
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeShareState(encoded).body).toBe('{"emoji":"🐶","cjk":"日本語"}')
  })

  it('retemplates sensitive values into {{var}} — never a secret in the link', () => {
    const sensitive = [{ name: 'auth.bearerAuth', value: 'tok-s3cret', sensitive: true }]
    const encoded = encodeShareState(
      {
        path: {},
        query: { token: 'tok-s3cret' },
        headers: [{ name: 'Authorization', value: 'Bearer tok-s3cret' }],
        body: '{"key":"tok-s3cret","template":"{{auth.bearerAuth}}"}',
        mediaTypeIndex: 0,
      },
      sensitive,
    )
    expect(encoded).not.toContain('tok-s3cret')
    const decoded = decodeShareState(encoded)
    expect(decoded.query.token).toBe('{{auth.bearerAuth}}')
    expect(decoded.headers[0].value).toBe('Bearer {{auth.bearerAuth}}')
    // Templates already in place remain intact.
    expect(decoded.body).toBe('{"key":"{{auth.bearerAuth}}","template":"{{auth.bearerAuth}}"}')
  })

  it('ignores a sensitive variable without a value (nothing to retemplate)', () => {
    const encoded = encodeShareState(STATE, [{ name: 'auth.x', value: '', sensitive: true }])
    expect(decodeShareState(encoded).body).toBe(STATE.body)
  })

  it('returns null for any unreadable payload or unknown version', () => {
    expect(decodeShareState('not-base64-!!!')).toBeNull()
    expect(decodeShareState('')).toBeNull()
    // Valid JSON but not a payload: version missing.
    expect(decodeShareState(btoa('{"foo":1}').replace(/=+$/, ''))).toBeNull()
  })

  it('sanitizes a payload of unexpected shape on decoding', () => {
    const hostile = btoa(
      JSON.stringify({
        v: 1,
        path: { ok: 'v', evil: { nested: true } },
        query: 'not-an-object',
        headers: [['X', 'y'], 'junk', [null, 'no-name']],
        body: 42,
        mediaTypeIndex: -3,
      }),
    ).replace(/=+$/, '')
    expect(decodeShareState(hostile)).toEqual({
      path: { ok: 'v' },
      query: {},
      headers: [{ name: 'X', value: 'y' }],
      body: null,
      mediaTypeIndex: 0,
    })
  })
})
