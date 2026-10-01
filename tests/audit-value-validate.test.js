import { describe, expect, it } from 'vitest'
import { sideOf, validateValue } from '../src/audit/value-validate.js'

const failure = (value, schema, options) => validateValue(value, schema, options).failure

describe('validateValue — required and the direction of the value', () => {
  const base = {
    type: 'object',
    properties: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string' },
      password: { type: 'string', writeOnly: true },
    },
  }
  const composed = { allOf: [base, { required: ['id', 'name', 'password'] }] }

  it('reads readOnly / writeOnly off the allOf members a required list names', () => {
    expect(failure({ name: 'x', password: 'p' }, composed, { side: 'request' })).toBeNull()
    expect(failure({ id: 1, name: 'x' }, composed, { side: 'response' })).toBeNull()
    expect(failure({ name: 'x' }, composed)).toBeNull()
    expect(failure({ name: 'x' }, composed, { side: 'response' })).toMatchObject({
      keyword: 'required',
      at: '$.id',
    })
  })

  it('carries the exemptions down to a branch requiring a parent property', () => {
    const schema = { ...base, oneOf: [{ required: ['id'] }, { required: ['id', 'name'] }] }
    expect(failure({ name: 'x' }, schema, { side: 'request' })).toBeNull()
  })

  it('still requires what no flag exempts', () => {
    expect(failure({ id: 1, password: 'p' }, composed, { side: 'request' })).toMatchObject({
      keyword: 'required',
      at: '$.name',
    })
  })
})

describe('sideOf', () => {
  const op = { kind: 'operation', pointer: '/paths/~1pets/post' }

  it('reads the direction off the first segment under the operation', () => {
    const request = '/paths/~1pets/post/requestBody/content/application~1json/schema'
    expect(sideOf({ op, dataPath: `${request}/properties/responses/example` })).toBe('request')
    const response = '/paths/~1pets/post/responses/200/content/application~1json/schema'
    expect(sideOf({ op, dataPath: `${response}/properties/parameters/example` })).toBe('response')
    expect(sideOf({ op, dataPath: '/paths/~1pets/parameters/0/example' })).toBe('request')
  })

  it('gives none to a component, a webhook or a callback', () => {
    expect(sideOf({ op: null, dataPath: '/components/schemas/Pet/example' })).toBeNull()
    const webhook = { kind: 'webhook', pointer: '/webhooks/newPet/post' }
    expect(sideOf({ op: webhook, dataPath: '/webhooks/newPet/post/requestBody' })).toBeNull()
    const callback = { kind: 'callback', pointer: '/paths/~1a/post/callbacks/c/{$url}/post' }
    expect(
      sideOf({ op: callback, dataPath: '/paths/~1a/post/callbacks/c/{$url}/post/responses/200' }),
    ).toBeNull()
  })
})

describe('validateValue — keywords', () => {
  it('holds multipleOf to the rounding error of the division, not a share of the value', () => {
    expect(failure(1e9 + 0.5, { multipleOf: 1 })).toMatchObject({ keyword: 'multipleOf' })
    expect(failure(12345678.123, { multipleOf: 0.01 })).toMatchObject({ keyword: 'multipleOf' })
    for (const [value, divisor] of [
      [0.3, 0.1],
      [19.99, 0.01],
      [99999999.99, 0.01],
      [4.35, 0.05],
    ]) {
      expect(failure(value, { multipleOf: divisor })).toBeNull()
    }
  })

  it('names the branch that failed with the grade it reports', () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { a: { type: 'object', required: ['deep'] } } },
        { type: 'object', properties: { b: { type: 'string', format: 'uuid' } } },
      ],
    }
    expect(failure({ a: {}, b: 'nope' }, schema)).toEqual({
      keyword: 'format',
      at: '$.b',
      severity: 'warning',
    })
  })

  it('gives no verdict on an empty or unknown type list', () => {
    expect(validateValue('x', { type: [] })).toEqual({ checked: false, failure: null })
    expect(validateValue('x', { type: ['string', 'file'] })).toEqual({
      checked: false,
      failure: null,
    })
    expect(failure(1, { type: ['string', 'null'] })).toMatchObject({ keyword: 'type' })
    expect(failure(null, { type: 'string', nullable: true })).toBeNull()
  })

  it('leaves the members a composition declares to it, open or closed', () => {
    const declared = { allOf: [{ properties: { name: { type: 'string' } } }] }
    expect(failure({ name: 'x' }, { ...declared, additionalProperties: { type: 'integer' } })).toBe(
      null,
    )
    expect(failure({ name: 'x' }, { ...declared, additionalProperties: false })).toBeNull()
    expect(failure({ n: 'x' }, { additionalProperties: { type: 'integer' } })).toMatchObject({
      keyword: 'type',
      at: '$.n',
    })
  })

  it('counts the depth of a quoted key by its members, not its characters', () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { 'a.b[c': { type: 'integer' } } },
        { type: 'object', properties: { x: { type: 'object', required: ['y'] } } },
      ],
    }
    expect(failure({ 'a.b[c': 'no', x: {} }, schema)).toMatchObject({
      keyword: 'required',
      at: '$.x.y',
    })
    // Same depth on both sides: no branch is the one meant.
    expect(failure({ 'a.b[c': 'no', x: 'flat' }, schema)).toMatchObject({
      keyword: 'anyOf',
      at: '$',
    })
  })

  it('reads an email address the way the rest of the audit does', () => {
    const email = { type: 'string', format: 'email' }
    expect(failure('a,b@c', email)).toMatchObject({ keyword: 'format', severity: 'warning' })
    expect(failure('<a>@b', email)).toMatchObject({ keyword: 'format' })
    expect(failure('a@b', email)).toBeNull()
  })
})
