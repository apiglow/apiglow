import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { freeFormInput } from '../src/audit/rules/free-form-input.js'
import { inputRootShape } from '../src/audit/rules/input-root-shape.js'
import { unionAmbiguous } from '../src/audit/rules/union-ambiguous.js'
import { untypedInput } from '../src/audit/rules/untyped-input.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The `agent` rules of docs/audit.md §4.7 that read an operation's inputs: what
// an agent is handed to fill in when a tool is built from the operation.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// Fixtures with `$ref`s: the rule sees the source as written and its
// dereferenced twin, as the loader hands them over — a recursive `$ref`
// becomes a cycle of objects.
const runRefs = (rule, source) =>
  run(rule, dereferenceInternal(structuredClone(source)), { source })

const post = (requestBody, extra = {}) => ({
  post: { requestBody, responses: okResponse, ...extra },
})
const jsonBody = (schema) => post({ content: { 'application/json': { schema } } })
const withParams = (...parameters) => ({ get: { parameters, responses: okResponse } })
const query = (name, schema) => ({ name, in: 'query', schema })
const BODY = '/paths/~1things/post/requestBody/content/application~1json/schema'

describe('untyped-input', () => {
  it('passes inputs that say what their value is', () => {
    const result = run(
      untypedInput,
      doc({
        paths: {
          '/search': withParams(
            query('q', { type: 'string' }),
            query('sort', { enum: ['asc', 'desc'] }),
            query('mode', { const: 'fast' }),
            query('either', { oneOf: [{ type: 'string' }, { type: 'integer' }] }),
            query('filter', { not: { type: 'null' } }),
          ),
          '/things': jsonBody({
            type: 'object',
            properties: {
              tags: { items: { type: 'string' } },
              meta: { properties: { a: { type: 'integer' } } },
            },
          }),
          '/upload': post({
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { format: 'binary' } } },
              },
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBeGreaterThan(5)
  })

  it('flags an empty schema, an annotations-only one, `true`, and a JSON body with no schema', () => {
    const result = run(
      untypedInput,
      doc({
        paths: {
          '/search': withParams(
            query('q', {}),
            query('id', { description: 'The id', example: 42, format: 'uuid' }),
            query('any', true),
          ),
          '/things': jsonBody({
            type: 'object',
            properties: { name: { type: 'string' }, value: {}, flag: true, list: { items: {} } },
          }),
          '/blank': post({ content: { 'application/json': {} } }),
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath).sort()).toEqual([
      '/paths/~1blank/post/requestBody/content/application~1json',
      '/paths/~1search/get/parameters/0/schema',
      '/paths/~1search/get/parameters/1/schema',
      '/paths/~1search/get/parameters/2/schema',
      `${BODY}/properties/flag`,
      `${BODY}/properties/list/items`,
      `${BODY}/properties/value`,
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'untyped-input',
      severity: 'warning',
      category: 'agent',
      location: 'GET /search',
    })
  })

  it('leaves alone what other rules or the media type cover', () => {
    const result = run(
      untypedInput,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              id: { readOnly: true },
              described: { allOf: [{ description: 'A described thing' }, { type: 'string' }] },
              labels: { type: 'object', additionalProperties: {} },
            },
          }),
          '/form': post({ content: { 'multipart/form-data': { schema: {} } } }),
          '/note': post({ content: { 'text/plain': {} } }),
          '/file': post({ content: { 'application/octet-stream': { schema: {} } } }),
          '/bare': withParams({ name: 'q', in: 'query' }),
        },
        webhooks: { ping: jsonBody({}) },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('reports a schema shared through components once, where it is written', () => {
    const result = runRefs(
      untypedInput,
      doc({
        components: {
          schemas: { Thing: { type: 'object', properties: { value: {} } } },
        },
        paths: {
          '/things': jsonBody({ $ref: '#/components/schemas/Thing' }),
          '/others': jsonBody({ $ref: '#/components/schemas/Thing' }),
        },
      }),
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      location: 'components.schemas.Thing',
      dataPath: '/components/schemas/Thing/properties/value',
      opRef: null,
    })
  })

  it('judges a schema that holds a value anywhere, whatever the order of the paths', () => {
    const paths = {
      '/a': jsonBody({ allOf: [{ $ref: '#/components/schemas/Note' }, { type: 'object' }] }),
      '/b': post({
        content: {
          'application/json': {
            schema: { type: 'object', properties: { note: { $ref: '#/components/schemas/Note' } } },
          },
        },
      }),
    }
    const components = { schemas: { Note: { description: 'Free text' } } }
    for (const order of [paths, { '/b': paths['/b'], '/a': paths['/a'] }]) {
      const result = runRefs(untypedInput, doc({ components, paths: order }))
      expect(result).toMatchObject({ checks: 3 })
      expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/Note'])
    }
  })
})

describe('free-form-input', () => {
  it('passes objects with a shape: properties, a typed map, a closed object, patterns, composition', () => {
    const result = run(
      freeFormInput,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              labels: { type: 'object', additionalProperties: { type: 'string' } },
              empty: { type: 'object', additionalProperties: false },
              byLocale: { type: 'object', patternProperties: { '^[a-z]{2}$': { type: 'string' } } },
              composed: { type: 'object', allOf: [{ properties: { a: { type: 'string' } } }] },
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBe(5)
  })

  it('flags an object an agent has every key to invent for', () => {
    const result = run(
      freeFormInput,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              metadata: { type: 'object' },
              open: { additionalProperties: true },
              loose: { type: 'object', additionalProperties: { description: 'Anything' } },
            },
          }),
          '/search': withParams(query('filter', { type: 'object' })),
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      `${BODY}/properties/metadata`,
      `${BODY}/properties/open`,
      `${BODY}/properties/loose`,
      '/paths/~1search/get/parameters/0/schema',
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'info', category: 'agent' })
  })

  it('does not judge a form root or a composition member on its own', () => {
    const result = run(
      freeFormInput,
      doc({
        paths: {
          '/form': post({ content: { 'multipart/form-data': { schema: { type: 'object' } } } }),
          '/things': jsonBody({
            allOf: [{ type: 'object' }, { properties: { a: { type: 'string' } } }],
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('judges the branches of a union with no shape of its own', () => {
    const result = run(
      freeFormInput,
      doc({
        paths: {
          '/things': jsonBody({
            oneOf: [{ type: 'object' }, { type: 'object', properties: { a: { type: 'string' } } }],
          }),
          '/contacts': post({
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { email: { type: 'string' }, phone: { type: 'string' } },
                  oneOf: [
                    { type: 'object', required: ['email'] },
                    { type: 'object', required: ['phone'] },
                  ],
                },
              },
            },
          }),
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => f.dataPath)).toEqual([`${BODY}/oneOf/0`])
  })

  it('judges a schema reached through a judged position anywhere, whatever the order', () => {
    const paths = {
      '/a': jsonBody({ allOf: [{ $ref: '#/components/schemas/Bag' }] }),
      '/b': post({
        content: {
          'application/json': {
            schema: { type: 'object', properties: { bag: { $ref: '#/components/schemas/Bag' } } },
          },
        },
      }),
    }
    const components = { schemas: { Bag: { type: 'object' } } }
    for (const order of [paths, { '/b': paths['/b'], '/a': paths['/a'] }]) {
      const result = runRefs(freeFormInput, doc({ components, paths: order }))
      expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/Bag'])
    }
  })
})

describe('union-ambiguous', () => {
  const card = { type: 'object', properties: { number: { type: 'string' } } }
  const iban = { type: 'object', properties: { iban: { type: 'string' } } }

  it('passes unions an agent can tell apart', () => {
    const result = run(
      unionAmbiguous,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              titled: {
                oneOf: [
                  { ...card, title: 'Card' },
                  { ...iban, title: 'Bank account' },
                ],
              },
              oneDescribed: { oneOf: [{ ...card, description: 'Pay by card' }, iban] },
              discriminated: {
                oneOf: [card, iban],
                discriminator: { propertyName: 'kind' },
              },
              keyed: {
                oneOf: [
                  { ...card, required: ['number'] },
                  { ...iban, required: ['iban'] },
                ],
              },
              arrays: {
                oneOf: [
                  { type: 'array', items: { type: 'string' } },
                  { type: 'array', items: { type: 'object' } },
                ],
              },
              kinds: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
            },
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 6, findings: [] })
  })

  it('flags two nameless branches of one JSON type', () => {
    const result = run(
      unionAmbiguous,
      doc({
        paths: {
          '/things': jsonBody({ oneOf: [{ type: 'string', title: 'Id' }, card, iban] }),
          '/amounts': jsonBody({ anyOf: [{ type: 'integer' }, { type: 'number' }] }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params)).toEqual([
      { keyword: 'oneOf', first: 1, second: 2, type: 'object' },
      { keyword: 'anyOf', first: 0, second: 1, type: 'number' },
    ])
    expect(result.findings[0]).toMatchObject({ dataPath: BODY, severity: 'info' })
  })

  it('does not count a description both branches inherit from a shared base', () => {
    const result = runRefs(
      unionAmbiguous,
      doc({
        components: {
          schemas: {
            Base: { type: 'object', description: 'A payment method' },
            Card: { allOf: [{ $ref: '#/components/schemas/Base' }, card] },
            Iban: { allOf: [{ $ref: '#/components/schemas/Base' }, iban] },
          },
        },
        paths: {
          '/things': jsonBody({
            oneOf: [{ $ref: '#/components/schemas/Card' }, { $ref: '#/components/schemas/Iban' }],
          }),
        },
      }),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('leaves enums spelled as unions, and single-branch unions, to other rules', () => {
    const result = run(
      unionAmbiguous,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              status: { oneOf: [{ const: 'open' }, { const: 'closed' }] },
              lonely: { oneOf: [card] },
            },
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('passes object branches a required key tells apart by its values', () => {
    const tagged = (values, extra = {}) => ({
      type: 'object',
      required: ['name', 'data_type'],
      properties: { name: { type: 'string' }, data_type: values, ...extra },
    })
    const result = run(
      unionAmbiguous,
      doc({
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              consts: { oneOf: [tagged({ const: 'a' }), tagged({ const: 'b' })] },
              enums: {
                oneOf: [
                  tagged({ enum: ['text', 'number', 'date'] }),
                  tagged({ enum: ['single_select'] }),
                  tagged({ enum: ['iteration'] }),
                ],
              },
              overlapping: {
                oneOf: [tagged({ enum: ['text', 'date'] }), tagged({ enum: ['date'] })],
              },
            },
          }),
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => f.dataPath)).toEqual([`${BODY}/properties/overlapping`])
  })

  it('grades a union of constants that is no enum: a branch says more than its value', () => {
    const result = run(
      unionAmbiguous,
      doc({
        paths: {
          '/things': jsonBody({
            oneOf: [{ const: 'a', format: 'x' }, { const: 'b' }],
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('input-root-shape', () => {
  it('passes object roots: declared, nullable, inferred, an allOf of objects, one holding a union', () => {
    const result = run(
      inputRootShape,
      doc({
        paths: {
          '/a': jsonBody({ type: 'object' }),
          '/b': jsonBody({ type: ['object', 'null'] }),
          '/c': jsonBody({ properties: { a: { type: 'string' } } }),
          '/d': jsonBody({
            allOf: [{ type: 'object' }, { properties: { a: { type: 'string' } } }],
          }),
          '/e': jsonBody({
            type: 'object',
            properties: { email: { type: 'string' }, phone: { type: 'string' } },
            oneOf: [{ required: ['email'] }, { required: ['phone'] }],
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('flags an array, a scalar and a choice at the root, naming the shape', () => {
    const result = run(
      inputRootShape,
      doc({
        paths: {
          '/a': jsonBody({ type: 'array', items: { type: 'object' } }),
          '/b': jsonBody({ type: 'string' }),
          '/c': jsonBody({ oneOf: [{ type: 'object' }, { type: 'object' }] }),
          '/d': jsonBody({ allOf: [{ type: 'array' }] }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params.shape)).toEqual([
      'array',
      'string',
      'oneOf',
      'array',
    ])
    expect(result.findings[0]).toMatchObject({
      dataPath: '/paths/~1a/post/requestBody/content/application~1json/schema',
      params: { mediaType: 'application/json' },
    })
  })

  it('gives no verdict on a root that says nothing, a form, or text', () => {
    const result = run(
      inputRootShape,
      doc({
        paths: {
          '/a': jsonBody({}),
          '/b': post({ content: { 'application/json': {} } }),
          '/c': post({ content: { 'multipart/form-data': { schema: { type: 'array' } } } }),
          '/d': post({ content: { 'text/plain': { schema: { type: 'string' } } } }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })
})
