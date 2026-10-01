import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { enumValuesUndescribed } from '../src/audit/rules/enum-values-undescribed.js'
import { errorMachineReadable } from '../src/audit/rules/error-machine-readable.js'
import { parameterNameCollision } from '../src/audit/rules/parameter-name-collision.js'
import { requestExample } from '../src/audit/rules/request-example.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// Agent rules of docs/audit.md §4.7 about meaning and feedback: what a tool
// built from the operation tells the agent about the values it sends and the
// errors it gets back.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

const runRefs = (rule, source) =>
  run(rule, dereferenceInternal(structuredClone(source)), { source })

const operation = (op, path = '/things', method = 'post') =>
  doc({ paths: { [path]: { [method]: { responses: okResponse, ...op } } } })

const jsonBody = (schema, extra = {}) => ({
  requestBody: { content: { 'application/json': { schema, ...extra } } },
})

const query = (name, schema, extra = {}) => ({ name, in: 'query', schema, ...extra })

describe('enum-values-undescribed', () => {
  const enumParam = (schema, extra) =>
    run(enumValuesUndescribed, operation({ parameters: [query('size', schema, extra)] }))

  it('passes values described one by one, in every spelling this documentation reads', () => {
    const result = run(
      enumValuesUndescribed,
      operation(
        jsonBody({
          type: 'object',
          properties: {
            list: {
              type: 'string',
              enum: ['S', 'M'],
              'x-enum-descriptions': ['Small, fits a letter box', 'Medium, a parcel'],
            },
            map: {
              type: 'integer',
              enum: [1, 2],
              'x-enumDescriptions': { 1: 'Next day', 2: 'Within a week' },
            },
            union: {
              oneOf: [
                { const: 'eu', description: 'Stored in Frankfurt' },
                { const: 'us', title: 'Stored in Virginia' },
              ],
            },
          },
        }),
      ),
    )
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('passes values the prose names as whole words, whatever the case', () => {
    const own = enumParam({
      type: 'string',
      enum: ['asc', 'desc'],
      description: 'ASC sorts oldest first, desc newest first.',
    })
    const fromParameter = enumParam(
      { type: 'array', items: { type: 'string', enum: ['open', 'closed'] } },
      { description: 'Any of `open` or `closed`.' },
    )
    const fromWrapper = run(
      enumValuesUndescribed,
      operation(
        jsonBody({
          type: 'object',
          properties: {
            level: {
              description: 'low: best effort; high: paged on call.',
              allOf: [{ type: 'string', enum: ['low', 'high'] }],
            },
          },
        }),
      ),
    )
    for (const result of [own, fromParameter, fromWrapper]) {
      expect(result).toMatchObject({ checks: 1, findings: [] })
    }
  })

  it('flags the values nothing explains, and only them', () => {
    const result = enumParam({
      type: 'string',
      enum: ['reviewed', 'unreviewed', 'malware'],
      description: 'Only reviewed advisories by default; malware ones on request.',
    })
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'enum-values-undescribed',
        severity: 'info',
        category: 'agent',
        opRef: 'post-things',
        dataPath: '/paths/~1things/post/parameters/0/schema',
        params: { count: 3, missing: 'unreviewed' },
      }),
    ])
  })

  it('counts a placeholder or the value read back as no description', () => {
    const result = enumParam({
      type: 'string',
      enum: ['active', 'gone'],
      'x-enum-descriptions': ['Active', 'TODO'],
    })
    expect(result.findings[0].params).toEqual({ count: 2, missing: 'active, gone' })
  })

  it('lists the first three unexplained values and elides the rest', () => {
    const result = enumParam({ type: 'string', enum: ['a1', 'b2', 'c3', 'd4', 'e5'] })
    expect(result.findings[0].params).toEqual({ count: 5, missing: 'a1, b2, c3, …' })
  })

  it('has nothing to ask of a boolean enum, a single value, or null', () => {
    for (const schema of [
      { type: 'boolean', enum: [true, false] },
      { type: 'string', enum: ['only'] },
      { const: 'fixed' },
      { type: ['string', 'null'], enum: ['only', null] },
    ]) {
      expect(enumParam(schema)).toMatchObject({ checks: 0, findings: [] })
    }
  })

  it('checks inputs only, each enum once, and never a read-only property', () => {
    const result = runRefs(
      enumValuesUndescribed,
      doc({
        paths: {
          '/a': {
            post: {
              parameters: [
                { name: 'tier', in: 'query', schema: { $ref: '#/components/schemas/Tier' } },
              ],
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Tier' } },
                  },
                },
              },
            },
          },
          '/b': {
            post: {
              ...jsonBody({
                type: 'object',
                properties: {
                  tier: { $ref: '#/components/schemas/Tier' },
                  state: { type: 'string', enum: ['x', 'y'], readOnly: true },
                },
              }),
              responses: okResponse,
            },
          },
        },
        webhooks: {
          ping: {
            post: { ...jsonBody({ type: 'string', enum: ['p', 'q'] }), responses: okResponse },
          },
        },
        components: { schemas: { Tier: { type: 'string', enum: ['gold', 'silver'] } } },
      }),
    )
    // A component is reported where it is written, once for every operation.
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/Tier'])
    expect(result.checks).toBe(1)
  })

  it('takes prose from a holder only when every place holding the enum names the value', () => {
    const sizes = (description) => ({
      post: {
        parameters: [
          {
            name: 'sizes',
            in: 'query',
            description,
            schema: { type: 'array', items: { $ref: '#/components/schemas/Size' } },
          },
        ],
        responses: okResponse,
      },
    })
    const bare = {
      post: {
        ...jsonBody({
          type: 'object',
          properties: { size: { $ref: '#/components/schemas/Size' } },
        }),
        responses: okResponse,
      },
    }
    const components = { schemas: { Size: { type: 'string', enum: ['s', 'm'] } } }
    const described = sizes('s: small; m: medium.')
    for (const paths of [
      { '/a': described, '/b': bare },
      { '/b': bare, '/a': described },
    ]) {
      const result = runRefs(enumValuesUndescribed, doc({ components, paths }))
      expect(result.findings.map((f) => [f.dataPath, f.params.missing])).toEqual([
        ['/components/schemas/Size', 's, m'],
      ])
    }
    const both = { '/a': described, '/c': sizes('Either s or m.') }
    expect(runRefs(enumValuesUndescribed, doc({ components, paths: both })).findings).toEqual([])
  })
})

