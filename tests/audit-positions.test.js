import { describe, expect, it } from 'vitest'
import { lineIndex, pointerIndex, sourcePointer } from '../src/audit/positions.js'

// Where a finding sits in the file its author edits (docs/audit.md §8.1).

const place = (text, pointer) => {
  const { offset, exact } = pointerIndex(text).find(pointer)
  return { ...lineIndex(text)(offset), exact }
}

describe('pointerIndex', () => {
  const json =
    '{\n  "paths": {\n    "/pets": {\n      "get": { "parameters": [{ "name": "id" }] }\n    }\n  }\n}\n'

  it('places a JSON key at its opening quote, escaped segments included', () => {
    expect(place(json, '/paths')).toEqual({ line: 2, column: 3, exact: true })
    expect(place(json, '/paths/~1pets/get')).toEqual({ line: 4, column: 7, exact: true })
    expect(place(json, '/paths/~1pets/get/parameters/0')).toEqual({
      line: 4,
      column: 31,
      exact: true,
    })
    expect(place(json, '/paths/~1pets/get/parameters/0/name')).toEqual({
      line: 4,
      column: 33,
      exact: true,
    })
  })

  it('falls back to the deepest node the text holds', () => {
    expect(place(json, '/paths/~1pets/get/description')).toEqual({
      line: 4,
      column: 7,
      exact: false,
    })
    expect(place(json, '/nowhere')).toEqual({ line: 1, column: 1, exact: false })
  })

  it('reads YAML: block and flow collections, quoted keys, aliases', () => {
    const yaml = [
      'openapi: 3.1.0',
      'paths:',
      '  /pets:',
      '    get:',
      '      tags: [pets, "store"]',
      '      parameters:',
      '        - &limit',
      '          name: limit',
      "  '/owners':",
      '    get:',
      '      parameters:',
      '        - *limit',
      '',
    ].join('\n')
    expect(place(yaml, '/paths/~1pets/get')).toMatchObject({ line: 4, column: 5 })
    expect(place(yaml, '/paths/~1pets/get/tags/1')).toMatchObject({ line: 5, column: 20 })
    expect(place(yaml, '/paths/~1pets/get/parameters/0/name')).toMatchObject({
      line: 8,
      column: 11,
    })
    expect(place(yaml, '/paths/~1owners')).toMatchObject({ line: 9, column: 3, exact: true })
    // An alias is placed where it is written; below it, nothing of its own.
    expect(place(yaml, '/paths/~1owners/get/parameters/0')).toMatchObject({ line: 12, column: 11 })
    expect(place(yaml, '/paths/~1owners/get/parameters/0/name')).toMatchObject({
      line: 12,
      exact: false,
    })
  })
})

describe('pointerIndex on texts no strict parser accepts', () => {
  it('places a duplicate key at its last occurrence, the one whose value counts', () => {
    const text = 'info:\n  title: A\n  title: B\n'
    expect(place(text, '/info/title')).toEqual({ line: 3, column: 3, exact: true })
  })

  it('gives a complex key no pointer, nor anything under it', () => {
    const text = '? [a, b]\n: { c: 1 }\nd: 2\n'
    expect(place(text, '/d')).toEqual({ line: 3, column: 1, exact: true })
    expect(place(text, '/c')).toMatchObject({ exact: false })
  })

  it('reads the first document of a stream only', () => {
    const text = 'a: 1\n---\nb: 2\n'
    expect(place(text, '/a')).toMatchObject({ line: 1, exact: true })
    expect(place(text, '/b')).toEqual({ line: 1, column: 1, exact: false })
  })

  it('places what it reads past a syntax error', () => {
    const text = '{"openapi": "3.1.0", "paths": {},}'
    expect(place(text, '/paths')).toEqual({ line: 1, column: 22, exact: true })
    const tab = 'openapi: 3.1.0\npaths: {}\n\tbad: tab\n'
    expect(place(tab, '/paths')).toEqual({ line: 2, column: 1, exact: true })
  })
})

describe('sourcePointer', () => {
  const document = {
    paths: {
      '/pets': {
        get: {
          parameters: [{ $ref: '#/components/parameters/Limit' }],
          responses: { 200: { $ref: 'responses.yaml#/Ok', description: 'Written beside the ref' } },
        },
      },
    },
    components: {
      parameters: { Limit: { name: 'limit', schema: { $ref: '#/components/schemas/N' } } },
    },
  }
  const external = { Ok: { content: { 'application/json': { schema: { type: 'object' } } } } }
  const loadDocument = (target) =>
    target === 'responses.yaml' ? { file: 'responses.yaml', document: external } : null
  const walk = (dataPath) => sourcePointer(dataPath, { document, loadDocument })

  it('follows a local $ref and records where it was crossed', () => {
    expect(walk('/paths/~1pets/get/parameters/0/name')).toEqual({
      file: null,
      pointer: '/components/parameters/Limit/name',
      refs: [{ file: null, pointer: '/paths/~1pets/get/parameters/0' }],
    })
  })

  it('follows a $ref into another file', () => {
    expect(walk('/paths/~1pets/get/responses/200/content/application~1json/schema')).toMatchObject({
      file: 'responses.yaml',
      pointer: '/Ok/content/application~1json/schema',
    })
  })

  it('prefers a field written beside the $ref', () => {
    expect(walk('/paths/~1pets/get/responses/200/description').pointer).toBe(
      '/paths/~1pets/get/responses/200/description',
    )
  })

  it('stops at the deepest node that exists, and on a $ref it cannot follow', () => {
    expect(walk('/paths/~1pets/get/parameters/0/schema/type').pointer).toBe(
      '/components/parameters/Limit/schema',
    )
    const loop = { a: { $ref: '#/b' }, b: { $ref: '#/a' } }
    expect(sourcePointer('/a/x', { document: loop, loadDocument }).refs.length).toBeLessThanOrEqual(
      32,
    )
  })

  it('decodes a percent-encoded fragment', () => {
    const encoded = {
      a: { $ref: '#/paths/~1pets~1%7Bid%7D' },
      paths: { '/pets/{id}': { get: {} } },
    }
    expect(sourcePointer('/a/get', { document: encoded, loadDocument }).pointer).toBe(
      '/paths/~1pets~1{id}/get',
    )
  })
})
