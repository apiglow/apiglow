import { describe, expect, it } from 'vitest'
import { parseCurl } from '../src/import/curl.js'
import { isAmbiguous, matchOperation } from '../src/import/match.js'
import { buildModel } from '../src/openapi/loader.js'

// From a draft to an operation of the model, and to the try-it state that
// pre-fills it. The cases that matter are the ones where a wrong guess would be
// invisible: the operation picked, the bucket a value lands in, and where a
// credential goes.

const DOC = {
  openapi: '3.0.3',
  info: { title: 'Import', version: '1' },
  servers: [{ url: 'https://api.test/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      basicAuth: { type: 'http', scheme: 'basic' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      queryKeyAuth: { type: 'apiKey', in: 'query', name: 'api_key' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
        ],
        responses: { 200: { description: 'ok' } },
      },
      post: {
        operationId: 'createPet',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
            'application/x-www-form-urlencoded': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, tag: { type: 'string' } },
              },
            },
          },
        },
        responses: { 201: { description: 'ok' } },
      },
    },
    '/pets/search': {
      get: { operationId: 'searchPets', responses: { 200: { description: 'ok' } } },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        security: [{ basicAuth: [] }, { apiKeyAuth: [] }, { queryKeyAuth: [] }],
        responses: { 200: { description: 'ok' } },
      },
    },
    // The pair that cannot be told apart for `/reports/latest`: one literal
    // matched on each side, in different positions.
    '/{group}/latest': {
      get: {
        operationId: 'latestOfGroup',
        parameters: [{ name: 'group', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'ok' } },
      },
    },
    '/reports/{reportId}': {
      get: {
        operationId: 'getReport',
        parameters: [{ name: 'reportId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'ok' } },
      },
    },
    '/upload': {
      post: {
        operationId: 'upload',
        requestBody: {
          content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
        },
        responses: { 200: { description: 'ok' } },
      },
    },
  },
}

const model = buildModel(structuredClone(DOC))
const match = (command, options) => matchOperation(model, parseCurl(command).requests[0], options)
const first = (command, options) => match(command, options).candidates[0]

describe('operation matching', () => {
  it('strips a declared server prefix and picks the operation', () => {
    const candidate = first(`curl https://api.test/v1/pets`)
    expect(candidate.op.id).toBe('listPets')
  })

  it('matches a bare route as well as a full URL', () => {
    expect(first(`curl /pets/7`).op.id).toBe('getPet')
    expect(first(`curl https://api.test/v1/pets/7`).op.id).toBe('getPet')
  })

  it('strips an environment base URL the document never declared', () => {
    const candidate = first(`curl https://staging.test/api/pets`, {
      baseUrls: ['https://staging.test/api'],
    })
    expect(candidate.op.id).toBe('listPets')
  })

  it('prefers a literal segment over a parameter one', () => {
    const { candidates } = match(`curl https://api.test/v1/pets/search`)
    expect(candidates[0].op.id).toBe('searchPets')
    expect(isAmbiguous(candidates)).toBe(false)
  })

  it('presents both when two templates fit equally well', () => {
    const { candidates } = match(`curl https://api.test/v1/reports/latest`)
    expect(isAmbiguous(candidates)).toBe(true)
    expect(candidates.map((c) => c.op.id).sort()).toEqual(['getReport', 'latestOfGroup'])
  })

  it('separates operations by method', () => {
    expect(first(`curl -X POST https://api.test/v1/pets`).op.id).toBe('createPet')
  })

  it('returns nothing rather than a guess when no route fits', () => {
    expect(match(`curl https://api.test/v1/nowhere`).candidates).toEqual([])
  })

  it('reports an unreadable URL instead of throwing', () => {
    expect(matchOperation(model, { method: 'GET', url: '' })).toEqual({
      candidates: [],
      warnings: [{ code: 'import-url-invalid' }],
    })
  })
})

