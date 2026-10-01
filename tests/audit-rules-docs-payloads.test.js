import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { isPlaceholderExample } from '../src/audit/placeholder-example.js'
import { exampleExternalOnly } from '../src/audit/rules/example-external-only.js'
import { examplePlaceholder } from '../src/audit/rules/example-placeholder.js'
import { exampleSummary } from '../src/audit/rules/example-summary.js'
import { forbiddenInBrowser } from '../src/audit/rules/forbidden-in-browser.js'
import { responseContentSchema } from '../src/audit/rules/response-content-schema.js'
import { serverDescribed } from '../src/audit/rules/server-described.js'
import { serverPlaceholder } from '../src/audit/rules/server-placeholder.js'
import { typeMissing } from '../src/audit/rules/type-missing.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The payload, example and server rules of docs/audit.md §4.2 and §4.5: what
// the reader of the reference sees of a response, an example, a server.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// Fixtures with `$ref`s: the rule sees the source as written and its
// dereferenced twin, as the loader hands them over.
const runRefs = (rule, source) =>
  run(rule, dereferenceInternal(structuredClone(source)), { source })

const getWith = (responses, extra = {}) => ({ get: { responses, ...extra } })
const json = (media = {}) => ({ 'application/json': media })

describe('isPlaceholderExample', () => {
  it('recognizes type names, to-do words and lorem ipsum, however written', () => {
    for (const value of [
      'string',
      'Integer',
      ' TODO: ',
      'To-do',
      'tbd',
      'FIXME',
      'xxx',
      'Lorem ipsum dolor',
    ]) {
      expect(isPlaceholderExample(value)).toBe(true)
    }
  })

  it('recognizes an object or array of placeholders and neutral fillers', () => {
    expect(isPlaceholderExample({ id: 0, name: 'string', tags: ['string'], ok: true })).toBe(true)
    expect(isPlaceholderExample([{ name: 'string', note: '' }])).toBe(true)
  })

  it('leaves alone a plausible value, a value with no placeholder, and a schema constant', () => {
    expect(isPlaceholderExample('Rex')).toBe(false)
    expect(isPlaceholderExample('a string of text')).toBe(false)
    expect(isPlaceholderExample({ id: 0, active: false })).toBe(false)
    expect(isPlaceholderExample({ id: 7, name: 'string' })).toBe(false)
    expect(isPlaceholderExample({ name: 'string', parent: null })).toBe(false)
    expect(isPlaceholderExample(0)).toBe(false)
    expect(isPlaceholderExample('string', { enum: ['string', 'number'] })).toBe(false)
    expect(isPlaceholderExample('object', { const: 'object' })).toBe(false)
    expect(
      isPlaceholderExample(
        { type: 'string' },
        { type: 'object', properties: { type: { enum: ['string', 'integer'] } } },
      ),
    ).toBe(false)
  })
})

