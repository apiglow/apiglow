import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { additionalOperationMethod } from '../src/audit/rules/additional-operation-method.js'
import { headerNameToken } from '../src/audit/rules/header-name-token.js'
import { headerParameterIgnored } from '../src/audit/rules/header-parameter-ignored.js'
import { parameterStyleValid } from '../src/audit/rules/parameter-style-valid.js'
import { parametersUnique } from '../src/audit/rules/parameters-unique.js'
import { pathSyntax } from '../src/audit/rules/path-syntax.js'
import { pathsAmbiguous } from '../src/audit/rules/paths-ambiguous.js'
import { pathsIdentical } from '../src/audit/rules/paths-identical.js'
import { querystringParameter } from '../src/audit/rules/querystring-parameter.js'
import { serverVariables } from '../src/audit/rules/server-variables.js'
import { auditContext, doc, okResponse } from './audit-context.js'

// The structural rules of docs/audit.md §4.1 on paths, parameters and servers.

const run = (rule, document, options) => runRule(rule, auditContext(document, options))
const get = (extra = {}) => ({ get: { responses: okResponse, ...extra } })
const paths = (...keys) => doc({ paths: Object.fromEntries(keys.map((key) => [key, get()])) })
const flagged = (result) => result.findings.map((f) => f.params.path ?? f.dataPath)

describe('path-syntax', () => {
  it('passes well-formed templates', () => {
    const result = run(pathSyntax, paths('/pets', '/pets/{petId}', '/files/{name}.{ext}', '/'))
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a key that is not a path template', () => {
    const result = run(
      pathSyntax,
      paths(
        'pets',
        '/pets/{id',
        '/pets/{{id}}',
        '/pets/{}',
        '/a/{id}/b/{id}',
        '/search?q={q}',
        '/x#y',
      ),
    )
    expect(flagged(result)).toEqual([
      'pets',
      '/pets/{id',
      '/pets/{{id}}',
      '/pets/{}',
      '/a/{id}/b/{id}',
      '/search?q={q}',
      '/x#y',
    ])
    expect(result.findings[0]).toMatchObject({
      dataPath: '/paths/pets',
      location: 'pets',
      opRef: 'get-pets',
      severity: 'error',
    })
  })

  it('leaves webhook names alone', () => {
    const result = run(
      pathSyntax,
      doc({ webhooks: { 'pet adopted?': { post: { responses: okResponse } } } }),
    )
    expect(result.findings).toEqual([])
  })
})

describe('paths-identical', () => {
  it('passes paths that differ by more than variable names', () => {
    const result = run(pathsIdentical, paths('/pets/{id}', '/pets/{id}/toys', '/stores/{id}'))
    expect(result.findings).toEqual([])
  })

  it('flags the second of two paths identical but for their variable names', () => {
    const result = run(pathsIdentical, paths('/pets/{id}', '/pets/mine', '/pets/{petId}'))
    expect(result.findings.map((f) => f.params)).toEqual([
      { path: '/pets/{petId}', other: '/pets/{id}' },
    ])
  })
})

describe('paths-ambiguous', () => {
  it('passes what concrete-first matching orders', () => {
    const result = run(
      pathsAmbiguous,
      paths('/pets/{id}', '/pets/mine', '/{entity}/{id}', '/pets/{id}/toys'),
    )
    expect(result.findings).toEqual([])
  })

  it('flags two paths each literal where the other is templated', () => {
    const result = run(pathsAmbiguous, paths('/{entity}/me', '/books/{id}', '/books/{id}/x'))
    expect(result.findings.map((f) => f.params)).toEqual([
      { path: '/books/{id}', other: '/{entity}/me' },
    ])
    expect(result.findings[0].severity).toBe('info')
  })
})

