import { describe, expect, it } from 'vitest'
import {
  isNoCorsMethod,
  isNoCorsSafelisted,
  partitionNoCorsHeaders,
} from '../src/openapi/no-cors.js'

describe('isNoCorsMethod', () => {
  // A webhook declared with any other verb never gets the mode offered:
  // `fetch` would throw instead of sending.
  it('allows the three CORS-safelisted methods only', () => {
    expect(isNoCorsMethod('post')).toBe(true)
    expect(isNoCorsMethod('GET')).toBe(true)
    expect(isNoCorsMethod('HEAD')).toBe(true)
    expect(isNoCorsMethod('PUT')).toBe(false)
    expect(isNoCorsMethod('patch')).toBe(false)
    expect(isNoCorsMethod('DELETE')).toBe(false)
  })
})

describe('partitionNoCorsHeaders', () => {
  it('keeps a safelisted header and drops the rest, preserving the written case', () => {
    const { kept, dropped } = partitionNoCorsHeaders({
      Accept: 'application/json',
      'X-Webhook-Signature': 'sha256=abc',
      Authorization: 'Bearer t',
    })
    expect(kept).toEqual({ Accept: 'application/json' })
    expect(dropped).toEqual(['X-Webhook-Signature', 'Authorization'])
  })

  // The nominal webhook case: a JSON payload arrives as text/plain, and that is
  // exactly what the UI has to warn about before the send.
  it('drops the Content-Type of a JSON webhook payload', () => {
    const { kept, dropped } = partitionNoCorsHeaders({ 'Content-Type': 'application/json' })
    expect(kept).toEqual({})
    expect(dropped).toEqual(['Content-Type'])
  })

  it('reports nothing dropped when every header is safelisted', () => {
    expect(partitionNoCorsHeaders({ 'content-type': 'text/plain' }).dropped).toEqual([])
    expect(partitionNoCorsHeaders({}).dropped).toEqual([])
  })
})

describe('isNoCorsSafelisted', () => {
  it('safelists the four names, case- and whitespace-insensitively', () => {
    expect(isNoCorsSafelisted('  ACCEPT ', 'text/html')).toBe(true)
    expect(isNoCorsSafelisted('Accept-Language', 'fr-FR')).toBe(true)
    expect(isNoCorsSafelisted('content-language', 'en')).toBe(true)
    expect(isNoCorsSafelisted('Content-Type', 'text/plain')).toBe(true)
    expect(isNoCorsSafelisted('Range', 'bytes=0-1')).toBe(false)
    expect(isNoCorsSafelisted('X-Signature', 'abc')).toBe(false)
  })

  it('accepts only the three content-type essences, parameters included', () => {
    expect(isNoCorsSafelisted('content-type', 'TEXT/Plain; charset=utf-8')).toBe(true)
    expect(isNoCorsSafelisted('content-type', 'multipart/form-data; boundary=x')).toBe(true)
    expect(isNoCorsSafelisted('content-type', 'application/x-www-form-urlencoded')).toBe(true)
    expect(isNoCorsSafelisted('content-type', 'application/json')).toBe(false)
    expect(isNoCorsSafelisted('content-type', 'text/plain+weird')).toBe(false)
    expect(isNoCorsSafelisted('content-type', 'not a mime type')).toBe(false)
  })

  it('rejects a value carrying a CORS-unsafe byte', () => {
    expect(isNoCorsSafelisted('accept', 'text/html (draft)')).toBe(false)
    expect(isNoCorsSafelisted('accept', 'text/html; profile="x"')).toBe(false)
    expect(isNoCorsSafelisted('accept', String.fromCharCode(0x7f))).toBe(false)
    // `/`, `;`, `=` and `,` stay safe — that is what lets a real media type through.
    expect(isNoCorsSafelisted('accept', 'text/html;q=0.9,text/plain')).toBe(true)
    // Tab is the one control byte the spec spares.
    expect(isNoCorsSafelisted('accept', `text/html${String.fromCharCode(9)}`)).toBe(true)
  })

  it('applies the stricter charset of the language headers', () => {
    expect(isNoCorsSafelisted('accept-language', 'fr-FR, en;q=0.5')).toBe(true)
    expect(isNoCorsSafelisted('accept-language', 'fr_FR')).toBe(false)
  })

  it('caps the value at 128 bytes, not 128 characters', () => {
    expect(isNoCorsSafelisted('accept', 'a'.repeat(128))).toBe(true)
    expect(isNoCorsSafelisted('accept', 'a'.repeat(129))).toBe(false)
    expect(isNoCorsSafelisted('accept', 'é'.repeat(65))).toBe(false)
  })
})
