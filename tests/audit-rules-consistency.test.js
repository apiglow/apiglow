import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
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
