import { describe, expect, it } from 'vitest'
import { sampleValue } from '../src/openapi/sample.js'

const str = (extra = {}) => ({ kind: 'primitive', type: 'string', ...extra })
const num = (extra = {}) => ({ kind: 'primitive', type: 'integer', ...extra })

describe('sampleValue — response mode', () => {
  const of = (schema) => sampleValue(schema, { forResponse: true })

  it('derives a plausible value from the format', () => {
    expect(of(str({ format: 'uuid' }))).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6')
    expect(of(str({ format: 'date-time' }))).toBe('2024-01-15T09:30:00Z')
    expect(of(str({ format: 'email' }))).toBe('user@example.com')
    expect(of(str({ format: 'ipv4' }))).toBe('192.0.2.1')
    expect(of(str({ format: 'uri' }))).toBe('https://example.com/resource')
    // Unknown or absent format: readable fallback rather than an empty string.
    expect(of(str({ format: 'siret' }))).toBe('string')
    expect(of(str())).toBe('string')
  })

  it('stays deterministic', () => {
    const schema = { kind: 'object', properties: [{ name: 'id', schema: str({ format: 'uuid' }) }] }
    expect(of(schema)).toEqual(of(schema))
  })

  it('honors length bounds', () => {
    expect(of(str({ maxLength: 3 }))).toBe('str')
    expect(of(str({ minLength: 9 }))).toBe('stringxxx')
  })

  it('excludes writeOnly and keeps readOnly', () => {
    const schema = {
      kind: 'object',
      properties: [
        { name: 'id', schema: num({ readOnly: true }) },
        { name: 'password', schema: str({ writeOnly: true }) },
      ],
    }
    expect(of(schema)).toEqual({ id: 0 })
  })

  it('repeats elements up to minItems, capped at 3', () => {
    expect(of({ kind: 'array', items: num(), minItems: 2 })).toEqual([0, 0])
    expect(of({ kind: 'array', items: num(), minItems: 9 })).toHaveLength(3)
    // Non-representable element: empty array rather than a misleading [null].
    expect(of({ kind: 'array', items: { kind: 'any' } })).toEqual([])
  })
})

describe('sampleValue — request mode', () => {
  it('produces the same values as in response', () => {
    expect(sampleValue(str({ format: 'uuid' }))).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6')
    expect(sampleValue({ kind: 'object', properties: [{ name: 'name', schema: str() }] })).toEqual({
      name: 'string',
    })
  })

  it('excludes readOnly and keeps writeOnly — the opposite of a response', () => {
    const schema = {
      kind: 'object',
      properties: [
        { name: 'id', schema: num({ readOnly: true }) },
        { name: 'password', schema: str({ writeOnly: true }) },
      ],
    }
    expect(sampleValue(schema)).toEqual({ password: 'string' })
  })
})

describe('2020-12 keywords the generator honours', () => {
  it('samples the contains schema of an array that declares no items', () => {
    const schema = { kind: 'array', contains: str({ enum: ['priority'] }) }
    expect(sampleValue(schema)).toEqual(['priority'])
  })

  it('lets items win over contains, which only constrains some element', () => {
    const schema = { kind: 'array', items: str(), contains: str({ enum: ['priority'] }) }
    expect(sampleValue(schema)).toEqual(['string'])
  })

  it('reads contentEncoding: base64 like the 3.0 byte format', () => {
    expect(sampleValue(str({ contentEncoding: 'base64' }))).toBe('ZXhhbXBsZQ==')
    // An explicit format still wins: it says more about the value.
    expect(sampleValue(str({ format: 'uuid', contentEncoding: 'base64' }))).toBe(
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    )
  })
})

