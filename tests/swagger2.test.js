import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditSchema } from '../src/audit/engine.js'
import { buildModel, loadInlineApiModel, SchemaLoadError } from '../src/openapi/loader.js'
import { toSerializable } from '../src/openapi/model.js'
import { convertSwagger2, isSwagger2 } from '../src/openapi/swagger2.js'

// Session 5 of docs/openapi-coverage.md: Swagger 2.0 read by conversion. Two
// levels of test, deliberately — the converted DOCUMENT (this is where the
// conversion table is pinned, field by field) and the normalized MODEL reached
// through the ordinary loader (this is where "the app renders it" is proved).

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const petstore = () => fixture('petstore-2.0.json')
const converted = () => convertSwagger2(petstore())

const opOf = (doc, path, method) => doc.paths[path][method]
const paramOf = (op, name) => op.parameters.find((p) => p.name === name)
const modelOp = (model, id) => model.operations.find((o) => o.id === id)

describe('detection', () => {
  it('recognizes 2.0 and nothing else', () => {
    expect(isSwagger2({ swagger: '2.0' })).toBe(true)
    expect(isSwagger2({ swagger: ' 2.0 ' })).toBe(true)
    expect(isSwagger2({ swagger: '1.2' })).toBe(false)
    expect(isSwagger2({ openapi: '3.0.0' })).toBe(false)
    expect(isSwagger2(null)).toBe(false)
  })

  it('keeps unsupported-version for a Swagger version with no conversion table', () => {
    const codeOf = (doc) => {
      try {
        buildModel(doc)
        return null
      } catch (err) {
        expect(err).toBeInstanceOf(SchemaLoadError)
        return err.code
      }
    }
    expect(codeOf({ swagger: '1.2', info: {}, paths: {} })).toBe('unsupported-version')
    expect(codeOf({ foo: 'bar' })).toBe('invalid-schema')
  })
})

