import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { schemaDialect } from '../src/audit/rules/schema-dialect.js'
import { versionConstruct } from '../src/audit/rules/version-construct.js'
import { versionLegacy } from '../src/audit/rules/version-legacy.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// Same document, only the declared version changes: that is the whole point of
// these two rules (docs/audit.md §4.6).
const withSchema = (openapi, schema) =>
  doc({
    openapi,
    components: { schemas: { Pet: schema } },
  })

describe('version-legacy', () => {
  it('passes on the 3.0 spellings in a 3.0 document', () => {
    const result = run(
      versionLegacy,
      withSchema('3.0.3', { type: 'integer', nullable: true, minimum: 0, exclusiveMinimum: true }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('flags them in a 3.1 document, and names the replacement', () => {
    const result = run(
      versionLegacy,
      withSchema('3.1.0', { type: 'integer', nullable: true, minimum: 0, exclusiveMinimum: true }),
    )
    expect(result.checks).toBe(2)
    expect(result.findings.map((finding) => finding.params)).toEqual([
      { construct: 'nullable', replacement: 'type: [..., "null"]', declared: '3.1.0' },
      {
        construct: 'exclusiveMinimum',
        replacement: 'exclusiveMinimum: <number>',
        declared: '3.1.0',
      },
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'version-legacy',
      severity: 'warning',
      category: 'correctness',
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/nullable',
    })
  })

  it('leaves the 3.1 numeric bound alone', () => {
    const result = run(versionLegacy, withSchema('3.1.0', { type: 'integer', exclusiveMinimum: 0 }))
    expect(result.checks).toBe(0)
  })

  // The XML booleans survived 3.1 untouched: `since` travels per construct,
  // which is why the same document passes at 3.1 and fails at 3.2.
  it('flags the XML booleans only from 3.2 on', () => {
    const xmlDoc = (openapi) =>
      withSchema(openapi, {
        type: 'object',
        properties: {
          id: { type: 'string', xml: { attribute: true } },
          tags: { type: 'array', xml: { wrapped: true }, items: { type: 'string' } },
        },
      })
    expect(run(versionLegacy, xmlDoc('3.1.0'))).toMatchObject({ checks: 2, findings: [] })
    const result = run(versionLegacy, xmlDoc('3.2.0'))
    expect(result.findings.map((finding) => finding.params)).toEqual([
      { construct: 'xml.attribute', replacement: "xml.nodeType: 'attribute'", declared: '3.2.0' },
      { construct: 'xml.wrapped', replacement: "xml.nodeType: 'element'", declared: '3.2.0' },
    ])
    expect(result.findings[0].dataPath).toBe('/components/schemas/Pet/properties/id/xml/attribute')
  })
})

describe('version-construct', () => {
  const modern = (openapi) =>
    doc({
      openapi,
      $self: 'https://api.example.com/spec.json',
      webhooks: { petStatus: { post: { responses: okResponse } } },
      paths: {
        '/pets': {
          query: {
            parameters: [{ name: 'filter', in: 'querystring', schema: { type: 'string' } }],
            responses: {
              200: { description: 'OK', content: { 'application/jsonl': { itemSchema: {} } } },
            },
          },
          additionalOperations: { PURGE: { responses: okResponse } },
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { type: 'object' },
                  prefixEncoding: [{ contentType: 'text/plain' }],
                  itemEncoding: { contentType: 'application/json' },
                },
              },
            },
            responses: okResponse,
          },
        },
      },
      components: {
        schemas: {
          Status: {
            type: ['string', 'null'],
            const: 'available',
            xml: { nodeType: 'text' },
          },
        },
      },
    })

  it('passes on every construct a 3.2 document is entitled to', () => {
    const result = run(versionConstruct, modern('3.2.0'))
    expect(result).toMatchObject({ checks: 11, findings: [] })
  })

  it('flags each construct the declared version does not have', () => {
    const result = run(versionConstruct, modern('3.0.3'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      'webhooks',
      '$self',
      'type: [...]',
      'const',
      'xml.nodeType',
      'prefixEncoding',
      'itemEncoding',
      'query',
      'in: querystring',
      'itemSchema',
      'additionalOperations',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'version-construct',
      severity: 'warning',
      location: 'webhooks',
      dataPath: '/webhooks',
      params: { construct: 'webhooks', since: '3.1', declared: '3.0.3' },
    })
  })

  it('flags only the 3.2 ones in a 3.1 document', () => {
    const result = run(versionConstruct, modern('3.1.0'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      '$self',
      'xml.nodeType',
      'prefixEncoding',
      'itemEncoding',
      'query',
      'in: querystring',
      'itemSchema',
      'additionalOperations',
    ])
    expect(result.findings.every((finding) => finding.params.since === '3.2')).toBe(true)
  })

  // 3.0's Schema Object is a draft-04 subset: everything 2020-12 added is ahead
  // of it, and the app reads it all regardless.
  const keywords = (openapi) =>
    doc({
      openapi,
      jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
      components: {
        schemas: {
          Pet: {
            type: 'object',
            $defs: { Tag: { type: 'string' } },
            if: { required: ['card'] },
            // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
            then: { required: ['cvv'] },
            else: { required: ['iban'] },
            not: { required: ['legacy'] },
            patternProperties: { '^x-': { type: 'string' } },
            propertyNames: { pattern: '^[a-z]+$' },
            dependentRequired: { card: ['cvv'] },
            dependentSchemas: { iban: { type: 'object' } },
            unevaluatedProperties: false,
            unevaluatedItems: false,
            contains: { type: 'string' },
            minContains: 1,
            maxContains: 2,
            contentEncoding: 'base64',
            contentMediaType: 'image/png',
          },
        },
      },
    })

  it('flags the 2020-12 keywords, and the declared dialect, in a 3.0 document', () => {
    const result = run(versionConstruct, keywords('3.0.3'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      'jsonSchemaDialect',
      'if',
      'then',
      'else',
      '$defs',
      'patternProperties',
      'propertyNames',
      'dependentRequired',
      'dependentSchemas',
      'unevaluatedProperties',
      'unevaluatedItems',
      'contains',
      'minContains',
      'maxContains',
      'contentEncoding',
      'contentMediaType',
    ])
    // `not` sits alongside allOf/oneOf/anyOf in 3.0: flagging it would be wrong.
    expect(result.findings.some((finding) => finding.params.construct === 'not')).toBe(false)
  })

  it('leaves every one of them alone in a 3.1 document', () => {
    expect(run(versionConstruct, keywords('3.1.0')).findings).toEqual([])
  })

  // The discriminator object is 3.0; only 3.2 added a fallback target.
  const defaultMapping = (openapi) =>
    doc({
      openapi,
      components: {
        schemas: {
          Pet: {
            oneOf: [{ $ref: '#/components/schemas/Cat' }],
            discriminator: { propertyName: 'petType', defaultMapping: 'Cat' },
          },
          Cat: { type: 'object' },
        },
      },
    })

  it('flags defaultMapping before 3.2, and only it', () => {
    const result = run(versionConstruct, defaultMapping('3.1.0'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      'discriminator.defaultMapping',
    ])
    expect(result.findings[0]).toMatchObject({
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/discriminator/defaultMapping',
      params: { since: '3.2', declared: '3.1.0' },
    })
    expect(run(versionConstruct, defaultMapping('3.2.0')).findings).toEqual([])
  })

  // The `info` block gained a `summary` in 3.1, and the licence an SPDX
  // `identifier` — everything else it holds has been there since 3.0.
  const richInfo = (openapi) =>
    doc({
      openapi,
      info: {
        title: 'Audit',
        version: '1',
        summary: 'One sentence.',
        contact: { email: 'api@example.com' },
        license: { name: 'Apache 2.0', identifier: 'Apache-2.0' },
      },
    })

  it('flags the 3.1 info fields in a 3.0 document', () => {
    const result = run(versionConstruct, richInfo('3.0.3'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      'info.summary',
      'license.identifier',
    ])
    expect(result.findings[1]).toMatchObject({
      location: 'info.license.identifier',
      dataPath: '/info/license/identifier',
      params: { since: '3.1', declared: '3.0.3' },
    })
    expect(run(versionConstruct, richInfo('3.1.0')).findings).toEqual([])
  })
})

// Correctness category, but the same family: what the document says about its
// own schemas versus what this app does with them.
describe('schema-dialect', () => {
  it('checks nothing when the document declares no dialect', () => {
    expect(run(schemaDialect, doc({})).checks).toBe(0)
  })

  it('passes on the dialects that mean 2020-12', () => {
    for (const dialect of [
      'https://json-schema.org/draft/2020-12/schema',
      'https://spec.openapis.org/oas/3.1/dialect/base',
      'https://spec.openapis.org/oas/3.2/dialect/base#',
    ]) {
      expect(run(schemaDialect, doc({ jsonSchemaDialect: dialect }))).toMatchObject({
        checks: 1,
        findings: [],
      })
    }
  })

  it('notes a dialect the app will not honour', () => {
    const dialect = 'https://json-schema.org/draft/2019-09/schema'
    const result = run(schemaDialect, doc({ jsonSchemaDialect: dialect }))
    expect(result.findings[0]).toMatchObject({
      ruleId: 'schema-dialect',
      severity: 'info',
      category: 'correctness',
      location: 'jsonSchemaDialect',
      dataPath: '/jsonSchemaDialect',
      params: { dialect },
    })
  })
})
