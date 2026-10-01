import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { sensitiveFieldExposure } from '../src/audit/rules/sensitive-field-exposure.js'
import { unboundedInput } from '../src/audit/rules/unbounded-input.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The `security` rules of docs/audit.md §4.8 that read the data an operation
// takes and returns: a secret handed back, an input with no size limit.

const run = (rule, document) => runRule(rule, auditContext(document))

// Fixtures with `$ref`s: the rule sees the source as written and its
// dereferenced twin, as the loader hands them over.
const runRefs = (rule, source) =>
  runRule(
    rule,
    auditContext(dereferenceInternal(structuredClone(source)), { source: structuredClone(source) }),
  )

const json = (schema) => ({ 'application/json': { schema } })
const returning = (schema) => ({
  get: { responses: { 200: { description: 'OK', content: json(schema) } } },
})
const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const password = { type: 'string', format: 'password' }

describe('sensitive-field-exposure', () => {
  it('passes a password the response schema marks writeOnly, however it says so', () => {
    const result = run(
      sensitiveFieldExposure,
      doc({
        paths: {
          '/me': returning({
            type: 'object',
            properties: {
              password: { ...password, writeOnly: true },
              pin: { allOf: [password, { writeOnly: true }] },
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    // `pin` passes as a whole; the member under it is never in a response.
    expect(result.checks).toBe(2)
  })

  it('flags a password a response returns, readOnly, in an array or a stream included', () => {
    const result = run(
      sensitiveFieldExposure,
      doc({
        openapi: '3.2.0',
        paths: {
          '/me': returning({
            type: 'object',
            properties: {
              password,
              current: { ...password, readOnly: true },
              history: { type: 'array', items: { ...password } },
            },
          }),
          '/events': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/jsonl': {
                      itemSchema: { type: 'object', properties: { secret: { ...password } } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    const me = '/paths/~1me/get/responses/200/content/application~1json/schema/properties'
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      `${me}/password`,
      `${me}/current`,
      `${me}/history/items`,
      '/paths/~1events/get/responses/200/content/application~1jsonl/itemSchema/properties/secret',
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      location: 'GET /me',
      params: {},
    })
  })

  it('reports a component once, at the component, and leaves the request side alone', () => {
    const result = runRefs(
      sensitiveFieldExposure,
      doc({
        paths: {
          '/users': {
            post: {
              requestBody: { content: json(ref('Credentials')) },
              responses: { 201: { description: 'Created', content: json(ref('User')) } },
            },
            get: {
              responses: {
                200: { description: 'OK', content: json({ type: 'array', items: ref('User') }) },
              },
            },
          },
        },
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                password: { ...password },
                // The format comes with the member: judged here, once.
                recovery: { allOf: [ref('Secret')] },
              },
            },
            Secret: { ...password },
            Credentials: { type: 'object', properties: { password: { ...password } } },
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings.map((f) => [f.location, f.dataPath])).toEqual([
      ['components.schemas.User', '/components/schemas/User/properties/password'],
      ['components.schemas.User', '/components/schemas/User/properties/recovery'],
    ])
    expect(result.findings[0].opRef).toBeNull()
  })

  it('does not walk under a writeOnly schema, nor judge by name', () => {
    const result = run(
      sensitiveFieldExposure,
      doc({
        paths: {
          '/me': returning({
            type: 'object',
            properties: {
              login: { type: 'object', writeOnly: true, properties: { password } },
              token: { type: 'string' },
              password: { type: 'string' },
            },
          }),
        },
      }),
    )
    expect(result.checks).toBe(0)
  })

  it('finds a password under patternProperties, unevaluatedProperties, a conditional or a dependent schema', () => {
    const result = run(
      sensitiveFieldExposure,
      doc({
        paths: {
          '/vault': returning({
            type: 'object',
            patternProperties: { '^key-': password },
            if: { required: ['kind'] },
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
            then: { properties: { pin: { ...password } } },
            else: { properties: { code: { ...password } } },
            dependentSchemas: { user: { properties: { secret: { ...password } } } },
            unevaluatedProperties: { ...password },
          }),
        },
      }),
    )
    const root = '/paths/~1vault/get/responses/200/content/application~1json/schema'
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      `${root}/patternProperties/^key-`,
      `${root}/dependentSchemas/user/properties/secret`,
      `${root}/unevaluatedProperties`,
      `${root}/then/properties/pin`,
      `${root}/else/properties/code`,
    ])
  })

  it('leaves webhook and callback responses to the integrator', () => {
    const response = { 200: { description: 'OK', content: json({ properties: { password } }) } }
    const result = run(
      sensitiveFieldExposure,
      doc({
        paths: {
          '/subscribe': {
            post: {
              responses: okResponse,
              callbacks: { onEvent: { '{$request.body#/url}': { post: { responses: response } } } },
            },
          },
        },
        webhooks: { event: { post: { responses: response } } },
      }),
    )
    expect(result.checks).toBe(0)
  })
})

const withParams = (...parameters) => ({ get: { parameters, responses: okResponse } })
const query = (name, schema) => ({ name, in: 'query', schema })
// The same values as a body's properties: where the rule looks.
const fields = (...entries) =>
  postJson({
    type: 'object',
    properties: Object.fromEntries(entries.map(({ name, schema }) => [name, schema])),
  })
const postJson = (schema) => ({
  post: { requestBody: { content: json(schema) }, responses: okResponse },
})

describe('unbounded-input', () => {
  it('passes strings and arrays bounded by any of the means the header lists', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/search': fields(
            query('q', { type: 'string', maxLength: 200 }),
            query('sort', { type: 'string', enum: ['asc', 'desc'] }),
            query('mode', { const: 'fast' }),
            query('nullable', { type: ['string', 'null'], maxLength: 10 }),
            ...['date', 'date-time', 'time', 'uuid', 'ipv4', 'ipv6', 'duration'].map((format) =>
              query(format, { type: 'string', format }),
            ),
            query('code', { type: 'string', pattern: '^[A-Z]{2}\\d{4}$' }),
            query('choice', { type: 'string', pattern: '^(yes|no)$' }),
            query('either', { type: 'string', pattern: '^a{1,3}$|^b$' }),
            query('signs', { type: 'string', pattern: '^[+*]{1,3}$' }),
            query('escaped', { type: 'string', pattern: '^\\+\\*{1}$' }),
            query('strong', { type: 'string', pattern: '^(?=.*\\d)[a-z0-9]{8,64}$' }),
            query('ids', {
              type: 'array',
              maxItems: 50,
              items: { type: 'string', format: 'uuid' },
            }),
          ),
          '/things': postJson({
            type: 'object',
            properties: {
              point: {
                type: 'array',
                prefixItems: [{ type: 'string', maxLength: 5 }, { type: 'integer' }],
                items: false,
              },
              name: { allOf: [{ type: 'string' }, { maxLength: 80 }] },
              ref: {
                oneOf: [
                  { type: 'string', format: 'uuid' },
                  { type: 'string', maxLength: 12 },
                ],
              },
              count: { type: 'integer' },
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBe(2)
  })

  it('flags each unbounded input once per operation, naming the first three', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/search': fields(
            query('q', { type: 'string' }),
            query('loose', { type: 'string', pattern: '[a-z]{1,8}' }),
            query('open', { type: 'string', pattern: '^[a-z]{1,8}' }),
            query('plus', { type: 'string', pattern: '^[a-z]+$' }),
            query('atLeast', { type: 'string', pattern: '^\\d{2,}$' }),
            query('dollar', { type: 'string', pattern: '^[a-z]{1,3}\\$' }),
            query('half', { type: 'string', pattern: '^a$|b' }),
          ),
          '/things': postJson({
            type: 'object',
            properties: {
              owner: { type: 'object', properties: { name: { type: 'string' } } },
              tags: { type: 'array', items: { type: 'string' } },
              map: { type: 'object', additionalProperties: { type: 'string' } },
              pair: { type: 'array', prefixItems: [{ type: 'string', maxLength: 3 }] },
              mixed: { oneOf: [{ type: 'string', maxLength: 3 }, { type: 'string' }] },
            },
          }),
        },
      }),
    )
    expect(result.findings.map((f) => [f.location, f.params])).toEqual([
      ['POST /search', { count: 7, names: 'q, loose, open (+4)' }],
      ['POST /things', { count: 6, names: 'owner.name, tags, tags[] (+3)' }],
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'info', dataPath: '/paths/~1search/post' })
  })

  it('reads unevaluated properties and items as values of their own', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/things': postJson({
            type: 'object',
            properties: {
              list: { type: 'array', maxItems: 3, unevaluatedItems: { type: 'string' } },
            },
            unevaluatedProperties: { type: 'string' },
          }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params)).toEqual([{ count: 2, names: 'list[], *' }])
  })

  it('leaves parameters to the limits servers put on URLs and headers', () => {
    const result = run(
      unboundedInput,
      doc({ paths: { '/search': withParams(query('q', { type: 'string' })) } }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('names the labels of a body root, map values and tuple items', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/notes': {
            post: {
              requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
              responses: okResponse,
            },
          },
          '/shapes': postJson({
            type: 'object',
            properties: {
              map: { type: 'object', additionalProperties: { type: 'string' } },
              pair: { type: 'array', prefixItems: [{ type: 'string' }], items: false },
            },
          }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params.names)).toEqual(['text/plain', 'map.*, pair[0]'])
  })

  it('skips readOnly properties, files and numbers, and grades only operations with a sized input', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/items': postJson({
            type: 'object',
            properties: {
              id: { type: 'string', readOnly: true },
              label: { type: 'string', maxLength: 40 },
              quantity: { type: 'integer' },
            },
          }),
          '/upload': {
            post: {
              requestBody: {
                content: {
                  'multipart/form-data': {
                    schema: {
                      type: 'object',
                      properties: { file: { type: 'string', format: 'binary' } },
                    },
                  },
                  'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
                },
              },
              responses: okResponse,
            },
          },
          '/count': withParams(query('limit', { type: 'integer' })),
        },
        webhooks: {
          event: postJson({ type: 'object', properties: { text: { type: 'string' } } }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBe(1)
  })

  it('grades a shared component in every operation that accepts it', () => {
    const result = runRefs(
      unboundedInput,
      doc({
        paths: {
          '/a': postJson(ref('Note')),
          '/b': { put: postJson(ref('Note')).post },
        },
        components: {
          schemas: { Note: { type: 'object', properties: { text: { type: 'string' } } } },
        },
      }),
    )
    expect(result.findings.map((f) => [f.location, f.params.names])).toEqual([
      ['POST /a', 'text'],
      ['PUT /b', 'text'],
    ])
  })

  it('leaves out a 3.1 file part, by its binary contentMediaType', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/upload': {
            post: {
              requestBody: {
                content: {
                  'multipart/form-data': {
                    schema: {
                      type: 'object',
                      properties: {
                        avatar: { type: 'string', contentMediaType: 'image/png' },
                        caption: { type: 'string', maxLength: 80 },
                      },
                    },
                  },
                },
              },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('reads an untyped branch as constraining the type of the schema it belongs to', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/things': postJson({
            type: 'object',
            properties: {
              id: { type: 'string', anyOf: [{ maxLength: 5 }, { format: 'uuid' }] },
              code: {
                type: ['string', 'integer'],
                anyOf: [{ type: 'string', maxLength: 5 }, { type: 'integer' }],
              },
              maybe: { type: ['string', 'null'], anyOf: [{ maxLength: 5 }, { type: 'null' }] },
              loose: { type: 'string', anyOf: [{ maxLength: 5 }, { minLength: 1 }] },
            },
          }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params)).toEqual([{ count: 1, names: 'loose' }])
  })

  it('skips a property made readOnly by an allOf member', () => {
    const result = run(
      unboundedInput,
      doc({
        paths: {
          '/items': postJson({
            type: 'object',
            properties: {
              id: { allOf: [{ type: 'string' }, { readOnly: true }] },
              label: { type: 'string', maxLength: 40 },
            },
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('counts a shared component once per place it takes in the body', () => {
    const result = runRefs(
      unboundedInput,
      doc({
        paths: {
          '/orders': postJson({
            type: 'object',
            properties: { billing: ref('Address'), shipping: ref('Address') },
          }),
        },
        components: {
          schemas: { Address: { type: 'object', properties: { street: { type: 'string' } } } },
        },
      }),
    )
    expect(result.findings.map((f) => f.params)).toEqual([
      { count: 2, names: 'billing.street, shipping.street' },
    ])
  })

  it('reads properties declared in a conditional branch and survives a cycle', () => {
    const result = runRefs(
      unboundedInput,
      doc({
        paths: { '/nodes': postJson(ref('Node')) },
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {
                name: { type: 'string', maxLength: 10 },
                children: { type: 'array', maxItems: 5, items: ref('Node') },
              },
              if: { properties: { name: { const: 'x' } } },
              // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
              then: { properties: { note: { type: 'string' } } },
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.params)).toEqual([{ count: 1, names: 'note' }])
  })
})