describe('parameters-unique', () => {
  const param = (name, location = 'query') => ({ name, in: location, schema: { type: 'string' } })

  it('passes distinct parameters, and an operation overriding its Path Item', () => {
    const result = run(
      parametersUnique,
      doc({
        paths: {
          '/pets': {
            parameters: [param('limit')],
            get: { parameters: [param('limit'), param('limit', 'header')], responses: okResponse },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 0, findings: [] })
  })

  it('flags a list naming one parameter twice, header names without case', () => {
    const result = run(
      parametersUnique,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [
                param('limit'),
                param('X-Trace', 'header'),
                param('limit'),
                param('x-trace', 'header'),
              ],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params])).toEqual([
      ['/paths/~1pets/get/parameters/2', { name: 'limit', in: 'query' }],
      ['/paths/~1pets/get/parameters/3', { name: 'x-trace', in: 'header' }],
    ])
  })
})

describe('header-parameter-ignored', () => {
  it('passes ordinary headers', () => {
    const result = run(
      headerParameterIgnored,
      doc({
        paths: {
          '/a': {
            get: {
              parameters: [
                { name: 'X-Trace', in: 'header', schema: {} },
                { name: 'accept', in: 'query', schema: {} },
              ],
              responses: { 200: { description: 'OK', headers: { 'X-Rate': { schema: {} } } } },
            },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags the headers the specification says to ignore', () => {
    const result = run(
      headerParameterIgnored,
      doc({
        paths: {
          '/a': {
            get: {
              parameters: [
                { name: 'Authorization', in: 'header', schema: {} },
                { name: 'content-type', in: 'header', schema: {} },
              ],
              responses: {
                200: { description: 'OK', headers: { 'Content-Type': { schema: {} } } },
              },
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.dataPath)).toEqual([
      '/paths/~1a/get/parameters/0',
      '/paths/~1a/get/parameters/1',
      '/paths/~1a/get/responses/200/headers/Content-Type',
    ])
  })
})

describe('header-name-token', () => {
  it('passes token names', () => {
    const result = run(
      headerNameToken,
      doc({
        paths: {
          '/a': {
            get: {
              parameters: [
                { name: 'X-Request-Id', in: 'header', schema: {} },
                { name: 'a b', in: 'query', schema: {} },
              ],
              responses: {
                200: { description: 'OK', headers: { 'X-Rate-Limit': { schema: {} } } },
              },
            },
          },
        },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags a header name no request can carry', () => {
    const result = run(
      headerNameToken,
      doc({
        paths: {
          '/a': {
            post: {
              parameters: [{ name: 'X Trace', in: 'header', schema: {} }],
              requestBody: {
                content: {
                  'multipart/form-data': {
                    schema: { type: 'object', properties: { file: {} } },
                    encoding: { file: { headers: { 'X-Clé': { schema: {} } } } },
                  },
                },
              },
              responses: { 200: { description: 'OK', headers: { 'Rate:Limit': { schema: {} } } } },
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => f.params.name)).toEqual(['X Trace', 'X-Clé', 'Rate:Limit'])
  })
})

describe('parameter-style-valid', () => {
  const style = (parameter) =>
    run(
      parameterStyleValid,
      doc({ paths: { '/a/{id}': { get: { parameters: [parameter], responses: okResponse } } } }),
    )

  it('passes a style its location and type allow', () => {
    for (const parameter of [
      { name: 'id', in: 'path', required: true, style: 'label', schema: { type: 'string' } },
      { name: 'q', in: 'query', style: 'deepObject', schema: { type: 'object' } },
      { name: 'q', in: 'query', style: 'pipeDelimited', schema: { type: ['array', 'null'] } },
      { name: 'q', in: 'query', style: 'spaceDelimited' },
      { name: 'q', in: 'query', style: 'nonsense' },
    ]) {
      expect(style(parameter).findings, JSON.stringify(parameter)).toEqual([])
    }
  })

  it('flags a style its location or its type does not allow', () => {
    for (const parameter of [
      { name: 'q', in: 'query', style: 'matrix', schema: { type: 'string' } },
      { name: 'h', in: 'header', style: 'form', schema: { type: 'string' } },
      { name: 'q', in: 'query', style: 'deepObject', schema: { type: 'array' } },
      { name: 'q', in: 'query', style: 'spaceDelimited', schema: { type: 'string' } },
      { name: 'q', in: 'querystring', style: 'form', content: {} },
    ]) {
      const { findings } = style(parameter)
      expect(findings, JSON.stringify(parameter)).toHaveLength(1)
      expect(findings[0]).toMatchObject({ dataPath: '/paths/~1a~1{id}/get/parameters/0/style' })
    }
  })
})

describe('querystring-parameter', () => {
  const qs = (
    name,
    extra = { content: { 'application/x-www-form-urlencoded': { schema: {} } } },
  ) => ({
    name,
    in: 'querystring',
    ...extra,
  })

  it('passes one querystring parameter described with content', () => {
    const result = run(
      querystringParameter,
      doc({
        openapi: '3.2.0',
        paths: { '/a': { get: { parameters: [qs('q')], responses: okResponse } } },
      }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags schema, a second one, and query parameters beside it', () => {
    const result = run(
      querystringParameter,
      doc({
        openapi: '3.2.0',
        paths: {
          '/a': {
            parameters: [{ name: 'limit', in: 'query', schema: {} }],
            get: {
              parameters: [qs('q'), qs('r', { schema: { type: 'string' } })],
              responses: okResponse,
            },
          },
        },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.params])).toEqual([
      ['/paths/~1a/get/parameters/1/schema', { name: 'r', conflict: 'schema' }],
      ['/paths/~1a/get/parameters/1', { name: 'r', conflict: 'q' }],
      ['/paths/~1a/get/parameters/0', { name: 'q', conflict: 'limit' }],
    ])
  })
})

describe('additional-operation-method', () => {
  const additional = (methods) =>
    run(
      additionalOperationMethod,
      doc({
        openapi: '3.2.0',
        paths: {
          '/a': {
            additionalOperations: Object.fromEntries(
              methods.map((m) => [m, { responses: okResponse }]),
            ),
          },
        },
      }),
    )

  it('passes methods with no field of their own', () => {
    expect(additional(['COPY', 'LINK', 'PROPFIND']).findings).toEqual([])
  })

  it('flags a method the Path Item has a field for, whatever its case, and a non-token', () => {
    const result = additional(['POST', 'query', 'GET users', 'COPY'])
    expect(result.findings.map((f) => f.params.method)).toEqual(['POST', 'query', 'GET users'])
    expect(result.findings[0].dataPath).toBe('/paths/~1a/additionalOperations/POST')
  })
})

describe('server-variables', () => {
  const server = (entry, openapi = '3.1.0') =>
    run(serverVariables, doc({ openapi, servers: [entry] }))

  it('passes variables with valid values', () => {
    const result = server({
      url: 'https://{region}.example.com/{version}',
      variables: {
        region: { default: 'eu', enum: ['eu', 'us'] },
        version: { default: 'v1' },
        unused: { default: 'x' },
      },
    })
    expect(result.findings).toEqual([])
  })

  it('flags an undefined variable, a default outside its enum and an empty enum', () => {
    const result = server({
      url: 'https://{region}.example.com/{version}/{tenant}',
      variables: {
        region: { default: 'ap', enum: ['eu', 'us'] },
        version: { default: 'v1', enum: [] },
      },
    })
    expect(result.findings.map((f) => [f.dataPath, f.params.name])).toEqual([
      ['/servers/0/url', 'tenant'],
      ['/servers/0/variables/region/default', 'region'],
      ['/servers/0/variables/version/enum', 'version'],
    ])
  })

  it('reads servers at every level, and lets 3.0 keep an empty enum', () => {
    const result = run(
      serverVariables,
      doc({
        openapi: '3.0.3',
        servers: [{ url: 'https://api.example.com', variables: { v: { default: 'x', enum: [] } } }],
        paths: { '/a': { get: { servers: [{ url: 'https://{host}' }], responses: okResponse } } },
      }),
    )
    expect(result.findings.map((f) => [f.dataPath, f.opRef])).toEqual([
      ['/paths/~1a/get/servers/0/url', 'get-a'],
    ])
  })
})
