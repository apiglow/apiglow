import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadApiModel, SchemaLoadError } from '../src/openapi/loader.js'
import { effectiveBaseUrl } from '../src/openapi/request-builder.js'
import { serverUrl } from '../src/openapi/servers.js'

// The four input formats the app claims for the schema document
// (docs/registry/specs-registry.md): OpenAPI 3.x and Swagger 2.0, each
// serialized as JSON or YAML. The inline path is covered by
// loader-inline.test.js; this file covers the URL path, where the format is
// not chosen by us but guessed by ref-parser from the URL.

const YAML_31 = [
  'openapi: 3.1.0',
  'info:',
  '  title: Remote YAML',
  '  version: "1.0"',
  'paths:',
  '  /pets:',
  '    get:',
  '      operationId: listPets',
  '      responses:',
  '        "200":',
  '          description: ok',
  '          content:',
  '            application/json:',
  '              schema:',
  '                $ref: "#/components/schemas/Pet"',
  'components:',
  '  schemas:',
  '    Pet:',
  '      type: object',
  '      properties:',
  '        name:',
  '          type: string',
].join('\n')

const JSON_30 = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Remote JSON', version: '1.0' },
  paths: {
    '/pets': { get: { operationId: 'listPets', responses: { 200: { description: 'ok' } } } },
  },
})

const YAML_SWAGGER_2 = [
  'swagger: "2.0"',
  'info:',
  '  title: Remote Swagger YAML',
  '  version: "1.0"',
  'host: api.example.com',
  'basePath: /v1',
  'schemes: [https]',
  'paths:',
  '  /pets:',
  '    get:',
  '      operationId: listPets',
  '      responses:',
  '        "200":',
  '          description: ok',
].join('\n')

// One stub for both fetches loadApiModel makes: its own classification fetch,
// then ref-parser's through `fetchHttpResolver`.
function serve(body, status = 200) {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? { ok: true, status, text: async () => body }
      : { ok: false, status, text: async () => '' },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('loadApiModel', () => {
  it('reads a JSON document', async () => {
    serve(JSON_30)
    const { model } = await loadApiModel('https://api.example.com/openapi.json')
    expect(model.info.title).toBe('Remote JSON')
    expect(model.operations[0].id).toBe('listPets')
  })

  it('reads a YAML document and resolves its internal $ref', async () => {
    serve(YAML_31)
    const { model, source } = await loadApiModel('https://api.example.com/openapi.yaml')
    expect(model.info.title).toBe('Remote YAML')
    const schema = model.operations[0].responses[0].contents[0].schema
    expect(schema.properties.map((p) => p.name)).toEqual(['name'])
    // The audit's raw shape keeps its `$ref`s, as on the inline path.
    expect(source.paths['/pets'].get.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Pet',
    })
  })

  it('reads a .yml document', async () => {
    serve(YAML_31)
    const { model } = await loadApiModel('https://api.example.com/openapi.yml')
    expect(model.info.title).toBe('Remote YAML')
  })

  // The common real-world case: a spec served from a route rather than a file
  // (`/v3/api-docs`, `/openapi`). ref-parser picks its parser from the URL
  // extension, and there is none — it then falls back to trying every parser
  // in order, JSON first, so YAML still lands. This test is what guards that
  // fallback: were it to go, an extension-less YAML spec would parse as text
  // and surface as `invalid-schema` with nothing pointing at the cause.
  it('reads YAML served from an extension-less URL', async () => {
    serve(YAML_31)
    const { model } = await loadApiModel('https://api.example.com/v3/api-docs')
    expect(model.info.title).toBe('Remote YAML')
  })

  it('converts a Swagger 2.0 document written in YAML', async () => {
    serve(YAML_SWAGGER_2)
    const { model } = await loadApiModel('https://api.example.com/swagger.yaml')
    expect(model.info.title).toBe('Remote Swagger YAML')
    expect(model.servers[0].url).toBe('https://api.example.com/v1')
  })

  it('types the errors: HTTP status, malformed body, non-OpenAPI document', async () => {
    serve('', 404)
    await expect(loadApiModel('https://api.example.com/openapi.yaml')).rejects.toMatchObject({
      code: 'http',
      detail: { status: 404 },
    })
    // Neither JSON nor YAML: an unclosed flow mapping is malformed in both.
    serve('{ nope')
    await expect(loadApiModel('https://api.example.com/openapi.yaml')).rejects.toMatchObject({
      code: 'malformed',
    })
    serve('kind: not-an-api')
    await expect(loadApiModel('https://api.example.com/openapi.yaml')).rejects.toBeInstanceOf(
      SchemaLoadError,
    )
  })

  it('reports a fetch failure as a network error (down or CORS-blocked alike)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(loadApiModel('https://api.example.com/openapi.yaml')).rejects.toMatchObject({
      code: 'network',
    })
  })

  // The host's `openapi.url` is handed over as written, relative to the page.
  it('reads $self and resolves relative URLs against the document under a page-relative URL', async () => {
    vi.stubGlobal('location', { href: 'https://docs.example.com/guide/index.html' })
    serve(
      JSON.stringify({
        openapi: '3.2.0',
        $self: 'https://api.example.com/specs/openapi.json',
        info: { title: 'Self', version: '1.0' },
        paths: {
          '/ping': {
            get: { servers: [{ url: '/v2' }], responses: { 200: { description: 'ok' } } },
          },
        },
      }),
    )
    const { model } = await loadApiModel('specs/openapi.json')
    expect(model.baseUri).toBe('https://api.example.com/specs/openapi.json')
    expect(effectiveBaseUrl(model.operations[0])).toBe('https://api.example.com/v2')
  })

  it('resolves relative URLs against where a document without $self was read from', async () => {
    vi.stubGlobal('location', { href: 'https://docs.example.com/guide/index.html' })
    serve(JSON_30.replace('"paths"', '"servers":[{"url":"v1"}],"paths"'))
    const { model } = await loadApiModel('specs/openapi.json')
    expect(model.linkBase).toBe('https://docs.example.com/guide/specs/openapi.json')
    expect(serverUrl(model.servers[0])).toBe('https://docs.example.com/guide/specs/v1')
  })
})