describe('response-content-schema', () => {
  it('passes structured media types with a schema or an item schema, and skips files and text', () => {
    const result = run(
      responseContentSchema,
      doc({
        paths: {
          '/pets': getWith({
            200: {
              description: 'OK',
              content: {
                'application/json': { schema: { type: 'object' } },
                'application/jsonl': { itemSchema: { type: 'object' } },
                'text/plain': {},
                'image/png': {},
                '*/*': {},
              },
            },
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags JSON, XML and form media types with no schema', () => {
    const result = run(
      responseContentSchema,
      doc({
        paths: {
          '/pets': getWith({
            200: {
              description: 'OK',
              content: {
                'application/json': { example: { id: 1 } },
                'application/problem+json': {},
                'text/xml': {},
                'application/atom+xml': {},
                'application/x-www-form-urlencoded': {},
                'application/yaml': {},
                'application/openapi+yaml': {},
              },
            },
          }),
        },
      }),
    )
    expect(result.findings.map((f) => f.params.mediaType)).toEqual([
      'application/json',
      'application/problem+json',
      'text/xml',
      'application/atom+xml',
      'application/x-www-form-urlencoded',
      'application/yaml',
      'application/openapi+yaml',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'response-content-schema',
      severity: 'warning',
      category: 'completeness',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/responses/200/content/application~1json',
      params: { status: '200', mediaType: 'application/json' },
    })
  })

  it('checks a shared response once, at the component, and webhook responses too', () => {
    const result = runRefs(
      responseContentSchema,
      doc({
        components: {
          responses: { Error: { description: 'Error', content: json() } },
        },
        paths: {
          '/a': getWith({ 400: { $ref: '#/components/responses/Error' } }),
          '/b': getWith({ 404: { $ref: '#/components/responses/Error' } }),
        },
        webhooks: {
          ping: { post: { responses: { 200: { description: 'OK', content: json() } } } },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.status])).toEqual([
      ['/components/responses/Error/content/application~1json', '400'],
      ['/webhooks/ping/post/responses/200/content/application~1json', '200'],
    ])
    expect(result.findings[0]).toMatchObject({
      location: 'components.responses.Error',
      opRef: null,
    })
  })

  it('leaves a response HTTP gives no content to bodyless-status', () => {
    const result = runRefs(
      responseContentSchema,
      doc({
        components: {
          responses: { Shared: { description: 'Shared', content: json() } },
        },
        paths: {
          '/a': {
            ...getWith({
              204: { description: 'Gone', content: json() },
              304: { $ref: '#/components/responses/Shared' },
            }),
            head: { responses: { 200: { description: 'OK', content: json() } } },
          },
          '/b': getWith({ 200: { $ref: '#/components/responses/Shared' } }),
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.status])).toEqual([
      ['/components/responses/Shared/content/application~1json', '200'],
    ])
  })
})

describe('example-placeholder', () => {
  it('passes real examples and a constant the schema allows', () => {
    const result = run(
      examplePlaceholder,
      doc({
        paths: {
          '/pets': getWith(
            {
              200: {
                description: 'OK',
                content: json({
                  schema: { type: 'object', example: { id: 7, name: 'Rex' } },
                  examples: { rex: { value: { id: 7, name: 'Rex' } } },
                }),
              },
            },
            {
              parameters: [
                {
                  name: 'kind',
                  in: 'query',
                  schema: { type: 'string', enum: ['string', 'number'] },
                  example: 'string',
                },
              ],
            },
          ),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('flags a placeholder wherever an example is written', () => {
    const result = run(
      examplePlaceholder,
      doc({
        components: {
          schemas: { Pet: { type: 'object', examples: [{ id: 0, name: 'string' }, { id: 7 }] } },
          headers: { 'X-Trace': { schema: { type: 'string' }, example: 'TODO' } },
          examples: { generated: { dataValue: 'lorem ipsum dolor' } },
        },
        paths: {
          '/pets': getWith(
            {
              200: {
                description: 'OK',
                content: json({
                  schema: { type: 'string' },
                  example: 'string',
                  examples: { blank: { value: 'tbd' } },
                }),
              },
            },
            {
              parameters: [{ name: 'q', in: 'query', schema: { type: 'string', example: 'xxx' } }],
            },
          ),
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath).sort()).toEqual([
      '/components/examples/generated/dataValue',
      '/components/headers/X-Trace/example',
      '/components/schemas/Pet/examples/0',
      '/paths/~1pets/get/parameters/0/schema/example',
      '/paths/~1pets/get/responses/200/content/application~1json/example',
      '/paths/~1pets/get/responses/200/content/application~1json/examples/blank/value',
    ])
    const pet = result.findings.find((f) => f.dataPath.endsWith('/examples/0'))
    expect(pet).toMatchObject({
      ruleId: 'example-placeholder',
      severity: 'info',
      category: 'completeness',
      location: 'components.schemas.Pet',
      params: { value: '{"id":0,"name":"string"}' },
    })
  })

  it('reads the enum of a schema behind a $ref', () => {
    const result = runRefs(
      examplePlaceholder,
      doc({
        components: { schemas: { Kind: { type: 'string', enum: ['object', 'array'] } } },
        paths: {
          '/pets': getWith(okResponse, {
            parameters: [
              {
                name: 'kind',
                in: 'query',
                schema: { $ref: '#/components/schemas/Kind' },
                examples: { first: { value: 'object' } },
              },
            ],
          }),
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('example-summary', () => {
  const withExamples = (examples) =>
    doc({
      paths: {
        '/pets': getWith({ 200: { description: 'OK', content: json({ schema: {}, examples }) } }),
      },
    })

  it('passes summarized examples, and leaves a lone example alone', () => {
    expect(
      run(
        exampleSummary,
        withExamples({
          dog: { summary: 'A dog with an owner', value: {} },
          cat: { summary: 'A stray cat', value: {} },
        }),
      ),
    ).toMatchObject({ checks: 2, findings: [] })
    expect(run(exampleSummary, withExamples({ dog: { value: {} } })).checks).toBe(0)
  })

  it('flags an example of a map of two or more with no substantive summary', () => {
    const result = run(
      exampleSummary,
      withExamples({
        soldOut: { summary: 'Sold out', value: {} },
        draft: { summary: 'TODO', value: {} },
        available: { summary: 'Every pet in stock', value: {} },
        plain: { value: {} },
      }),
    )
    expect(result.findings.map((f) => f.params.name)).toEqual(['soldOut', 'draft', 'plain'])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'example-summary',
      severity: 'info',
      category: 'readiness',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/responses/200/content/application~1json/examples/soldOut',
    })
  })

  it('checks a shared example once, at the component, and honours a summary on the $ref', () => {
    const ref = { $ref: '#/components/examples/Dog' }
    const result = runRefs(
      exampleSummary,
      doc({
        openapi: '3.1.0',
        components: { examples: { Dog: { value: { name: 'Rex' } } } },
        paths: {
          '/a': getWith({
            200: {
              description: 'OK',
              content: json({ schema: {}, examples: { dog: ref, cat: ref } }),
            },
          }),
          '/b': getWith({
            200: {
              description: 'OK',
              content: json({
                schema: {},
                examples: {
                  dog: { ...ref, summary: 'A good dog' },
                  other: { summary: 'A cat that hunts', value: 1 },
                },
              }),
            },
          }),
        },
      }),
    )
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: '/components/examples/Dog',
      location: 'components.examples.Dog',
      params: { name: 'dog' },
    })
  })
})

describe('example-external-only', () => {
  it('passes an external example with an inline value beside it', () => {
    const result = run(
      exampleExternalOnly,
      doc({
        openapi: '3.2.0',
        components: {
          examples: {
            Pet: { externalValue: 'https://cdn.example.com/pet.json', dataValue: { id: 7 } },
            Inline: { value: { id: 7 } },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags an example whose only value is in another file', () => {
    const result = run(
      exampleExternalOnly,
      doc({
        paths: {
          '/pets': getWith({
            200: {
              description: 'OK',
              content: json({
                schema: {},
                examples: { big: { externalValue: 'https://cdn.example.com/pets.json' } },
              }),
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'example-external-only',
        severity: 'info',
        category: 'readiness',
        location: 'GET /pets',
        dataPath:
          '/paths/~1pets/get/responses/200/content/application~1json/examples/big/externalValue',
      }),
    ])
  })
})

describe('type-missing', () => {
  it('passes typed response values and skips what other rules grade', () => {
    const result = run(
      typeMissing,
      doc({
        paths: {
          '/pets': getWith({
            200: {
              description: 'OK',
              content: {
                ...json({
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer', readOnly: true },
                      secret: { writeOnly: true },
                      described: { allOf: [{ description: 'A thing' }, { type: 'string' }] },
                      labels: { type: 'object', additionalProperties: {} },
                    },
                  },
                }),
                'text/plain': { schema: {} },
                'application/xml': {},
                'application/octet-stream': { schema: {} },
              },
            },
          }),
        },
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBeGreaterThan(2)
  })

  it('flags untyped response values, readOnly ones included', () => {
    const result = run(
      typeMissing,
      doc({
        paths: {
          '/pets': getWith({
            200: {
              description: 'OK',
              content: json({
                schema: {
                  type: 'object',
                  properties: { id: { readOnly: true }, meta: true, list: { items: {} } },
                },
              }),
            },
            201: { description: 'Created', content: json({ schema: {} }) },
          }),
        },
      }),
    )
    const body = '/paths/~1pets/get/responses/200/content/application~1json/schema'
    expect(result.findings.map((f) => f.dataPath).sort()).toEqual([
      `${body}/properties/id`,
      `${body}/properties/list/items`,
      `${body}/properties/meta`,
      '/paths/~1pets/get/responses/201/content/application~1json/schema',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'type-missing',
      severity: 'info',
      category: 'readiness',
      location: 'GET /pets',
    })
  })

  it("grades a webhook's request, and leaves a tool input to untyped-input", () => {
    const result = runRefs(
      typeMissing,
      doc({
        components: {
          schemas: {
            Pet: {
              type: 'object',
              properties: { name: { type: 'string' }, note: {}, id: { readOnly: true } },
            },
          },
        },
        paths: {
          '/pets': {
            post: {
              requestBody: { content: json({ schema: { $ref: '#/components/schemas/Pet' } }) },
              responses: {
                200: {
                  description: 'OK',
                  content: json({ schema: { $ref: '#/components/schemas/Pet' } }),
                },
              },
            },
          },
        },
        webhooks: {
          petAdded: {
            post: {
              parameters: [{ name: 'X-Hook', in: 'header', schema: {} }],
              requestBody: { content: json() },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath).sort()).toEqual([
      '/components/schemas/Pet/properties/id',
      '/webhooks/petAdded/post/parameters/0/schema',
      '/webhooks/petAdded/post/requestBody/content/application~1json',
    ])
  })

  it('judges a schema that holds a value anywhere, whatever the order of the paths', () => {
    const paths = {
      '/a': getWith({
        200: {
          description: 'OK',
          content: json({ schema: { allOf: [{ $ref: '#/components/schemas/Note' }] } }),
        },
      }),
      '/b': getWith({
        200: {
          description: 'OK',
          content: json({
            schema: { type: 'object', properties: { note: { $ref: '#/components/schemas/Note' } } },
          }),
        },
      }),
    }
    const components = { schemas: { Note: { description: 'Free text' } } }
    for (const order of [paths, { '/b': paths['/b'], '/a': paths['/a'] }]) {
      const result = runRefs(typeMissing, doc({ components, paths: order }))
      expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/Note'])
    }
  })

  it('leaves a response that allows no content to bodyless-status', () => {
    const result = run(
      typeMissing,
      doc({
        paths: {
          '/pets': {
            head: { responses: { 200: { description: 'OK', content: json({ schema: {} }) } } },
            delete: { responses: { 204: { description: 'Gone', content: json({ schema: {} }) } } },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('judges a shared response once, at the component', () => {
    const result = runRefs(
      typeMissing,
      doc({
        components: {
          responses: {
            Err: { description: 'Error', content: json({ schema: { properties: { code: {} } } }) },
          },
        },
        paths: {
          '/a': getWith({ 400: { $ref: '#/components/responses/Err' } }),
          '/b': getWith({ 400: { $ref: '#/components/responses/Err' } }),
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'components.responses.Err',
        dataPath: '/components/responses/Err/content/application~1json/schema/properties/code',
      }),
    ])
  })
})

describe('forbidden-in-browser', () => {
  it('passes headers and methods a browser sends', () => {
    const result = run(
      forbiddenInBrowser,
      doc({
        paths: {
          '/pets': getWith(okResponse, {
            parameters: [
              { name: 'X-Request-Id', in: 'header', schema: { type: 'string' } },
              { name: 'X-HTTP-Method-Override', in: 'header', schema: { enum: ['PATCH', 'PUT'] } },
              { name: 'session', in: 'cookie', schema: { type: 'string' } },
            ],
          }),
        },
        webhooks: {
          ping: {
            post: { parameters: [{ name: 'Host', in: 'header' }], responses: okResponse },
          },
        },
      }),
    )
    // Two header parameters, one paths operation; the cookie and the webhook are not checked.
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('flags a forbidden header, a method override smuggling TRACE, and a forbidden method', () => {
    const result = run(
      forbiddenInBrowser,
      doc({
        paths: {
          '/echo': {
            get: {
              parameters: [
                { name: 'Origin', in: 'header', schema: { type: 'string' } },
                { name: 'Sec-Fetch-Mode', in: 'header', schema: { type: 'string' } },
                { name: 'X-HTTP-Method-Override', in: 'header', schema: { const: 'TRACE' } },
              ],
              responses: okResponse,
            },
            trace: { responses: okResponse },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.params.name)).toEqual([
      'Origin',
      'Sec-Fetch-Mode',
      'X-HTTP-Method-Override',
      'TRACE',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'forbidden-in-browser',
      severity: 'info',
      category: 'readiness',
      location: 'GET /echo',
      dataPath: '/paths/~1echo/get/parameters/0',
    })
    expect(result.findings[3]).toMatchObject({ location: 'TRACE /echo', opRef: 'trace-echo' })
  })

  it('checks a shared parameter once, and a 3.2 additional operation', () => {
    const result = runRefs(
      forbiddenInBrowser,
      doc({
        openapi: '3.2.0',
        components: { parameters: { Host: { name: 'Host', in: 'header', schema: {} } } },
        paths: {
          '/a': getWith(okResponse, { parameters: [{ $ref: '#/components/parameters/Host' }] }),
          '/b': {
            ...getWith(okResponse, { parameters: [{ $ref: '#/components/parameters/Host' }] }),
            additionalOperations: { TRACK: { responses: okResponse } },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.name])).toEqual([
      ['/components/parameters/Host', 'Host'],
      ['/paths/~1b/additionalOperations/TRACK', 'TRACK'],
    ])
  })
})

describe('server-placeholder', () => {
  const withServers = (servers, extra = {}) => doc({ servers, ...extra })

  it('passes real hosts, test and local names, and relative URLs', () => {
    const result = run(
      serverPlaceholder,
      withServers([
        { url: 'https://api.acme.io/v1' },
        { url: 'https://api.e2e.test' },
        { url: 'http://localhost:8080' },
        { url: 'https://examples.com' },
        { url: '/v1' },
      ]),
    )
    expect(result).toMatchObject({ checks: 4, findings: [] })
  })

  it('flags RFC 2606 hosts at every level the client calls, variables at their defaults', () => {
    const result = run(
      serverPlaceholder,
      withServers(
        [
          { url: 'https://api.example.com/v1' },
          { url: 'https://{env}.example.org', variables: { env: { default: 'sandbox' } } },
          { url: 'https://{host}', variables: { host: { default: 'api.service.example' } } },
        ],
        {
          paths: {
            '/pets': {
              servers: [{ url: 'https://EXAMPLE.NET.' }],
              get: { servers: [{ url: 'https://pets.invalid' }], responses: okResponse },
            },
          },
        },
      ),
    )
    expect(result.findings.map((f) => f.params.url)).toEqual([
      'https://api.example.com/v1',
      'https://sandbox.example.org',
      'https://api.service.example',
      'https://pets.invalid',
      'https://EXAMPLE.NET.',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'server-placeholder',
      severity: 'warning',
      category: 'readiness',
      dataPath: '/servers/0/url',
    })
    expect(result.findings[3]).toMatchObject({ location: 'GET /pets' })
  })

  it("leaves alone a Link's server and the servers of webhooks and callbacks", () => {
    const placeholder = [{ url: 'https://hooks.example.com' }]
    const result = run(
      serverPlaceholder,
      withServers([{ url: 'https://api.acme.io' }], {
        paths: {
          '/pets': {
            post: {
              responses: {
                200: {
                  description: 'OK',
                  links: { self: { operationId: 'x', server: placeholder[0] } },
                },
              },
              callbacks: {
                done: {
                  '{$request.body#/url}': { post: { servers: placeholder, responses: okResponse } },
                },
              },
            },
          },
        },
        webhooks: { ping: { servers: placeholder, post: { responses: okResponse } } },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('server-described', () => {
  it('passes described or named servers, and a lone server', () => {
    expect(
      run(
        serverDescribed,
        doc({
          servers: [
            { url: 'https://api.acme.io', description: 'Production' },
            { url: 'https://sandbox.acme.io', name: 'sandbox' },
          ],
        }),
      ),
    ).toMatchObject({ checks: 2, findings: [] })
    expect(run(serverDescribed, doc({ servers: [{ url: 'https://api.acme.io' }] })).checks).toBe(0)
  })

  it('flags a server known by its URL alone when there are several', () => {
    const result = run(
      serverDescribed,
      doc({
        servers: [
          { url: 'https://api.acme.io', description: 'Production' },
          { url: 'https://eu1.api.acme.io' },
          { url: 'https://us1.api.acme.io', description: 'TODO' },
        ],
      }),
    )
    expect(result.findings.map((f) => f.params.url)).toEqual([
      'https://eu1.api.acme.io',
      'https://us1.api.acme.io',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'server-described',
      severity: 'info',
      category: 'readiness',
      location: 'servers.1',
      dataPath: '/servers/1',
    })
  })
})
