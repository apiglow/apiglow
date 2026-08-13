import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readHeaderMemory, rememberHeader } from '../src/storage/header-memory.js'
import { setSpecScope } from '../src/storage/prefs.js'
import { fakeStorage } from './support/fake-storage.js'

beforeEach(() => {
  globalThis.window = { localStorage: fakeStorage() }
})

afterEach(() => {
  setSpecScope(null)
  delete globalThis.window
})

describe('remembering', () => {
  it('keys by lowercase name while keeping the entered casing', () => {
    rememberHeader('X-Api-Version', '2')
    expect(readHeaderMemory()).toEqual({ 'x-api-version': { name: 'X-Api-Version', value: '2' } })
  })

  it('forgets on an empty or undefined value', () => {
    rememberHeader('X-Trace', 'abc')
    rememberHeader('X-Trace', '')
    expect(readHeaderMemory()).toEqual({})
  })

  it('ignores a nameless header', () => {
    rememberHeader('', 'value')
    expect(readHeaderMemory()).toEqual({})
  })
})

describe('bounded storage', () => {
  it('keeps at most 50 headers, dropping the first seen', () => {
    for (let i = 0; i < 55; i++) rememberHeader(`X-H${i}`, String(i))
    const memory = readHeaderMemory()
    expect(Object.keys(memory)).toHaveLength(50)
    expect(memory['x-h0']).toBeUndefined()
    expect(memory['x-h54'].value).toBe('54')
  })

  it('does not memorize a value beyond 8 KB rather than storing half of it', () => {
    rememberHeader('Authorization', 'Bearer short')
    rememberHeader('X-Blob', 'y'.repeat(8 * 1024 + 1))
    const memory = readHeaderMemory()
    expect(memory['x-blob']).toBeUndefined()
    expect(memory.authorization.value).toBe('Bearer short')
  })

  it('accepts a long-but-plausible token', () => {
    rememberHeader('Authorization', `Bearer ${'j'.repeat(4000)}`)
    expect(readHeaderMemory().authorization.value).toHaveLength(4007)
  })
})
