import { describe, expect, it } from 'vitest'
import { createAuditContext, runRule } from '../src/audit/engine.js'
import { discriminatorProperty } from '../src/audit/rules/discriminator-property.js'
import { encodingValid } from '../src/audit/rules/encoding-valid.js'
import { refResolves } from '../src/audit/rules/ref-resolves.js'
import { refSiblings } from '../src/audit/rules/ref-siblings.js'
import { refTargetKind } from '../src/audit/rules/ref-target-kind.js'
import { responsesSuccess } from '../src/audit/rules/responses-success.js'
import { runtimeExpressionSyntax } from '../src/audit/rules/runtime-expression-syntax.js'
import { securityScopes } from '../src/audit/rules/security-scopes.js'
import { sequentialMedia } from '../src/audit/rules/sequential-media.js'
import { loadInlineApiModel } from '../src/openapi/loader.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The structural rules of docs/audit.md §4.1 about references, runtime
// expressions, media types, success responses, discriminators and scopes.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// Through the loader: what the reference rules read is what it makes of a
// `$ref` — siblings laid over a copy of the target, a broken one left in place.
const loaded = async (rule, document) =>
  runRule(rule, createAuditContext(await loadInlineApiModel(document)))

const pathsOf = (result) => result.findings.map((finding) => finding.dataPath)

describe('ref-siblings', () => {
  const document = (openapi) =>
    doc({
      openapi,
      paths: {
        '/pets': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/Limit', description: 'Here', 'x-note': 1 },
            ],
            responses: {
              200: {
                $ref: '#/components/responses/Pets',
                summary: 'Pets',
                headers: {},
              },
            },
          },
        },
      },
      components: {
        parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } } },
        responses: {
          Pets: {
            description: 'The pets',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Pet', description: 'A pet' },
              },
            },
          },
        },
        schemas: { Pet: { type: 'object' } },
      },
    })

  it('passes summary and description on a 3.1 reference, and any keyword on a schema $ref', async () => {
    const result = await loaded(refSiblings, document('3.1.0'))
    expect(pathsOf(result)).toEqual(['/paths/~1pets/get/responses/200/headers'])
  })

  it('flags every sibling of a 3.0 reference, schemas included, extensions spared', async () => {
    const result = await loaded(refSiblings, document('3.0.3'))
    expect(result.findings.map((f) => `${f.dataPath} ${f.params.object}`)).toEqual([
      '/paths/~1pets/get/parameters/0/description Parameter',
      '/paths/~1pets/get/responses/200/summary Response',
      '/paths/~1pets/get/responses/200/headers Response',
      '/components/responses/Pets/content/application~1json/schema/description Schema',
    ])
    expect(result.findings[0]).toMatchObject({ severity: 'warning', opRef: 'get-pets' })
  })
})

