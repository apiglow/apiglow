import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { buildModel, SchemaLoadError } from '../src/openapi/loader.js'
import { normalizeSchema, slugify, toSerializable } from '../src/openapi/model.js'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const load = async (name) => buildModel(await $RefParser.dereference(fixture(name)))

const opById = (model, id) => model.operations.find((o) => o.id === id)
const paramOf = (op, name) => op.parameters.find((p) => p.name === name)
const propOf = (schema, name) => schema.properties.find((p) => p.name === name).schema

describe('3.0 normalization', () => {
  it('extracts operations with id, fallback id, and groups', async () => {
    const model = await load('petstore-3.0.json')
    expect(model.operations.map((o) => o.id)).toEqual([
      'listPets',
      'post-pets',
      'getPet',
      'delete-pets-petid',
    ])
    expect(model.groups).toEqual([
      {
        tag: 'pets',
        description: 'Everything about pets',
        operationIds: ['listPets', 'post-pets', 'getPet'],
      },
      { tag: null, operationIds: ['delete-pets-petid'] },
    ])
  })

  it('inherits path parameters and applies the operation override (name + in)', async () => {
    const model = await load('petstore-3.0.json')
    // Overridden at the operation level: type goes from integer to string
    expect(paramOf(opById(model, 'getPet'), 'petId').schema.type).toBe('string')
    // Inherited as-is from the path level
    const inherited = paramOf(opById(model, 'delete-pets-petid'), 'petId')
    expect(inherited.schema.type).toBe('integer')
    expect(inherited.required).toBe(true)
  })

  it('resolves parameter serialization, defaults included', async () => {
    const model = await load('petstore-3.0.json')
    const limit = paramOf(opById(model, 'listPets'), 'limit')
    expect([limit.style, limit.explode]).toEqual(['form', true])
    const petId = paramOf(opById(model, 'getPet'), 'petId')
    expect([petId.style, petId.explode]).toEqual(['simple', false])

    const explicit = buildModel({
      openapi: '3.0.3',
      paths: {
        '/pets': {
          get: {
            operationId: 'findPets',
            parameters: [
              {
                name: 'tags',
                in: 'query',
                style: 'pipeDelimited',
                schema: { type: 'array', items: { type: 'string' } },
              },
            ],
            responses: {},
          },
        },
      },
    })
    const tags = paramOf(opById(explicit, 'findPets'), 'tags')
    // explode defaults to false as soon as the style isn't `form`.
    expect([tags.style, tags.explode]).toEqual(['pipeDelimited', false])
  })

  it('normalizes 3.0 boolean exclusiveMaximum to the numeric bound', async () => {
    const model = await load('petstore-3.0.json')
    const limit = paramOf(opById(model, 'listPets'), 'limit').schema
    expect(limit.exclusiveMaximum).toBe(100)
    expect(limit.maximum).toBeUndefined()
    expect(limit.minimum).toBe(1)
  })

  it('normalizes 3.0 nullable into a nullable flag', async () => {
    const model = await load('petstore-3.0.json')
    const status = paramOf(opById(model, 'listPets'), 'status').schema
    expect(status.type).toBe('string')
    expect(status.nullable).toBe(true)
  })

  it('unifies scalar example into an examples array', async () => {
    const model = await load('petstore-3.0.json')
    expect(paramOf(opById(model, 'listPets'), 'limit').schema.examples).toEqual([10])
    expect(paramOf(opById(model, 'listPets'), 'limit').examples).toEqual([{ value: 10 }])
  })

  it('preserves the distinction between absent security (null) and disabled ([])', async () => {
    const model = await load('petstore-3.0.json')
    expect(opById(model, 'listPets').security).toBeNull()
    expect(opById(model, 'post-pets').security).toEqual([])
    expect(model.security).toEqual([{ bearerAuth: [] }])
  })

  it('normalizes securitySchemes', async () => {
    const model = await load('petstore-3.0.json')
    expect(model.securitySchemes).toEqual([
      { name: 'bearerAuth', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    ])
  })

  it('renders allOf as an unmerged composite', async () => {
    const model = await load('petstore-3.0.json')
    const body = opById(model, 'post-pets').requestBody
    expect(body.required).toBe(true)
    const schema = body.contents[0].schema
    expect(schema.kind).toBe('composite')
    expect(schema.composite.keyword).toBe('allOf')
    expect(schema.composite.variants).toHaveLength(2)
    expect(body.contents[0].examples).toEqual([
      { name: 'doggie', summary: 'A dog', value: { name: 'Rex', tag: 'dog' } },
    ])
  })

  it('retains the component name behind a dereferenced $ref', async () => {
    const model = await load('petstore-3.0.json')
    // The body is the NewPet component, whose first allOf variant is Pet.
    const body = opById(model, 'post-pets').requestBody.contents[0].schema
    expect(body.schemaName).toBe('NewPet')
    expect(body.composite.variants[0].schemaName).toBe('Pet')
    // An inline-declared schema has no component name.
    expect(paramOf(opById(model, 'listPets'), 'limit').schema.schemaName).toBeUndefined()
  })
})

describe('webhooks & callbacks', () => {
  it('normalizes 3.1 webhooks into kind=webhook operations, outside the groups', async () => {
    const model = await load('webhooks-3.1.json')
    expect(model.operations).toEqual([])
    expect(model.groups).toEqual([])
    expect(model.webhooks.map((w) => w.id)).toEqual(['webhook-post-petadopted', 'petLostHook'])
    const webhook = model.webhooks[0]
    expect(webhook.kind).toBe('webhook')
    expect(webhook.name).toBe('petAdopted')
    expect(webhook.method).toBe('post')
    expect(paramOf(webhook, 'X-Webhook-Signature').in).toBe('header')
    expect(webhook.requestBody.contents[0].examples).toEqual([
      { value: { petId: 1, adopterEmail: 'jane@example.com' } },
    ])
  })

  it('a 3.0 document has an empty webhooks array', async () => {
    const model = await load('petstore-3.0.json')
    expect(model.webhooks).toEqual([])
  })

  it('normalizes callbacks at the operation level (name → expression → operations)', async () => {
    const model = await load('petstore-3.0.json')
    const callbacks = opById(model, 'post-pets').callbacks
    expect(callbacks).toHaveLength(1)
    expect(callbacks[0].name).toBe('onPetStatus')
    const { expression, operations } = callbacks[0].expressions[0]
    expect(expression).toBe('{$request.body#/callbackUrl}')
    expect(operations[0].method).toBe('post')
    expect(operations[0].summary).toBe('Status update')
    expect(operations[0].requestBody.contents[0].schema.kind).toBe('object')
    // An operation without callbacks does not have the key at all (prune).
    expect(opById(model, 'listPets').callbacks).toBeUndefined()
  })
})

describe('3.0 / 3.1 equivalence', () => {
  it('produces an identical model for the same API expressed in both versions', async () => {
    const strip = (model) => ({ ...model, sourceVersion: null, info: null })
    expect(strip(await load('petstore-3.1.json'))).toEqual(strip(await load('petstore-3.0.json')))
  })
})

describe('3.2 normalization', () => {
  it('accepts the version and absorbs the query method and additionalOperations', async () => {
    const model = await load('petstore-3.2.json')
    expect(model.sourceVersion).toBe('3.2.0')
    // Order: standard Path Item methods, `query` last, then free-form
    // methods. `GET` redeclared in additionalOperations is ignored.
    expect(model.operations.map((o) => [o.method, o.id])).toEqual([
      ['get', 'listPets'],
      ['query', 'searchPets'],
      ['purge', 'purgePets'],
      ['get', 'streamPets'],
      ['get', 'findPets'],
    ])
  })

  it('exposes the response summary, description falls back to the empty string', async () => {
    const response = opById(await load('petstore-3.2.json'), 'listPets').responses[0]
    expect(response.summary).toBe('A paged array of pets')
    expect(response.description).toBe('')
  })

  it('normalizes itemSchema of sequential media types', async () => {
    const stream = opById(await load('petstore-3.2.json'), 'streamPets').responses[0].contents[0]
    expect(stream.mediaType).toBe('text/event-stream')
    expect(stream.itemSchema.properties.map((p) => p.name)).toEqual(['id', 'name'])
    // No `schema` declared: the usual unconstrained node.
    expect(stream.schema).toEqual({ kind: 'any' })
  })

  it('reads dataValue and serializedValue as example values', async () => {
    const model = await load('petstore-3.2.json')
    expect(opById(model, 'listPets').responses[0].contents[0].examples[0].value).toEqual([
      { id: 1, name: 'Rex' },
    ])
    expect(paramOf(opById(model, 'findPets'), 'filter').examples[0].value).toBe(
      "$.pets[?(@.name=='Rex')]",
    )
  })

  it('keeps the in: querystring parameter as-is', async () => {
    expect(paramOf(opById(await load('petstore-3.2.json'), 'findPets'), 'filter').in).toBe(
      'querystring',
    )
  })

  it('models tag summary/parent/kind and server name', async () => {
    const model = await load('petstore-3.2.json')
    expect(model.tags).toEqual([
      { name: 'pets', summary: 'Pets', description: 'Everything about pets', kind: 'nav' },
      { name: 'search', summary: 'Search', parent: 'pets', kind: 'nav' },
    ])
    expect(model.servers[0].name).toBe('prod')
  })

  it('models deprecated security schemes and the deviceAuthorization flow', async () => {
    const schemes = (await load('petstore-3.2.json')).securitySchemes
    expect(schemes.find((s) => s.name === 'legacyKey').deprecated).toBe(true)
    const device = schemes.find((s) => s.name === 'deviceAuth')
    expect(device.oauth2MetadataUrl).toBe(
      'https://auth.example.com/.well-known/oauth-authorization-server',
    )
    expect(device.flows[0]).toMatchObject({
      key: 'deviceAuthorization',
      deviceAuthorizationUrl: 'https://auth.example.com/device',
      tokenUrl: 'https://auth.example.com/token',
    })
  })
})

describe('JSON Schema 2020-12 keywords', () => {
  const payment = async () =>
    opById(await load('keywords-3.1.json'), 'createPayment').requestBody.contents[0].schema
  const receipt = async () =>
    opById(await load('keywords-3.1.json'), 'createPayment').responses[0].contents[0].schema

  it('gathers if/then/else into one branch object, and models not', async () => {
    const schema = await payment()
    expect(Object.keys(schema.conditional)).toEqual(['if', 'then', 'else'])
    expect(propOf(schema.conditional.if, 'method').enum).toEqual(['card'])
    expect(schema.conditional.then.required).toEqual(['cardNumber'])
    expect(schema.conditional.else.required).toEqual(['iban'])
    expect(schema.not.required).toEqual(['legacyToken'])
  })

  it('infers no type from a conditional: the schema stays unconstrained', () => {
    // biome-ignore lint/suspicious/noThenProperty: JSON Schema keyword.
    const raw = { if: { type: 'string' }, then: { maxLength: 4 } }
    const node = normalizeSchema(raw)
    expect(node.kind).toBe('any')
    // Absent branches are omitted rather than carried as undefined.
    expect('else' in node.conditional).toBe(false)
  })

  it('models the object applicators, and infers object from them', async () => {
    const labels = propOf(await payment(), 'labels')
    expect(labels.patternProperties.map((p) => p.pattern)).toEqual(['^x-', '^n-'])
    expect(labels.patternProperties[1].schema.type).toBe('integer')
    expect(labels.propertyNames.pattern).toBe('^[a-z-]+$')
    expect(labels.unevaluatedProperties).toBe(false)
    expect(normalizeSchema({ patternProperties: { '^x-': { type: 'string' } } }).kind).toBe(
      'object',
    )
    expect(normalizeSchema({ propertyNames: { pattern: '^a' } }).kind).toBe('object')
  })

  it('keeps dependentRequired as data and dependentSchemas as nodes', async () => {
    const schema = await payment()
    expect(schema.dependentRequired).toEqual({ cardNumber: ['cvv'] })
    expect(schema.dependentSchemas).toHaveLength(1)
    expect(schema.dependentSchemas[0].name).toBe('iban')
    expect(propOf(schema.dependentSchemas[0].schema, 'bic').type).toBe('string')
  })

  it('models contains with its bounds, and infers array from it', async () => {
    const tags = propOf(await payment(), 'tags')
    expect(tags.kind).toBe('array')
    expect(tags.contains.enum).toEqual(['priority'])
    expect([tags.minContains, tags.maxContains]).toEqual([1, 2])
    expect(tags.unevaluatedItems).toBe(false)
  })

  it('keeps contentEncoding and contentMediaType', async () => {
    const attachment = propOf(await payment(), 'attachment')
    expect(attachment.contentEncoding).toBe('base64')
    expect(attachment.contentMediaType).toBe('image/png')
  })

  it('names a $defs schema, like a components.schemas one', async () => {
    const schema = await payment()
    expect(propOf(schema, 'currency').schemaName).toBe('Currency')
    // Referenced twice, normalized once: the memo preserves the sharing, so
    // both places display the same name.
    expect(propOf(schema, 'refundCurrency')).toBe(propOf(schema, 'currency'))
  })

  it('degrades a self-referencing if exactly like a cyclic items', async () => {
    const schema = await receipt()
    expect(schema.circular).toBe(true)
    expect(schema.conditional.if).toBe(schema)
    expect(JSON.stringify(toSerializable(schema))).toContain('↻ (circular)')
  })

  it('records the declared dialect without acting on it', async () => {
    const model = await load('keywords-3.1.json')
    expect(model.sourceDialect).toBe('https://json-schema.org/draft/2020-12/schema')
    expect((await load('petstore-3.1.json')).sourceDialect).toBeUndefined()
  })

  it('normalizes the whole keyword schema the same way twice', async () => {
    expect(toSerializable(await payment())).toMatchSnapshot()
  })
})

describe('discriminator', () => {
  const bodyOf = async (id) =>
    opById(await load('polymorphism-3.2.json'), id).requestBody.contents[0].schema

  it('resolves the mapping onto variant indices, whatever the target spelling', async () => {
    const pet = await bodyOf('createPet')
    expect(pet.discriminator.propertyName).toBe('petType')
    expect(pet.discriminator.mapping).toEqual([
      // Pointer form and short name resolve identically.
      { key: 'cat', schemaName: 'Cat', variantIndex: 0 },
      { key: 'dog', schemaName: 'Dog', variantIndex: 1, default: true },
      // External target: the key is kept, it just points at no variant.
      { key: 'bird', schemaName: 'Bird', variantIndex: null },
      // Never mapped explicitly: addressed by its own schema name (spec).
      { key: 'Lizard', schemaName: 'Lizard', variantIndex: 2 },
    ])
    expect(pet.discriminator.defaultIndex).toBe(1)
  })

  it('gives every variant an implicit key when no mapping is declared', async () => {
    const event = opById(await load('polymorphism-3.2.json'), 'createPet').responses[0].contents[0]
      .schema
    expect(event.discriminator).toEqual({
      propertyName: 'kind',
      mapping: [{ key: 'Created', schemaName: 'Created', variantIndex: 0 }],
    })
  })

  it('finds the subtypes of the parent-side allOf idiom by reverse index', async () => {
    const animal = await bodyOf('createAnimal')
    // No variant list to index into: the keys name the subtypes, nothing more.
    expect(animal.kind).toBe('object')
    expect(animal.discriminator).toEqual({
      propertyName: 'species',
      mapping: [
        { key: 'feline', schemaName: 'Kitten', variantIndex: null },
        { key: 'Puppy', schemaName: 'Puppy', variantIndex: null },
      ],
    })
  })

  it('ignores a discriminator with no propertyName, and one with nothing to dispatch to', () => {
    expect(normalizeSchema({ oneOf: [{ type: 'string' }], discriminator: {} }).discriminator).toBe(
      undefined,
    )
    // Inline variants carry no component name: no implicit key exists.
    expect(
      normalizeSchema({ oneOf: [{ type: 'object' }], discriminator: { propertyName: 'k' } })
        .discriminator,
    ).toBe(undefined)
  })

  it('leaves an allOf alone: it is one value, not a choice', () => {
    const node = normalizeSchema({
      allOf: [{ type: 'object' }],
      discriminator: { propertyName: 'kind', mapping: { a: 'A' } },
    })
    expect(node.discriminator.mapping).toEqual([{ key: 'a', schemaName: 'A', variantIndex: null }])
  })

  it('normalizes the whole polymorphic schema the same way twice', async () => {
    expect(toSerializable(await bodyOf('createPet'))).toMatchSnapshot()
  })
})

describe('document metadata', () => {
  const metadata = () => load('metadata-3.1.json')
  const linksOf = async (id) =>
    (await metadata()).operations.find((o) => o.id === id).responses[0].links
  const linkNamed = async (name) => (await linksOf('createPet')).find((l) => l.name === name)

  it('normalizes the whole info block, identifier winning over url', async () => {
    const { info } = await metadata()
    expect(info).toEqual({
      title: 'Metadata API',
      version: '2.1.0',
      summary: 'Everything the info block can say.',
      description: expect.stringContaining('Fixture for the document-metadata session'),
      termsOfService: 'https://metadata.example.com/terms',
      contact: {
        name: 'API team',
        url: 'https://metadata.example.com/support',
        email: 'api@metadata.example.com',
      },
      // The declared `url` is gone: newest-wins, and the two are exclusive.
      license: { name: 'Apache 2.0', identifier: 'Apache-2.0' },
    })
  })

  it('drops an info sub-object that says nothing renderable', () => {
    const model = buildModel({
      openapi: '3.1.0',
      info: { title: 'x', version: '1', contact: {}, license: { url: 'javascript:alert(1)' } },
    })
    expect(model.info.contact).toBe(undefined)
    expect(model.info.license).toBe(undefined)
    expect(model.info.termsOfService).toBe(undefined)
  })

  it('carries externalDocs at root, tag, group, operation and schema level', async () => {
    const model = await metadata()
    expect(model.externalDocs).toEqual({
      description: 'Developer portal',
      url: 'https://metadata.example.com/docs',
    })
    expect(model.tags[0].externalDocs.url).toBe('https://metadata.example.com/docs/pets')
    expect(model.groups[0].externalDocs.url).toBe('https://metadata.example.com/docs/pets')
    const op = opById(model, 'createPet')
    expect(op.externalDocs.description).toBe('Creation rules')
    expect(op.requestBody.contents[0].schema.externalDocs.url).toBe(
      'https://metadata.example.com/docs/pet-model',
    )
  })

  it('drops a non-http(s) externalDocs url rather than rendering it', async () => {
    const model = await metadata()
    // The tag survives; only the link it could not be trusted with is gone.
    expect(model.tags.find((tag) => tag.name === 'hidden-docs').externalDocs).toBe(undefined)
  })

  it('resolves a link by operationId, keeping its expressions verbatim', async () => {
    expect(await linkNamed('GetPetById')).toEqual({
      name: 'GetPetById',
      description: 'Read the pet back.',
      operationId: 'getPet',
      targetId: 'getPet',
      parameters: [
        { name: 'petId', expression: '$response.body#/id' },
        // A constant is as legal as an expression: rendered the same way.
        { name: 'verbose', expression: 'true' },
      ],
      requestBody: '$response.body',
      server: { url: 'https://mirror.metadata.example.com/v2', variables: [] },
    })
  })

  it('resolves a same-document operationRef, escapes and percent-encoding included', async () => {
    // The target has no operationId: the fallback route id is what a link
    // must land on.
    expect((await linkNamed('DeleteByRef')).targetId).toBe('delete-pets-petid')
    expect((await linkNamed('EncodedRef')).targetId).toBe('getPet')
  })

  it('leaves targetId null for anything it cannot navigate to', async () => {
    for (const name of ['ExternalRef', 'Missing', 'MissingRef', 'Untargeted']) {
      expect((await linkNamed(name)).targetId).toBe(null)
    }
    // What the document declared is kept either way — it is all we know.
    expect((await linkNamed('Missing')).operationId).toBe('noSuchOperation')
  })

  it('gives a link to a hidden operation no target: the doc has no page for it', async () => {
    const raw = fixture('metadata-3.1.json')
    const model = buildModel(await $RefParser.dereference(raw), { hide: ['getPet'] })
    const link = model.operations[0].responses[0].links.find((l) => l.name === 'GetPetById')
    expect(link.targetId).toBe(null)
  })

  it('leaves a response without links unchanged', async () => {
    const model = await metadata()
    expect(opById(model, 'getPet').responses[0].links).toBe(undefined)
  })
})

describe('cycles', () => {
  it('materializes circular $ref without infinite recursion and marks the node', async () => {
    const model = await load('circular.json')
    const category = opById(model, 'listCategories').responses[0].contents[0].schema
    expect(category.circular).toBe(true)
    // The normalized graph reproduces the circularity: same object identity
    expect(category.properties.find((p) => p.name === 'parent').schema).toBe(category)
    expect(category.properties.find((p) => p.name === 'children').schema.items).toBe(category)
  })

  it('toSerializable cuts cycles and stays depth-bounded', async () => {
    const model = await load('circular.json')
    const json = JSON.stringify(toSerializable(model))
    expect(json).toContain('↻ (circular)')
    expect(() => JSON.parse(json)).not.toThrow()
  })
})

describe('schema micro-cases', () => {
  it('handles 3.1 boolean schemas', () => {
    expect(normalizeSchema(true)).toEqual({ kind: 'any' })
    expect(normalizeSchema(undefined)).toEqual({ kind: 'any' })
    expect(normalizeSchema(false)).toEqual({ kind: 'never' })
  })

  it('unifies 3.1 const into a single-value enum, with inferred type', () => {
    const node = normalizeSchema({ const: 'cat' })
    expect(node.enum).toEqual(['cat'])
    expect(node.type).toBe('string')
  })

  it('keeps minimum when 3.0 exclusiveMinimum is false', () => {
    const node = normalizeSchema({ type: 'integer', minimum: 1, exclusiveMinimum: false })
    expect(node.minimum).toBe(1)
    expect(node.exclusiveMinimum).toBeUndefined()
  })

  it('accepts 3.1 numeric exclusiveMinimum equal to 0', () => {
    const node = normalizeSchema({ type: 'integer', exclusiveMinimum: 0 })
    expect(node.exclusiveMinimum).toBe(0)
  })

  it('keeps 3.1 multiple types excluding null', () => {
    const node = normalizeSchema({ type: ['string', 'integer', 'null'] })
    expect(node.type).toBe('string')
    expect(node.types).toEqual(['string', 'integer'])
    expect(node.nullable).toBe(true)
  })

  it('maps non-standard types from real-world generators back to the JSON Schema type', () => {
    expect(normalizeSchema({ type: 'bool' }).type).toBe('boolean')
    expect(normalizeSchema({ type: 'int' }).type).toBe('integer')
    expect(normalizeSchema({ type: 'float' }).type).toBe('number')
    expect(normalizeSchema({ type: 'double' }).type).toBe('number')
  })

  it('ignores a non-array enum (FQCN string seen in real schemas)', () => {
    const node = normalizeSchema({
      type: 'string',
      enum: 'App\\Enum\\Nature',
      example: 'ARGENT_REEL',
    })
    expect(node.enum).toBeUndefined()
    expect(node.type).toBe('string')
    // With no declared type, inference must not crash on the string enum.
    expect(normalizeSchema({ enum: 'App\\Enum\\Nature' }).type).toBeUndefined()
  })

  it('slugifies paths for fallback ids', () => {
    expect(slugify('/pets/{petId}')).toBe('pets-petid')
    expect(slugify('/user-profiles/{id}/avatar')).toBe('user-profiles-id-avatar')
  })
})

describe('document validation', () => {
  const codeOf = (doc) => {
    try {
      buildModel(doc)
      return null
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaLoadError)
      return err.code
    }
  }

  // Swagger 2.0 is read by conversion (`tests/swagger2.test.js`); what stays
  // unsupported is a Swagger version there is no conversion table for.
  it('rejects a Swagger version older than 2.0 as unsupported', () => {
    expect(codeOf({ swagger: '1.2', info: {}, paths: {} })).toBe('unsupported-version')
  })

  it('rejects a document without an openapi field as an invalid schema', () => {
    expect(codeOf({ foo: 'bar' })).toBe('invalid-schema')
  })

  it('rejects uncovered future 3.x versions', () => {
    expect(codeOf({ openapi: '3.3.0', info: {}, paths: {} })).toBe('unsupported-version')
  })

  it('accepts a 3.1 document with no paths or webhooks as an empty doc', () => {
    const model = buildModel({ openapi: '3.1.0', info: { title: 'x', version: '1' } })
    expect(model.operations).toEqual([])
    expect(model.groups).toEqual([])
    expect(model.webhooks).toEqual([])
  })
})

describe('path and operation servers', () => {
  const doc = {
    openapi: '3.0.3',
    info: { title: 't', version: '1' },
    servers: [{ url: 'https://root.example.com' }],
    paths: {
      '/a': {
        servers: [{ url: 'https://path.example.com' }],
        get: { responses: { 200: { description: 'ok' } } },
        post: {
          servers: [{ url: 'https://op.example.com' }],
          responses: { 200: { description: 'ok' } },
        },
      },
      '/b': { get: { responses: { 200: { description: 'ok' } } } },
    },
  }

  it('folds path-level servers into operations, the operation level winning', () => {
    const model = buildModel(doc)
    const [aGet, aPost, bGet] = model.operations
    expect(aGet.servers[0].url).toBe('https://path.example.com')
    expect(aPost.servers[0].url).toBe('https://op.example.com')
    expect(bGet.servers ?? null).toBeNull()
  })
})
