import { describe, expect, it } from 'vitest'
import { isBlockedAsMixedContent, isCleartext } from '../src/openapi/mixed-content.js'

// What a browser refuses as mixed content, read once for the try-it, the OAuth
// block and the audit.

describe('isCleartext', () => {
  it('judges http to a remote host only', () => {
    expect(isCleartext('http://api.example.com')).toBe(true)
    expect(isCleartext('HTTP://api.example.com')).toBe(true)
    for (const url of [
      'https://api.example.com',
      '/v1',
      '//api.example.com',
      'http://localhost:8080',
      'http://localhost./',
      'http://dev.localhost',
      'http://127.0.0.1:3000',
      'http://[::1]/',
    ])
      expect(isCleartext(url), url).toBe(false)
  })

  it('gives no verdict on a host still holding an undeclared variable', () => {
    expect(isCleartext('http://{host}/v1')).toBe(false)
    expect(isCleartext('http://{env}.example.com')).toBe(false)
  })
})

describe('isBlockedAsMixedContent', () => {
  it('blocks a cleartext URL from an https page only, loopback allowed', () => {
    expect(isBlockedAsMixedContent('http://api.example.com/v1', 'https:')).toBe(true)
    expect(isBlockedAsMixedContent('http://api.example.com/v1', 'http:')).toBe(false)
    expect(isBlockedAsMixedContent('http://localhost:8080/v1', 'https:')).toBe(false)
    expect(isBlockedAsMixedContent('https://api.example.com', 'https:')).toBe(false)
  })

  it('resolves a relative URL against the page first', () => {
    expect(isBlockedAsMixedContent('/token', 'https:', 'https://docs.example.com/')).toBe(false)
    expect(isBlockedAsMixedContent('//api.example.com/token', 'https:', 'https://docs.test/')).toBe(
      false,
    )
  })
})
