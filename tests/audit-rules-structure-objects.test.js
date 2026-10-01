import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { componentKeyFormat } from '../src/audit/rules/component-key-format.js'
import { exclusiveFields } from '../src/audit/rules/exclusive-fields.js'
import { extensionReservedPrefix } from '../src/audit/rules/extension-reserved-prefix.js'
import { headerObjectFields } from '../src/audit/rules/header-object-fields.js'
import {
  isSpdxExpression,
  licenseIdentifierSpdx,
} from '../src/audit/rules/license-identifier-spdx.js'
import { mediaTypeKeySyntax } from '../src/audit/rules/media-type-key-syntax.js'
import { parameterSchemaOrContent } from '../src/audit/rules/parameter-schema-or-content.js'
import { selfUri } from '../src/audit/rules/self-uri.js'
import { statusCodeValid } from '../src/audit/rules/status-code-valid.js'
import { tagParent } from '../src/audit/rules/tag-parent.js'
import { tagUnique } from '../src/audit/rules/tag-unique.js'
import { unknownField } from '../src/audit/rules/unknown-field.js'
import { uriForm } from '../src/audit/rules/uri-form.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The document-object rules of docs/audit.md §4.1 (structure): what the
// specification says the objects themselves hold.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))
const paths = (result) => result.findings.map((finding) => finding.dataPath)

const withParameters = (parameters, extra = {}) =>
  doc({ paths: { '/pets': { get: { parameters, responses: okResponse } } }, ...extra })

describe('parameter-schema-or-content', () => {
  it('passes a schema, or a content map with one media type', () => {
    const result = run(
      parameterSchemaOrContent,
      withParameters([
        { name: 'a', in: 'query', schema: { type: 'string' } },
        { name: 'b', in: 'query', content: { 'application/json': { schema: {} } } },
      ]),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags both, neither, and a content map of several media types — headers too', () => {
    const result = run(
      parameterSchemaOrContent,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [
                { name: 'a', in: 'query', schema: {}, content: { 'text/plain': {} } },
                { name: 'b', in: 'query' },
                { name: 'c', in: 'query', content: { 'text/plain': {}, 'application/json': {} } },
              ],
              responses: {
                200: { description: 'OK', headers: { 'X-Rate': { description: 'r' } } },
              },
            },
          },
        },
      }),
    )
    expect(paths(result)).toEqual([
      '/paths/~1pets/get/parameters/0',
      '/paths/~1pets/get/parameters/1',
      '/paths/~1pets/get/parameters/2',
      '/paths/~1pets/get/responses/200/headers/X-Rate',
    ])
    expect(result.findings[3]).toMatchObject({ params: { object: 'Header' }, opRef: 'get-pets' })
  })
})

