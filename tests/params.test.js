import { describe, expect, it } from 'vitest'
import {
  isMultiValue,
  isObjectValue,
  normalizeParamValue,
  objectPathValue,
  objectQueryPairs,
  paramValueTemplates,
  pathValue,
  queryPairs,
  readQueryValues,
  toValueEntries,
  toValueList,
} from '../src/openapi/params.js'

const arrayParam = (over = {}) => ({
  name: 'tags',
  in: 'query',
  style: 'form',
  explode: true,
  schema: { kind: 'array', items: { kind: 'string' } },
  ...over,
})

describe('toValueList', () => {
  it('keeps a list as a list and a scalar as a single value', () => {
    expect(toValueList(arrayParam(), ['cat', 'dog'])).toEqual(['cat', 'dog'])
    expect(toValueList(null, 'cat')).toEqual(['cat'])
  })

  it('drops an empty value entirely', () => {
    expect(toValueList(arrayParam(), '')).toEqual([])
    expect(toValueList(arrayParam(), undefined)).toEqual([])
    expect(toValueList(null, '')).toEqual([])
  })

  it('reads a string back with the delimiter of the declared style', () => {
    expect(toValueList(arrayParam(), 'cat,dog')).toEqual(['cat', 'dog'])
    expect(toValueList(arrayParam({ style: 'pipeDelimited' }), 'cat|dog')).toEqual(['cat', 'dog'])
    expect(toValueList(arrayParam({ style: 'spaceDelimited' }), 'cat dog')).toEqual(['cat', 'dog'])
  })

  it('leaves a comma inside a scalar value alone', () => {
    expect(toValueList({ name: 'q', in: 'query', schema: { kind: 'string' } }, 'a,b')).toEqual([
      'a,b',
    ])
  })
})

describe('queryPairs', () => {
  it('repeats the name for form + explode (the OpenAPI default)', () => {
    expect(queryPairs('tags', arrayParam(), ['cat', 'dog'])).toEqual([
      ['tags', 'cat'],
      ['tags', 'dog'],
    ])
  })

  it('joins on the style delimiter when not exploded', () => {
    expect(queryPairs('tags', arrayParam({ explode: false }), ['cat', 'dog'])).toEqual([
      ['tags', 'cat,dog'],
    ])
    expect(
      queryPairs('tags', arrayParam({ style: 'pipeDelimited', explode: false }), ['cat', 'dog']),
    ).toEqual([['tags', 'cat|dog']])
    expect(
      queryPairs('tags', arrayParam({ style: 'spaceDelimited', explode: false }), ['cat', 'dog']),
    ).toEqual([['tags', 'cat dog']])
  })

  it('repeats an undeclared multi-valued name rather than losing values', () => {
    expect(queryPairs('tags', null, ['cat', 'dog'])).toEqual([
      ['tags', 'cat'],
      ['tags', 'dog'],
    ])
  })

  it('produces nothing for an empty list', () => {
    expect(queryPairs('tags', arrayParam(), [])).toEqual([])
  })
})

describe('pathValue', () => {
  const pathParam = (over = {}) => ({
    name: 'ids',
    in: 'path',
    style: 'simple',
    explode: false,
    schema: { kind: 'array', items: { kind: 'string' } },
    ...over,
  })

  it('joins on commas for the simple style', () => {
    expect(pathValue('ids', pathParam(), ['3', '4'])).toBe('3,4')
    expect(pathValue('ids', pathParam({ explode: true }), ['3', '4'])).toBe('3,4')
  })

  it('prefixes label and matrix styles', () => {
    expect(pathValue('ids', pathParam({ style: 'label' }), ['3', '4'])).toBe('.3,4')
    expect(pathValue('ids', pathParam({ style: 'label', explode: true }), ['3', '4'])).toBe('.3.4')
    expect(pathValue('ids', pathParam({ style: 'matrix' }), ['3', '4'])).toBe(';ids=3,4')
    expect(pathValue('ids', pathParam({ style: 'matrix', explode: true }), ['3', '4'])).toBe(
      ';ids=3;ids=4',
    )
  })

  it('encodes each element but never the delimiters', () => {
    expect(pathValue('ids', pathParam(), ['a/b', 'c d'])).toBe('a%2Fb,c%20d')
  })
})

describe('readQueryValues', () => {
  const op = { parameters: [arrayParam()] }

  it('gives an array parameter back as an array, even with a single value', () => {
    const params = new URLSearchParams('tags=cat&tags=dog')
    expect(readQueryValues(params, op)).toEqual({ tags: ['cat', 'dog'] })
    expect(readQueryValues(new URLSearchParams('tags=cat'), op)).toEqual({ tags: ['cat'] })
  })

  it('splits a joined value when the parameter is not exploded', () => {
    const nonExploded = { parameters: [arrayParam({ explode: false })] }
    expect(readQueryValues(new URLSearchParams('tags=cat,dog'), nonExploded)).toEqual({
      tags: ['cat', 'dog'],
    })
  })

  it('keeps a scalar scalar and an undeclared repeated name as a list', () => {
    const params = new URLSearchParams('limit=10&other=a&other=b')
    expect(readQueryValues(params, op)).toEqual({ limit: '10', other: ['a', 'b'] })
  })
})

