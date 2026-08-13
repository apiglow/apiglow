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
