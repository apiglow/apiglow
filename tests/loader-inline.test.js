import { describe, expect, it } from 'vitest'
import { loadInlineApiModel, SchemaLoadError } from '../src/openapi/loader.js'

const DOC = {
  openapi: '3.1.0',
  info: { title: 'Inline API', version: '2.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: {
          200: {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  },
  components: { schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } } },
}

describe('loadInlineApiModel', () => {
  it('normalizes an object document and resolves its internal $ref', async () => {
    const { model } = await loadInlineApiModel(structuredClone(DOC))
    expect(model.info.title).toBe('Inline API')
    expect(model.operations).toHaveLength(1)
    const schema = model.operations[0].responses[0].contents[0].schema
    expect(schema.properties.map((p) => p.name)).toEqual(['name'])
  })

  it('accepts the same document as a JSON string', async () => {
    const { model } = await loadInlineApiModel(JSON.stringify(DOC))
    expect(model.operations[0].id).toBe('listPets')
  })

  // The audit reads both shapes (docs/audit.md §5): a dereferenced `$ref` is
  // indistinguishable from an inline definition, so the source is the only place
  // an unused component is observable.
  it('returns the source with its $refs intact next to the dereferenced document', async () => {
    const { source, document } = await loadInlineApiModel(structuredClone(DOC))
    const content = (doc) => doc.paths['/pets'].get.responses[200].content['application/json']
    expect(content(source).schema).toEqual({ $ref: '#/components/schemas/Pet' })
    expect(content(document).schema).toEqual(DOC.components.schemas.Pet)
  })

  it('does not mutate the host page document (ref-parser dereferences in place)', async () => {
    const source = structuredClone(DOC)
    const before = JSON.stringify(source)
    await loadInlineApiModel(source)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('applies hide options the same way as remote loading', async () => {
    const { model } = await loadInlineApiModel(structuredClone(DOC), { hide: ['listPets'] })
    expect(model.operations).toEqual([])
  })

  // A host page has every reason to paste the YAML it publishes rather than
  // convert it. ref-parser already carries a YAML parser: no new dependency,
  // The platform-first dependency rule holds (architecture.md §14.2).
  it('accepts an inline YAML document', async () => {
    const yaml = [
      'openapi: 3.1.0',
      'info:',
      '  title: Inline YAML',
      '  version: "2.0"',
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
    const { model, source } = await loadInlineApiModel(yaml)
    expect(model.info.title).toBe('Inline YAML')
    expect(model.operations[0].id).toBe('listPets')
    // Internal `$ref`s resolve exactly as they do for a JSON string.
    const schema = model.operations[0].responses[0].contents[0].schema
    expect(schema.properties.map((p) => p.name)).toEqual(['name'])
    // And the audit still gets the `$ref`-bearing source.
    expect(source.paths['/pets'].get.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Pet',
    })
  })

  it('resolves 3.2 $self as the document base', async () => {
    const { model } = await loadInlineApiModel({
      openapi: '3.2.0',
      $self: 'https://api.example.com/specs/pets.json',
      info: { title: 'Self', version: '1' },
      servers: [{ url: '/v2' }],
      paths: {},
    })
    expect(model.baseUri).toBe('https://api.example.com/specs/pets.json')
  })

  // A broken reference costs the reader what it points at, not the whole
  // document — and the audit names it (docs/audit.md, `ref-resolves`).
  it('loads a document whose $refs lead nowhere, leaving them as written', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Broken refs', version: '1' },
      paths: {
        '/pets': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/Missing' },
              { $ref: 'missing-file.yaml#/Limit' },
            ],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    }
    const { document, model } = await loadInlineApiModel(doc)
    expect(document.paths['/pets'].get.parameters).toEqual([
      { $ref: '#/components/parameters/Missing' },
      { $ref: 'missing-file.yaml#/Limit' },
    ])
    expect(model.operations).toHaveLength(1)
  })

  // ref-parser leaves `null` at every use of a chain through a missing pointer,
  // and names only the pointer in its errors.
  it('puts back a $ref whose chain breaks further down, next to an external one', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Broken chain', version: '1' },
      paths: {
        '/pets': {
          get: {
            parameters: [
              { $ref: '#/components/parameters/A' },
              { $ref: 'missing-file.yaml#/Limit' },
            ],
            responses: { 200: { description: 'OK' } },
          },
        },
      },
      components: { parameters: { A: { $ref: '#/components/parameters/Missing' } } },
    }
    const { document } = await loadInlineApiModel(doc)
    expect(document.paths['/pets'].get.parameters[0]).toEqual({ $ref: '#/components/parameters/A' })
    expect(document.components.parameters.A).toEqual({ $ref: '#/components/parameters/Missing' })
  })

  it('types the errors: unreadable JSON, unusable value, non-OpenAPI schema', async () => {
    // Neither JSON nor YAML: an unclosed flow mapping is malformed in both.
    await expect(loadInlineApiModel('{ nope')).rejects.toMatchObject({ code: 'malformed' })
    await expect(loadInlineApiModel(42)).rejects.toBeInstanceOf(SchemaLoadError)
    // 2.0 is converted, not rejected: the unsupported case is a Swagger
    // version with no conversion table.
    await expect(loadInlineApiModel({ swagger: '1.2' })).rejects.toMatchObject({
      code: 'unsupported-version',
    })
  })
})

