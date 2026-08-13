import { describe, expect, it } from 'vitest'
import {
  pathToPointer,
  pointerFrom,
  pointerToPath,
  resolvePointer,
} from '../src/scenarios/pointer.js'

const doc = {
  id: 7,
  data: { items: [{ name: 'a' }, { name: 'b' }] },
  'a/b': 'slash',
  'c~d': 'tilde',
  empty: '',
  nothing: null,
}

describe('resolvePointer', () => {
  it('returns the whole document for the empty pointer', () => {
    expect(resolvePointer(doc, '')).toEqual({ found: true, value: doc })
  })

  it('traverses objects and arrays', () => {
    expect(resolvePointer(doc, '/data/items/1/name')).toEqual({ found: true, value: 'b' })
    expect(resolvePointer(doc, '/id')).toEqual({ found: true, value: 7 })
  })

  it('unescapes ~1 then ~0, in that order', () => {
    expect(resolvePointer(doc, '/a~1b').value).toBe('slash')
    expect(resolvePointer(doc, '/c~0d').value).toBe('tilde')
    expect(resolvePointer({ '~1': 'ok' }, '/~01').value).toBe('ok')
  })

  it('distinguishes a missing value from an empty or null value', () => {
    expect(resolvePointer(doc, '/empty')).toEqual({ found: true, value: '' })
    expect(resolvePointer(doc, '/nothing')).toEqual({ found: true, value: null })
    expect(resolvePointer(doc, '/absent').found).toBe(false)
  })

  it('rejects array indices that are out of bounds or non-numeric', () => {
    expect(resolvePointer(doc, '/data/items/2').found).toBe(false)
    expect(resolvePointer(doc, '/data/items/01').found).toBe(false)
    expect(resolvePointer(doc, '/data/items/-').found).toBe(false)
    expect(resolvePointer(doc, '/data/items/name').found).toBe(false)
  })

  it('never throws on a weird pointer or document', () => {
    expect(resolvePointer(doc, 'id').found).toBe(false)
    expect(resolvePointer(doc, '/id/trop/loin').found).toBe(false)
    expect(resolvePointer(null, '/id').found).toBe(false)
    expect(resolvePointer('text', '/id').found).toBe(false)
    // Prototype trap: `constructor` is not an own key.
    expect(resolvePointer(doc, '/constructor').found).toBe(false)
  })
})

describe('pointerFrom', () => {
  it('assembles a clicked path into an escaped pointer', () => {
    expect(pointerFrom(['data', 'items', 0, 'name'])).toBe('/data/items/0/name')
    expect(pointerFrom(['a/b'])).toBe('/a~1b')
    expect(pointerFrom(['c~d'])).toBe('/c~0d')
    expect(pointerFrom([])).toBe('')
  })

  it('round-trips with resolvePointer', () => {
    expect(resolvePointer(doc, pointerFrom(['data', 'items', 1, 'name'])).value).toBe('b')
  })
})

describe('dotted notation', () => {
  it('renders a pointer without a separator at the root', () => {
    expect(pointerToPath('/triplon/original_operator')).toBe('triplon.original_operator')
    expect(pointerToPath('/data/items/0/name')).toBe('data.items.0.name')
    expect(pointerToPath('/id')).toBe('id')
  })

  it('renders the whole body as an absence of path', () => {
    expect(pointerToPath('')).toBe('')
    expect(pointerToPath(null)).toBe('')
    expect(pointerToPath(undefined)).toBe('')
  })

  it('unescapes translatable segments', () => {
    expect(pointerToPath('/a~1b')).toBe('a/b')
    expect(pointerToPath('/c~0d')).toBe('c~d')
  })

  it('leaves the raw pointer when dotted notation would be ambiguous', () => {
    // `{"a.b": 1}` and `{"a": {"b": 1}}` would both be written as "a.b".
    expect(pointerToPath('/a.b')).toBe('/a.b')
    expect(pointerToPath('/')).toBe('/')
    // Input in progress, not yet a pointer: rendered as-is.
    expect(pointerToPath('id')).toBe('id')
  })

  it('parses a typed path into a storable pointer', () => {
    expect(pathToPointer('triplon.original_operator')).toBe('/triplon/original_operator')
    expect(pathToPointer('data.items.0.name')).toBe('/data/items/0/name')
    expect(pathToPointer('  id  ')).toBe('/id')
    expect(pathToPointer('')).toBe('')
    expect(pathToPointer(null)).toBe('')
  })

  it('accepts a pasted pointer as-is', () => {
    expect(pathToPointer('/a.b')).toBe('/a.b')
    expect(pathToPointer('/data/items/0')).toBe('/data/items/0')
  })

  it('round-trips on every translatable pointer', () => {
    for (const pointer of ['/id', '/data/items/0/name', '/a~1b', '/c~0d', '']) {
      expect(pathToPointer(pointerToPath(pointer))).toBe(pointer)
    }
  })
})