const objectParam = (over = {}) => ({
  name: 'filter',
  in: 'query',
  style: 'form',
  explode: true,
  schema: {
    kind: 'object',
    properties: [
      { name: 'role', schema: { kind: 'primitive', type: 'string' } },
      { name: 'level', schema: { kind: 'primitive', type: 'integer' } },
    ],
  },
  ...over,
})

describe('structured parameter detection', () => {
  it('spreads an array or an object, never a scalar', () => {
    expect(isMultiValue(arrayParam())).toBe(true)
    expect(isObjectValue(objectParam())).toBe(true)
    expect(isMultiValue(objectParam())).toBe(false)
    expect(isObjectValue({ schema: { kind: 'primitive', type: 'string' } })).toBe(false)
  })

  it('leaves a free-form object and a `content` parameter as one raw value', () => {
    expect(isObjectValue({ schema: { kind: 'object' } })).toBe(false)
    expect(isObjectValue(objectParam({ mediaType: 'application/json' }))).toBe(false)
    expect(isMultiValue(arrayParam({ mediaType: 'application/json' }))).toBe(false)
  })
})

describe('object parameters', () => {
  it('reads a map, and a flat wire string, in schema order', () => {
    expect(toValueEntries(objectParam(), { level: '3', role: 'admin' })).toEqual([
      ['role', 'admin'],
      ['level', '3'],
    ])
    expect(toValueEntries(objectParam(), 'role,admin,level,3')).toEqual([
      ['role', 'admin'],
      ['level', '3'],
    ])
    expect(toValueEntries(objectParam(), { role: '', level: '3' })).toEqual([['level', '3']])
  })

  it('spreads the properties as plain pairs for form + explode', () => {
    const entries = toValueEntries(objectParam(), { role: 'admin', level: '3' })
    expect(objectQueryPairs('filter', objectParam(), entries)).toEqual([
      ['role', 'admin'],
      ['level', '3'],
    ])
  })

  it('brackets each property for deepObject', () => {
    const param = objectParam({ style: 'deepObject' })
    expect(objectQueryPairs('filter', param, toValueEntries(param, { role: 'admin' }))).toEqual([
      ['filter[role]', 'admin'],
    ])
  })

  it('flattens key,value,key,value when not exploded', () => {
    const param = objectParam({ explode: false })
    const entries = toValueEntries(param, { role: 'admin', level: '3' })
    expect(objectQueryPairs('filter', param, entries)).toEqual([['filter', 'role,admin,level,3']])
  })

  it('serializes a path object per style', () => {
    const entries = [
      ['role', 'admin'],
      ['level', '3'],
    ]
    expect(objectPathValue('f', { style: 'simple' }, entries)).toBe('role,admin,level,3')
    expect(objectPathValue('f', { style: 'simple', explode: true }, entries)).toBe(
      'role=admin,level=3',
    )
    expect(objectPathValue('f', { style: 'label', explode: true }, entries)).toBe(
      '.role=admin.level=3',
    )
    expect(objectPathValue('f', { style: 'matrix' }, entries)).toBe(';f=role,admin,level,3')
    expect(objectPathValue('f', { style: 'matrix', explode: true }, entries)).toBe(
      ';role=admin;level=3',
    )
  })

  it('reads an object parameter back from the URL, whatever its style', () => {
    const exploded = { parameters: [objectParam()] }
    expect(readQueryValues(new URLSearchParams('role=admin&level=3'), exploded)).toEqual({
      filter: { role: 'admin', level: '3' },
    })

    const deep = { parameters: [objectParam({ style: 'deepObject' })] }
    expect(readQueryValues(new URLSearchParams('filter[role]=admin'), deep)).toEqual({
      filter: { role: 'admin' },
    })

    const flat = { parameters: [objectParam({ explode: false })] }
    expect(readQueryValues(new URLSearchParams('filter=role,admin,level,3'), flat)).toEqual({
      filter: { role: 'admin', level: '3' },
    })
  })

  it('leaves a name declared as its own parameter out of the object', () => {
    const op = { parameters: [objectParam(), { name: 'level', in: 'query', style: 'form' }] }
    expect(readQueryValues(new URLSearchParams('role=admin&level=3'), op)).toEqual({
      filter: { role: 'admin' },
      level: '3',
    })
  })
})

describe('stored value contract', () => {
  it('accepts a string, a list of strings and a flat map', () => {
    expect(normalizeParamValue('a')).toBe('a')
    expect(normalizeParamValue(3)).toBe('3')
    expect(normalizeParamValue(['a', 2])).toEqual(['a', '2'])
    expect(normalizeParamValue({ role: 'admin', level: 2 })).toEqual({ role: 'admin', level: '2' })
  })

  it('drops anything else — every source of it is untrusted', () => {
    for (const value of [null, undefined, true, {}, { a: { b: 1 } }, [{ a: 1 }], () => {}]) {
      expect(normalizeParamValue(value)).toBeUndefined()
    }
  })

  it('exposes every template a structured value can hold', () => {
    const templates = paramValueTemplates({
      a: '{{one}}',
      b: ['{{two}}'],
      c: { k: '{{three}}' },
    })
    expect(templates).toEqual(['{{one}}', '{{two}}', '{{three}}'])
  })
})
