import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { bodylessStatus } from '../src/audit/rules/bodyless-status.js'
import { httpDateHeaders } from '../src/audit/rules/http-date-headers.js'
import { methodNotAllowedAllow } from '../src/audit/rules/method-not-allowed-allow.js'
import { partialContentRange } from '../src/audit/rules/partial-content-range.js'
import { problemDetailsShape } from '../src/audit/rules/problem-details-shape.js'
import { queryMethodBody } from '../src/audit/rules/query-method-body.js'
import { redirectLocation } from '../src/audit/rules/redirect-location.js'
import { requestBodyMethod } from '../src/audit/rules/request-body-method.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

const op = (fields = {}) => ({ responses: okResponse, ...fields })
const body = { content: { 'application/json': { schema: { type: 'object' } } } }
const json = { 'application/json': { schema: { type: 'object' } } }

describe('request-body-method', () => {
  it('grades a body by what the method makes of it', () => {
    const result = run(
      requestBodyMethod,
      doc({
        paths: {
          '/a': {
            get: op({ requestBody: body }),
            head: op({ requestBody: body }),
            delete: op({ requestBody: body }),
            trace: op({ requestBody: body }),
          },
        },
      }),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((f) => [f.params.method, f.severity, f.dataPath])).toEqual([
      ['GET', 'warning', '/paths/~1a/get/requestBody'],
      ['DELETE', 'info', '/paths/~1a/delete/requestBody'],
      ['HEAD', 'warning', '/paths/~1a/head/requestBody'],
      ['TRACE', 'error', '/paths/~1a/trace/requestBody'],
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'request-body-method',
      category: 'correctness',
      location: 'GET /a',
    })
  })

  it('passes those methods without a body, and leaves the others alone', () => {
    const result = run(
      requestBodyMethod,
      doc({
        paths: {
          '/a': { get: op(), delete: op(), post: op({ requestBody: body }) },
          '/b': { put: op({ requestBody: body }), patch: op({ requestBody: body }) },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('checks webhooks and callbacks too', () => {
    const result = run(
      requestBodyMethod,
      doc({
        webhooks: { ping: { get: op({ requestBody: body }) } },
        paths: {
          '/a': {
            post: op({
              callbacks: {
                done: { '{$request.body#/url}': { delete: op({ requestBody: body }) } },
              },
            }),
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.params.method, f.severity])).toEqual([
      ['DELETE', 'info'],
      ['GET', 'warning'],
    ])
  })

  it('does not count a request body that is no object', () => {
    const result = run(
      requestBodyMethod,
      doc({ paths: { '/a': { get: op({ requestBody: 'x' }) } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('bodyless-status', () => {
  const withContent = (description = 'x') => ({ description, content: json })

  it('reports content on 1xx, 204, 205 and 304 responses', () => {
    const result = run(
      bodylessStatus,
      doc({
        paths: {
          '/a': {
            get: op({
              responses: {
                '1XX': withContent(),
                103: withContent(),
                204: withContent(),
                205: withContent(),
                304: withContent(),
                200: withContent(),
              },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(5)
    expect(result.findings.map((f) => f.params.status)).toEqual(['103', '204', '205', '304', '1XX'])
    expect(result.findings[0]).toMatchObject({
      severity: 'error',
      category: 'correctness',
      dataPath: '/paths/~1a/get/responses/103/content',
    })
  })

  it('passes a bodyless response and an empty content map', () => {
    const result = run(
      bodylessStatus,
      doc({
        paths: {
          '/a': {
            delete: op({
              responses: {
                204: { description: 'gone' },
                304: { description: 'same', content: {} },
              },
            }),
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('checks every response of a HEAD operation, whatever its status', () => {
    const result = run(
      bodylessStatus,
      doc({
        paths: {
          '/a': {
            head: op({
              responses: { 200: withContent(), default: withContent(), 404: { description: 'no' } },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.params.status, f.dataPath])).toEqual([
      ['200', '/paths/~1a/head/responses/200/content'],
      ['default', '/paths/~1a/head/responses/default/content'],
    ])
  })

  it('reports a shared 204 once at its component, a shared HEAD response at its use', () => {
    const empty = withContent('No content')
    const pet = withContent('A pet')
    const document = doc({
      components: { responses: { Empty: empty, Pet: pet } },
      paths: {
        '/a': { delete: op({ responses: { 204: empty } }), head: op({ responses: { 200: pet } }) },
        '/b': { delete: op({ responses: { 204: empty } }), get: op({ responses: { 200: pet } }) },
      },
    })
    const result = run(bodylessStatus, document)
    expect(result.checks).toBe(2)
    expect(result.findings.map((f) => [f.dataPath, f.location])).toEqual([
      ['/components/responses/Empty/content', 'components.responses.Empty'],
      ['/paths/~1a/head/responses/200', 'HEAD /a'],
    ])
  })
})

describe('redirect-location', () => {
  it('reports a redirect without a Location header', () => {
    const result = run(
      redirectLocation,
      doc({
        paths: {
          '/a': {
            get: op({
              responses: {
                301: { description: 'moved' },
                303: { description: 'see other' },
                307: { description: 'here', headers: { location: { schema: { type: 'string' } } } },
                300: { description: 'choices' },
                304: { description: 'same' },
              },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.params.status, f.severity, f.category])).toEqual([
      ['301', 'info', 'completeness'],
      ['303', 'info', 'completeness'],
    ])
  })

  it('reports a shared redirect once, at the component', () => {
    const moved = { description: 'moved' }
    const result = run(
      redirectLocation,
      doc({
        components: { responses: { Moved: moved } },
        paths: {
          '/a': { get: op({ responses: { 308: moved } }) },
          '/b': { get: op({ responses: { 301: moved, 308: moved } }) },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: '/components/responses/Moved',
      params: { status: '308' },
    })
  })
})

describe('method-not-allowed-allow', () => {
  it('reports a 405 without an Allow header, and passes one with it', () => {
    const result = run(
      methodNotAllowedAllow,
      doc({
        paths: {
          '/a': { get: op({ responses: { 405: { description: 'no' } } }) },
          '/b': {
            get: op({
              responses: {
                405: { description: 'no', headers: { ALLOW: { schema: { type: 'string' } } } },
              },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'method-not-allowed-allow',
        category: 'completeness',
        severity: 'info',
        dataPath: '/paths/~1a/get/responses/405',
        params: { status: '405' },
      }),
    ])
  })
})

describe('partial-content-range', () => {
  it('passes a Content-Range header or a multipart/byteranges body, reports neither', () => {
    const result = run(
      partialContentRange,
      doc({
        paths: {
          '/a': {
            get: op({
              responses: {
                206: {
                  description: 'part',
                  headers: { 'content-range': { schema: { type: 'string' } } },
                },
              },
            }),
          },
          '/b': {
            get: op({
              responses: {
                206: { description: 'parts', content: { 'multipart/byteranges; boundary=x': {} } },
              },
            }),
          },
          '/c': {
            get: op({
              responses: {
                206: { description: 'part', content: { 'application/octet-stream': {} } },
              },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(3)
    expect(result.findings.map((f) => [f.dataPath, f.severity])).toEqual([
      ['/paths/~1c/get/responses/206', 'info'],
    ])
  })
})

describe('http-date-headers', () => {
  const responding = (headers, components) =>
    doc({
      components,
      paths: { '/a': { get: op({ responses: { 200: { description: 'OK', headers } } }) } },
    })

  it('reports an RFC 3339 format, a number, or an example that is no IMF-fixdate', () => {
    const result = run(
      httpDateHeaders,
      responding({
        'Last-Modified': { schema: { type: 'string', format: 'date-time' } },
        Expires: { schema: { type: 'integer' }, example: 0 },
        sunset: { schema: { type: 'string' }, example: '2026-10-21T07:28:00Z' },
        'Retry-After': { schema: { type: 'string', format: 'date' } },
      }),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((f) => [f.params.header, f.dataPath])).toEqual([
      ['Last-Modified', '/paths/~1a/get/responses/200/headers/Last-Modified/schema/format'],
      ['Expires', '/paths/~1a/get/responses/200/headers/Expires/schema/type'],
      ['sunset', '/paths/~1a/get/responses/200/headers/sunset/example'],
      ['Retry-After', '/paths/~1a/get/responses/200/headers/Retry-After/schema/format'],
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'warning', category: 'correctness' })
  })

  it('passes an http-date string with IMF-fixdate examples, and delay-seconds on Retry-After', () => {
    const result = run(
      httpDateHeaders,
      responding({
        'Last-Modified': {
          schema: {
            type: 'string',
            format: 'http-date',
            examples: ['Wed, 21 Oct 2026 07:28:00 GMT'],
          },
          examples: { one: { value: 'Sun, 06 Nov 1994 08:49:37 GMT' } },
        },
        'Retry-After': { schema: { type: 'integer' }, example: 120 },
        'retry-after': { schema: { type: 'string' }, example: '120' },
        Expires: { schema: { type: 'string' }, example: { not: 'a string' } },
        ETag: { schema: { type: 'integer' } },
        Sunset: { content: { 'text/plain': { schema: { format: 'http-date' } } } },
      }),
    )
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('reads a header described by its content', () => {
    const result = run(
      httpDateHeaders,
      responding({
        Sunset: {
          content: { 'text/plain': { schema: { type: 'string', format: 'date-time' } } },
        },
        Expires: { content: { 'text/plain': { example: '2024-01-01' } } },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/responses/200/headers/Sunset/content/text~1plain/schema/format',
      '/paths/~1a/get/responses/200/headers/Expires/content/text~1plain/example',
    ])
  })

  it('rejects an HTTP-date in another form, or an impossible one', () => {
    for (const example of [
      'Sunday, 06-Nov-94 08:49:37 GMT',
      'Sun Nov  6 08:49:37 1994',
      'sun, 06 nov 1994 08:49:37 gmt',
      'Mon, 31 Feb 2026 08:49:37 GMT',
      'Sun, 06 Nov 1994 08:49:37 UTC',
    ]) {
      const result = run(
        httpDateHeaders,
        responding({ Sunset: { schema: { type: 'string' }, example } }),
      )
      expect(result.findings, example).toHaveLength(1)
    }
  })

  it('reads named examples, the negative delay, and the schema behind a $ref', () => {
    const result = run(
      httpDateHeaders,
      responding({
        'Retry-After': { schema: { type: 'integer' }, examples: { soon: { value: -5 } } },
        Expires: { schema: { type: 'string' }, examples: { soon: { value: 'tomorrow' } } },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/responses/200/headers/Retry-After/examples/soon/value',
      '/paths/~1a/get/responses/200/headers/Expires/examples/soon/value',
    ])
  })

  it('checks a shared header once at its component, named by the key it is used under', () => {
    const shared = { schema: { type: 'string', format: 'date-time' } }
    const document = doc({
      components: {
        headers: {
          When: shared,
          Expires: { schema: { type: 'number' } },
          Other: { schema: { type: 'string', format: 'date-time' } },
        },
      },
      paths: {
        '/a': {
          get: op({
            responses: {
              200: {
                description: 'OK',
                headers: { 'Last-Modified': { $ref: '#/components/headers/When' } },
              },
            },
          }),
        },
      },
    })
    const source = structuredClone(document)
    document.paths['/a'].get.responses[200].headers['Last-Modified'] = shared
    const result = run(httpDateHeaders, document, { source })
    expect(result.checks).toBe(2)
    expect(result.findings.map((f) => [f.params.header, f.dataPath, f.location])).toEqual([
      ['Last-Modified', '/components/headers/When/schema/format', 'components.headers.When'],
      ['Expires', '/components/headers/Expires/schema/type', 'components.headers.Expires'],
    ])
  })

  it('names a shared header after the keys responses use, its own only when none does', () => {
    const document = doc({
      components: {
        headers: {
          Sunset: { schema: { type: 'integer' } },
          When: { schema: { type: 'integer' } },
          Expires: { schema: { type: 'integer' } },
        },
      },
      paths: {
        '/a': {
          get: op({
            responses: {
              200: {
                description: 'OK',
                headers: {
                  'X-Count': { $ref: '#/components/headers/Sunset' },
                  'X-When': { $ref: '#/components/headers/When' },
                },
              },
              201: {
                description: 'Created',
                headers: { Expires: { $ref: '#/components/headers/When' } },
              },
            },
          }),
        },
      },
    })
    const result = run(httpDateHeaders, document, { source: structuredClone(document) })
    expect(result.findings.map((f) => [f.params.header, f.dataPath])).toEqual([
      ['Expires', '/components/headers/When/schema/type'],
      ['Expires', '/components/headers/Expires/schema/type'],
    ])
    expect(result.checks).toBe(2)
  })

  it('leaves part headers of a multipart encoding alone', () => {
    const result = run(
      httpDateHeaders,
      doc({
        paths: {
          '/a': {
            post: op({
              requestBody: {
                content: {
                  'multipart/form-data': {
                    schema: { type: 'object', properties: { file: {} } },
                    encoding: { file: { headers: { Expires: { schema: { type: 'integer' } } } } },
                  },
                },
              },
            }),
          },
        },
      }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('query-method-body', () => {
  const v32 = (paths) => doc({ openapi: '3.2.0', paths })

  it('reports a QUERY operation without a request body or without content', () => {
    const result = run(
      queryMethodBody,
      v32({
        '/a': { query: op() },
        '/b': { query: op({ requestBody: { description: 'filters' } }) },
        '/c': { query: op({ requestBody: { content: {} } }) },
        '/d': { query: op({ requestBody: body }) },
      }),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((f) => [f.dataPath, f.severity])).toEqual([
      ['/paths/~1a/query', 'warning'],
      ['/paths/~1b/query/requestBody', 'warning'],
      ['/paths/~1c/query/requestBody', 'warning'],
    ])
  })

  it('has nothing to check before 3.2', () => {
    const result = run(queryMethodBody, doc({ paths: { '/a': { query: op(), get: op() } } }))
    expect(result.checks).toBe(0)
  })
})

describe('problem-details-shape', () => {
  const problem = (schema, components) =>
    doc({
      components,
      paths: {
        '/a': {
          get: op({
            responses: {
              400: { description: 'bad', content: { 'application/problem+json': { schema } } },
            },
          }),
        },
      },
    })

  it('reports a root that is no object', () => {
    for (const schema of [
      { type: 'array', items: {} },
      { items: { type: 'object' } },
      { type: ['string', 'null'] },
    ]) {
      const result = run(problemDetailsShape, problem(schema))
      expect(result.findings.map((f) => f.params)).toEqual([{ member: '$' }])
    }
  })

  it('reports a standard member typed against the RFC, through allOf', () => {
    const result = run(
      problemDetailsShape,
      problem({
        allOf: [
          { type: 'object', properties: { title: { type: 'string' } } },
          { properties: { status: { type: 'string' }, detail: { type: 'object' } } },
        ],
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        category: 'correctness',
        dataPath: '/paths/~1a/get/responses/400/content/application~1problem+json/schema',
        params: { member: '$.status' },
      }),
    ])
  })

  it('passes the RFC shape, nullable members and extensions', () => {
    const result = run(
      problemDetailsShape,
      problem({
        type: 'object',
        properties: {
          type: { type: 'string', format: 'uri-reference' },
          status: { type: 'integer' },
          title: { type: ['string', 'null'] },
          detail: {},
          instance: { type: 'string' },
          errors: { type: 'array' },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('checks a shared schema once, at the component; ignores requests and other media types', () => {
    const shared = { type: 'object', properties: { instance: { type: 'integer' } } }
    const document = doc({
      components: { schemas: { Problem: shared } },
      paths: {
        '/a': {
          post: op({
            requestBody: { content: { 'application/problem+json': { schema: shared } } },
            responses: {
              400: {
                description: 'bad',
                content: {
                  'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
                },
              },
              409: {
                description: 'conflict',
                content: {
                  'application/problem+json; charset=utf-8': {
                    schema: { $ref: '#/components/schemas/Problem' },
                  },
                },
              },
              422: {
                description: 'json',
                content: { 'application/json': { schema: { type: 'array' } } },
              },
            },
          }),
        },
      },
    })
    const dereferenced = structuredClone(document)
    for (const status of ['400', '409']) {
      const content = dereferenced.paths['/a'].post.responses[status].content
      for (const media of Object.values(content))
        media.schema = dereferenced.components.schemas.Problem
    }
    const result = run(problemDetailsShape, dereferenced, { source: document })
    expect(result.checks).toBe(1)
    expect(result.findings.map((f) => [f.dataPath, f.location, f.params])).toEqual([
      ['/components/schemas/Problem', 'components.schemas.Problem', { member: '$.instance' }],
    ])
  })
})
