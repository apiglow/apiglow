import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { errorResponsesDocumented } from '../src/audit/rules/error-responses-documented.js'
import { infoDescribed } from '../src/audit/rules/info-described.js'
import { infoMetadata } from '../src/audit/rules/info-metadata.js'
import { operationDescribed } from '../src/audit/rules/operation-described.js'
import { parameterDescribed } from '../src/audit/rules/parameter-described.js'
import { propertyDescribed } from '../src/audit/rules/property-described.js'
import { requestBodyDescribed } from '../src/audit/rules/request-body-described.js'
import { responseExample } from '../src/audit/rules/response-example.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

describe('operation-described', () => {
  it('passes on a summary alone', () => {
    const result = run(
      operationDescribed,
      doc({ paths: { '/pets': { get: { summary: 'List pets', responses: okResponse } } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags an operation with neither summary nor description, blank included', () => {
    const result = run(
      operationDescribed,
      doc({
        paths: {
          '/pets': { get: { responses: okResponse } },
          '/owners': { get: { summary: '  ', description: '', responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'operation-described',
      severity: 'warning',
      category: 'completeness',
      location: 'GET /pets',
      opRef: 'get-pets',
    })
  })
})

describe('parameter-described', () => {
  it('flags the undescribed parameter and points at its declaration', () => {
    const result = run(
      parameterDescribed,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [
                { name: 'limit', in: 'query' },
                { name: 'sort', in: 'query', description: 'Sort order' },
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      params: { name: 'limit' },
      dataPath: '/paths/~1pets/get/parameters/0',
    })
  })

  it('counts a parameter shared by several operations once', () => {
    // What dereferencing a `$ref`'d component parameter produces: one object,
    // reached from two operations.
    const shared = { name: 'petId', in: 'path', required: true }
    const result = run(
      parameterDescribed,
      doc({
        paths: {
          '/pets/{petId}': {
            get: { parameters: [shared], responses: okResponse },
            delete: { parameters: [shared], responses: okResponse },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1 })
    expect(result.findings).toHaveLength(1)
  })
})

describe('request-body-described', () => {
  const withBody = (requestBody) =>
    doc({ paths: { '/pets': { post: { requestBody, responses: okResponse } } } })

  it('passes on a described body and ignores an operation without one', () => {
    expect(
      run(requestBodyDescribed, withBody({ description: 'The pet to create', content: {} })),
    ).toMatchObject({ checks: 1, findings: [] })
    expect(run(requestBodyDescribed, doc({ paths: { '/pets': { get: {} } } })).checks).toBe(0)
  })

  it('flags a body with no description', () => {
    const result = run(requestBodyDescribed, withBody({ content: {} }))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'request-body-described',
      severity: 'warning',
      location: 'POST /pets',
      dataPath: '/paths/~1pets/post/requestBody',
    })
  })
})

describe('property-described', () => {
  it('flags each undescribed property at its own pointer, title counting as one', () => {
    const result = run(
      propertyDescribed,
      doc({
        components: {
          schemas: {
            Pet: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string', description: 'Call name' },
                tag: { type: 'string', title: 'Tag' },
              },
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'info',
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/properties/id',
      params: { name: 'id' },
    })
  })
})

describe('error-responses-documented', () => {
  const withResponses = (method, responses) =>
    doc({ paths: { '/pets': { [method]: { responses } } } })

  it('accepts a 4xx, or a default response', () => {
    expect(
      run(
        errorResponsesDocumented,
        withResponses('post', { ...okResponse, 422: { description: 'Nope' } }),
      ),
    ).toMatchObject({ checks: 1, findings: [] })
    expect(
      run(errorResponsesDocumented, withResponses('delete', { default: { description: 'Error' } }))
        .findings,
    ).toEqual([])
  })

  it('flags a mutating operation documenting only its happy path', () => {
    const result = run(errorResponsesDocumented, withResponses('post', okResponse))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'error-responses-documented',
      severity: 'warning',
      location: 'POST /pets',
      dataPath: '/paths/~1pets/post/responses',
    })
  })

  it('has nothing to check on a read-only operation, nor on a webhook', () => {
    expect(run(errorResponsesDocumented, withResponses('get', okResponse)).checks).toBe(0)
    expect(
      run(
        errorResponsesDocumented,
        doc({ webhooks: { petStatus: { post: { responses: okResponse } } } }),
      ).checks,
    ).toBe(0)
  })
})

describe('response-example', () => {
  const withResponse = (response) =>
    doc({ paths: { '/pets': { get: { responses: { 200: response } } } } })

  it('counts one check per status, whatever the media types', () => {
    const result = run(
      responseExample,
      withResponse({
        description: 'OK',
        content: {
          'application/json': { schema: { type: 'object' } },
          'application/xml': { schema: { type: 'object' }, example: '<pet/>' },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a response whose schema comes with no example', () => {
    const result = run(
      responseExample,
      withResponse({ description: 'OK', content: { 'application/json': { schema: {} } } }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'response-example',
      severity: 'info',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/responses/200/content/application~1json',
      params: { status: '200' },
    })
  })

  it('has nothing to check on a response with no schema', () => {
    expect(run(responseExample, withResponse({ description: 'No content' })).checks).toBe(0)
  })
})

describe('info-described', () => {
  it('passes on a description and flags its absence', () => {
    expect(
      run(infoDescribed, doc({ info: { title: 'A', version: '1', description: 'Yes' } })).findings,
    ).toEqual([])
    const result = run(infoDescribed, doc())
    expect(result.findings[0]).toMatchObject({
      ruleId: 'info-described',
      severity: 'warning',
      location: 'info',
      dataPath: '/info/description',
    })
  })
})

describe('info-metadata', () => {
  it('checks contact and license, an empty object counting for nothing', () => {
    const result = run(
      infoMetadata,
      doc({ info: { title: 'A', version: '1', contact: {}, license: { name: 'MIT' } } }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      severity: 'info',
      location: 'info.contact',
      dataPath: '/info/contact',
      params: { field: 'contact' },
    })
  })
})
