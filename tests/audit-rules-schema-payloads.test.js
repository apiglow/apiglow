import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { binaryPlacement } from '../src/audit/rules/binary-placement.js'
import { compositionSanity } from '../src/audit/rules/composition-sanity.js'
import { exampleHasRef } from '../src/audit/rules/example-has-ref.js'
import { mergePatchRequired } from '../src/audit/rules/merge-patch-required.js'
import { multipartSchemaObject } from '../src/audit/rules/multipart-schema-object.js'
import { problemStatusMismatch } from '../src/audit/rules/problem-status-mismatch.js'
import { readonlyWriteonly } from '../src/audit/rules/readonly-writeonly.js'
import { recursionUnsatisfiable } from '../src/audit/rules/recursion-unsatisfiable.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// Schema- and payload-level rules of docs/audit.md §4.1: contradictions a
// schema or an example holds, read where they are written.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// Fixtures with `$ref`s: the rule sees the source as written and its
// dereferenced twin, as the loader hands them over.
const runRefs = (rule, source) =>
  run(rule, dereferenceInternal(structuredClone(source)), { source })

const body = (mediaType, schema, extra = {}) => ({
  paths: {
    '/things': {
      post: {
        requestBody: { content: { [mediaType]: { schema, ...extra } } },
        responses: okResponse,
      },
    },
  },
})

