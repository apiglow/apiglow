import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { defaultAllowed } from '../src/audit/rules/default-allowed.js'
import { discriminatorMapping } from '../src/audit/rules/discriminator-mapping.js'
import { duplicateOperationId } from '../src/audit/rules/duplicate-operation-id.js'
import { exampleTypeMismatch } from '../src/audit/rules/example-type-mismatch.js'
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

  it('skips a composed schema, whose branches carry the properties', () => {
    const result = run(
      requiredPropertyDeclared,
      withSchema({
        required: ['id'],
        properties: {},
        allOf: [{ type: 'object', properties: { id: { type: 'string' } } }],
      }),
    )
    expect(result.checks).toBe(0)
  })

  it('skips a free-form object with no properties at all', () => {
    const result = run(requiredPropertyDeclared, withSchema({ type: 'object', required: ['id'] }))
    expect(result.checks).toBe(0)
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
      params: { value: '"ten"' },
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
      params: { value: '0' },
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

  it('has nothing to check without enum nor bounds', () => {
    const result = run(defaultAllowed, withSchema({ type: 'string', default: 'anything' }))
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
      severity: 'warning',
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
        204: { content: { 'application/json': {} } },
        // 3.2: summary alone is substance.
        404: { summary: 'Not found' },
      }),
    )
    expect(result).toMatchObject({ checks: 3, findings: [] })
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
