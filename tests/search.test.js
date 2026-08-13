import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { buildModel } from '../src/openapi/loader.js'
import { buildSearchIndex, searchIndex } from '../src/search/index.js'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const load = async (name) => buildModel(await $RefParser.dereference(fixture(name)))

const ids = (results) => results.map((r) => r.id)

describe('buildSearchIndex', () => {
  it('indexes all operations and config pages', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model, [{ slug: 'guide', title: 'Getting started' }])
    expect(index.map((e) => e.id)).toEqual([
      'guide',
      'listPets',
      'post-pets',
      'getPet',
      'delete-pets-petid',
    ])
    expect(index[0].type).toBe('page')
  })

  it('collects property names from bodies, responses, parameters and headers', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    const listPets = index.find((e) => e.id === 'listPets')
    // parameters + response header + response schema properties (array items)
    expect(listPets.properties).toEqual(
      expect.arrayContaining(['limit', 'status', 'x-next', 'id', 'name', 'tag']),
    )
    // property contributed by an allOf variant of the body (NewPet)
    const createPet = index.find((e) => e.id === 'post-pets')
    expect(createPet.properties).toContain('certificate')
  })

  it('indexes webhooks with type webhook', async () => {
    const model = await load('webhooks-3.1.json')
    const index = buildSearchIndex(model)
    expect(index.map((e) => e.id)).toEqual(['webhook-post-petadopted', 'petLostHook'])
    expect(index[0].type).toBe('webhook')
    expect(index[0].properties).toEqual(
      expect.arrayContaining(['petId', 'adopterEmail', 'X-Webhook-Signature']),
    )
    const results = searchIndex(index, 'adopted')
    expect(results[0]).toMatchObject({
      type: 'webhook',
      id: 'webhook-post-petadopted',
      title: 'Pet adopted',
    })
  })

  it('does not loop on a recursive schema and still indexes its fields', async () => {
    const model = await load('circular.json')
    const index = buildSearchIndex(model)
    const op = index.find((e) => e.id === 'listCategories')
    expect(op.properties).toEqual(expect.arrayContaining(['name', 'parent', 'children']))
  })
})

describe('searchIndex', () => {
  it('returns empty without a query', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    expect(searchIndex(index, '')).toEqual([])
    expect(searchIndex(index, '   ')).toEqual([])
  })

  it('matches primary fields (summary, operationId, path, method), case-insensitive', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    expect(ids(searchIndex(index, 'LIST'))).toContain('listPets')
    expect(ids(searchIndex(index, 'petid'))).toContain('getPet')
    expect(ids(searchIndex(index, 'delete'))).toContain('delete-pets-petid')
    // operation without a tag: fallback group null (rendered as "Other" by the UI)
    expect(searchIndex(index, 'delete')[0].group).toBeNull()
  })

  it('matches by schema property name and flags it in the result', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    const results = searchIndex(index, 'certificate')
    expect(ids(results)).toEqual(['post-pets'])
    expect(results[0].matchedProperties).toEqual(['certificate'])
    expect(results[0].group).toBe('pets')
  })

  it('matches in the description, with a lower score than the title', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    const results = searchIndex(index, 'returns')
    expect(ids(results)).toContain('listPets')
    // "pets" matches listPets in primary fields and other ops only in
    // description/property: the primary match must rank first.
    const ranked = searchIndex(index, 'pets')
    expect(ranked[0].id).toBe('listPets')
  })

  it('requires all tokens (AND)', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    expect(ids(searchIndex(index, 'pet delete'))).toEqual(['delete-pets-petid'])
    expect(searchIndex(index, 'pets zzz-nothing')).toEqual([])
  })

  it('finds pages by title and by slug', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model, [{ slug: 'getting-started', title: 'Getting started' }])
    const byTitle = searchIndex(index, 'getting')
    expect(byTitle[0]).toMatchObject({
      type: 'page',
      id: 'getting-started',
      title: 'Getting started',
    })
    expect(ids(searchIndex(index, 'started'))).toContain('getting-started')
  })

  it('caps the number of results', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(model)
    expect(searchIndex(index, 'pet', 2)).toHaveLength(2)
  })
})

describe('scenarios in the index', () => {
  it('indexes name, description and step titles, and routes to the scenario', async () => {
    const model = await load('petstore-3.0.json')
    const index = buildSearchIndex(
      model,
      [],
      [
        {
          id: 'onboarding',
          title: 'Full onboarding',
          description: 'Create an account, then pay',
          stepTitles: ['List all pets', 'Create a pet'],
        },
      ],
    )
    const entry = index.find((e) => e.id === 'onboarding')
    expect(entry.type).toBe('scenario')
    expect(ids(searchIndex(index, 'onboarding'))).toEqual(['onboarding'])
    // A step's name is enough to find the scenario…
    expect(searchIndex(index, 'create a pet').map((r) => r.id)).toContain('onboarding')
    // …but the operation itself still ranks better.
    expect(searchIndex(index, 'create a pet')[0].id).toBe('post-pets')
    expect(ids(searchIndex(index, 'account'))).toEqual(['onboarding'])
  })
})