// A text the strict read refuses is read tolerantly (docs/architecture.md
// §14.21): what can be recovered opens, with what is wrong in it as
// `problems`; what cannot says why, line and column, and carries what it holds.
describe('loadInlineApiModel on a text the strict read refuses', () => {
  const YAML = 'openapi: 3.1.0\ninfo:\n  title: T\n  version: "1"\npaths:\n  /a:\n    get:\n'
  const OPERATION = '      responses:\n        "200": { description: ok }\n'

  it('opens a document with a duplicate key, the problem kept for the audit', async () => {
    const loaded = await loadInlineApiModel(
      `${YAML}      summary: A\n      summary: B\n${OPERATION}`,
    )
    expect(loaded.model.operations[0].summary).toBe('B')
    expect(loaded.problems).toEqual([
      { code: 'DUPLICATE_KEY', line: 9, column: 7, detail: 'Map keys must be unique' },
    ])
  })

  it('opens JSON with a trailing comma, saying it is not JSON', async () => {
    const loaded = await loadInlineApiModel(JSON.stringify(DOC).replace(/}$/, ',}'))
    expect(loaded.model.operations[0].id).toBe('listPets')
    expect(loaded.source.info.title).toBe('Inline API')
    expect(loaded.problems.map((problem) => problem.code)).toEqual(['json'])
  })

  it('reports no problem on a text the strict read accepts', async () => {
    expect((await loadInlineApiModel(JSON.stringify(DOC))).problems).toEqual([])
    expect((await loadInlineApiModel(`${YAML}${OPERATION}`)).problems).toEqual([])
    expect((await loadInlineApiModel(structuredClone(DOC))).problems).toEqual([])
  })

  it('lists what is wrong when the recovered document is still unusable', async () => {
    const err = await loadInlineApiModel('{ nope').catch((error) => error)
    expect(err).toMatchObject({ code: 'malformed' })
    expect(err.detail.problems).toEqual([
      expect.objectContaining({ code: 'json', line: 1, column: 3 }),
    ])
  })

  it('stops on a well-formed text holding no mapping, carrying what it holds', async () => {
    for (const [text, content] of [
      ['- a\n- b\n', ['a', 'b']],
      ['hello world', 'hello world'],
      ['', undefined],
      ['[1, 2]', [1, 2]],
    ]) {
      const err = await loadInlineApiModel(text).catch((error) => error)
      expect(err, JSON.stringify(text)).toMatchObject({ code: 'invalid-schema' })
      expect(err.detail).toEqual({ problems: [], content })
    }
  })

  // The audit's reading (docs/audit.md §8): a version this app does not read is
  // graded anyway, with the newest semantics; the page keeps refusing it.
  it('reads any version under `anyVersion`, and only then', async () => {
    const v4 = { ...structuredClone(DOC), openapi: '4.0.0' }
    await expect(loadInlineApiModel(structuredClone(v4))).rejects.toMatchObject({
      code: 'unsupported-version',
    })
    const loaded = await loadInlineApiModel(structuredClone(v4), { anyVersion: true })
    expect(loaded.model.operations[0].id).toBe('listPets')
    expect(loaded.source.openapi).toBe('4.0.0')
    const { openapi: _, ...unversioned } = structuredClone(DOC)
    expect((await loadInlineApiModel(unversioned, { anyVersion: true })).model.info.title).toBe(
      'Inline API',
    )
    const swagger = await loadInlineApiModel({ swagger: '1.2', apis: [] }, { anyVersion: true })
    expect(swagger.model.operations).toEqual([])
  })
})