describe('ref-target-kind', () => {
  it('passes references to the kind of object their place expects', () => {
    const result = run(
      refTargetKind,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [{ $ref: '#/components/parameters/Limit' }],
              responses: {
                200: {
                  description: 'OK',
                  headers: { 'X-Rate': { $ref: '#/components/headers/Rate' } },
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Pet/properties/id' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          parameters: { Limit: { name: 'limit', in: 'query', schema: {} } },
          headers: { Rate: { schema: { type: 'integer' } } },
          schemas: { Pet: { properties: { id: { type: 'integer' } } } },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a schema used as a parameter, a parameter used as a header, a response as a path item', () => {
    const result = run(
      refTargetKind,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [{ $ref: '#/components/schemas/Pet' }],
              responses: {
                200: {
                  description: 'OK',
                  headers: { 'X-Rate': { $ref: '#/components/parameters/Rate' } },
                },
              },
            },
          },
          '/cats': { $ref: '#/components/responses/Gone' },
        },
        components: {
          parameters: { Rate: { name: 'X-Rate', in: 'header', schema: {} } },
          responses: { Gone: { description: 'Gone' } },
          schemas: { Pet: { type: 'object' } },
        },
      }),
    )
    expect(
      result.findings.map((f) => `${f.dataPath} ${f.params.expected} ← ${f.params.actual}`),
    ).toEqual([
      '/paths/~1pets/get/parameters/0/$ref Parameter ← Schema',
      '/paths/~1pets/get/responses/200/headers/X-Rate/$ref Header ← Parameter',
      '/paths/~1cats/$ref Path Item ← Response',
    ])
  })

  it('gives no verdict on a target outside what the walk typed', () => {
    const result = run(
      refTargetKind,
      doc({
        'x-shared': { Limit: { name: 'limit', in: 'query' } },
        paths: {
          '/pets': {
            get: { parameters: [{ $ref: '#/x-shared/Limit' }], responses: okResponse },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })
})

describe('ref-resolves', () => {
  it('passes references that resolve, through a chain too', async () => {
    const result = await loaded(
      refResolves,
      doc({
        paths: {
          '/pets': {
            get: { parameters: [{ $ref: '#/components/parameters/A' }], responses: okResponse },
          },
        },
        components: {
          parameters: {
            A: { $ref: '#/components/parameters/B' },
            B: { name: 'b', in: 'query', schema: {} },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags each reference the loader left in place, once at the end of a chain', async () => {
    const result = await loaded(
      refResolves,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [{ $ref: '#/components/parameters/A' }],
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Pett' } },
                  },
                },
              },
            },
          },
          '/old': { $ref: '#/components/pathItems/Gone' },
        },
        components: {
          parameters: { A: { $ref: '#/components/parameters/Missing' } },
          schemas: { Pet: { type: 'object' } },
        },
      }),
    )
    expect(result.findings.map((f) => f.params.ref)).toEqual([
      '#/components/schemas/Pett',
      '#/components/pathItems/Gone',
      '#/components/parameters/Missing',
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'error',
      opRef: 'get-pets',
      dataPath: '/paths/~1pets/get/responses/200/content/application~1json/schema/$ref',
    })
  })

  it('flags a file the loader could not read', async () => {
    const result = await loaded(
      refResolves,
      doc({
        paths: {
          '/pets': { get: { parameters: [{ $ref: 'common.yaml#/Limit' }], responses: okResponse } },
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/paths/~1pets/get/parameters/0/$ref'])
  })

  it('leaves a $ref inside an example alone: it is data', async () => {
    const result = await loaded(
      refResolves,
      doc({
        paths: {
          '/pets': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: { 'application/json': { example: { $ref: '#/nowhere' } } },
                },
              },
            },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })
})

describe('runtime-expression-syntax', () => {
  const document = (callbackKey, link) =>
    doc({
      paths: {
        '/subscriptions': {
          post: {
            callbacks: { onEvent: { [callbackKey]: { post: { responses: okResponse } } } },
            responses: { 201: { description: 'Created', links: { self: link } } },
          },
        },
      },
    })

  it('passes expressions the grammar produces, and constants', () => {
    const result = run(
      runtimeExpressionSyntax,
      document('https://hooks.example.com?id={$request.body#/id}&at={$request.header.X-Trace}', {
        operationId: 'getSubscription',
        parameters: { id: '$response.body#/id', region: 'eu', all: '$url', a: '$request.query.q' },
        requestBody: 'prefix-{$statusCode}',
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags each malformed expression where it is written', () => {
    const result = run(
      runtimeExpressionSyntax,
      document('{$request.body/url}', {
        operationId: 'getSubscription',
        parameters: {
          id: '$response.headers.Location',
          p: '$request.body#/a~2b',
          q: '$request.query',
        },
        requestBody: '{$method}{$request.header.}',
      }),
    )
    // The operation's fields in the spec's order: responses (and their links)
    // before callbacks.
    expect(result.findings.map((f) => `${f.params.expression}`)).toEqual([
      '$response.headers.Location',
      '$request.body#/a~2b',
      '$request.query',
      '$request.header.',
      '$request.body/url',
    ])
    expect(result.findings.at(-1).dataPath).toBe(
      '/paths/~1subscriptions/post/callbacks/onEvent/{$request.body~1url}',
    )
  })
})

describe('encoding-valid', () => {
  const body = (
    mediaType,
    encoding,
    schema = { type: 'object', properties: { file: {}, meta: {} } },
  ) =>
    doc({
      paths: {
        '/upload': {
          post: {
            requestBody: { content: { [mediaType]: { schema, encoding } } },
            responses: okResponse,
          },
        },
      },
    })

  it('passes an encoding naming properties of a form body, inherited ones included', () => {
    const inherited = { allOf: [{ properties: { file: {} } }, { properties: { meta: {} } }] }
    const result = run(
      encodingValid,
      body('multipart/form-data', { file: { contentType: 'image/png' }, meta: {} }, inherited),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags an entry naming no property, and every entry of a body that is not a form', () => {
    const typo = run(
      encodingValid,
      body('multipart/form-data', { fiel: { contentType: 'image/png' } }),
    )
    expect(typo.findings[0]).toMatchObject({
      dataPath: '/paths/~1upload/post/requestBody/content/multipart~1form-data/encoding/fiel',
      params: { mediaType: 'multipart/form-data', property: 'fiel' },
    })
    const json = run(encodingValid, body('application/json', { file: {}, meta: {} }))
    expect(json.findings.map((f) => f.params.property)).toEqual(['file', 'meta'])
  })

  it('applies to responses from 3.2 only, and gives no verdict on an open schema', () => {
    const response = (openapi) =>
      doc({
        openapi,
        paths: {
          '/parts': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'multipart/mixed': {
                      schema: { type: 'object', properties: { a: {} } },
                      encoding: { a: {} },
                    },
                  },
                },
              },
            },
          },
        },
      })
    expect(run(encodingValid, response('3.1.0')).findings).toHaveLength(1)
    expect(run(encodingValid, response('3.2.0')).findings).toEqual([])
    const open = body(
      'multipart/form-data',
      { anything: {} },
      { type: 'object', additionalProperties: true },
    )
    expect(run(encodingValid, open).findings).toEqual([])
  })
})

describe('sequential-media', () => {
  const content = (mediaType, media) =>
    doc({
      openapi: '3.2.0',
      paths: {
        '/events': {
          get: { responses: { 200: { description: 'OK', content: { [mediaType]: media } } } },
        },
      },
    })

  it('passes the 3.2 fields where they apply', () => {
    const stream = run(
      sequentialMedia,
      content('application/jsonl', { itemSchema: { type: 'object' } }),
    )
    const parts = run(
      sequentialMedia,
      content('multipart/mixed', { itemSchema: {}, prefixEncoding: [{}], itemEncoding: {} }),
    )
    expect(stream.findings).toEqual([])
    expect(parts.findings).toEqual([])
  })

  it('flags an itemSchema on a single-document body, positional encodings off multipart', () => {
    const json = run(
      sequentialMedia,
      content('application/json', { itemSchema: { type: 'object' } }),
    )
    expect(json.findings.map((f) => f.params)).toEqual([
      { field: 'itemSchema', mediaType: 'application/json' },
    ])
    const misplaced = run(
      sequentialMedia,
      content('text/event-stream', { itemSchema: {}, itemEncoding: { contentType: 'text/plain' } }),
    )
    expect(pathsOf(misplaced)).toEqual([
      '/paths/~1events/get/responses/200/content/text~1event-stream/itemEncoding',
    ])
    const noItems = run(
      sequentialMedia,
      content('multipart/mixed', {
        schema: { type: 'object' },
        prefixEncoding: [{}],
        encoding: {},
      }),
    )
    expect(noItems.findings.map((f) => f.params.field)).toEqual(['prefixEncoding'])
  })

  it('leaves older documents to version-construct', () => {
    const json = content('application/json', { itemSchema: {} })
    expect(run(sequentialMedia, { ...json, openapi: '3.1.0' }).findings).toEqual([])
  })
})

describe('responses-success', () => {
  const operation = (responses) => doc({ paths: { '/pets': { get: { responses } } } })

  it('passes a success code, a range or a default', () => {
    for (const responses of [
      { 200: { description: 'OK' } },
      { '2XX': { description: 'OK' } },
      { 302: { description: 'Moved' } },
      { default: { description: 'Any' } },
    ]) {
      expect(run(responsesSuccess, operation(responses)).findings).toEqual([])
    }
  })

  it('flags errors only, and an empty Responses', () => {
    const result = run(responsesSuccess, operation({ 404: { description: 'Not found' } }))
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      opRef: 'get-pets',
      dataPath: '/paths/~1pets/get/responses',
    })
    expect(run(responsesSuccess, operation({})).findings).toHaveLength(1)
  })

  it('reads a lowercase range as no success, as status-code-valid does', () => {
    const result = run(responsesSuccess, operation({ '2xx': { description: 'OK' } }))
    expect(result.findings).toHaveLength(1)
  })

  it('leaves webhooks and callbacks alone', () => {
    const result = run(
      responsesSuccess,
      doc({ webhooks: { petAdopted: { post: { responses: { 400: { description: 'No' } } } } } }),
    )
    expect(result.findings).toEqual([])
  })
})

describe('discriminator-property', async () => {
  const pets = (openapi, catProperties, catRequired, discriminator = { propertyName: 'kind' }) =>
    doc({
      openapi,
      components: {
        schemas: {
          Pet: { oneOf: [{ $ref: '#/components/schemas/Cat' }], discriminator },
          Cat: { type: 'object', properties: catProperties, required: catRequired },
        },
      },
    })

  it('passes a property every variant declares and requires', async () => {
    const result = await loaded(
      discriminatorProperty,
      pets('3.1.0', { kind: { type: 'string' } }, ['kind']),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('passes a parent that declares it for the children extending it', async () => {
    const result = run(
      discriminatorProperty,
      doc({
        components: {
          schemas: {
            Pet: {
              type: 'object',
              properties: { kind: { type: 'string' } },
              required: ['kind'],
              discriminator: { propertyName: 'kind' },
            },
            Cat: { allOf: [{ $ref: '#/components/schemas/Pet' }] },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags a property no variant declares, or one a payload may omit', async () => {
    const undeclared = await loaded(
      discriminatorProperty,
      pets('3.1.0', { type: { type: 'string' } }, []),
    )
    expect(undeclared.findings[0]).toMatchObject({
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/discriminator/propertyName',
      params: { property: 'kind' },
    })
    expect(
      (await loaded(discriminatorProperty, pets('3.1.0', { kind: {} }, []))).findings,
    ).toHaveLength(1)
  })

  it('accepts an optional property with a defaultMapping, from 3.2 only', async () => {
    const fallback = { propertyName: 'kind', defaultMapping: 'Cat' }
    expect(
      (await loaded(discriminatorProperty, pets('3.2.0', { kind: {} }, [], fallback))).findings,
    ).toEqual([])
    expect(
      (await loaded(discriminatorProperty, pets('3.1.0', { kind: {} }, [], fallback))).findings,
    ).toHaveLength(1)
  })
})

describe('security-scopes', () => {
  const document = (openapi, security) =>
    doc({
      openapi,
      security,
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              clientCredentials: {
                tokenUrl: 'https://auth.example.com/token',
                scopes: { 'pets:read': 'Read' },
              },
            },
          },
          oidc: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
          },
          key: { type: 'apiKey', name: 'X-Key', in: 'header' },
        },
      },
    })

  it('passes declared scopes, openIdConnect ones, and 3.1 roles', () => {
    const result = run(
      securityScopes,
      document('3.1.0', [{ oauth: ['pets:read'] }, { oidc: ['profile'] }, { key: ['admin'] }]),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a scope no flow declares, and a 3.0 list on a scheme that has no scopes', () => {
    const result = run(
      securityScopes,
      document('3.0.3', [{ oauth: ['pets:write'] }, { key: ['admin'] }]),
    )
    expect(result.findings.map((f) => `${f.dataPath} ${f.params.scope} ${f.params.type}`)).toEqual([
      '/security/0/oauth/0 pets:write oauth2',
      '/security/1/key/0 admin apiKey',
    ])
  })

  it('finds no scheme in what a requirement name inherits', () => {
    const requirement = JSON.parse('{ "__proto__": ["x"], "constructor": ["y"] }')
    const result = run(securityScopes, document('3.0.3', [requirement]))
    expect(result.findings).toEqual([])
  })
})
