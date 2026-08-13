import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSpecPref, setSpecScope, writeSpecPref } from '../src/storage/prefs.js'
import { fakeStorage } from './support/fake-storage.js'

let storage

beforeEach(() => {
  storage = fakeStorage()
  globalThis.window = { localStorage: storage }
})

afterEach(() => {
  setSpecScope(null)
  delete globalThis.window
})

describe('per-spec namespace prefix', () => {
  it('writes and reads bare keys with no scope (single-spec)', () => {
    writeSpecPref('environments', [1])
    expect(storage.map.has('apidoc:environments')).toBe(true)
    expect(readSpecPref('environments')).toEqual([1])
  })

  it('prefixes apidoc:{specId}:{key} once the scope is set', () => {
    setSpecScope('payments')
    writeSpecPref('environments', [2])
    expect(storage.map.has('apidoc:payments:environments')).toBe(true)
    expect(storage.map.has('apidoc:environments')).toBe(false)
    expect(readSpecPref('environments')).toEqual([2])
  })

  it('isolates two specs from each other', () => {
    setSpecScope('payments')
    writeSpecPref('tryit.headers', { a: 1 })
    setSpecScope('accounts')
    expect(readSpecPref('tryit.headers', {})).toEqual({})
  })
})