describe('discriminated composites', () => {
  const variant = (name, prop) => ({
    kind: 'object',
    schemaName: name,
    properties: [
      { name: 'petType', schema: str() },
      { name: prop, schema: num() },
    ],
  })
  const pet = (discriminator) => ({
    kind: 'composite',
    composite: {
      keyword: 'oneOf',
      variants: [variant('Cat', 'livesLeft'), variant('Dog', 'pack')],
    },
    discriminator,
  })

  it('samples the first mapped variant and stamps its key', () => {
    const schema = pet({
      propertyName: 'petType',
      mapping: [
        { key: 'cat', schemaName: 'Cat', variantIndex: 0 },
        { key: 'dog', schemaName: 'Dog', variantIndex: 1 },
      ],
    })
    expect(sampleValue(schema)).toEqual({ petType: 'cat', livesLeft: 0 })
  })

  it('follows defaultMapping when the document names one', () => {
    const schema = pet({
      propertyName: 'petType',
      mapping: [
        { key: 'cat', schemaName: 'Cat', variantIndex: 0 },
        { key: 'dog', schemaName: 'Dog', variantIndex: 1, default: true },
      ],
      defaultIndex: 1,
    })
    expect(sampleValue(schema)).toEqual({ petType: 'dog', pack: 0 })
  })

  it('skips the keys that point at no variant', () => {
    const schema = pet({
      propertyName: 'petType',
      mapping: [
        { key: 'bird', schemaName: 'Bird', variantIndex: null },
        { key: 'dog', schemaName: 'Dog', variantIndex: 1 },
      ],
    })
    expect(sampleValue(schema)).toEqual({ petType: 'dog', pack: 0 })
  })

  it('leaves an undiscriminated composite on its first variant, unstamped', () => {
    expect(sampleValue(pet(undefined))).toEqual({ petType: 'string', livesLeft: 0 })
  })
})

describe('numeric constraints (both modes)', () => {
  it('brings 0 back into the declared domain', () => {
    expect(sampleValue(num({ minimum: 5 }))).toBe(5)
    expect(sampleValue(num({ maximum: -3 }))).toBe(-3)
    expect(sampleValue(num({ exclusiveMinimum: 0 }))).toBe(1)
    expect(sampleValue(num({ exclusiveMaximum: 0 }))).toBe(-1)
    expect(sampleValue(num({ minimum: 1, maximum: 100 }))).toBe(1)
  })

  it('respects multipleOf', () => {
    expect(sampleValue(num({ minimum: 7, multipleOf: 5 }))).toBe(10)
    expect(sampleValue(num({ multipleOf: 5 }))).toBe(0)
  })
})

describe('priority of schema declarations', () => {
  it('example, then default, then enum, before any made-up value', () => {
    expect(
      sampleValue(str({ examples: ['Rex'], default: 'x', enum: ['y'] }), { forResponse: true }),
    ).toBe('Rex')
    expect(sampleValue(str({ default: 'x', enum: ['y'] }), { forResponse: true })).toBe('x')
    expect(sampleValue(str({ enum: ['y'] }), { forResponse: true })).toBe('y')
  })

  it('takes the first variant of a composite', () => {
    const composite = {
      kind: 'composite',
      composite: { keyword: 'oneOf', variants: [num(), str()] },
    }
    expect(sampleValue(composite, { forResponse: true })).toBe(0)
  })
})

describe('recursion bounds (rule 7)', () => {
  it('cuts nodes marked circular', () => {
    const node = { kind: 'object', circular: true, properties: [] }
    expect(sampleValue({ kind: 'object', properties: [{ name: 'self', schema: node }] })).toEqual({
      self: null,
    })
  })

  it('resolves scalar leaves at any depth', () => {
    // A `null` under a typed property would be a counter-example: the bound
    // only cuts the nesting of objects and arrays.
    const item = {
      kind: 'object',
      properties: [
        { name: 'id', schema: num() },
        { name: 'name', schema: str() },
      ],
    }
    const schema = {
      kind: 'object',
      properties: [{ name: 'tags', schema: { kind: 'array', items: item } }],
    }
    expect(sampleValue(schema)).toEqual({ tags: [{ id: 0, name: 'string' }] })
  })

  it('bounds the expansion depth', () => {
    const leaf = { kind: 'object', properties: [{ name: 'deep', schema: str() }] }
    const nested = (depth) =>
      depth === 0
        ? leaf
        : { kind: 'object', properties: [{ name: 'child', schema: nested(depth - 1) }] }
    expect(sampleValue(nested(5), { forResponse: true })).toEqual({
      child: { child: { child: null } },
    })
  })
})
