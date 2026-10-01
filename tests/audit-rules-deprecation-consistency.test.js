import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { identifierKey } from '../src/audit/identifier-key.js'
import { deprecatedButRequired } from '../src/audit/rules/deprecated-but-required.js'
import { deprecationHeaderFormat } from '../src/audit/rules/deprecation-header-format.js'
import { operationIdCollision } from '../src/audit/rules/operation-id-collision.js'
import { propertyNameCollision } from '../src/audit/rules/property-name-collision.js'
import { schemaNameCollision } from '../src/audit/rules/schema-name-collision.js'
import { sunsetBeforeDeprecation } from '../src/audit/rules/sunset-before-deprecation.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// A document with `$ref`s, audited as the loader hands it over: the source as
// written, the document dereferenced.
const runWithRefs = (rule, raw) =>
  runRule(rule, auditContext(dereferenceInternal(structuredClone(raw)), { source: raw }))

const withHeaders = (headers, extra = {}) =>
  doc({
    paths: {
      '/pets': { get: { responses: { 200: { description: 'OK', headers } } } },
    },
    ...extra,
  })

describe('identifierKey', () => {
  it('drops case and the separators a generator turns into one identifier', () => {
    const keys = ['getUser', 'get_user', 'GetUser', 'get-user', 'get.user', 'get user']
    expect(new Set(keys.map(identifierKey))).toEqual(new Set(['getuser']))
    expect(identifierKey('Pet.Status')).toBe(identifierKey('pet_status'))
  })

  it('keeps the symbols a generator spells out', () => {
    expect(identifierKey('+1')).not.toBe(identifierKey('-1'))
    expect(identifierKey('@type')).not.toBe(identifierKey('type'))
  })
})

describe('deprecation-header-format', () => {
  it('passes a Structured Field Date, whatever case the header name has', () => {
    const result = run(
      deprecationHeaderFormat,
      withHeaders({ deprecation: { schema: { type: 'string' }, example: '@1688169599' } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a boolean schema, the drafts’ `true`', () => {
    const result = run(
      deprecationHeaderFormat,
      withHeaders({ Deprecation: { schema: { type: 'boolean' } } }),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'deprecation-header-format',
        severity: 'warning',
        category: 'deprecation',
        location: 'GET /pets',
        dataPath: '/paths/~1pets/get/responses/200/headers/Deprecation',
        params: { declared: 'type: boolean' },
      }),
    ])
  })

  it('flags a date format, a non-string type and an example that is no SF Date', () => {
    const cases = [
      [{ schema: { type: 'string', format: 'date-time' } }, 'format: date-time'],
      [{ schema: { type: 'string', format: 'http-date' } }, 'format: http-date'],
      [{ schema: { type: 'integer' } }, 'type: integer'],
      [{ schema: { type: 'string' }, example: 'Sun, 06 Nov 1994 08:49:37 GMT' }, null],
      [{ schema: { type: 'string', example: '2024-06-30' } }, '"2024-06-30"'],
      [{ examples: { now: { value: 'true' } } }, '"true"'],
      [{ schema: { type: 'string' }, example: '@1688169599.5' }, '"@1688169599.5"'],
    ]
    for (const [header, declared] of cases) {
      const result = run(deprecationHeaderFormat, withHeaders({ Deprecation: header }))
      expect(result.findings).toHaveLength(1)
      if (declared) expect(result.findings[0].params).toEqual({ declared })
    }
  })

  it('has nothing to judge without a schema or an example', () => {
    const result = run(deprecationHeaderFormat, withHeaders({ Deprecation: { description: 'x' } }))
    expect(result.checks).toBe(0)
  })

  it('reports a shared header once, at its component', () => {
    const raw = doc({
      paths: {
        '/pets': {
          get: {
            responses: {
              200: {
                description: 'OK',
                headers: { Deprecation: { $ref: '#/components/headers/Deprecated' } },
              },
            },
          },
          delete: {
            responses: {
              204: {
                description: 'Gone',
                headers: { Deprecation: { $ref: '#/components/headers/Deprecated' } },
              },
            },
          },
        },
      },
      components: { headers: { Deprecated: { schema: { type: 'boolean' } } } },
    })
    const result = runWithRefs(deprecationHeaderFormat, raw)
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: '/components/headers/Deprecated',
      location: 'components.headers.Deprecated',
    })
  })
})