describe('exclusive-fields', () => {
  it('passes one field of each pair', () => {
    const result = run(
      exclusiveFields,
      withParameters([{ name: 'a', in: 'query', schema: {}, example: 'x' }], {
        info: { title: 'T', version: '1', license: { name: 'MIT', identifier: 'MIT' } },
        components: { examples: { A: { value: 1 } } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags each pair set together, the 3.2 ones only in 3.2', () => {
    const document = (openapi) =>
      withParameters(
        [{ name: 'a', in: 'query', schema: {}, example: 'x', examples: { one: { value: 'y' } } }],
        {
          openapi,
          info: {
            title: 'T',
            version: '1',
            license: { name: 'MIT', identifier: 'MIT', url: 'https://mit.example' },
          },
          components: {
            examples: {
              Both: { value: 1, externalValue: 'https://ex.example/1.json' },
              Data: { dataValue: 1, value: 1 },
              Serialized: { serializedValue: '1', externalValue: 'https://ex.example/1' },
            },
            links: { Next: { operationId: 'a', operationRef: '#/paths/~1pets/get' } },
          },
        },
      )
    expect(paths(run(exclusiveFields, document('3.2.0')))).toEqual([
      '/info/license/url',
      '/paths/~1pets/get/parameters/0/examples',
      '/components/examples/Both/externalValue',
      '/components/examples/Data/value',
      '/components/examples/Serialized/externalValue',
      '/components/links/Next/operationId',
    ])
    // 3.0 has no SPDX identifier and no dataValue / serializedValue: those are
    // version-construct's.
    expect(paths(run(exclusiveFields, document('3.0.3')))).toEqual([
      '/paths/~1pets/get/parameters/0/examples',
      '/components/examples/Both/externalValue',
      '/components/links/Next/operationId',
    ])
  })
})

describe('header-object-fields', () => {
  const headers = (header) =>
    doc({
      paths: {
        '/pets': {
          get: { responses: { 200: { description: 'OK', headers: { 'X-Rate': header } } } },
        },
      },
    })

  it('passes a header named by its key', () => {
    const result = run(headerObjectFields, headers({ schema: { type: 'integer' } }))
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a name or an in copied from a Parameter, which unknown-field leaves to it', () => {
    const document = headers({ name: 'X-Rate', in: 'header', schema: { type: 'integer' } })
    expect(paths(run(headerObjectFields, document))).toEqual([
      '/paths/~1pets/get/responses/200/headers/X-Rate/name',
      '/paths/~1pets/get/responses/200/headers/X-Rate/in',
    ])
    expect(run(unknownField, document).findings).toEqual([])
  })
})

describe('component-key-format', () => {
  it('passes letters, digits, dots, dashes and underscores', () => {
    const result = run(
      componentKeyFormat,
      doc({ components: { schemas: { 'Pet.v2_new-1': { type: 'object' } } } }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags any other character, in every section', () => {
    const result = run(
      componentKeyFormat,
      doc({
        components: {
          schemas: { 'Pet Store': {}, 'pets/v2': {} },
          parameters: { Limité: { name: 'l', in: 'query', schema: {} } },
        },
      }),
    )
    expect(paths(result)).toEqual([
      '/components/schemas/Pet Store',
      '/components/schemas/pets~1v2',
      '/components/parameters/Limité',
    ])
    expect(result.findings[0]).toMatchObject({
      location: 'components.schemas.Pet Store',
      params: { section: 'schemas', name: 'Pet Store' },
    })
  })
})

describe('status-code-valid', () => {
  const responses = (map) => doc({ paths: { '/pets': { get: { responses: map } } } })

  it('passes codes, uppercase ranges, default and extensions', () => {
    const result = run(
      statusCodeValid,
      responses({
        200: { description: 'OK' },
        '4XX': { description: 'Client' },
        default: { description: 'Other' },
        'x-note': 'n',
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags anything else', () => {
    const result = run(
      statusCodeValid,
      responses({
        '200 OK': { description: 'a' },
        '2xx': { description: 'b' },
        600: { description: 'c' },
        20: { description: 'd' },
      }),
    )
    expect(result.findings.map((finding) => finding.params.status).sort()).toEqual([
      '20',
      '200 OK',
      '2xx',
      '600',
    ])
  })
})

describe('media-type-key-syntax', () => {
  const body = (content) =>
    doc({
      paths: { '/pets': { post: { requestBody: { content }, responses: okResponse } } },
    })

  it('passes media types, ranges and parameters', () => {
    const result = run(
      mediaTypeKeySyntax,
      body({
        'application/json; charset=utf-8': {},
        'application/vnd.api+json': {},
        'text/*': {},
        '*/*': {},
        'multipart/form-data; boundary="a b"': {},
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags keys that are not media types', () => {
    const result = run(mediaTypeKeySyntax, body({ json: {}, 'application json': {}, 'text/': {} }))
    expect(result.findings.map((finding) => finding.params.mediaType)).toEqual([
      'json',
      'application json',
      'text/',
    ])
    expect(result.findings[0].dataPath).toBe('/paths/~1pets/post/requestBody/content/json')
  })
})

describe('extension-reserved-prefix', () => {
  const document = (openapi) =>
    doc({
      openapi,
      'x-oai-mine': true,
      info: { title: 'T', version: '1', 'x-logo': {} },
      components: { schemas: { Pet: { type: 'object', 'x-oas-internal': 1 } } },
    })

  it('passes other extensions, and anything in 3.0, where the prefixes are not reserved', () => {
    expect(run(extensionReservedPrefix, document('3.0.3')).findings).toEqual([])
  })

  it('flags x-oai- and x-oas- extensions from 3.1', () => {
    expect(paths(run(extensionReservedPrefix, document('3.1.0')))).toEqual([
      '/x-oai-mine',
      '/components/schemas/Pet/x-oas-internal',
    ])
  })
})

describe('uri-form', () => {
  it('passes URLs, relative references and email addresses', () => {
    const result = run(
      uriForm,
      doc({
        info: {
          title: 'T',
          version: '1',
          termsOfService: '/terms',
          contact: { url: 'https://example.com', email: 'api@example.com' },
        },
        externalDocs: { url: 'docs/guide.html' },
        components: { schemas: { Pet: { xml: { namespace: 'urn:example:pets' } } } },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags values that cannot be one, an XML namespace that is relative', () => {
    const result = run(
      uriForm,
      doc({
        info: {
          title: 'T',
          version: '1',
          termsOfService: 'See our website',
          contact: { email: 'support at example.com' },
        },
        externalDocs: { url: 'https://' },
        components: {
          schemas: { Pet: { xml: { namespace: 'pets' } } },
          securitySchemes: {
            oauth: {
              type: 'oauth2',
              flows: {
                clientCredentials: { tokenUrl: 'https://auth.example.com/to ken', scopes: {} },
              },
            },
          },
        },
      }),
    )
    expect(paths(result)).toEqual([
      '/info/termsOfService',
      '/info/contact/email',
      '/components/schemas/Pet/xml/namespace',
      '/components/securitySchemes/oauth/flows/clientCredentials/tokenUrl',
      '/externalDocs/url',
    ])
    expect(result.findings[0]).toMatchObject({
      location: 'info.termsOfService',
      params: { field: 'termsOfService', object: 'Info', value: 'See our website' },
    })
  })
})

describe('license-identifier-spdx', () => {
  const license = (identifier, openapi = '3.1.0') =>
    doc({ openapi, info: { title: 'T', version: '1', license: { name: 'L', identifier } } })

  it('passes SPDX expressions', () => {
    for (const identifier of [
      'MIT',
      'apache-2.0',
      'GPL-2.0-or-later WITH Classpath-exception-2.0',
      '(MIT OR Apache-2.0) AND BSD-3-Clause',
      'LicenseRef-Acme-Proprietary',
      'GPL-2.0+',
    ]) {
      expect(isSpdxExpression(identifier), identifier).toBe(true)
    }
    expect(run(licenseIdentifierSpdx, license('MIT'))).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags anything else, from 3.1 only', () => {
    for (const identifier of [
      'Apache 2',
      'MIT License',
      'Proprietary',
      'MIT AND',
      '(MIT',
      'MIT and Or',
    ]) {
      expect(isSpdxExpression(identifier), identifier).toBe(false)
    }
    expect(run(licenseIdentifierSpdx, license('Apache 2')).findings[0]).toMatchObject({
      dataPath: '/info/license/identifier',
      params: { identifier: 'Apache 2' },
    })
    expect(run(licenseIdentifierSpdx, license('Apache 2', '3.0.3')).findings).toEqual([])
  })
})

describe('self-uri', () => {
  it('passes a URI reference, absolute or relative', () => {
    for (const $self of ['https://example.com/api/openapi', 'shared/openapi.yaml']) {
      expect(run(selfUri, doc({ openapi: '3.2.0', $self })).findings).toEqual([])
    }
  })

  it('flags what cannot be one, in 3.2 only', () => {
    const result = run(selfUri, doc({ openapi: '3.2.0', $self: 'my api' }))
    expect(result.findings[0]).toMatchObject({ dataPath: '/$self', params: { value: 'my api' } })
    expect(run(selfUri, doc({ openapi: '3.1.0', $self: 'my api' })).findings).toEqual([])
  })
})

describe('tag-unique', () => {
  it('passes distinct names', () => {
    const result = run(tagUnique, doc({ tags: [{ name: 'pets' }, { name: 'store' }] }))
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags the later of two tags with one name', () => {
    const result = run(
      tagUnique,
      doc({ tags: [{ name: 'pets' }, { name: 'store' }, { name: 'pets', description: 'again' }] }),
    )
    expect(result.findings).toMatchObject([{ dataPath: '/tags/2/name', params: { name: 'pets' } }])
  })
})

describe('tag-parent', () => {
  it('passes a parent that exists', () => {
    const result = run(
      tagParent,
      doc({ openapi: '3.2.0', tags: [{ name: 'pets' }, { name: 'cats', parent: 'pets' }] }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a parent that does not exist and every tag of a loop, in 3.2 only', () => {
    const tags = [
      { name: 'cats', parent: 'animals' },
      { name: 'a', parent: 'b' },
      { name: 'b', parent: 'a' },
      { name: 'c', parent: 'a' },
    ]
    expect(paths(run(tagParent, doc({ openapi: '3.2.0', tags })))).toEqual([
      '/tags/0/parent',
      '/tags/1/parent',
      '/tags/2/parent',
    ])
    expect(run(tagParent, doc({ openapi: '3.1.0', tags })).findings).toEqual([])
  })
})