describe('pre-filled try-it state', () => {
  it('fills path values and reads array query parameters as lists', () => {
    const candidate = first(`curl 'https://api.test/v1/pets?status=sold&tags=cat&tags=dog'`)
    expect(candidate.request.query).toEqual({ status: 'sold', tags: ['cat', 'dog'] })
    expect(first(`curl https://api.test/v1/pets/a%20b`).request.path).toEqual({ petId: 'a b' })
  })

  it('picks the media type from Content-Type and stops repeating it as a header', () => {
    const candidate = first(
      `curl -X POST https://api.test/v1/pets -H 'Content-Type: application/x-www-form-urlencoded' -d 'name=Rex&tag=dog'`,
    )
    expect(candidate.request.mediaTypeIndex).toBe(1)
    expect(candidate.request.headers).toEqual([])
    // A urlencoded body IS the field list: it goes to the editor the media type
    // opens, not into a textarea nothing would show.
    expect(candidate.request.formFields).toEqual([
      { name: 'name', value: 'Rex' },
      { name: 'tag', value: 'dog' },
    ])
    expect(candidate.request.body).toBeNull()
  })

  it('keeps a JSON body as text and keeps an unmatched Content-Type as a header', () => {
    const json = first(
      `curl -X POST https://api.test/v1/pets -H 'Content-Type: application/json' -d '{"name":"Rex"}'`,
    )
    expect(json.request.mediaTypeIndex).toBe(0)
    expect(json.request.body).toBe('{"name":"Rex"}')

    const other = first(
      `curl -X POST https://api.test/v1/pets -H 'Content-Type: text/csv' -d 'a,b'`,
    )
    expect(other.request.headers).toEqual([{ name: 'Content-Type', value: 'text/csv' }])
  })

  it('drops the headers a browser refuses to set, and says so for cookies', () => {
    const candidate = first(
      `curl https://api.test/v1/pets -H 'Host: api.test' -H 'Content-Length: 3' -H 'X-Trace: t1' -H 'Cookie: sid=1'`,
    )
    expect(candidate.request.headers).toEqual([{ name: 'X-Trace', value: 't1' }])
    expect(candidate.warnings).toContainEqual({ code: 'import-cookie-dropped', value: 'sid=1' })
  })

  it('does not pretend to carry a file body', () => {
    const candidate = first(`curl -X POST https://api.test/v1/upload --data-binary @dog.png`)
    expect(candidate.request.body).toBeNull()
    expect(candidate.warnings).toContainEqual({ code: 'import-body-file' })
  })

  it('warns when the body has nowhere to go', () => {
    const candidate = first(`curl -X GET https://api.test/v1/pets -d 'a=1'`)
    expect(candidate.warnings).toContainEqual({ code: 'import-body-undeclared' })
  })
})

describe('credentials', () => {
  it('turns a bearer token into the scheme its own variable', () => {
    const candidate = first(`curl https://api.test/v1/pets -H 'Authorization: Bearer tok-1'`)
    expect(candidate.variables).toEqual({ 'auth.bearerAuth': { value: 'tok-1', sensitive: true } })
    expect(candidate.request.authSchemeName).toBe('bearerAuth')
    // The raw header is gone: the injection rebuilds it from the variable.
    expect(candidate.request.headers).toEqual([])
  })

  it('splits a basic credential into its two conventional variables', () => {
    const fromHeader = first(
      `curl https://api.test/v1/pets/7 -H 'Authorization: Basic ${btoa('alice:s3cret')}'`,
    )
    expect(fromHeader.variables).toEqual({
      'auth.basicAuth.username': { value: 'alice', sensitive: false },
      'auth.basicAuth.password': { value: 's3cret', sensitive: true },
    })
    const fromFlag = first(`curl https://api.test/v1/pets/7 -u alice:s3cret`)
    expect(fromFlag.variables).toEqual(fromHeader.variables)
  })

  it('recognizes an api key by the parameter name the document declared', () => {
    const inHeader = first(`curl https://api.test/v1/pets/7 -H 'X-Api-Key: k-1'`)
    expect(inHeader.variables).toEqual({ 'auth.apiKeyAuth': { value: 'k-1', sensitive: true } })
    expect(inHeader.request.headers).toEqual([])

    const inQuery = first(`curl 'https://api.test/v1/pets/7?api_key=k-2'`)
    expect(inQuery.variables).toEqual({ 'auth.queryKeyAuth': { value: 'k-2', sensitive: true } })
    expect(inQuery.request.query).toEqual({})
  })

  it('keeps an unmatched Authorization header as a header, and says why', () => {
    // getPet declares basic / apiKey only: a bearer token belongs to no scheme
    // of ITS security requirement.
    const candidate = first(`curl https://api.test/v1/pets/7 -H 'Authorization: Bearer tok-1'`)
    expect(candidate.variables).toEqual({})
    expect(candidate.request.headers).toEqual([{ name: 'Authorization', value: 'Bearer tok-1' }])
    expect(candidate.warnings).toContainEqual({ code: 'import-credential-unmatched' })
  })

  it('ignores an Authorization header it cannot decode', () => {
    const candidate = first(`curl https://api.test/v1/pets/7 -H 'Authorization: Basic @@@'`)
    expect(candidate.variables).toEqual({})
    expect(candidate.request.headers).toHaveLength(1)
  })
})