describe('sunset-before-deprecation', () => {
  const pair = (deprecation, sunset) =>
    withHeaders({
      Deprecation: { schema: { type: 'string' }, example: deprecation },
      Sunset: { schema: { type: 'string' }, example: sunset },
    })

  it('passes a sunset after the deprecation', () => {
    // @1688169599 is 2023-06-30T23:59:59Z.
    const result = run(
      sunsetBeforeDeprecation,
      pair('@1688169599', 'Sun, 30 Jun 2024 23:59:59 GMT'),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('accepts a sunset at the very instant of the deprecation', () => {
    const result = run(
      sunsetBeforeDeprecation,
      pair('@1688169599', 'Fri, 30 Jun 2023 23:59:59 GMT'),
    )
    expect(result.findings).toEqual([])
  })

  it('flags a sunset earlier than the deprecation, on the Sunset header', () => {
    const result = run(
      sunsetBeforeDeprecation,
      pair('@1688169599', 'Sun, 06 Nov 1994 08:49:37 GMT'),
    )
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'sunset-before-deprecation',
        severity: 'error',
        category: 'deprecation',
        dataPath: '/paths/~1pets/get/responses/200/headers/Sunset',
        params: { sunset: 'Sun, 06 Nov 1994 08:49:37 GMT', deprecation: '@1688169599' },
      }),
    ])
  })

  it('compares only examples that parse', () => {
    for (const [deprecation, sunset] of [
      ['true', 'Sun, 06 Nov 1994 08:49:37 GMT'],
      ['@1688169599', '1994-11-06T08:49:37Z'],
      ['@1688169599', 'Sun, 31 Nov 1994 08:49:37 GMT'],
      ['@1688169599', 'sun, 06 nov 1994 08:49:37 gmt'],
    ]) {
      expect(run(sunsetBeforeDeprecation, pair(deprecation, sunset)).checks).toBe(0)
    }
  })

  it('needs both headers on one response', () => {
    const result = run(
      sunsetBeforeDeprecation,
      withHeaders({ Sunset: { example: 'Sun, 06 Nov 1994 08:49:37 GMT' } }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('deprecated-but-required', () => {
  it('flags a required deprecated parameter, not an optional one nor a path one', () => {
    const result = run(
      deprecatedButRequired,
      doc({
        paths: {
          '/pets/{id}': {
            get: {
              parameters: [
                { name: 'id', in: 'path', required: true, deprecated: true },
                { name: 'legacy', in: 'query', required: true, deprecated: true },
                { name: 'old', in: 'query', deprecated: true },
                { name: 'X-Key', in: 'header', required: true },
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'deprecated-but-required',
        severity: 'warning',
        category: 'deprecation',
        location: 'GET /pets/{id}',
        dataPath: '/paths/~1pets~1{id}/get/parameters/1',
        params: { name: 'legacy' },
      }),
    ])
  })

  it('reports a shared parameter once, at its component', () => {
    const raw = doc({
      paths: {
        '/pets': {
          get: {
            parameters: [{ $ref: '#/components/parameters/Legacy' }],
            responses: okResponse,
          },
          delete: {
            parameters: [{ $ref: '#/components/parameters/Legacy' }],
            responses: okResponse,
          },
        },
      },
      components: {
        parameters: { Legacy: { name: 'legacy', in: 'query', required: true, deprecated: true } },
      },
    })
    const result = runWithRefs(deprecatedButRequired, raw)
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: '/components/parameters/Legacy',
      location: 'components.parameters.Legacy',
    })
  })

  const bodySchema = {
    type: 'object',
    required: ['contexts', 'id', 'checks'],
    properties: {
      contexts: { type: 'array', deprecated: true, items: { type: 'string' } },
      id: { type: 'string', readOnly: true, deprecated: true },
      checks: { type: 'array', items: { type: 'string' } },
      note: { type: 'string', deprecated: true },
    },
  }

  it('flags a required deprecated property of a request body, not a readOnly one', () => {
    const result = run(
      deprecatedButRequired,
      doc({
        paths: {
          '/branches': {
            put: {
              requestBody: { content: { 'application/json': { schema: bodySchema } } },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toEqual([
      expect.objectContaining({
        location: 'PUT /branches',
        dataPath:
          '/paths/~1branches/put/requestBody/content/application~1json/schema/properties/contexts',
        params: { name: 'contexts' },
      }),
    ])
  })

  it('leaves response bodies and webhooks alone', () => {
    const result = run(
      deprecatedButRequired,
      doc({
        paths: {
          '/branches': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: { 'application/json': { schema: bodySchema } },
                },
              },
            },
          },
        },
        webhooks: {
          branch: {
            post: {
              parameters: [{ name: 'legacy', in: 'query', required: true, deprecated: true }],
              requestBody: {
                content: { 'application/json': { schema: structuredClone(bodySchema) } },
              },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(0)
  })

  it('reports a property of a shared request schema at the component', () => {
    const raw = doc({
      paths: {
        '/branches': {
          put: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Branch' } } },
            },
            responses: okResponse,
          },
        },
      },
      components: { schemas: { Branch: bodySchema } },
    })
    const result = runWithRefs(deprecatedButRequired, raw)
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/components/schemas/Branch/properties/contexts',
    ])
    expect(result.findings[0].location).toBe('components.schemas.Branch')
  })
})

describe('operation-id-collision', () => {
  const operations = (...ids) =>
    doc({
      paths: Object.fromEntries(
        ids.map((operationId, index) => [
          `/r${index}`,
          { get: { operationId, responses: okResponse } },
        ]),
      ),
    })

  it('passes distinct identifiers', () => {
    const result = run(operationIdCollision, operations('getUser', 'listUsers', 'getUserById'))
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('flags each later spelling of one identifier', () => {
    const result = run(
      operationIdCollision,
      operations('getUser', 'get_user', 'GetUser', 'get-user'),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((finding) => finding.params)).toEqual([
      { operationId: 'get_user', other: 'getUser' },
      { operationId: 'GetUser', other: 'getUser' },
      { operationId: 'get-user', other: 'getUser' },
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'operation-id-collision',
      severity: 'warning',
      category: 'consistency',
      location: 'GET /r1',
      dataPath: '/paths/~1r1/get/operationId',
    })
  })

  it('leaves identical strings to duplicate-operation-id', () => {
    const result = run(operationIdCollision, operations('getUser', 'getUser'))
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('skips operations without an operationId', () => {
    const result = run(operationIdCollision, operations(undefined, '  ', 42))
    expect(result.checks).toBe(0)
  })
})

describe('property-name-collision', () => {
  const schemaDoc = (properties) =>
    doc({ components: { schemas: { User: { type: 'object', properties } } } })

  it('passes properties with distinct identifiers, `+1` and `-1` included', () => {
    const result = run(propertyNameCollision, schemaDoc({ id: {}, name: {}, '+1': {}, '-1': {} }))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags every later name sharing a key, in one check per schema', () => {
    const result = run(
      propertyNameCollision,
      schemaDoc({ user_id: {}, userId: {}, name: {}, 'user-id': {} }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'property-name-collision',
        severity: 'warning',
        category: 'consistency',
        location: 'components.schemas.User',
        dataPath: '/components/schemas/User/properties/userId',
        params: { name: 'userId', other: 'user_id' },
      }),
      expect.objectContaining({
        dataPath: '/components/schemas/User/properties/user-id',
        params: { name: 'user-id', other: 'user_id' },
      }),
    ])
  })

  it('has nothing to compare in a schema with one property', () => {
    expect(run(propertyNameCollision, schemaDoc({ id: {} })).checks).toBe(0)
  })
})

describe('schema-name-collision', () => {
  const schemas = (...names) =>
    doc({ components: { schemas: Object.fromEntries(names.map((name) => [name, {}])) } })

  it('passes distinct names', () => {
    const result = run(schemaNameCollision, schemas('Pet', 'PetStatus', 'Owner'))
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  it('flags every later name generating the same type', () => {
    const result = run(schemaNameCollision, schemas('Pet.Status', 'pet_status', 'PetStatus'))
    expect(result.checks).toBe(3)
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'schema-name-collision',
        severity: 'warning',
        category: 'consistency',
        location: 'components.schemas.pet_status',
        dataPath: '/components/schemas/pet_status',
        params: { name: 'pet_status', other: 'Pet.Status' },
      }),
      expect.objectContaining({ params: { name: 'PetStatus', other: 'Pet.Status' } }),
    ])
  })
})
