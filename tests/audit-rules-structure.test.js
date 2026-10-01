import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { walkObjects } from '../src/audit/openapi-objects.js'
import { fieldValueKind } from '../src/audit/rules/field-value-kind.js'
import { requiredFieldMissing } from '../src/audit/rules/required-field-missing.js'
import { unknownField } from '../src/audit/rules/unknown-field.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The structural rules of docs/audit.md §4.1: what the specification says an
// object holds, read from the field table of src/audit/openapi-objects.js.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

describe('walkObjects', () => {
  it('types every object of the source, a $ref where an object may stand included', () => {
    const source = doc({
      paths: {
        '/pets': {
          get: {
            parameters: [{ $ref: '#/components/parameters/Limit' }],
            responses: {
              200: {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
              },
            },
          },
        },
      },
      components: {
        parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer' } } },
        schemas: {
          Pet: { type: 'object', properties: { tag: { type: 'string', xml: { name: 't' } } } },
        },
      },
    })
    const typed = walkObjects(source, source, 1).map(({ type, expected, dataPath }) =>
      expected ? `${type}<${expected}> ${dataPath}` : `${type} ${dataPath}`,
    )
    expect(typed).toEqual([
      'OpenAPI ',
      'Info /info',
      'Server /servers/0',
      'Paths /paths',
      'PathItem /paths/~1pets',
      'Operation /paths/~1pets/get',
      'Reference<Parameter> /paths/~1pets/get/parameters/0',
      'Responses /paths/~1pets/get/responses',
      'Response /paths/~1pets/get/responses/200',
      'MediaType /paths/~1pets/get/responses/200/content/application~1json',
      'Reference<Schema> /paths/~1pets/get/responses/200/content/application~1json/schema',
      'Components /components',
      'Schema /components/schemas/Pet',
      'Schema /components/schemas/Pet/properties/tag',
      'XML /components/schemas/Pet/properties/tag/xml',
      'Parameter /components/parameters/Limit',
      'Schema /components/parameters/Limit/schema',
    ])
  })

  it('follows a $ref into another file through the dereferenced document', () => {
    const source = doc({
      paths: {
        '/a': { get: { parameters: [{ $ref: 'common.yaml#/Limit' }], responses: okResponse } },
      },
    })
    const document = structuredClone(source)
    document.paths['/a'].get.parameters[0] = { name: 'limit', in: 'query', descripton: 'typo' }
    const entries = walkObjects(source, document, 1)
    expect(entries.find((e) => e.type === 'Parameter')).toMatchObject({
      dataPath: '/paths/~1a/get/parameters/0',
    })
  })

  const typedPaths = (entries) =>
    entries.map(({ type, expected, dataPath }) =>
      expected ? `${type}<${expected}> ${dataPath}` : `${type} ${dataPath}`,
    )

  it('follows a Path Item split into another file, and types it a Path Item', () => {
    const source = doc({ paths: { '/a': { $ref: './a.yaml' } } })
    const document = structuredClone(source)
    document.paths['/a'] = { get: { descripton: 'typo', responses: okResponse } }
    expect(typedPaths(walkObjects(source, document, 1))).toEqual(
      expect.arrayContaining(['PathItem /paths/~1a', 'Operation /paths/~1a/get']),
    )
    const result = run(unknownField, document, { source })
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/paths/~1a/get/descripton'])
  })

  it('keeps an unread Path Item file as the $ref, for ref-resolves', () => {
    const source = doc({ paths: { '/a': { $ref: './missing.yaml' } } })
    const entries = walkObjects(source, structuredClone(source), 1)
    expect(entries.find((e) => e.dataPath === '/paths/~1a')).toMatchObject({
      type: 'PathItem',
      node: { $ref: './missing.yaml' },
    })
  })

  it('never takes a whole list or map for a Reference', () => {
    const source = doc({
      paths: {
        '/a': {
          get: { parameters: { $ref: '#/components/parameters/P' }, responses: okResponse },
        },
      },
    })
    const typed = typedPaths(walkObjects(source, source, 1))
    expect(typed.some((entry) => entry.includes('/parameters'))).toBe(false)
  })

  it('types a 3.1 Schema $ref with siblings as a Schema too, and walks them', () => {
    const schema = {
      $ref: '#/components/schemas/Pet',
      properties: { name: { maxLenght: 3 } },
    }
    const source = doc({ components: { schemas: { Pet: { type: 'object' }, Named: schema } } })
    expect(typedPaths(walkObjects(source, source, 1))).toEqual(
      expect.arrayContaining([
        'Reference<Schema> /components/schemas/Named',
        'Schema /components/schemas/Named',
        'Schema /components/schemas/Named/properties/name',
      ]),
    )
    // 3.0 ignores a `$ref`'s siblings: a Reference only.
    expect(
      typedPaths(walkObjects(source, source, 0)).filter((entry) => entry.includes('/Named')),
    ).toEqual(['Reference<Schema> /components/schemas/Named'])
  })

  it('types a Media Type $ref as a Reference of the version that allows it', () => {
    const content = { 'application/json': { $ref: '#/components/mediaTypes/Json' } }
    const source = doc({
      paths: { '/a': { get: { responses: { 200: { description: 'OK', content } } } } },
    })
    expect(walkObjects(source, source, 1)).toContainEqual(
      expect.objectContaining({ type: 'Reference', expected: 'MediaType', since: 2 }),
    )
  })
})

