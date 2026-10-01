import { describe, expect, it } from 'vitest'
import { isForbiddenMethod, isForbiddenRequestHeader } from '../src/openapi/forbidden.js'

describe('isForbiddenRequestHeader', () => {
  it('matches the standard names, whatever their case', () => {
    for (const name of ['Cookie', 'host', 'ORIGIN', 'Referer', 'Content-Length', 'Set-Cookie']) {
      expect(isForbiddenRequestHeader(name)).toBe(true)
    }
  })

  it('matches every Proxy- and Sec- header', () => {
    expect(isForbiddenRequestHeader('Proxy-Authorization')).toBe(true)
    expect(isForbiddenRequestHeader('sec-fetch-mode')).toBe(true)
  })

  it('lets through what a script may set, User-Agent included', () => {
    for (const name of ['Authorization', 'Content-Type', 'User-Agent', 'X-Request-Id', 'Accept']) {
      expect(isForbiddenRequestHeader(name)).toBe(false)
    }
  })

  it('forbids a method override only when it carries a forbidden method', () => {
    expect(isForbiddenRequestHeader('X-HTTP-Method-Override', 'TRACE')).toBe(true)
    expect(isForbiddenRequestHeader('x-method-override', 'get, connect')).toBe(true)
    expect(isForbiddenRequestHeader('X-HTTP-Method', 'PATCH')).toBe(false)
    expect(isForbiddenRequestHeader('X-HTTP-Method-Override')).toBe(false)
  })
})

describe('isForbiddenMethod', () => {
  it('matches CONNECT, TRACE and TRACK, whatever their case', () => {
    for (const method of ['CONNECT', 'trace', 'Track']) expect(isForbiddenMethod(method)).toBe(true)
    for (const method of ['GET', 'query', 'purge']) expect(isForbiddenMethod(method)).toBe(false)
  })
})