describe('document conversion', () => {
  it('declares 3.0.4 and where it came from', () => {
    const doc = converted()
    expect(doc.openapi).toBe('3.0.4')
    expect(doc['x-converted-from']).toBe('2.0')
    // Vendor extensions are the author's, and they survive the conversion.
    expect(doc['x-vendor-note']).toEqual({ kept: true })
    expect(doc.swagger).toBeUndefined()
  })

  it('builds one server per http(s) scheme, basePath trailing slash removed', () => {
    // `wss` is dropped: nothing in this app can send to it, and a server URL
    // every request fails against is worse than one server fewer.
    expect(converted().servers).toEqual([
      { url: 'https://api.example.com/v2' },
      { url: 'http://api.example.com/v2' },
    ])
  })

  it('falls back on a protocol-relative host, then on the basePath alone', () => {
    const base = petstore()
    expect(convertSwagger2({ ...base, schemes: undefined }).servers).toEqual([
      { url: '//api.example.com/v2' },
    ])
    expect(convertSwagger2({ ...base, host: undefined }).servers).toEqual([{ url: '/v2' }])
    const bare = convertSwagger2({ ...base, host: undefined, basePath: undefined })
    expect(bare.servers).toBeUndefined()
  })

  it('turns operation schemes into operation servers', () => {
    expect(opOf(converted(), '/pets', 'post').servers).toEqual([
      { url: 'https://api.example.com/v2' },
    ])
    expect(opOf(converted(), '/pets', 'get').servers).toBeUndefined()
  })

  it('lifts flat parameter keywords into a schema', () => {
    const limit = paramOf(opOf(converted(), '/pets', 'get'), 'limit')
    expect(limit).toEqual({
      name: 'limit',
      in: 'query',
      description: 'Page size',
      allowEmptyValue: true,
      schema: {
        type: 'integer',
        format: 'int32',
        default: 20,
        maximum: 100,
        // The boolean form is 3.0's own spelling; `model.js` is what turns it
        // into the numeric bound.
        exclusiveMaximum: true,
        minimum: 1,
      },
    })
    // A path item's shared parameters stay shared: the operation declares none.
    expect(opOf(converted(), '/pets/{petId}', 'get').parameters).toBeUndefined()
    // A path parameter is required by definition, whatever the source said.
    expect(converted().paths['/pets/{petId}'].parameters[0]).toMatchObject({
      name: 'petId',
      in: 'path',
      required: true,
      schema: { type: 'integer', format: 'int64' },
    })
  })

  it('maps every collectionFormat, and marks the ones 3.0 cannot express', () => {
    const get = opOf(converted(), '/pets', 'get')
    const serialization = (name) => {
      const param = paramOf(get, name)
      return {
        style: param.style,
        explode: param.explode,
        original: param['x-original-collection-format'],
      }
    }
    // `multi` is the only exploded one; `csv` is 2.0's default and has to be
    // said out loud in a query, where 3.0's default is the exploded form.
    expect(serialization('status')).toEqual({ style: 'form', explode: true, original: undefined })
    expect(serialization('tags')).toEqual({ style: 'form', explode: false, original: undefined })
    expect(serialization('ids')).toEqual({
      style: 'pipeDelimited',
      explode: false,
      original: undefined,
    })
    expect(serialization('sort')).toEqual({
      style: 'spaceDelimited',
      explode: false,
      original: undefined,
    })
    // No tab-delimited style in 3.0: comma, and the marker that says so.
    expect(serialization('fields')).toEqual({ style: 'form', explode: false, original: 'tsv' })
    // `spaceDelimited` is query-only in 3.0, so the same format in a header has
    // no spelling at all — `simple` plus the marker.
    expect(serialization('X-Regions')).toEqual({
      style: undefined,
      explode: undefined,
      original: 'ssv',
    })
  })

  it('turns an in: body parameter into a requestBody, once per consumed media type', () => {
    const post = opOf(converted(), '/pets', 'post')
    expect(post.parameters).toBeUndefined()
    expect(post.requestBody.required).toBe(true)
    expect(post.requestBody.description).toBe('Pet to add to the store')
    expect(Object.keys(post.requestBody.content)).toEqual(['application/json', 'application/xml'])
    // Same schema OBJECT under both media types: normalization memoizes by
    // identity, so the model holds one node instead of two copies.
    const [json, xml] = Object.values(post.requestBody.content)
    expect(json.schema).toBe(xml.schema)
    expect(json.schema.$ref).toBe('#/components/schemas/NewPet')
  })

  it('defaults a body with no consumes to JSON', () => {
    const base = petstore()
    const doc = convertSwagger2({ ...base, consumes: undefined })
    expect(Object.keys(doc.paths['/pets'].post.requestBody.content)).toEqual([
      'application/json',
      'application/xml',
    ])
    const stripped = structuredClone(base)
    stripped.consumes = undefined
    stripped.paths['/pets'].post.consumes = undefined
    const plain = convertSwagger2(stripped)
    expect(Object.keys(plain.paths['/pets'].post.requestBody.content)).toEqual(['application/json'])
  })

  it('turns formData parameters into a form body, files included', () => {
    const upload = opOf(converted(), '/pets/{petId}', 'post')
    expect(upload.parameters).toBeUndefined()
    expect(upload.requestBody.required).toBe(true)
    const multipart = upload.requestBody.content['multipart/form-data']
    expect(multipart.schema).toEqual({
      type: 'object',
      required: ['file'],
      properties: {
        metadata: { type: 'string', description: 'Additional data to pass to the server' },
        file: { type: 'string', format: 'binary', description: 'The file to upload' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    })
    // A form field's collection format becomes the part's Encoding Object.
    expect(multipart.encoding).toEqual({ labels: { style: 'form', explode: true } })
  })

  it('picks urlencoded without a file, and multipart with one', () => {
    const form = opOf(converted(), '/pets/{petId}/form', 'post')
    expect(Object.keys(form.requestBody.content)).toEqual(['application/x-www-form-urlencoded'])
    expect(form.requestBody.content['application/x-www-form-urlencoded'].schema.required).toEqual([
      'name',
    ])
    // No `consumes` to go by: the file field is what says multipart.
    const doc = structuredClone(petstore())
    doc.paths['/pets/{petId}'].post.consumes = undefined
    doc.consumes = undefined
    expect(
      Object.keys(convertSwagger2(doc).paths['/pets/{petId}'].post.requestBody.content),
    ).toEqual(['multipart/form-data'])
  })

  it('spreads a response schema over produces, and keys examples by media type', () => {
    const ok = opOf(converted(), '/pets', 'get').responses['200']
    // The operation narrows `produces` to JSON alone.
    expect(Object.keys(ok.content)).toEqual(['application/json'])
    expect(ok.content['application/json'].example).toEqual([{ id: 1, name: 'Rex' }])
    expect(ok.headers['X-Next']).toEqual({
      description: 'Next page token',
      schema: { type: 'string' },
    })
    // A response header cannot be serialized by this app, but the delimiter it
    // announced is still part of what the document says.
    expect(ok.headers['X-Pages'].schema['x-original-collection-format']).toBe('ssv')
    // A response with no schema gets no content at all.
    expect(opOf(converted(), '/pets', 'post').responses['405'].content).toBeUndefined()
    // `type: file` is 2.0's way of saying bytes.
    const photo = opOf(converted(), '/pets/{petId}/photo', 'get').responses['200']
    expect(photo.content).toEqual({ 'image/png': { schema: { type: 'string', format: 'binary' } } })
  })

  it('moves the three component roots and rewrites the pointers', () => {
    const doc = converted()
    expect(Object.keys(doc.components.schemas)).toEqual([
      'Pet',
      'Dog',
      'Cat',
      'NewPet',
      'ApiResponse',
      'Error',
    ])
    expect(doc.definitions).toBeUndefined()
    expect(doc.components.schemas.Dog.allOf[0].$ref).toBe('#/components/schemas/Pet')
    expect(opOf(doc, '/pets', 'get').responses.default.$ref).toBe(
      '#/components/responses/Unexpected',
    )
    expect(doc.components.responses.Unexpected.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/Error',
    )
    // A body parameter is not a `components.parameters` entry: 3.0 has none, and
    // its media types depend on the operation that uses it.
    expect(Object.keys(doc.components.parameters)).toEqual(['ApiKeyHeader'])
  })

  it('leaves a pointer into another document alone', () => {
    const doc = structuredClone(petstore())
    doc.paths['/pets'].get.responses['200'].schema = { $ref: 'shared.json#/definitions/Pet' }
    const out = convertSwagger2(doc)
    // `shared.json` was never converted: its `definitions` are still there.
    expect(out.paths['/pets'].get.responses['200'].content['application/json'].schema.$ref).toBe(
      'shared.json#/definitions/Pet',
    )
  })

  it('maps every security scheme and renames the two oauth2 flows', () => {
    const schemes = converted().components.securitySchemes
    expect(schemes.basic_auth).toEqual({
      description: 'HTTP basic',
      type: 'http',
      scheme: 'basic',
    })
    expect(schemes.api_key).toEqual({ type: 'apiKey', name: 'api_key', in: 'header' })
    expect(schemes.petstore_auth).toEqual({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://example.com/oauth/authorize',
          tokenUrl: 'https://example.com/oauth/token',
          scopes: { 'read:pets': 'read your pets', 'write:pets': 'modify pets in your account' },
        },
      },
    })
    // An implicit flow has no token URL, a client-credentials one no
    // authorization URL — 2.0 spelled the latter `application`.
    expect(schemes.implicit_auth.flows.implicit).toEqual({
      authorizationUrl: 'https://example.com/oauth/authorize',
      scopes: { 'read:pets': 'read your pets' },
    })
    expect(schemes.app_auth.flows).toEqual({
      clientCredentials: { tokenUrl: 'https://example.com/oauth/token', scopes: {} },
    })
  })

  it('rewrites the schema-level divergences 2.0 spelled differently', () => {
    const pet = converted().components.schemas.Pet
    // 2.0's discriminator is the property name; 3.0 wraps it, which is what the
    // model's polymorphism support reads.
    expect(pet.discriminator).toEqual({ propertyName: 'petType' })
    // `x-nullable` was the era's spelling of nullability. Translated, not kept.
    expect(pet.properties.tag).toEqual({ type: 'string', nullable: true })
    expect(pet.properties.tag['x-nullable']).toBeUndefined()
  })

  it('does not mutate the document it was given', () => {
    const source = petstore()
    const before = JSON.stringify(source)
    convertSwagger2(source)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('survives a document that is already dereferenced and cyclic', () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'Cyclic', version: '1' },
      paths: {},
      definitions: {},
    }
    const node = { type: 'object', properties: {} }
    node.properties.self = node
    doc.definitions.Node = node
    const out = convertSwagger2(doc)
    expect(out.components.schemas.Node.properties.self).toBe(out.components.schemas.Node)
  })
})

