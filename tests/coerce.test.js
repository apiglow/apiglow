import { describe, expect, it } from 'vitest'
import { acceptedTypes, coerceDeep, coerceValue } from '../src/openapi/coerce.js'
import { normalizeSchema } from '../src/openapi/model.js'
import { sampleValue } from '../src/openapi/sample.js'

const num = (extra = {}) => ({ kind: 'primitive', type: 'number', ...extra })
const int = (extra = {}) => ({ kind: 'primitive', type: 'integer', ...extra })
const str = (extra = {}) => ({ kind: 'primitive', type: 'string', ...extra })
const bool = () => ({ kind: 'primitive', type: 'boolean' })
const oneOf = (...variants) => ({ kind: 'composite', composite: { keyword: 'oneOf', variants } })

describe('acceptedTypes', () => {
  it("collects the types of a composite's variants", () => {
    expect([...acceptedTypes(oneOf(num(), int()))]).toEqual(['number', 'integer'])
  })

  it('includes null for a nullable schema', () => {
    expect([...acceptedTypes(str({ nullable: true }))]).toEqual(['string', 'null'])
  })

  it('takes all types of a multi-type schema (3.1)', () => {
    expect([
      ...acceptedTypes({ kind: 'primitive', type: 'string', types: ['string', 'number'] }),
    ]).toEqual(['string', 'number'])
  })

  it('does not follow cyclic variants', () => {
    const node = oneOf(str())
    node.composite.variants.push(node)
    node.circular = true
    expect([...acceptedTypes(node)]).toEqual(['string'])
  })
})

describe('coerceValue', () => {
  it('converts text input to the declared type', () => {
    expect(coerceValue('20.51', num())).toBe(20.51)
    expect(coerceValue('42', int())).toBe(42)
    expect(coerceValue('true', bool())).toBe(true)
    expect(coerceValue('false', bool())).toBe(false)
    expect(coerceValue(7, str())).toBe('7')
  })

  it('resolves a numeric oneOf — the case that used to come out as a string', () => {
    expect(coerceValue('20.51', oneOf(num({ format: 'float' }), int()))).toBe(20.51)
    // Integer on both sides: the integer variant wins, same JSON value either way.
    expect(coerceValue('20', oneOf(num(), int()))).toBe(20)
  })

  it('leaves a value already of the right type untouched', () => {
    expect(coerceValue('abc', str())).toBe('abc')
    expect(coerceValue(20.51, num())).toBe(20.51)
    expect(coerceValue(null, str({ nullable: true }))).toBeNull()
    // String accepted by the schema: no conversion, even if it's numeric-looking.
    expect(
      coerceValue('20', { kind: 'primitive', type: 'string', types: ['string', 'number'] }),
    ).toBe('20')
  })

  it('gives up rather than inventing a value', () => {
    expect(coerceValue('twelve', int())).toBe('twelve')
    expect(coerceValue('20.51', int())).toBe('20.51')
    expect(coerceValue('', num())).toBe('')
    // An environment template is only resolved at send time.
    expect(coerceValue('{{amount}}', num())).toBe('{{amount}}')
    // No declared type: nothing to enforce.
    expect(coerceValue('20', { kind: 'any' })).toBe('20')
  })

  it('matches the enum value, including its original type', () => {
    expect(coerceValue('2', int({ enum: [1, 2, 3] }))).toBe(2)
    expect(coerceValue('null', str({ enum: ['a', null] }))).toBeNull()
    // Out of the list: the field accepts free text (templates), we don't invent anything.
    expect(coerceValue('4', int({ enum: [1, 2, 3] }))).toBe(4)
    expect(coerceValue('{{choice}}', str({ enum: ['a', 'b'] }))).toBe('{{choice}}')
  })

  it('does not turn a boolean into a number', () => {
    expect(coerceValue(true, num())).toBe(true)
  })

  it('re-parses a structured example given in serialized form', () => {
    const schema = { kind: 'object', type: 'object', properties: [] }
    expect(coerceValue('{"a":1}', schema)).toEqual({ a: 1 })
    expect(coerceValue('not JSON', schema)).toBe('not JSON')
  })
})

describe('coerceDeep', () => {
  it('types every leaf of an object', () => {
    const schema = {
      kind: 'object',
      type: 'object',
      properties: [
        { name: 'amount', schema: oneOf(num(), int()) },
        { name: 'active', schema: bool() },
        { name: 'ref', schema: str() },
      ],
    }
    expect(coerceDeep({ amount: '20.51', active: 'true', ref: 12 }, schema)).toEqual({
      amount: 20.51,
      active: true,
      ref: '12',
    })
  })

  it('descends into arrays and sub-objects', () => {
    const schema = {
      kind: 'object',
      type: 'object',
      properties: [
        {
          name: 'lines',
          schema: {
            kind: 'array',
            type: 'array',
            items: {
              kind: 'object',
              type: 'object',
              properties: [{ name: 'price', schema: num() }],
            },
          },
        },
      ],
    }
    expect(coerceDeep({ lines: [{ price: '1.5' }, { price: '2' }] }, schema)).toEqual({
      lines: [{ price: 1.5 }, { price: 2 }],
    })
  })

  it('finds the property across the variants of an allOf', () => {
    const schema = {
      kind: 'composite',
      composite: {
        keyword: 'allOf',
        variants: [
          { kind: 'object', type: 'object', properties: [{ name: 'a', schema: int() }] },
          { kind: 'object', type: 'object', properties: [{ name: 'b', schema: bool() }] },
        ],
      },
    }
    expect(coerceDeep({ a: '1', b: 'false' }, schema)).toEqual({ a: 1, b: false })
  })

  it('types free-form values via additionalProperties', () => {
    const schema = { kind: 'object', type: 'object', additionalProperties: num() }
    expect(coerceDeep({ x: '3.5' }, schema)).toEqual({ x: 3.5 })
  })

  it('types the leaves of a structure recovered from its serialized form', () => {
    const schema = {
      kind: 'array',
      type: 'array',
      items: { kind: 'object', type: 'object', properties: [{ name: 'price', schema: num() }] },
    }
    expect(coerceDeep('[{"price":"9.9"}]', schema)).toEqual([{ price: 9.9 }])
  })

  it('lets through what the schema does not describe', () => {
    const schema = { kind: 'object', type: 'object', properties: [] }
    expect(coerceDeep({ unknown: '20' }, schema)).toEqual({ unknown: '20' })
  })
})

// The real-world case that motivated this pass: a vendor API declares `example: "20.51"`
// on a `oneOf: [number(float), integer]` and then rejects the string at send time.
describe('end to end from a raw OpenAPI schema', () => {
  const raw = {
    type: 'object',
    required: ['amount'],
    properties: {
      amount: {
        description: 'Withdrawal amount in euros, at most 2 decimals',
        minimum: 15,
        pattern: '\\d+(\\.\\d{1,2})?',
        example: '20.51',
        oneOf: [{ type: 'number', format: 'float' }, { type: 'integer' }],
      },
    },
  }

  it('pre-fills the body with a number, not a string', () => {
    const body = sampleValue(normalizeSchema(raw))
    expect(body).toEqual({ amount: 20.51 })
    expect(JSON.stringify(body)).toBe('{"amount":20.51}')
  })

  it('honors the composite constraints when there is no example', () => {
    const withoutExample = structuredClone(raw)
    delete withoutExample.properties.amount.example
    expect(sampleValue(normalizeSchema(withoutExample))).toEqual({ amount: 15 })
  })
})