// The strict read failed: the loader reads the text it already has
// (docs/architecture.md §14.21).
describe('loadApiModel on a text the strict read refuses', () => {
  const broken = new URL('fixtures/broken/', import.meta.url)
  const text = (name) => readFileSync(new URL(name, broken), 'utf8')

  // A `|+` block whose only line is blank: valid YAML that ref-parser's parser
  // refuses, and the shape of the OpenAI description.
  it('opens a valid YAML document the strict parser refused, with no problem', async () => {
    serve(text('keep-chomp.yaml'))
    const { model, problems } = await loadApiModel('https://api.example.com/openapi.yaml')
    expect(model.operations[0].description).toBe('\n')
    expect(problems).toEqual([])
  })

  it('opens a recoverable document fetched by URL, its problems kept', async () => {
    serve(text('tab.yaml'))
    const { model, problems } = await loadApiModel('https://api.example.com/openapi.yaml')
    expect(model.operations).toHaveLength(1)
    expect(problems.map(({ code, line }) => [code, line])).toEqual([['TAB_AS_INDENT', 5]])
  })

  it('says a JSON body is not JSON instead of reading it as YAML in silence', async () => {
    serve(text('trailing-comma.json'))
    const { problems } = await loadApiModel('https://api.example.com/openapi.json')
    expect(problems.map(({ code, line, column }) => [code, line, column])).toEqual([
      ['json', 1, 66],
    ])
  })

  // The CLI's seam: it reads the file, the core never touches the disk.
  it('reads the text handed over for a file: URL', async () => {
    const url = new URL('dup-key.yaml', broken)
    const { model, problems } = await loadApiModel(url.href, { body: text('dup-key.yaml') })
    expect(model.operations[0].summary).toBe('B')
    expect(problems.map((problem) => problem.code)).toEqual(['DUPLICATE_KEY'])
  })
})