describe('parameter-name-collision', () => {
  it('passes distinct names, an override, and one header written in two cases', () => {
    const result = run(
      parameterNameCollision,
      doc({
        paths: {
          '/things/{id}': {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'X-Trace', in: 'header', schema: { type: 'string' } },
            ],
            put: {
              parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'x-trace', in: 'header', schema: { type: 'string' } },
              ],
              ...jsonBody({ type: 'object', properties: { name: { type: 'string' } } }),
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags one name in two locations, on the later one', () => {
    const result = run(
      parameterNameCollision,
      operation(
        {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            query('ID', { type: 'string' }),
          ],
        },
        '/things/{id}',
        'get',
      ),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'parameter-name-collision',
        severity: 'warning',
        category: 'agent',
        dataPath: '/paths/~1things~1{id}/get/parameters/1',
        params: { name: 'ID', first: 'path', second: 'query' },
      }),
    ])
  })

  it('flags two case variants in the query, which only HTTP tells apart', () => {
    const result = run(
      parameterNameCollision,
      operation({ parameters: [query('page', {}), query('Page', {})] }, '/things', 'get'),
    )
    expect(result.findings[0].params).toEqual({ name: 'Page', first: 'query', second: 'query' })
  })

  it('flags a parameter clashing with a property of a JSON or form body, allOf included', () => {
    const json = run(
      parameterNameCollision,
      operation({
        parameters: [query('name', { type: 'string' })],
        ...jsonBody({
          allOf: [
            { type: 'object', properties: { id: { type: 'string' } } },
            { type: 'object', properties: { name: { type: 'string' } } },
          ],
        }),
      }),
    )
    expect(json.findings.map((f) => [f.dataPath, f.params])).toEqual([
      [
        '/paths/~1things/post/requestBody/content/application~1json/schema/allOf/1/properties/name',
        { name: 'name', first: 'query', second: 'body' },
      ],
    ])
    const form = run(
      parameterNameCollision,
      operation({
        parameters: [{ name: 'Name', in: 'cookie', schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/x-www-form-urlencoded': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
      }),
    )
    expect(form.findings[0].params).toEqual({ name: 'name', first: 'cookie', second: 'body' })
  })

  it('leaves out read-only body properties and bodies no bridge flattens', () => {
    const result = run(
      parameterNameCollision,
      operation({
        parameters: [query('id', { type: 'string' })],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'string', readOnly: true } } },
            },
            'application/xml': {
              schema: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('reports each colliding name once, and checks only operations with two inputs', () => {
    const result = run(
      parameterNameCollision,
      doc({
        paths: {
          '/things/{id}': {
            patch: {
              parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                query('id', {}),
                { name: 'id', in: 'header', schema: {} },
              ],
              ...jsonBody({ type: 'object', properties: { id: {}, note: {} } }),
              responses: okResponse,
            },
          },
          '/lonely': { get: { parameters: [query('q', {})], responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings.map((f) => f.params)).toEqual([
      { name: 'id', first: 'path', second: 'query' },
    ])
  })
})

describe('request-example', () => {
  const body = (schema, extra) => run(requestExample, operation(jsonBody(schema, extra)))

  it('passes a schema that shows an example, on its root or value by value', () => {
    for (const schema of [
      { type: 'object', properties: { a: { type: 'string' } }, example: { a: 'x' } },
      { type: 'object', properties: { a: { type: 'string' } }, examples: [{ a: 'x' }] },
      { allOf: [{ type: 'object', properties: { a: {} }, example: { a: 1 } }] },
      {
        type: 'object',
        properties: {
          id: { type: 'string', readOnly: true },
          name: { type: 'string', example: 'Rex' },
          kind: { type: 'string', enum: ['dog', 'cat'] },
          v: { const: 2 },
          owner: { type: 'object', properties: { email: { type: 'string', examples: ['a@b.c'] } } },
          tags: { type: 'array', items: { type: 'string', example: 'good' } },
          level: { allOf: [{ type: 'string', enum: ['low', 'high'] }] },
        },
      },
      { type: 'string', enum: ['on', 'off'] },
    ]) {
      expect(body(schema)).toMatchObject({ checks: 1, findings: [] })
    }
  })

  it('passes a form whose only unexemplified part is a file', () => {
    const result = run(
      requestExample,
      operation({
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                  caption: { type: 'string', example: 'My dog' },
                },
              },
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a body exemplified only on its media type, which no tool sees', () => {
    const result = body(
      { type: 'object', properties: { name: { type: 'string' } } },
      { example: { name: 'Rex' }, examples: { rex: { value: { name: 'Rex' } } } },
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'request-example',
        severity: 'info',
        category: 'agent',
        dataPath: '/paths/~1things/post/requestBody/content/application~1json/schema',
        params: { mediaType: 'application/json' },
      }),
    ])
  })

  it('counts one payload offered under several media types once', () => {
    const pet = { type: 'object', properties: { name: { type: 'string' } } }
    const result = run(
      requestExample,
      doc({
        paths: {
          '/pets': {
            post: {
              requestBody: {
                content: {
                  'application/json': { schema: pet },
                  'application/xml': { schema: pet },
                },
              },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({
      checks: 1,
      findings: [{ params: { mediaType: 'application/json' } }],
    })
  })

  it('flags a body with one value left without example, or an empty examples list', () => {
    const partial = body({
      type: 'object',
      properties: { name: { type: 'string', example: 'Rex' }, age: { type: 'integer' } },
    })
    const empty = body({ type: 'object', properties: { a: {} }, examples: [] })
    expect(partial.findings).toHaveLength(1)
    expect(empty.findings).toHaveLength(1)
  })

  it('flags a recursive body that never shows a value', () => {
    const result = runRefs(
      requestExample,
      doc({
        paths: {
          '/nodes': {
            post: { ...jsonBody({ $ref: '#/components/schemas/Node' }), responses: okResponse },
          },
        },
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: { child: { $ref: '#/components/schemas/Node' } },
            },
          },
        },
      }),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('checks neither a file body, nor a body without schema, nor a webhook', () => {
    const result = run(
      requestExample,
      doc({
        paths: {
          '/files': {
            post: {
              requestBody: {
                content: {
                  'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
                  'image/png': {},
                  'application/json': {},
                },
              },
              responses: okResponse,
            },
          },
        },
        webhooks: { ping: { post: { ...jsonBody({ type: 'object' }), responses: okResponse } } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('has nothing to ask of a body whose every property is read-only', () => {
    const readOnly = { type: 'string', readOnly: true }
    for (const schema of [
      { type: 'object', properties: { id: readOnly, created: readOnly } },
      { allOf: [{ type: 'object', properties: { id: readOnly } }] },
    ]) {
      expect(body(schema)).toMatchObject({ checks: 0, findings: [] })
    }
  })
})

describe('error-machine-readable', () => {
  const responses = (map) =>
    run(errorMachineReadable, operation({ responses: { ...okResponse, ...map } }))
  const response = (content) => ({ description: 'Failed', content })
  const object = { type: 'object', properties: { code: { type: 'string' } } }

  it('passes an error body with fields, in any family that can carry them', () => {
    const result = responses({
      400: response({ 'application/json': { schema: object } }),
      '4XX': response({ 'application/problem+json': { schema: { allOf: [object] } } }),
      500: response({
        'text/plain': { schema: { type: 'string' } },
        'application/json': { schema: object },
      }),
      503: response({ 'text/xml': { schema: { type: 'array', items: object } } }),
      default: response({ 'application/json': { schema: { type: ['object', 'null'] } } }),
    })
    expect(result).toMatchObject({ checks: 5, findings: [] })
  })

  it('flags prose: text, HTML, JSON without a schema or with a bare string', () => {
    const result = responses({
      400: response({ 'text/plain': { schema: { type: 'string' } } }),
      404: response({ 'text/html': {} }),
      409: response({ 'application/xhtml+xml': { schema: object } }),
      '5XX': response({ 'application/json': {} }),
      default: response({ 'application/json': { schema: { type: 'string' } } }),
    })
    expect(result.findings.map((f) => [f.dataPath, f.params.status])).toEqual([
      ['/paths/~1things/post/responses/400/content', '400'],
      ['/paths/~1things/post/responses/404/content', '404'],
      ['/paths/~1things/post/responses/409/content', '409'],
      ['/paths/~1things/post/responses/5XX/content', '5XX'],
      ['/paths/~1things/post/responses/default/content', 'default'],
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'error-machine-readable',
      severity: 'info',
      category: 'agent',
    })
  })

  it('checks neither a success, nor an error without content, nor a webhook', () => {
    const result = run(
      errorMachineReadable,
      doc({
        paths: {
          '/things': {
            post: {
              responses: {
                200: response({ 'text/plain': {} }),
                404: { description: 'Not found' },
                410: response({}),
              },
            },
          },
        },
        webhooks: {
          ping: { post: { responses: { 500: response({ 'text/plain': {} }) } } },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('reads an object the way the schema view does: required keys make one', () => {
    const result = responses({
      404: response({ 'application/json': { schema: { required: ['code'] } } }),
    })
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('grades a shared error response once, at the component', () => {
    const result = runRefs(
      errorMachineReadable,
      doc({
        components: {
          responses: { NotFound: response({ 'text/plain': { schema: { type: 'string' } } }) },
        },
        paths: {
          '/a': { get: { responses: { 404: { $ref: '#/components/responses/NotFound' } } } },
          '/b': { get: { responses: { 404: { $ref: '#/components/responses/NotFound' } } } },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'components.responses.NotFound',
        dataPath: '/components/responses/NotFound/content',
        params: { status: '404' },
      }),
    ])
  })
})
