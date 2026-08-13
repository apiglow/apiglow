import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { duplicateInlineSchema } from '../src/audit/rules/duplicate-inline-schema.js'
import { parameterNaming } from '../src/audit/rules/parameter-naming.js'
import { pathStyle } from '../src/audit/rules/path-style.js'
import { propertyNaming } from '../src/audit/rules/property-naming.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

const queryParams = (names) =>
  doc({
    paths: {
      '/pets': {
        get: {
          parameters: names.map((name) => ({ name, in: 'query' })),
          responses: okResponse,
        },
      },
    },
  })

describe('parameter-naming', () => {
  it('says nothing until there is a population to call dominant', () => {
    expect(run(parameterNaming, queryParams(['petId', 'pet_id'])).checks).toBe(0)
  })

  it('flags the outliers of the document own convention', () => {
    const result = run(
      parameterNaming,
      queryParams(['petId', 'ownerId', 'sortBy', 'shipDate', 'order_by', 'status']),
    )
    // `status` is a single lowercase word: camelCase, snake_case and kebab-case
    // all at once, so it votes for nothing and is never an outlier.
    expect(result.checks).toBe(5)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'parameter-naming',
      severity: 'info',
      category: 'consistency',
      params: { name: 'order_by', style: 'snake_case', dominant: 'camelCase' },
    })
  })

  it('leaves header names to the HTTP convention', () => {
    const document = doc({
      paths: {
        '/pets': {
          get: {
            parameters: [
              { name: 'petId', in: 'query' },
              { name: 'ownerId', in: 'query' },
              { name: 'sortBy', in: 'query' },
              { name: 'shipDate', in: 'query' },
              { name: 'X-Request-Id', in: 'header' },
            ],
            responses: okResponse,
          },
        },
      },
    })
    expect(run(parameterNaming, document)).toMatchObject({ checks: 4, findings: [] })
  })

  it('counts a name shared by several operations once', () => {
    const parameters = ['petId', 'ownerId', 'sortBy', 'shipDate'].map((name) => ({
      name,
      in: 'query',
    }))
    const document = doc({
      paths: {
        '/pets': { get: { parameters, responses: okResponse } },
        '/owners': { get: { parameters, responses: okResponse } },
      },
    })
    expect(run(parameterNaming, document).checks).toBe(4)
  })
})

describe('property-naming', () => {
  it('flags the property that changes convention', () => {
    const result = run(
      propertyNaming,
      doc({
        components: {
          schemas: {
            Pet: {
              type: 'object',
              properties: {
                petId: {},
                ownerName: {},
                shipDate: {},
                photoUrls: {},
                created_at: {},
              },
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(5)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'property-naming',
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/properties/created_at',
      params: { name: 'created_at', style: 'snake_case', dominant: 'camelCase' },
    })
  })
})

describe('path-style', () => {
  it('flags the path carrying the deviant segment, template segments aside', () => {
    const paths = {
      '/pet-store/{petId}': { get: { responses: okResponse } },
      '/pet-store/{petId}/order-history': { get: { responses: okResponse } },
      '/user-profile': { get: { responses: okResponse } },
      '/shipping-address/orderHistory': { get: { responses: okResponse } },
    }
    const result = run(pathStyle, doc({ paths }))
    expect(result.checks).toBe(4)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'path-style',
      severity: 'info',
      location: '/shipping-address/orderHistory',
      dataPath: '/paths/~1shipping-address~1orderHistory',
      params: { segment: 'orderHistory', style: 'camelCase', dominant: 'kebab-case' },
    })
    // The label is the path, the link is an operation of it: nothing in the app
    // renders a path on its own, so a finding on one would otherwise be the
    // only kind the reader cannot click through.
    expect(result.findings[0].opRef).toBe('get-shipping-address-orderhistory')
  })

  // Every operation of the path hidden: the reader is told so, rather than
  // handed a link to a page that does not exist.
  it('shows the path as hidden when nothing under it is routable', () => {
    const paths = {
      '/pet-store/{petId}': { get: { responses: okResponse } },
      '/user-profile': { get: { responses: okResponse } },
      '/shipping-address': { get: { responses: okResponse } },
      '/orderHistory': { get: { operationId: 'orderHistory', responses: okResponse } },
    }
    const result = run(pathStyle, doc({ paths }), { hide: ['/orderHistory'] })
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ opRef: null, hidden: true })
  })

  it('says nothing on a document with too few segments to have a convention', () => {
    expect(
      run(pathStyle, doc({ paths: { '/pets': { get: { responses: okResponse } } } })).checks,
    ).toBe(0)
  })
})

describe('duplicate-inline-schema', () => {
  // Big enough to be worth a component: the threshold is on the serialized size.
  const address = (description) => ({
    type: 'object',
    description,
    properties: {
      street: { type: 'string', description: 'Street and number' },
      city: { type: 'string', description: 'City name' },
      zipCode: { type: 'string', description: 'Postal code' },
      country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code' },
    },
  })

  const withSchemas = (schemas) =>
    doc({
      paths: Object.fromEntries(
        Object.entries(schemas).map(([path, schema]) => [
          path,
          { get: { responses: { 200: { content: { 'application/json': { schema } } } } } },
        ]),
      ),
    })

  it('flags the copies and leaves the first occurrence alone', () => {
    const result = run(
      duplicateInlineSchema,
      withSchemas({ '/a': address('An address'), '/b': address('An address') }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'duplicate-inline-schema',
      severity: 'info',
      location: 'GET /b',
      params: { count: 2 },
    })
  })

  it('sees through a different key order but not through a different content', () => {
    const reordered = {
      properties: address('An address').properties,
      type: 'object',
      description: 'An address',
    }
    expect(
      run(duplicateInlineSchema, withSchemas({ '/a': address('An address'), '/b': reordered }))
        .findings,
    ).toHaveLength(1)
    expect(
      run(duplicateInlineSchema, withSchemas({ '/a': address('One'), '/b': address('Another') }))
        .findings,
    ).toEqual([])
  })

  it('does not mistake a component reused at several sites for a copy', () => {
    // What dereferencing produces: the same object at every `$ref` site.
    const shared = address('An address')
    const document = withSchemas({
      '/a': { type: 'array', items: shared },
      '/b': { type: 'array', items: shared },
    })
    document.components = { schemas: { Address: shared } }
    expect(run(duplicateInlineSchema, document).findings).toEqual([])
  })

  it('ignores a shape too small to deserve a component', () => {
    const small = { type: 'string', format: 'date-time' }
    expect(
      run(duplicateInlineSchema, withSchemas({ '/a': small, '/b': { ...small } })).checks,
    ).toBe(0)
  })
})
