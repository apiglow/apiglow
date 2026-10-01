import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { defaultAllowed } from '../src/audit/rules/default-allowed.js'
import { discriminatorMapping } from '../src/audit/rules/discriminator-mapping.js'
import { duplicateOperationId } from '../src/audit/rules/duplicate-operation-id.js'
import { exampleTypeMismatch } from '../src/audit/rules/example-type-mismatch.js'
import { fieldWithoutValue } from '../src/audit/rules/field-without-value.js'
import { linkTarget } from '../src/audit/rules/link-target.js'
import { pathParamDeclared } from '../src/audit/rules/path-param-declared.js'
import { pathParamInTemplate } from '../src/audit/rules/path-param-in-template.js'
import { pathParamRequired } from '../src/audit/rules/path-param-required.js'
import { requiredPropertyDeclared } from '../src/audit/rules/required-property-declared.js'
import { responseSubstance } from '../src/audit/rules/response-substance.js'
import { securitySchemeDeclared } from '../src/audit/rules/security-scheme-declared.js'
import { requiredWithDefault } from '../src/audit/rules/required-with-default.js'
import { unusedComponent } from '../src/audit/rules/unused-component.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

describe('duplicate-operation-id', () => {
  it('passes on distinct ids', () => {
    const result = run(
      duplicateOperationId,
      doc({
        paths: {
          '/a': { get: { operationId: 'a', responses: okResponse } },
          '/b': { get: { operationId: 'b', responses: okResponse } },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags both operations sharing an id, and ignores the ones without', () => {
    const result = run(
      duplicateOperationId,
      doc({
        paths: {
          '/a': { get: { operationId: 'same', responses: okResponse } },
          '/b': { get: { operationId: 'same', responses: okResponse } },
          '/c': { get: { responses: okResponse } },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings).toHaveLength(2)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'duplicate-operation-id',
      severity: 'error',
      category: 'correctness',
      location: 'GET /a',
      opRef: 'same',
      dataPath: '/paths/~1a/get/operationId',
      params: { operationId: 'same' },
    })
  })
})

describe('path-param-declared', () => {
  const document = (parameters) =>
    doc({ paths: { '/pets/{petId}': { get: { parameters, responses: okResponse } } } })

  it('passes when every template has its parameter', () => {
    const result = run(pathParamDeclared, document([{ name: 'petId', in: 'path', required: true }]))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a template with no parameter', () => {
    const result = run(pathParamDeclared, document([{ name: 'other', in: 'query' }]))
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'path-param-declared',
      params: { name: 'petId' },
      dataPath: '/paths/~1pets~1{petId}/get',
    })
  })

  it('accepts a parameter inherited from the Path Item', () => {
    const result = run(
      pathParamDeclared,
      doc({
        paths: {
          '/pets/{petId}': {
            parameters: [{ name: 'petId', in: 'path', required: true }],
            get: { responses: okResponse },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('leaves a key path-syntax rejects to that rule', () => {
    const result = run(
      pathParamDeclared,
      doc({ paths: { '/pets/{petId}/{petId}': { get: { responses: okResponse } } } }),
    )
    expect(result.checks).toBe(0)
  })

  it('skips webhooks, whose key is a name and not a template', () => {
    const result = run(
      pathParamDeclared,
      doc({ webhooks: { 'pet{Status}': { post: { responses: okResponse } } } }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('path-param-in-template', () => {
  it('passes when the declared parameter is in the template', () => {
    const result = run(
      pathParamInTemplate,
      doc({
        paths: {
          '/pets/{petId}': {
            get: {
              parameters: [{ name: 'petId', in: 'path', required: true }],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a path parameter absent from the template', () => {
    const result = run(
      pathParamInTemplate,
      doc({
        paths: {
          '/pets/{petId}': {
            get: {
              parameters: [
                { name: 'petId', in: 'path', required: true },
                { name: 'ownerId', in: 'path', required: true },
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
      params: { name: 'ownerId' },
      dataPath: '/paths/~1pets~1{petId}/get/parameters/1',
    })
  })
})

describe('path-param-in-template (malformed key)', () => {
  it('leaves a key path-syntax rejects to that rule', () => {
    const result = run(
      pathParamInTemplate,
      doc({
        paths: {
          '/pets/{petId': {
            get: {
              parameters: [{ name: 'petId', in: 'path', required: true }],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(0)
  })
})

describe('path-param-required', () => {
  it('passes on required: true', () => {
    const result = run(
      pathParamRequired,
      doc({
        paths: {
          '/pets/{petId}': {
            get: {
              parameters: [{ name: 'petId', in: 'path', required: true }],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a path parameter that omits required, at its declaration site', () => {
    const result = run(
      pathParamRequired,
      doc({
        paths: {
          '/pets/{petId}': {
            parameters: [{ name: 'petId', in: 'path' }],
            get: { responses: okResponse },
          },
        },
      }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'path-param-required',
      dataPath: '/paths/~1pets~1{petId}/parameters/0',
      params: { name: 'petId' },
    })
  })
})

describe('required-property-declared', () => {
  const withSchema = (schema) => doc({ components: { schemas: { Pet: schema } } })

  it('passes when every required name is a property', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({ type: 'object', required: ['id'], properties: { id: { type: 'string' } } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a required property that is declared nowhere', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' } },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'required-property-declared',
      severity: 'error',
      location: 'components.schemas.Pet',
      opRef: null,
      dataPath: '/components/schemas/Pet/required/1',
      params: { name: 'name' },
    })
  })

  it('counts what an allOf member or a oneOf branch declares, and what a pattern matches', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        required: ['id', 'kind', 'x-trace'],
        properties: {},
        allOf: [{ type: 'object', properties: { id: { type: 'string' } } }],
        oneOf: [{ properties: { kind: { const: 'a' } } }, { properties: { kind: { const: 'b' } } }],
        patternProperties: { '^x-': { type: 'string' } },
      }),
    )
    expect(result).toMatchObject({ checks: 3, findings: [] })
  })

  // A branch requiring what its parent lists, an allOf member requiring what
  // a sibling defines: the usual way to write a variant.
  it('counts what the schema it is composed into declares', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        type: 'object',
        properties: { status: { type: 'string' }, conclusion: { type: 'string' } },
        oneOf: [{ required: ['status', 'conclusion'] }, { required: ['status', 'missing'] }],
        allOf: [{ properties: { id: { type: 'string' } } }, { required: ['id'] }],
      }),
    )
    expect(result.checks).toBe(5)
    expect(result.findings.map((finding) => [finding.dataPath, finding.params])).toEqual([
      ['/components/schemas/Pet/oneOf/1/required/1', { name: 'missing' }],
    ])
  })

  it('checks the names dependentRequired lists', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        type: 'object',
        properties: { cardNumber: { type: 'string' } },
        dependentRequired: { cardNumber: ['cvv'] },
      }),
    )
    expect(result.findings[0]).toMatchObject({
      dataPath: '/components/schemas/Pet/dependentRequired/cardNumber/0',
      params: { name: 'cvv' },
    })
  })

  it('skips a free-form object with no properties at all', () => {
    const result = run(requiredPropertyDeclared, withSchema({ type: 'object', required: ['id'] }))
    expect(result.checks).toBe(0)
  })

  it('flags every required name of an object that declares none and admits no other', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({ type: 'object', required: ['id'], additionalProperties: false }),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('never counts what a sibling branch declares', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        oneOf: [{ properties: { a: {} }, required: ['b'] }, { properties: { b: {} } }],
      }),
    )
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/components/schemas/Pet/oneOf/0/required/0',
    ])
  })

  it('lets an unresolved $ref member declare anything', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        properties: { a: {} },
        allOf: [{ $ref: '#/components/schemas/Missing' }],
        required: ['a', 'b'],
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })
})

describe('example-type-mismatch', () => {
  const parameterExample = (schema, example) =>
    doc({
      paths: {
        '/pets': {
          get: {
            parameters: [{ name: 'limit', in: 'query', schema, example }],
            responses: okResponse,
          },
        },
      },
    })

  it('passes on a value of the declared type', () => {
    const result = run(exampleTypeMismatch, parameterExample({ type: 'integer' }, 10))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a parameter example of the wrong type', () => {
    const result = run(exampleTypeMismatch, parameterExample({ type: 'integer' }, 'ten'))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'example-type-mismatch',
      severity: 'error',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/parameters/0/example',
      params: { value: '"ten"', keyword: 'type', at: '$' },
    })
  })

  it('flags a value outside the declared enum', () => {
    const result = run(
      exampleTypeMismatch,
      parameterExample({ type: 'string', enum: ['asc', 'desc'] }, 'up'),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('checks the named examples of a media type', () => {
    const result = run(
      exampleTypeMismatch,
      doc({
        paths: {
          '/pets': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: { type: 'object' },
                    examples: {
                      ok: { value: { name: 'Kitty' } },
                      broken: { value: 'Kitty' },
                      remote: { externalValue: 'https://example.com/pet.json' },
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
    expect(result.checks).toBe(2)
    expect(result.findings[0].dataPath).toBe(
      '/paths/~1pets/post/requestBody/content/application~1json/examples/broken/value',
    )
  })

  it('checks a schema-level example, and accepts an untyped schema', () => {
    const flagged = run(
      exampleTypeMismatch,
      doc({ components: { schemas: { Pet: { type: 'object', example: [] } } } }),
    )
    expect(flagged.findings[0]).toMatchObject({
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/example',
    })
    const untyped = run(
      exampleTypeMismatch,
      doc({ components: { schemas: { Pet: { example: 'anything' } } } }),
    )
    expect(untyped.checks).toBe(0)
  })

  it('accepts null when the schema is nullable, in either spelling', () => {
    const v30 = run(
      exampleTypeMismatch,
      doc({ components: { schemas: { A: { type: 'string', nullable: true, example: null } } } }),
    )
    const v31 = run(
      exampleTypeMismatch,
      doc({ components: { schemas: { A: { type: ['string', 'null'], example: null } } } }),
    )
    expect(v30.findings).toEqual([])
    expect(v31.findings).toEqual([])
  })
})

describe('example-type-mismatch — in depth', () => {
  const component = (schema) => doc({ components: { schemas: { Pet: schema } } })
  const bodies = (schema, request, response) =>
    doc({
      paths: {
        '/pets': {
          post: {
            requestBody: { content: { 'application/json': { schema, example: request } } },
            responses: {
              201: {
                description: 'Created',
                content: { 'application/json': { schema, example: response } },
              },
            },
          },
        },
      },
    })
  const pet = {
    type: 'object',
    required: ['id', 'name', 'password'],
    properties: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', maxLength: 5 },
      password: { type: 'string', writeOnly: true },
      tags: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
    },
  }
  const findings = (result) => result.findings.map(({ severity, params }) => [severity, params])

  it('names the keyword broken and where, as a JSONPath into the value', () => {
    const result = run(
      exampleTypeMismatch,
      component({ ...pet, required: [], example: { name: 'Rex', tags: [{ name: 7 }] } }),
    )
    expect(findings(result)).toEqual([
      [
        'error',
        { value: '{"name":"Rex","tags":[{"name":7}]}', keyword: 'type', at: '$.tags[0].name' },
      ],
    ])
  })

  it('counts lengths in code points', () => {
    const result = run(
      exampleTypeMismatch,
      component({ ...pet, required: [], example: { name: '🐶🐶🐶🐶🐶' } }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('owes no readOnly member in a request, no writeOnly one in a response', () => {
    const result = run(
      exampleTypeMismatch,
      bodies(pet, { name: 'Rex', password: 'x' }, { id: 1, name: 'Rex' }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
    const swapped = run(
      exampleTypeMismatch,
      bodies(pet, { id: 1, name: 'Rex' }, { name: 'Rex', password: 'x' }),
    )
    expect(swapped.findings.map((finding) => finding.params.at)).toEqual(['$.password', '$.id'])
  })

  it('owes neither in a component example, which has no direction', () => {
    const result = run(exampleTypeMismatch, component({ ...pet, example: { name: 'Rex' } }))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('grades a broken format alone as a warning', () => {
    const result = run(
      exampleTypeMismatch,
      component({
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time' },
          id: { type: 'string', format: 'uuid' },
          site: { type: 'string', format: 'uri' },
          count: { type: 'integer', format: 'int32' },
        },
        example: { at: '2026-02-30T10:00:00Z', id: '0b1c', site: 'example.com', count: 2 ** 31 },
      }),
    )
    expect(findings(result)).toEqual([
      ['warning', expect.objectContaining({ keyword: 'format', at: '$.at' })],
    ])
    const valid = run(
      exampleTypeMismatch,
      component({
        type: 'object',
        properties: {
          at: { type: 'string', format: 'date-time' },
          day: { type: 'string', format: 'date' },
          time: { type: 'string', format: 'time' },
          ip: { type: 'string', format: 'ipv6' },
          mail: { type: 'string', format: 'email' },
          other: { type: 'string', format: 'hostname' },
        },
        example: {
          at: '2024-02-29t23:59:60.5+01:00',
          day: '2024-02-29',
          time: '08:30:00Z',
          ip: '::1',
          mail: 'a@b',
          other: '!!',
        },
      }),
    )
    expect(valid.findings).toEqual([])
  })

  it('reads patterns, bounds, sizes and closed objects', () => {
    const cases = [
      [{ type: 'string', pattern: '^[a-z]+$' }, 'ABC', 'pattern'],
      [{ type: 'number', multipleOf: 0.1 }, 0.35, 'multipleOf'],
      [{ type: 'integer', minimum: 0, exclusiveMinimum: true }, 0, 'exclusiveMinimum'],
      [{ type: 'array', items: { type: 'string' }, uniqueItems: true }, ['a', 'a'], 'uniqueItems'],
      [{ type: 'object', maxProperties: 1 }, { a: 1, b: 2 }, 'maxProperties'],
      [
        { type: 'object', properties: { a: {} }, additionalProperties: false },
        { b: 1 },
        'additionalProperties',
      ],
      [{ type: 'object', additionalProperties: { type: 'integer' } }, { b: 'x' }, 'type'],
      [
        { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'integer' } },
        ['a', 'b'],
        'type',
      ],
      [{ const: 'fixed' }, 'other', 'const'],
    ]
    for (const [schema, example, keyword] of cases) {
      const result = run(exampleTypeMismatch, component({ ...schema, example }))
      expect(result.findings.map((finding) => finding.params.keyword)).toEqual([keyword])
    }
    expect(
      run(exampleTypeMismatch, component({ type: 'number', multipleOf: 0.1, example: 0.3 }))
        .findings,
    ).toEqual([])
  })

  it('judges a composition: allOf member by member, oneOf/anyOf only when every branch fails', () => {
    const variants = {
      oneOf: [
        { type: 'string' },
        { type: 'object', required: ['kind'], properties: { kind: { type: 'string' } } },
      ],
    }
    expect(run(exampleTypeMismatch, component({ ...variants, example: 'a' })).findings).toEqual([])
    const missed = run(exampleTypeMismatch, component({ ...variants, example: { kind: 1 } }))
    // The branch the value got furthest into says why.
    expect(missed.findings[0].params).toMatchObject({ keyword: 'type', at: '$.kind' })
    const neither = run(exampleTypeMismatch, component({ ...variants, example: 3 }))
    expect(neither.findings[0].params).toMatchObject({ keyword: 'oneOf', at: '$' })
    const all = run(
      exampleTypeMismatch,
      component({ allOf: [{ type: 'object' }, { required: ['id'] }], example: {} }),
    )
    expect(all.findings[0].params).toMatchObject({ keyword: 'required', at: '$.id' })
  })

  it('gives no verdict on what it does not read', () => {
    for (const schema of [
      { not: { type: 'string' } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
      { if: { type: 'string' }, then: { minLength: 9 } },
      { $ref: '#/components/schemas/Missing' },
      { type: 'string', pattern: '(' },
      { type: 'string', format: 'hostname' },
      { type: 'string', nullable: true, enum: ['a'] },
    ]) {
      const example = schema.nullable ? null : 'x'
      expect(run(exampleTypeMismatch, component({ ...schema, example })).findings).toEqual([])
    }
  })

  it('leaves a lone $ref example to example-has-ref', () => {
    const result = run(
      exampleTypeMismatch,
      component({ type: 'string', example: { $ref: '#/components/examples/Pet' } }),
    )
    expect(result.checks).toBe(0)
  })

  it('reads readOnly / writeOnly on the allOf member a required list names', () => {
    const composed = { allOf: [pet, { required: ['id', 'name', 'password'] }] }
    const result = run(
      exampleTypeMismatch,
      bodies(composed, { name: 'Rex', password: 'x' }, { id: 1, name: 'Rex' }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
    const own = run(exampleTypeMismatch, component({ ...composed, example: { name: 'Rex' } }))
    expect(own.findings).toEqual([])
  })

  it('takes the direction from where the example sits, not from a property name', () => {
    const nested = { type: 'object', required: ['id'], properties: { id: pet.properties.id } }
    const shaped = { type: 'object', properties: { responses: { ...nested, example: {} } } }
    const result = run(exampleTypeMismatch, bodies(shaped))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('owes neither in a webhook, whose request the API sends', () => {
    const result = run(
      exampleTypeMismatch,
      doc({
        webhooks: {
          newPet: {
            post: {
              requestBody: {
                content: { 'application/json': { schema: pet, example: { id: 1, name: 'Rex' } } },
              },
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('places a 3.2 dataValue at dataValue', () => {
    const result = run(
      exampleTypeMismatch,
      doc({
        openapi: '3.2.0',
        paths: {
          '/pets': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'integer' },
                      examples: { broken: { dataValue: 'x' } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/paths/~1pets/get/responses/200/content/application~1json/examples/broken/dataValue',
    ])
  })

  it('checks a parameter serialized by media type, and a response header', () => {
    const result = run(
      exampleTypeMismatch,
      doc({
        openapi: '3.2.0',
        paths: {
          '/pets': {
            get: {
              parameters: [
                {
                  in: 'querystring',
                  name: 'filter',
                  content: {
                    'application/json': {
                      schema: { type: 'object', properties: { limit: { type: 'integer' } } },
                      example: { limit: 'ten' },
                    },
                  },
                },
                {
                  in: 'query',
                  name: 'sort',
                  content: { 'application/json': { schema: { type: 'string' } } },
                  example: 3,
                },
              ],
              responses: {
                200: {
                  description: 'OK',
                  headers: {
                    'X-Rate-Limit': { schema: { type: 'integer' }, example: 'many' },
                    'X-Trace': {
                      content: { 'text/plain': { schema: { type: 'string' }, example: 'abc' } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(4)
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/paths/~1pets/get/parameters/0/content/application~1json/example',
      '/paths/~1pets/get/parameters/1/example',
      '/paths/~1pets/get/responses/200/headers/X-Rate-Limit/example',
    ])
  })
})

describe('default-allowed', () => {
  const withSchema = (schema) => doc({ components: { schemas: { A: schema } } })

  it('passes on a default the schema allows', () => {
    const result = run(defaultAllowed, withSchema({ type: 'integer', minimum: 1, default: 5 }))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a default below the minimum', () => {
    const result = run(defaultAllowed, withSchema({ type: 'integer', minimum: 1, default: 0 }))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'default-allowed',
      dataPath: '/components/schemas/A/default',
      params: { value: '0', keyword: 'minimum', at: '$' },
    })
  })

  it('flags a default outside the enum', () => {
    const result = run(defaultAllowed, withSchema({ enum: ['asc', 'desc'], default: 'up' }))
    expect(result.findings).toHaveLength(1)
  })

  it('reads the 3.0 boolean form of exclusiveMinimum', () => {
    const result = run(
      defaultAllowed,
      withSchema({ type: 'integer', minimum: 0, exclusiveMinimum: true, default: 0 }),
    )
    expect(result.findings).toHaveLength(1)
  })

  it('reads the type, lengths, pattern and formats too', () => {
    const cases = [
      [{ type: 'integer', default: '10' }, 'type', 'error'],
      [{ type: 'string', maxLength: 2, default: 'abc' }, 'maxLength', 'error'],
      [{ type: 'string', pattern: '^v\\d+$', default: 'x1' }, 'pattern', 'error'],
      [{ type: 'string', format: 'uri', default: '' }, 'format', 'warning'],
    ]
    for (const [schema, keyword, severity] of cases) {
      const [finding] = run(defaultAllowed, withSchema(schema)).findings
      expect(finding).toMatchObject({ severity, params: { keyword, at: '$' } })
    }
  })

  it('has nothing to check on a schema that constrains nothing', () => {
    const result = run(defaultAllowed, withSchema({ description: 'Free', default: 'anything' }))
    expect(result.checks).toBe(0)
  })
})

describe('required-with-default', () => {
  it('passes on a required parameter with no default, and ignores an optional one', () => {
    const result = run(
      requiredWithDefault,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [
                { name: 'status', in: 'query', required: true, schema: { type: 'string' } },
                {
                  name: 'limit',
                  in: 'query',
                  schema: { type: 'integer', default: 20 },
                },
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a required parameter whose schema carries a default', () => {
    const result = run(
      requiredWithDefault,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [
                {
                  name: 'status',
                  in: 'query',
                  required: true,
                  schema: { type: 'string', default: 'available' },
                },
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'required-with-default',
      severity: 'info',
      category: 'correctness',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/parameters/0',
      params: { name: 'status' },
    })
  })

  it('flags the same contradiction spelled as a required property', () => {
    const result = run(
      requiredWithDefault,
      doc({
        paths: {
          '/pets': {
            post: {
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['name', 'ghost'],
                      properties: {
                        name: { type: 'string', default: 'doggie' },
                        status: { type: 'string', default: 'available' },
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
    // `status` is optional and `ghost` is declared nowhere (another rule's
    // finding): one check, one finding, on `name`.
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      dataPath: '/paths/~1pets/post/requestBody/content/application~1json/schema/properties/name',
      params: { name: 'name' },
    })
  })
})

describe('unused-component', () => {
  // The source keeps its $refs — that is the whole point of this rule.
  const source = doc({
    paths: {
      '/pets': {
        get: {
          responses: { 200: { $ref: '#/components/responses/Ok' } },
          security: [{ apiKey: [] }],
        },
      },
    },
    components: {
      schemas: { Pet: { type: 'object' }, Ghost: { type: 'object' } },
      responses: {
        Ok: {
          description: 'OK',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
      },
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' },
        unusedScheme: { type: 'http', scheme: 'basic' },
      },
      requestBodies: {
        PetBody: {
          description: 'A pet',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
      },
    },
  })

  it('flags only what nothing references, in every components section', () => {
    const result = run(unusedComponent, source)
    expect(result.checks).toBe(6)
    expect(result.findings.map((finding) => finding.params)).toEqual([
      { section: 'schemas', name: 'Ghost' },
      // A request body nothing `$ref`s is as dead as a schema nothing `$ref`s —
      // and was invisible to this rule until the sections list followed the spec.
      { section: 'requestBodies', name: 'PetBody' },
      { section: 'securitySchemes', name: 'unusedScheme' },
    ])
    expect(result.findings[0]).toMatchObject({
      severity: 'warning',
      location: 'components.schemas.Ghost',
      dataPath: '/components/schemas/Ghost',
      opRef: null,
    })
  })
})

describe('security-scheme-declared', () => {
  const document = (security) =>
    doc({
      paths: { '/pets': { get: { security, responses: okResponse } } },
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Key' } } },
    })

  it('accepts a declared scheme, and ignores the empty requirement', () => {
    const result = run(securitySchemeDeclared, document([{ apiKey: [] }, {}]))
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })

  it('flags a requirement naming an undeclared scheme', () => {
    const result = run(securitySchemeDeclared, document([{ ghost: ['read'] }]))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'security-scheme-declared',
      severity: 'error',
      location: 'GET /pets',
      dataPath: '/paths/~1pets/get/security',
      params: { name: 'ghost' },
    })
  })

  it('checks the document-level security too', () => {
    const result = run(
      securitySchemeDeclared,
      doc({ security: [{ ghost: [] }], paths: { '/pets': { get: { responses: okResponse } } } }),
    )
    expect(result.findings[0]).toMatchObject({ location: 'security', dataPath: '/security' })
  })
})

describe('response-substance', () => {
  const withResponses = (responses) => doc({ paths: { '/pets': { get: { responses } } } })

  it('passes on a described response and on a response with content', () => {
    const result = run(
      responseSubstance,
      withResponses({
        200: { description: 'OK' },
        201: { content: { 'application/json': { schema: { type: 'object' } } } },
        202: { content: { 'application/json': { example: { id: 1 } } } },
        // 3.2: summary alone is substance.
        404: { summary: 'Not found' },
      }),
    )
    expect(result).toMatchObject({ checks: 4, findings: [] })
  })

  // A file or plain text says what the payload is by its type alone.
  it('counts a file or plain-text media type as content on its own', () => {
    const result = run(
      responseSubstance,
      withResponses({
        200: { content: { 'text/plain': {} } },
        201: { content: { 'image/png': {} } },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('does not count content that says nothing: a structured media type or a range left empty', () => {
    const result = run(
      responseSubstance,
      withResponses({
        200: { content: { 'application/json': {} } },
        201: { content: { '*/*': {} } },
        202: { content: { 'application/xml': { examples: {} } } },
        203: { content: { 'application/yaml': {} } },
        204: { content: { 'application/openapi+yaml': {} } },
      }),
    )
    expect(result.findings.map((f) => f.params.status)).toEqual(['200', '201', '202', '203', '204'])
  })

  it('flags a response with neither description nor content', () => {
    const result = run(responseSubstance, withResponses({ 500: { description: '  ' } }))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'response-substance',
      severity: 'warning',
      dataPath: '/paths/~1pets/get/responses/500',
      params: { status: '500' },
    })
  })
})

// Same resolution as `buildDiscriminator` in the model, on a dereferenced
// document: the fixture shares object identity the way ref-parser leaves it.
describe('discriminator-mapping', () => {
  const polymorphic = (mapping, extra = {}) => {
    const Cat = { type: 'object', properties: { petType: { type: 'string' } } }
    return doc({
      components: {
        schemas: {
          Pet: { oneOf: [Cat], discriminator: { propertyName: 'petType', mapping }, ...extra },
          Cat,
        },
      },
    })
  }

  it('checks nothing on a discriminator with no mapping', () => {
    expect(run(discriminatorMapping, polymorphic(undefined)).checks).toBe(0)
  })

  it('accepts both target spellings of a real variant', () => {
    const result = run(
      discriminatorMapping,
      polymorphic({ cat: 'Cat', feline: '#/components/schemas/Cat' }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('notes a key whose target is none of the variants', () => {
    const result = run(discriminatorMapping, polymorphic({ bird: 'Bird' }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'discriminator-mapping',
      severity: 'info',
      category: 'correctness',
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/discriminator/mapping/bird',
      params: { key: 'bird', target: 'Bird' },
    })
  })

  // Parent-side idiom: nothing lists the subtypes, they point back through
  // `allOf` — a mapping target found that way must not be flagged.
  it('resolves the subtypes of a parent that declares no variants', () => {
    const Animal = {
      type: 'object',
      properties: { species: { type: 'string' } },
      discriminator: { propertyName: 'species', mapping: { feline: 'Kitten', canine: 'Puppy' } },
    }
    const result = run(
      discriminatorMapping,
      doc({
        components: {
          schemas: {
            Animal,
            Kitten: { allOf: [Animal, { type: 'object' }] },
          },
        },
      }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings.map((finding) => finding.params.key)).toEqual(['canine'])
  })
})

describe('link-target', () => {
  const linked = (links) =>
    doc({
      paths: {
        '/pets': {
          post: { operationId: 'createPet', responses: { 201: { description: 'ok', links } } },
        },
        '/pets/{petId}': {
          get: { operationId: 'getPet', responses: okResponse },
          delete: { responses: okResponse },
        },
      },
    })

  it('accepts an operationId this document declares', () => {
    expect(run(linkTarget, linked({ Read: { operationId: 'getPet' } }))).toMatchObject({
      checks: 1,
      findings: [],
    })
  })

  it('accepts a same-document operationRef, fallback route id included', () => {
    const result = run(
      linkTarget,
      linked({
        Read: { operationRef: '#/paths/~1pets~1{petId}/get' },
        // No operationId on the target: the pointer is the only way to name it.
        Drop: { operationRef: '#/paths/~1pets~1%7BpetId%7D/delete' },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('checks nothing on a target it cannot judge', () => {
    const result = run(
      linkTarget,
      linked({
        // Another document: legitimate, and not something we can follow.
        Elsewhere: { operationRef: 'https://other.example.com/api.json#/paths/~1x/get' },
        // Neither field: an invalid Link Object, a validator's business.
        Empty: { description: 'nothing declared' },
      }),
    )
    expect(result.checks).toBe(0)
  })

  it('flags an operationId no operation carries', () => {
    const result = run(linkTarget, linked({ Read: { operationId: 'noSuchOperation' } }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'link-target',
      severity: 'warning',
      category: 'correctness',
      location: 'POST /pets',
      opRef: 'createPet',
      dataPath: '/paths/~1pets/post/responses/201/links/Read',
      params: { link: 'Read', target: 'noSuchOperation' },
    })
  })

  it('flags a same-document pointer that resolves to nothing', () => {
    const result = run(linkTarget, linked({ Read: { operationRef: '#/paths/~1nope/get' } }))
    expect(result.findings.map((finding) => finding.params.target)).toEqual(['#/paths/~1nope/get'])
  })

  // The hide filter is documentation-level: a hidden operation is still
  // declared, so the link is correct even though the doc shows no page for it.
  it('accepts a link at a hidden operation', () => {
    const result = run(linkTarget, linked({ Read: { operationId: 'getPet' } }), {
      hide: ['getPet'],
    })
    expect(result).toMatchObject({ checks: 1, findings: [] })
  })
})

describe('field-without-value', () => {
  // What a YAML flow mapping cut by an unquoted comma parses to:
  // `{ type: string, description: The signed mandate, as uploaded by the client }`.
  const cut = {
    type: 'string',
    description: 'The signed mandate',
    'as uploaded by the client': null,
  }

  it('flags the empty field a cut flow mapping leaves, linked to its operation', () => {
    const result = run(
      fieldWithoutValue,
      doc({
        paths: {
          '/mandates/{id}': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'object', properties: { pdf: cut } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    expect(result.checks).toBe(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'field-without-value',
      severity: 'error',
      category: 'correctness',
      location: 'GET /mandates/{id}',
      dataPath:
        '/paths/~1mandates~1{id}/get/responses/200/content/application~1json/schema/properties/pdf/as uploaded by the client',
      params: { field: 'as uploaded by the client' },
    })
  })

  it('names the component outside an operation, once however often it is used', () => {
    const result = run(
      fieldWithoutValue,
      doc({
        info: { title: 'A', version: '1', description: null },
        components: { schemas: { Mandate: cut } },
      }),
    )
    expect(result.findings.map(({ location, dataPath }) => ({ location, dataPath }))).toEqual([
      { location: 'info.description', dataPath: '/info/description' },
      {
        location: 'components.schemas.Mandate',
        dataPath: '/components/schemas/Mandate/as uploaded by the client',
      },
    ])
  })

  it('has nothing to check on a document with every field filled', () => {
    expect(
      run(fieldWithoutValue, doc({ components: { schemas: { Pet: { type: 'object' } } } })).checks,
    ).toBe(0)
  })

  // The fields whose value is any JSON value, and the payloads under them: an
  // example's nulls are the API's data.
  it('leaves alone what takes any value, nulls included', () => {
    const schema = {
      type: ['string', 'null'],
      enum: ['a', null],
      default: null,
      const: null,
      example: null,
      examples: [{ deleted: null }],
      'x-owner': null,
    }
    const result = run(
      fieldWithoutValue,
      doc({
        paths: {
          '/pets/{id}': {
            get: {
              parameters: [{ name: 'id', in: 'path', required: true, schema, example: null }],
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: { type: 'object', default: { owner: null } },
                      example: { owner: null },
                      examples: { empty: { value: null }, nested: { value: { owner: null } } },
                    },
                  },
                  links: {
                    owner: { operationId: 'getOwner', parameters: { id: null }, requestBody: null },
                  },
                },
              },
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('reads the source, where a field sits once at its declaration', () => {
    const shared = { type: 'string', 'as uploaded': null }
    const document = doc({
      paths: {
        '/a': {
          get: {
            responses: {
              200: { description: 'OK', content: { 'application/json': { schema: shared } } },
            },
          },
        },
      },
    })
    const source = doc({
      paths: {
        '/a': {
          get: {
            responses: {
              200: {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/S' } } },
              },
            },
          },
        },
      },
      components: { schemas: { S: shared } },
    })
    const result = run(fieldWithoutValue, document, { source })
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/S/as uploaded'])
  })

  // A property is a name, not a keyword: one called `value` or `default` holds
  // a schema like any other.
  it('tells a property named like a payload keyword from the keyword', () => {
    const properties = {
      value: { type: 'string', description: null },
      default: { type: 'string', title: null },
      lost: null,
    }
    const result = run(
      fieldWithoutValue,
      doc({ components: { schemas: { Setting: { type: 'object', properties } } } }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.field])).toEqual([
      ['/components/schemas/Setting/properties/lost', 'lost'],
      ['/components/schemas/Setting/properties/value/description', 'description'],
      ['/components/schemas/Setting/properties/default/title', 'title'],
    ])
  })

  it('flags an empty map member, never a list member', () => {
    const result = run(
      fieldWithoutValue,
      doc({
        servers: [
          { url: 'https://{env}.example.com', variables: { env: { default: 'a', enum: [null] } } },
        ],
        paths: { '/a': { get: { responses: { 200: null } } } },
        components: { responses: { Gone: null } },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/responses/200',
      '/components/responses/Gone',
    ])
  })

  it('reports an empty sibling of a 3.1 $ref once', () => {
    const result = run(
      fieldWithoutValue,
      doc({
        components: {
          schemas: {
            A: { type: 'string' },
            B: { $ref: '#/components/schemas/A', description: null },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual(['/components/schemas/B/description'])
  })
})