describe('unknown-field', () => {
  it('passes fixed fields and extensions', () => {
    const result = run(
      unknownField,
      doc({ 'x-logo': {}, info: { title: 'T', version: '1', 'x-audience': 'public' } }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a field the object does not have, a typo or one a later version removed', () => {
    const result = run(
      unknownField,
      doc({
        openapi: '3.2.0',
        paths: {
          '/pets': {
            get: {
              descripton: 'List pets',
              responses: {
                200: {
                  description: 'OK',
                  headers: { 'X-Rate': { allowEmptyValue: true, schema: {} } },
                },
              },
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.field, f.params.object])).toEqual([
      ['/paths/~1pets/get/descripton', 'descripton', 'Operation'],
      [
        '/paths/~1pets/get/responses/200/headers/X-Rate/allowEmptyValue',
        'allowEmptyValue',
        'Header',
      ],
    ])
    expect(result.findings[0]).toMatchObject({ opRef: 'get-pets', severity: 'error' })
  })

  it('flags a key named like an Object.prototype member', () => {
    const result = run(unknownField, doc({ info: { title: 'T', version: '1', constructor: 'x' } }))
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/info/constructor'])
  })

  it('leaves a 3.1 Media Type $ref to version-construct', () => {
    const content = { 'application/json': { $ref: '#/components/mediaTypes/Json' } }
    const result = run(
      unknownField,
      doc({ paths: { '/a': { get: { responses: { 200: { description: 'OK', content } } } } } }),
    )
    expect(result.findings).toEqual([])
  })

  it('leaves a field of a later version to version-construct, and schemas alone', () => {
    const result = run(
      unknownField,
      doc({
        openapi: '3.0.3',
        info: { title: 'T', summary: 'Later', version: '1' },
        components: { schemas: { Pet: { descripton: 'not mine' } } },
      }),
    )
    expect(result.findings).toEqual([])
  })
})

describe('required-field-missing', () => {
  it('passes a complete document', () => {
    const result = run(
      requiredFieldMissing,
      doc({
        paths: {
          '/pets': { get: { parameters: [{ name: 'a', in: 'query' }], responses: okResponse } },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags each required field absent, by the version and the scheme type', () => {
    const result = run(
      requiredFieldMissing,
      doc({
        openapi: '3.0.3',
        info: { title: 'T' },
        servers: [{ url: 'https://{region}.example.com', variables: { region: { enum: ['eu'] } } }],
        paths: { '/pets': { get: { parameters: [{ name: 'a' }] } } },
        components: { securitySchemes: { key: { type: 'apiKey', in: 'header' } } },
      }),
    )
    expect(
      result.findings.map((f) => `${f.params.object}.${f.params.field} ${f.dataPath}`),
    ).toEqual([
      'Info.version /info',
      'Server Variable.default /servers/0/variables/region',
      'Operation.responses /paths/~1pets/get',
      'Parameter.in /paths/~1pets/get/parameters/0',
      'Security Scheme.name /components/securitySchemes/key',
    ])
  })

  it('leaves a response with neither content nor description to response-substance', () => {
    const responses = { 200: { headers: {} }, 201: { content: { 'text/plain': {} } } }
    const result = run(requiredFieldMissing, doc({ paths: { '/a': { get: { responses } } } }))
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/paths/~1a/get/responses/201'])
    // 3.2 made it optional.
    const later = run(
      requiredFieldMissing,
      doc({ openapi: '3.2.0', paths: { '/a': { get: { responses } } } }),
    )
    expect(later.findings).toEqual([])
  })

  it('asks a 3.1 document for paths, components or webhooks', () => {
    const empty = doc()
    delete empty.paths
    expect(run(requiredFieldMissing, empty).findings[0]).toMatchObject({
      dataPath: '',
      params: { field: 'paths' },
    })
    expect(run(requiredFieldMissing, { ...empty, webhooks: {} }).findings).toEqual([])
  })
})

describe('field-value-kind', () => {
  it('passes values of the right kind', () => {
    const result = run(
      fieldValueKind,
      doc({
        paths: {
          '/pets': {
            get: {
              tags: ['pets'],
              parameters: [
                { name: 'a', in: 'query', style: 'form', schema: { type: ['string', 'null'] } },
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a value of the wrong kind or outside the allowed set', () => {
    const result = run(
      fieldValueKind,
      doc({
        openapi: '3.0.3',
        security: [{ key: 'read' }],
        paths: {
          '/pets': {
            get: {
              tags: 'pets',
              deprecated: 'yes',
              parameters: [
                { name: 'a', in: 'body', schema: { type: 'int' } },
                { name: 'b', in: 'query', style: 'comma', schema: { type: 'string' } },
              ],
              responses: okResponse,
            },
          },
        },
        components: { securitySchemes: { key: { type: 'bearer' } } },
      }),
    )
    expect(
      result.findings.map((f) => `${f.dataPath} ${f.params.value} → ${f.params.expected}`),
    ).toEqual([
      '/paths/~1pets/get/tags "pets" → array of strings',
      '/paths/~1pets/get/deprecated "yes" → boolean',
      '/paths/~1pets/get/parameters/0/in "body" → query | header | path | cookie',
      '/paths/~1pets/get/parameters/0/schema/type "int" → string | number | integer | boolean | array | object',
      '/paths/~1pets/get/parameters/1/style "comma" → matrix | label | simple | form | spaceDelimited | pipeDelimited | deepObject',
      '/components/securitySchemes/key/type "bearer" → apiKey | http | oauth2 | openIdConnect',
      '/security/0/key "read" → array of strings',
    ])
  })

  it('accepts a boolean schema from 3.1 on', () => {
    const boolean = (openapi) =>
      doc({
        openapi,
        paths: {
          '/a': {
            get: {
              responses: {
                200: { description: 'OK', content: { 'application/json': { schema: true } } },
              },
            },
          },
        },
        components: { schemas: { Never: false } },
      })
    expect(run(fieldValueKind, boolean('3.1.0')).findings).toEqual([])
    expect(run(fieldValueKind, boolean('3.0.3')).findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/responses/200/content/application~1json/schema',
      '/components/schemas/Never',
    ])
  })

  it('flags list and map members that are not objects, at the member', () => {
    const result = run(
      fieldValueKind,
      doc({
        security: ['api_key'],
        tags: ['pets'],
        paths: {
          '/pets': { get: { parameters: ['id'], responses: { 200: 'OK', 'x-note': 'n' } } },
          '/owners': 'TODO',
        },
      }),
    )
    expect(
      result.findings.map((f) => `${f.dataPath} ${f.params.field} ${f.params.object}`),
    ).toEqual([
      '/security/0 security[0] OpenAPI',
      '/tags/0 tags[0] OpenAPI',
      '/paths/~1owners /owners Paths',
      '/paths/~1pets/get/parameters/0 parameters[0] Operation',
      '/paths/~1pets/get/responses/200 200 Responses',
    ])
  })

  it('leaves a null map member to field-without-value, and names a key unescaped', () => {
    const result = run(
      fieldValueKind,
      doc({
        security: [{ 'a/b': 'read', key: null }],
        components: {
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: { implicit: { authorizationUrl: 'https://a.b', scopes: { read: null } } },
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.field])).toEqual([
      ['/security/0/a~1b', 'a/b'],
    ])
  })

  it('flags items written as a list', () => {
    const result = run(
      fieldValueKind,
      doc({ components: { schemas: { Pair: { type: 'array', items: [{}, {}] } } } }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.expected])).toEqual([
      ['/components/schemas/Pair/items', 'object'],
    ])
  })

  it('leaves a value only a later version allows to version-construct', () => {
    const result = run(
      fieldValueKind,
      doc({
        openapi: '3.1.0',
        paths: {
          '/a': {
            get: {
              parameters: [{ name: 'q', in: 'querystring', content: {} }],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })
})
