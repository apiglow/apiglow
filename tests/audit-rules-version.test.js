import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSchema, runRule } from '../src/audit/engine.js'
import { schemaDialect } from '../src/audit/rules/schema-dialect.js'
import { versionConstruct } from '../src/audit/rules/version-construct.js'
import { versionLegacy } from '../src/audit/rules/version-legacy.js'
import { loadInlineApiModel } from '../src/openapi/loader.js'
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
      { construct: 'nullable', replacement: 'type: ["integer", "null"]', declared: '3.1.0' },
      { construct: 'exclusiveMinimum', replacement: 'exclusiveMinimum: 0', declared: '3.1.0' },
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'version-legacy',
      severity: 'warning',
      category: 'correctness',
      location: 'components.schemas.Pet',
      dataPath: '/components/schemas/Pet/nullable',
    })
  })

  it('writes the exact rewrite from the schema itself', () => {
    const rewrite = (schema) =>
      run(versionLegacy, withSchema('3.1.0', schema)).findings.map((f) => f.params.replacement)
    expect(rewrite({ type: ['string', 'integer'], nullable: true })).toEqual([
      'type: ["string", "integer", "null"]',
    ])
    expect(rewrite({ nullable: true, oneOf: [{ type: 'string' }, { type: 'integer' }] })).toEqual([
      'oneOf: [..., { type: "null" }]',
    ])
    expect(rewrite({ type: 'number', maximum: 9, exclusiveMaximum: false })).toEqual(['maximum: 9'])
  })

  // What only restates the default said nothing in 3.0 either.
  it('does not check a spelling that only restates the default', () => {
    const result = run(
      versionLegacy,
      withSchema('3.1.0', { type: 'integer', nullable: false, exclusiveMinimum: true }),
    )
    expect(result.checks).toBe(0)
  })

  it('flags x-nullable in every 3.x document, with that version’s spelling', () => {
    const replacement = (openapi) =>
      run(versionLegacy, withSchema(openapi, { type: 'string', 'x-nullable': true })).findings.map(
        (finding) => [finding.dataPath, finding.params.replacement],
      )
    expect(replacement('3.0.3')).toEqual([['/components/schemas/Pet/x-nullable', 'nullable: true']])
    expect(replacement('3.1.0')).toEqual([
      ['/components/schemas/Pet/x-nullable', 'type: ["string", "null"]'],
    ])
  })

  it('notes a schema example from 3.1 on, as info: deprecated, still read', () => {
    const schema = { type: 'integer', example: 7 }
    expect(run(versionLegacy, withSchema('3.0.3', schema))).toMatchObject({
      checks: 1,
      findings: [],
    })
    const [finding] = run(versionLegacy, withSchema('3.1.0', schema)).findings
    expect(finding).toMatchObject({
      severity: 'info',
      dataPath: '/components/schemas/Pet/example',
      params: { construct: 'example', replacement: 'examples: [7]' },
    })
  })

  it('rewrites an example in full, eliding only one too long for a line', () => {
    const pet = { id: 7, name: 'Rex', tags: [{ name: 'good boy' }], owner: { name: 'Ada' } }
    const rewrite = (example) =>
      run(versionLegacy, withSchema('3.1.0', { type: 'object', example })).findings[0].params
        .replacement
    expect(rewrite(pet)).toBe(`examples: [${JSON.stringify(pet)}]`)
    expect(rewrite({ text: 'x'.repeat(300) })).toBe('examples: [...]')
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
    expect(result.findings[0]).toMatchObject({
      severity: 'info',
      dataPath: '/components/schemas/Pet/properties/id/xml/attribute',
    })
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
    // Object fields in document order, then schema keywords.
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      '$self',
      'webhooks',
      'pathItem.query',
      'pathItem.additionalOperations',
      'mediaType.prefixEncoding',
      'mediaType.itemEncoding',
      'in: querystring',
      'mediaType.itemSchema',
      'xml.nodeType',
      'type: [...]',
      'const',
    ])
    expect(result.findings[1]).toMatchObject({
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
      'pathItem.query',
      'pathItem.additionalOperations',
      'mediaType.prefixEncoding',
      'mediaType.itemEncoding',
      'in: querystring',
      'mediaType.itemSchema',
      'xml.nodeType',
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
            contentSchema: { type: 'object' },
            prefixItems: [{ type: 'string' }],
            examples: [{ name: 'Rex' }],
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: 'https://example.com/pet',
            $anchor: 'pet',
            $dynamicAnchor: 'node',
            $dynamicRef: '#node',
            $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/core': true },
            $comment: 'Shared by every pet endpoint.',
            // A draft-07 spelling: no OpenAPI version's, so nothing ahead of 3.0.
            definitions: { Legacy: { type: 'string' } },
          },
        },
      },
    })

  it('flags the 2020-12 keywords, and the declared dialect, in a 3.0 document', () => {
    const result = run(versionConstruct, keywords('3.0.3'))
    expect(result.findings.map((finding) => finding.params.construct)).toEqual([
      'jsonSchemaDialect',
      '$schema',
      '$id',
      '$anchor',
      '$dynamicRef',
      '$dynamicAnchor',
      '$vocabulary',
      '$comment',
      '$defs',
      'if',
      'then',
      'else',
      'dependentSchemas',
      'prefixItems',
      'contains',
      'patternProperties',
      'propertyNames',
      'unevaluatedItems',
      'unevaluatedProperties',
      'maxContains',
      'minContains',
      'dependentRequired',
      'examples',
      'contentEncoding',
      'contentMediaType',
      'contentSchema',
    ])
    // `not` sits alongside allOf/oneOf/anyOf in 3.0: flagging it would be wrong.
    expect(result.findings.some((finding) => finding.params.construct === 'not')).toBe(false)
  })

  it('leaves every one of them alone in a 3.1 document', () => {
    expect(run(versionConstruct, keywords('3.1.0')).findings).toEqual([])
  })

  it('flags a Media Type $ref before 3.2', () => {
    const mediaRef = (openapi) =>
      doc({
        openapi,
        paths: {
          '/a': {
            get: {
              responses: {
                200: {
                  description: 'OK',
                  content: { 'application/json': { $ref: '#/components/mediaTypes/Json' } },
                },
              },
            },
          },
        },
      })
    expect(run(versionConstruct, mediaRef('3.1.0')).findings[0]).toMatchObject({
      dataPath: '/paths/~1a/get/responses/200/content/application~1json/$ref',
      params: { construct: 'mediaType.$ref', since: '3.2', declared: '3.1.0' },
    })
    expect(run(versionConstruct, mediaRef('3.2.0'))).toMatchObject({ checks: 1, findings: [] })
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

// The one rule whose input is a marker no hand-written document carries: the
// fixtures are the real Swagger 2.0 petstore run through the converter, and a
// 3.0 document nobody converted.
describe('conversion-approximation', () => {
  const fixture = (name) =>
    JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
  const findings = (result, ruleId) =>
    result.categories.flatMap((c) => c.findings).filter((f) => f.ruleId === ruleId)
  const report = async (name) => auditSchema(await loadInlineApiModel(fixture(name)))

  it('reports every approximation the conversion had to make, and only those', async () => {
    const result = await report('petstore-2.0.json')
    const approximations = findings(result, 'conversion-approximation')
    expect(approximations.map((f) => [f.dataPath, f.params.construct])).toEqual([
      ['/paths/~1pets/get/parameters/4', 'tsv'],
      ['/paths/~1pets/get/parameters/5', 'ssv'],
      ['/paths/~1pets/get/responses/200/headers/X-Pages/schema', 'ssv'],
    ])
    expect(approximations.every((f) => f.severity === 'info')).toBe(true)
  })

  it('says nothing on a document nobody converted', async () => {
    const result = await report('petstore-3.0.json')
    expect(findings(result, 'conversion-approximation')).toEqual([])
  })
})
