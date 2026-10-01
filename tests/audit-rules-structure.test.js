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
