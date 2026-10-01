import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { freeFormInput } from '../src/audit/rules/free-form-input.js'
import { inputComplexity } from '../src/audit/rules/input-complexity.js'
import { inputRootShape } from '../src/audit/rules/input-root-shape.js'
import { recursiveInput } from '../src/audit/rules/recursive-input.js'
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
})

describe('input-root-shape', () => {
  it('passes object roots: declared, nullable, inferred, an allOf of objects', () => {
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
        },
      }),
    )
    expect(result).toMatchObject({ checks: 4, findings: [] })
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

describe('recursive-input', () => {
  const tree = {
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
    },
  }

  it('flags each operation whose input reaches itself, where it reaches back', () => {
    const result = runRefs(
      recursiveInput,
      doc({
        ...tree,
        paths: {
          '/things': jsonBody({ $ref: '#/components/schemas/Node' }),
          '/others': jsonBody({
            type: 'object',
            properties: { root: { $ref: '#/components/schemas/Node' } },
          }),
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings.map((f) => [f.dataPath, f.params.name])).toEqual([
      [`${BODY}/properties/children/items`, 'Node'],
      [
        '/paths/~1others/post/requestBody/content/application~1json/schema/properties/root/properties/children/items',
        'Node',
      ],
    ])
  })

  it('passes a schema merely shared by two properties, and a cycle only through readOnly', () => {
    const result = runRefs(
      recursiveInput,
      doc({
        components: {
          schemas: {
            Money: { type: 'object', properties: { amount: { type: 'number' } } },
            Folder: {
              type: 'object',
              properties: { parent: { readOnly: true, $ref: '#/components/schemas/Folder' } },
            },
          },
        },
        paths: {
          '/things': jsonBody({
            type: 'object',
            properties: {
              price: { $ref: '#/components/schemas/Money' },
              tax: { $ref: '#/components/schemas/Money' },
            },
          }),
          '/folders': jsonBody({ $ref: '#/components/schemas/Folder' }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('names an inline cycle after where it was met, and skips operations with no input', () => {
    const filter = { type: 'object', properties: {} }
    filter.properties.and = { type: 'array', items: filter }
    const result = run(
      recursiveInput,
      doc({
        paths: {
          '/things': jsonBody({ type: 'object', properties: { filter } }),
          '/ping': { get: { responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: `${BODY}/properties/filter/properties/and/items`,
      params: { name: 'filter' },
    })
  })
})

describe('input-complexity', () => {
  // `levels` nested objects: the body itself, then one property each.
  const nested = (levels) => {
    let schema = { type: 'object', properties: { leaf: { type: 'string' } } }
    for (let level = 1; level < levels; level++) {
      schema = { type: 'object', properties: { next: schema } }
    }
    return schema
  }

  it('passes a body within every limit, ten levels deep', () => {
    const result = run(inputComplexity, doc({ paths: { '/things': jsonBody(nested(10)) } }))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags eleven levels, counting arrays of objects as a level', () => {
    const rows = { type: 'array', items: nested(10) }
    const result = run(
      inputComplexity,
      doc({ paths: { '/things': jsonBody({ type: 'object', properties: { rows } }) } }),
    )
    expect(result.findings[0]).toMatchObject({
      dataPath: '/paths/~1things/post/requestBody',
      params: { depth: 11 },
    })
  })

  it('flags more than 5000 properties or 1000 enum values, each schema counted once', () => {
    const wide = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 2501 }, (_, i) => [`p${i}`, { type: 'string' }]),
      ),
    }
    const status = { enum: Array.from({ length: 600 }, (_, i) => `s${i}`) }
    const result = run(
      inputComplexity,
      doc({
        paths: {
          '/wide': jsonBody({ type: 'object', properties: { a: wide, b: structuredClone(wide) } }),
          '/shared': jsonBody({ type: 'object', properties: { a: wide, b: wide } }),
          '/enums': jsonBody({
            type: 'object',
            properties: { a: status, b: structuredClone(status) },
          }),
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => f.params)).toEqual([
      { depth: 2, properties: 5004, enumValues: 0 },
      { depth: 1, properties: 2, enumValues: 1200 },
    ])
  })

  it('stops on a cycle, and has nothing to measure without a body or for a file', () => {
    const node = { type: 'object', properties: {} }
    node.properties.child = node
    const result = run(
      inputComplexity,
      doc({
        paths: {
          '/things': jsonBody(node),
          '/ping': { get: { responses: okResponse } },
          '/file': post({ content: { 'image/png': { schema: { format: 'binary' } } } }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})