describe('the converted document through the whole pipeline', () => {
  const loaded = () => loadInlineApiModel(petstore())

  it('normalizes into a model that names its origin', async () => {
    const { model } = await loaded()
    expect(model.sourceVersion).toBe('3.0.4')
    expect(model.convertedFrom).toBe('2.0')
    expect(model.info).toMatchObject({
      title: 'Petstore 2.0',
      contact: { name: 'API team', email: 'api@example.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      termsOfService: 'https://example.com/terms',
    })
    expect(model.operations.map((op) => op.id)).toEqual([
      'listPets',
      'addPet',
      'getPet',
      'uploadPetImage',
      'deletePet',
      'updatePetWithForm',
      'getPetPhoto',
    ])
  })

  it('gives the try-it the same shapes a 3.x document would', async () => {
    const { model } = await loaded()
    const list = modelOp(model, 'listPets')
    // Path-level parameters are inherited, and the header one came from the path
    // item of a 2.0 document.
    expect(list.parameters.map((p) => `${p.in}:${p.name}`)).toEqual([
      'header:X-Trace',
      'query:status',
      'query:tags',
      'query:ids',
      'query:sort',
      'query:fields',
      'header:X-Regions',
      'query:limit',
    ])
    const limit = list.parameters.find((p) => p.name === 'limit')
    // Newest-wins, applied by the model on the 3.0 document the converter made:
    // the boolean bound became the numeric one.
    expect(limit.schema.exclusiveMaximum).toBe(100)
    expect(limit.allowEmptyValue).toBe(true)

    const upload = modelOp(model, 'uploadPetImage')
    const multipart = upload.requestBody.contents[0]
    expect(multipart.mediaType).toBe('multipart/form-data')
    expect(multipart.schema.properties.map((p) => p.name)).toEqual(['metadata', 'file', 'labels'])
    // What `bodyKind` reads to give the field a file picker instead of a text
    // input — the same node a 3.x `format: binary` produces.
    expect(multipart.schema.properties[1].schema).toMatchObject({
      kind: 'primitive',
      type: 'string',
      format: 'binary',
    })
    expect(multipart.encodings).toEqual([{ property: 'labels', style: 'form', explode: true }])
  })

  it('resolves the parent-side polymorphism the 2.0 idiom always used', async () => {
    const { model } = await loaded()
    const pet = modelOp(model, 'getPet').responses[0].contents[0].schema
    expect(pet.discriminator).toMatchObject({ propertyName: 'petType' })
    // The subtypes point back at the parent through `allOf`: the model's
    // reverse index is what finds them, and a converted 2.0 document is the
    // shape it exists for.
    expect(pet.discriminator.mapping.map((entry) => entry.key)).toEqual(['Dog', 'Cat'])
  })

  it('carries the security schemes into the model', async () => {
    const { model } = await loaded()
    expect(model.securitySchemes.map((s) => `${s.name}:${s.type}`)).toEqual([
      'basic_auth:http',
      'api_key:apiKey',
      'petstore_auth:oauth2',
      'implicit_auth:oauth2',
      'app_auth:oauth2',
    ])
    expect(model.security).toEqual([{ petstore_auth: ['read:pets'] }])
  })

  it('matches the recorded model', async () => {
    const { model } = await loaded()
    expect(toSerializable(model)).toMatchSnapshot()
  })
})

// Only what the conversion's own output must satisfy. The rule that reads the
// approximation markers (`conversion-approximation`) has its fixtures with the
// other version-awareness rules, in `audit-rules-version.test.js`.
describe('audit of a converted document', () => {
  const report = async () => auditSchema(await loadInlineApiModel(petstore()))
  const findings = (result, ruleId) =>
    result.categories.flatMap((c) => c.findings).filter((f) => f.ruleId === ruleId)

  it('never flags 3.0 spellings as legacy: the document declares 3.0.4', async () => {
    const result = await report()
    expect(result.openapi).toBe('3.0.4')
    // `nullable` and the boolean `exclusiveMaximum` are what the conversion
    // produced, and they are correct in the version it produced them for.
    expect(findings(result, 'version-legacy')).toEqual([])
    // Nor ahead of it: nothing in the converted document is a 3.1+ construct.
    expect(findings(result, 'version-construct')).toEqual([])
  })
})