describe('composition-sanity', () => {
  it('passes real choices, and the decorated single-member idioms', () => {
    const result = runRefs(
      compositionSanity,
      doc({
        components: {
          schemas: {
            A: { type: 'object' },
            B: { type: 'object' },
            Choice: {
              oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
            },
            Described: { description: 'An A', allOf: [{ $ref: '#/components/schemas/A' }] },
            Nullable: { nullable: true, oneOf: [{ $ref: '#/components/schemas/A' }] },
            Number: { type: 'number', allOf: [{ type: 'integer' }] },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a bare single-member choice, a member listed twice, and disjoint types', () => {
    const result = runRefs(
      compositionSanity,
      doc({
        components: {
          schemas: {
            A: { type: 'object' },
            Lonely: { anyOf: [{ $ref: '#/components/schemas/A' }] },
            Twice: {
              oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/A' }],
            },
            Impossible: { allOf: [{ type: 'string' }, { type: 'object' }] },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.keyword])).toEqual([
      ['/components/schemas/Lonely/anyOf', 'anyOf'],
      ['/components/schemas/Twice/oneOf/1', 'oneOf'],
      ['/components/schemas/Impossible/allOf', 'allOf'],
    ])
    expect(result.findings[0]).toMatchObject({ location: 'components.schemas.Lonely' })
  })
})

describe('readonly-writeonly', () => {
  it('passes a property marked one way', () => {
    const schemas = { Pet: { properties: { id: { type: 'string', readOnly: true } } } }
    expect(run(readonlyWriteonly, doc({ components: { schemas } }))).toMatchObject({
      checks: 0,
      findings: [],
    })
  })

  it('flags a property marked both ways', () => {
    const schemas = {
      Pet: { properties: { secret: { type: 'string', readOnly: true, writeOnly: true } } },
    }
    const result = run(readonlyWriteonly, doc({ components: { schemas } }))
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'readonly-writeonly',
        severity: 'error',
        dataPath: '/components/schemas/Pet/properties/secret',
      }),
    ])
  })
})

describe('recursion-unsatisfiable', () => {
  it('passes recursion with a way out: optional, nullable, a choice, an array that may be empty', () => {
    const result = runRefs(
      recursionUnsatisfiable,
      doc({
        components: {
          schemas: {
            Tree: {
              type: 'object',
              required: ['children'],
              properties: {
                children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } },
              },
            },
            List: {
              type: 'object',
              required: ['next'],
              properties: {
                next: { oneOf: [{ $ref: '#/components/schemas/List' }, { type: 'null' }] },
              },
            },
            Chain: {
              type: 'object',
              properties: { next: { $ref: '#/components/schemas/Chain' } },
            },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a schema that requires itself, directly or through another', () => {
    const result = runRefs(
      recursionUnsatisfiable,
      doc({
        components: {
          schemas: {
            Node: {
              type: 'object',
              required: ['child'],
              properties: { child: { $ref: '#/components/schemas/Node' } },
            },
            Husband: {
              type: 'object',
              required: ['wife'],
              properties: { wife: { $ref: '#/components/schemas/Wife' } },
            },
            Wife: {
              allOf: [
                {
                  type: 'object',
                  required: ['husband'],
                  properties: { husband: { $ref: '#/components/schemas/Husband' } },
                },
              ],
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params.property])).toEqual([
      ['/components/schemas/Node', 'child'],
      ['/components/schemas/Husband', 'wife'],
    ])
  })
})

describe('merge-patch-required', () => {
  it('passes a merge patch that requires nothing, and a plain JSON body that does', () => {
    const schema = { type: 'object', properties: { name: { type: 'string' } } }
    expect(run(mergePatchRequired, doc(body('application/merge-patch+json', schema))).checks).toBe(
      0,
    )
    const json = { ...schema, required: ['name'] }
    expect(run(mergePatchRequired, doc(body('application/json', json))).checks).toBe(0)
  })

  it('flags a merge patch requiring properties, an allOf member included', () => {
    const schema = {
      allOf: [{ type: 'object', required: ['name', 'tag'], properties: { name: {}, tag: {} } }],
    }
    const result = run(mergePatchRequired, doc(body('application/merge-patch+json', schema)))
    expect(result.findings).toEqual([
      expect.objectContaining({
        dataPath: '/paths/~1things/post/requestBody/content/application~1merge-patch+json/schema',
        params: { properties: 'name, tag' },
      }),
    ])
  })
})

describe('multipart-schema-object', () => {
  it('passes a form with properties, a composed schema, and multipart/mixed', () => {
    const fields = { type: 'object', properties: { file: { type: 'string', format: 'binary' } } }
    expect(run(multipartSchemaObject, doc(body('multipart/form-data', fields))).checks).toBe(0)
    expect(
      run(multipartSchemaObject, doc(body('multipart/form-data', { allOf: [fields] }))).checks,
    ).toBe(0)
    expect(
      run(multipartSchemaObject, doc(body('multipart/mixed', { type: 'array', items: {} }))).checks,
    ).toBe(0)
  })

  it('flags a form whose schema names no field, or that has no schema', () => {
    for (const schema of [{ type: 'array', items: {} }, { type: 'object' }, { type: 'string' }]) {
      const result = run(
        multipartSchemaObject,
        doc(body('application/x-www-form-urlencoded', schema)),
      )
      expect(result.findings).toHaveLength(1)
    }
    const bare = doc(body('multipart/form-data', undefined))
    expect(run(multipartSchemaObject, bare).findings[0]).toMatchObject({
      dataPath: '/paths/~1things/post/requestBody/content/multipart~1form-data',
      params: { mediaType: 'multipart/form-data' },
    })
  })
})

describe('binary-placement', () => {
  it('passes files where files go: a multipart part, an octet-stream body, base64 in JSON', () => {
    const file = { type: 'string', format: 'binary' }
    const multipart = body('multipart/form-data', { type: 'object', properties: { file } })
    expect(run(binaryPlacement, doc(multipart)).checks).toBe(0)
    expect(run(binaryPlacement, doc(body('application/octet-stream', file))).checks).toBe(0)
    const encoded = {
      type: 'object',
      properties: {
        photo: { type: 'string', format: 'byte' },
        scan: { type: 'string', contentMediaType: 'image/png', contentEncoding: 'base64' },
        page: { type: 'string', contentMediaType: 'text/html' },
      },
    }
    expect(run(binaryPlacement, doc(body('application/json', encoded))).checks).toBe(0)
  })

  it('flags raw bytes inside JSON, and in a parameter', () => {
    const document = doc({
      paths: {
        '/things': {
          post: {
            parameters: [
              { name: 'blob', in: 'query', schema: { type: 'string', format: 'binary' } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      files: { type: 'array', items: { type: 'string', format: 'binary' } },
                      scan: { type: 'string', contentMediaType: 'application/pdf' },
                    },
                  },
                },
              },
            },
            responses: okResponse,
          },
        },
      },
    })
    const result = run(binaryPlacement, document)
    expect(result.findings.map((f) => [f.dataPath, f.params.container])).toEqual([
      ['/paths/~1things/post/parameters/0/schema', 'query'],
      [
        '/paths/~1things/post/requestBody/content/application~1json/schema/properties/files/items',
        'application/json',
      ],
      [
        '/paths/~1things/post/requestBody/content/application~1json/schema/properties/scan',
        'application/json',
      ],
    ])
  })
})

describe('example-has-ref', () => {
  it('passes a referenced Example Object, and data that merely contains $ref', () => {
    const result = runRefs(
      exampleHasRef,
      doc({
        paths: {
          '/schemas': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: {
                    'application/json': {
                      examples: { one: { $ref: '#/components/examples/Schema' } },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          examples: {
            Schema: { value: { type: 'object', properties: { a: { $ref: '#/defs/a' } } } },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags an example that is nothing but a $ref, wherever it sits', () => {
    const ref = { $ref: '#/components/examples/Pet' }
    const result = runRefs(
      exampleHasRef,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, example: ref }],
              responses: {
                200: {
                  description: 'OK',
                  content: { 'application/json': { examples: { pet: { value: ref } } } },
                },
              },
            },
          },
        },
        components: { schemas: { Pet: { type: 'object', examples: [ref] } } },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1pets/get/parameters/0/example',
      '/paths/~1pets/get/responses/200/content/application~1json/examples/pet/value',
      '/components/schemas/Pet/examples/0',
    ])
    expect(result.findings[0]).toMatchObject({ opRef: 'get-pets', params: { ref: ref.$ref } })
  })
})

describe('problem-status-mismatch', () => {
  const problem = (status, media) => ({
    paths: {
      '/pets': {
        get: {
          responses: {
            200: { description: 'OK' },
            [status]: { description: 'Error', content: { 'application/problem+json': media } },
          },
        },
      },
    },
  })

  it('passes a problem whose status matches its code, and a range', () => {
    expect(
      run(problemStatusMismatch, doc(problem('404', { example: { status: 404 } }))).checks,
    ).toBe(0)
    expect(
      run(problemStatusMismatch, doc(problem('4XX', { example: { status: 418 } }))).checks,
    ).toBe(0)
  })

  it('flags an example or a pinned status that says another code', () => {
    const result = run(
      problemStatusMismatch,
      doc(
        problem('404', {
          schema: { type: 'object', properties: { status: { type: 'integer', const: 400 } } },
          examples: { gone: { value: { status: 410 } } },
        }),
      ),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params])).toEqual([
      [
        '/paths/~1pets/get/responses/404/content/application~1problem+json/examples/gone/value/status',
        { status: '404', value: 410 },
      ],
      [
        '/paths/~1pets/get/responses/404/content/application~1problem+json/schema/properties/status/const',
        { status: '404', value: 400 },
      ],
    ])
  })
})
