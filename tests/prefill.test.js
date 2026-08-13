import { describe, expect, it } from 'vitest'
import { pickFirstCallOperation } from '../src/openapi/first-call.js'
import { paramPrefill, prefilledValues } from '../src/openapi/prefill.js'

const param = (over = {}) => ({
  name: 'petId',
  in: 'query',
  required: true,
  schema: { kind: 'primitive', type: 'string' },
  ...over,
})

describe('paramPrefill precedence', () => {
  it('takes the declared example over the default', () => {
    expect(
      paramPrefill(
        param({ examples: [{ value: 'from-example' }], schema: { type: 'string', default: 'x' } }),
      ),
    ).toBe('from-example')
  })

  it('falls back to the schema default', () => {
    expect(paramPrefill(param({ schema: { type: 'string', default: 'fr' } }))).toBe('fr')
  })

  it('gives nothing when the schema declares neither', () => {
    expect(paramPrefill(param())).toBeUndefined()
  })

  // The enum's first value and the format samples belong to sample.js: they are
  // invented, and an invented value sent to a real API answers 400.
  it('never invents a value from an enum or a format', () => {
    expect(paramPrefill(param({ schema: { type: 'string', enum: ['a', 'b'] } }))).toBeUndefined()
    expect(paramPrefill(param({ schema: { type: 'string', format: 'uuid' } }))).toBeUndefined()
  })

  it('leaves optional parameters alone', () => {
    expect(paramPrefill(param({ required: false, examples: [{ value: '42' }] }))).toBeUndefined()
  })

  it('stringifies through the declared type', () => {
    expect(paramPrefill(param({ examples: [{ value: 42 }] }))).toBe('42')
    expect(paramPrefill(param({ examples: [{ value: false }] }))).toBe('false')
    // "20.51" on a numeric schema describes the number, not the string.
    expect(
      paramPrefill(param({ schema: { type: 'number' }, examples: [{ value: '20.51' }] })),
    ).toBe('20.51')
  })

  it('skips the shapes a single string cannot represent', () => {
    const array = param({
      schema: { kind: 'array', items: { type: 'string' } },
      examples: [{ value: ['a', 'b'] }],
    })
    const object = param({
      schema: { kind: 'object', properties: [{ name: 'role' }] },
      examples: [{ value: { role: 'admin' } }],
    })
    expect(paramPrefill(array)).toBeUndefined()
    expect(paramPrefill(object)).toBeUndefined()
  })
})

describe('prefilledValues', () => {
  const op = {
    parameters: [
      param({ name: 'petId', in: 'path', examples: [{ value: 42 }] }),
      param({ name: 'verbose', in: 'query', schema: { type: 'boolean', default: true } }),
      param({ name: 'page', in: 'query', required: false, schema: { default: 1 } }),
      param({ name: 'X-Tenant', in: 'header', examples: [{ value: 'acme' }] }),
    ],
  }

  it('collects one location at a time, required only', () => {
    expect(prefilledValues(op, 'path')).toEqual({ petId: '42' })
    expect(prefilledValues(op, 'query')).toEqual({ verbose: 'true' })
    expect(prefilledValues(op, 'header')).toEqual({ 'X-Tenant': 'acme' })
    expect(prefilledValues(op, 'cookie')).toEqual({})
  })
})

describe('pickFirstCallOperation', () => {
  const op = (over) => ({ method: 'get', parameters: [], requestBody: null, ...over })

  it('prefers the read that needs no typing', () => {
    const model = {
      operations: [
        op({ id: 'getPet', parameters: [param({ name: 'petId', in: 'path' })] }),
        op({ id: 'listPets' }),
      ],
    }
    expect(pickFirstCallOperation(model).id).toBe('listPets')
  })

  // A required parameter the schema declares a value for costs no typing
  // either — that is the whole point of the prefill.
  it('counts a prefilled parameter as free', () => {
    const model = {
      operations: [
        op({ id: 'getPet', parameters: [param({ name: 'petId', in: 'path' })] }),
        op({
          id: 'getStore',
          parameters: [param({ name: 'storeId', in: 'path', examples: [{ value: 1 }] })],
        }),
      ],
    }
    expect(pickFirstCallOperation(model).id).toBe('getStore')
  })

  it('never suggests a write, a deprecated read or a body', () => {
    const model = {
      operations: [
        op({ id: 'addPet', method: 'post' }),
        op({ id: 'oldList', deprecated: true }),
        op({ id: 'search', requestBody: { contents: [] } }),
        op({ id: 'listPets' }),
      ],
    }
    expect(pickFirstCallOperation(model).id).toBe('listPets')
  })

  it('gives nothing when the API declares no read', () => {
    expect(
      pickFirstCallOperation({ operations: [op({ id: 'addPet', method: 'post' })] }),
    ).toBeNull()
    expect(pickFirstCallOperation(null)).toBeNull()
  })

  it('keeps schema order on a tie', () => {
    const model = { operations: [op({ id: 'listPets' }), op({ id: 'listStores' })] }
    expect(pickFirstCallOperation(model).id).toBe('listPets')
  })
})
