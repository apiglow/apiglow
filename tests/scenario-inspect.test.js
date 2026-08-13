import { describe, expect, it } from 'vitest'
import { normalizeSchema } from '../src/openapi/model.js'
import {
  chainableResponses,
  preferredResponse,
  responseLeaves,
  schemaLeaves,
  variableNameFor,
} from '../src/scenarios/inspect.js'
import { resolvePointer } from '../src/scenarios/pointer.js'

describe('responseLeaves', () => {
  it('renders a pointer per key, containers included, flat and indented', () => {
    const { rows, truncated } = responseLeaves({ id: 42, owner: { name: 'Ada' }, tags: ['a'] })
    expect(truncated).toBe(false)
    expect(rows.map((r) => [r.pointer, r.depth, r.preview])).toEqual([
      ['/id', 0, '42'],
      ['/owner', 0, '{1}'],
      ['/owner/name', 1, '"Ada"'],
      ['/tags', 0, '[1]'],
      ['/tags/0', 1, '"a"'],
    ])
    expect(rows.find((r) => r.pointer === '/owner').container).toBe(true)
  })

  it('produces pointers that actually resolve, escaping included', () => {
    const doc = { 'a/b': { '~x': 1 } }
    const { rows } = responseLeaves(doc)
    expect(rows.map((r) => r.pointer)).toEqual(['/a~1b', '/a~1b/~0x'])
    expect(resolvePointer(doc, '/a~1b/~0x')).toEqual({ found: true, value: 1 })
  })

  it('caps the number of rows and the depth, without throwing', () => {
    const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]))
    const { rows, truncated } = responseLeaves(wide, { maxRows: 10 })
    expect(rows).toHaveLength(10)
    expect(truncated).toBe(true)

    const deep = { a: { b: { c: { d: { e: 1 } } } } }
    const { rows: deepRows } = responseLeaves(deep, { maxDepth: 2 })
    expect(deepRows.map((r) => r.pointer)).toEqual(['/a', '/a/b'])
  })

  it('renders nothing for a scalar or empty body', () => {
    expect(responseLeaves(null).rows).toEqual([])
    expect(responseLeaves('text').rows).toEqual([])
    expect(responseLeaves({}).rows).toEqual([])
  })

  it('truncates previews that are too long', () => {
    const { rows } = responseLeaves({ jwt: 'x'.repeat(200) })
    expect(rows[0].preview.length).toBeLessThan(70)
    expect(rows[0].preview.endsWith('…')).toBe(true)
  })
})

describe('schemaLeaves', () => {
  const leaves = (raw, options) => schemaLeaves(normalizeSchema(raw), options)

  it('renders the same rows as a response, but typed and without value', () => {
    const { rows } = leaves({
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer' },
        owner: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
      },
    })
    expect(rows.map((r) => [r.pointer, r.depth, r.preview, r.required])).toEqual([
      ['/id', 0, 'integer', true],
      ['/owner', 0, 'object', false],
      ['/owner/email', 1, 'string (email)', false],
    ])
  })

  it('descends into an array via index 0 — the pointer you would write by hand', () => {
    const { rows } = leaves({
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' } } },
    })
    expect(rows.map((r) => r.pointer)).toEqual(['/0', '/0/id'])
  })

  it('merges allOf, without which the most common schema would show nothing', () => {
    const { rows } = leaves({
      allOf: [
        { type: 'object', properties: { id: { type: 'integer' } } },
        { type: 'object', properties: { name: { type: 'string' } } },
      ],
    })
    expect(rows.map((r) => r.pointer)).toEqual(['/id', '/name'])
  })

  it('shows only one oneOf variant, and says so', () => {
    const { rows } = leaves({
      type: 'object',
      properties: { pet: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
    })
    expect(rows[0].preview).toBe('string · 1/2')
  })

  it('flags dynamic keys instead of inventing a pointer', () => {
    const { rows } = leaves({ type: 'object', additionalProperties: { type: 'string' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].dynamic).toBe(true)
    expect(rows[0].pointer).toBe(null)
  })

  it('caps rows and depth, and does not loop on a recursive schema', () => {
    const raw = { type: 'object', properties: { name: { type: 'string' } } }
    raw.properties.child = raw
    const { rows } = leaves(raw)
    expect(rows.length).toBeLessThan(30)
    expect(rows.some((r) => r.preview === '↻')).toBe(true)

    const deep = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: { b: { type: 'object', properties: { c: { type: 'string' } } } },
        },
      },
    }
    expect(leaves(deep, { maxDepth: 2 }).rows.map((r) => r.pointer)).toEqual(['/a', '/a/b'])
  })

  it('names types the way a reader would search for them', () => {
    const { rows } = leaves({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['available', 'sold'] },
        note: { type: 'string', nullable: true },
      },
    })
    expect(rows.map((r) => r.preview)).toEqual(['"available" | "sold"', 'string | null'])
  })

  it('renders nothing for an absent or scalar schema', () => {
    expect(schemaLeaves(null).rows).toEqual([])
    expect(leaves({ type: 'string' }).rows).toEqual([])
  })
})

describe('chainableResponses / preferredResponse', () => {
  const op = {
    responses: [
      {
        status: '201',
        headers: [{ name: 'Location', schema: { type: 'string' } }],
        contents: [{ mediaType: 'application/json', schema: normalizeSchema({ type: 'object' }) }],
      },
      {
        status: '400',
        contents: [{ mediaType: 'application/json', schema: normalizeSchema({ type: 'object' }) }],
      },
      { status: '204', contents: [], headers: [] },
    ],
  }

  it('discards responses that offer neither body nor header', () => {
    expect(chainableResponses(op).map((r) => r.status)).toEqual(['201', '400'])
    expect(chainableResponses(op)[0].headers[0]).toEqual({
      name: 'Location',
      required: false,
      preview: 'string',
    })
    expect(chainableResponses(null)).toEqual([])
  })

  it('picks the step’s expected status, otherwise the first success', () => {
    const responses = chainableResponses(op)
    expect(preferredResponse(responses, '400').status).toBe('400')
    expect(preferredResponse(responses, '2xx').status).toBe('201')
    expect(preferredResponse(responses, undefined).status).toBe('201')
    expect(preferredResponse([], '200')).toBe(null)
  })
})

describe('variableNameFor', () => {
  it('proposes the last segment in camelCase', () => {
    expect(variableNameFor('/access_token')).toBe('accessToken')
    expect(variableNameFor('/data/pet-id')).toBe('petId')
    expect(variableNameFor('/id')).toBe('id')
  })

  it('goes up one level when the segment is an array index', () => {
    expect(variableNameFor('/items/0')).toBe('items')
    expect(variableNameFor('/items/0/2')).toBe('items')
  })

  it('falls back to a neutral name rather than nothing', () => {
    expect(variableNameFor('')).toBe('value')
    expect(variableNameFor('/0')).toBe('value')
  })

  it('never proposes a name interpolation would reject', () => {
    // {{…}} only accepts [\w.-]: separators disappear.
    expect(variableNameFor('/a b/c d')).toBe('cD')
    // The escaped segment is decoded first ("a/b"), the separator becomes
    // a word break — never a forbidden character.
    expect(variableNameFor('/a~1b')).toBe('aB')
  })
})
