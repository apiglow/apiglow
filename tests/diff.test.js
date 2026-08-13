import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { diffOperations, operationFingerprints } from '../src/openapi/diff.js'
import { buildModel } from '../src/openapi/loader.js'
import { normalizeDocument } from '../src/openapi/model.js'

const baseDoc = {
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets',
        responses: { 200: { description: 'ok' } },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        },
        responses: { 201: { description: 'created' } },
      },
    },
    '/pets/{petId}': {
      delete: {
        operationId: 'deletePet',
        summary: 'Delete a pet',
        responses: { 204: { description: 'gone' } },
      },
    },
  },
}

function fingerprintsOf(doc) {
  return operationFingerprints(normalizeDocument(doc))
}

describe('local schema diff', () => {
  it('two loads of the same schema give identical fingerprints (empty diff)', () => {
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(structuredClone(baseDoc)))
    expect(diff).toEqual({ added: [], removed: [], changed: [], byOp: {}, empty: true })
  })

  it('detects added and removed operations', () => {
    const next = structuredClone(baseDoc)
    delete next.paths['/pets/{petId}']
    next.paths['/pets'].put = {
      operationId: 'replacePets',
      summary: 'Replace',
      responses: { 200: { description: 'ok' } },
    }
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(diff.added).toEqual([
      { id: 'replacePets', method: 'put', path: '/pets', summary: 'Replace' },
    ])
    expect(diff.removed).toEqual([
      { id: 'deletePet', method: 'delete', path: '/pets/{petId}', summary: 'Delete a pet' },
    ])
    expect(diff.changed).toEqual([])
    expect(diff.empty).toBe(false)
  })

  it('detects a deeply modified operation (new required body field)', () => {
    const next = structuredClone(baseDoc)
    next.paths['/pets'].post.requestBody.content['application/json'].schema.properties.tag = {
      type: 'string',
    }
    next.paths['/pets'].post.requestBody.content['application/json'].schema.required.push('tag')
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([
      { id: 'createPet', method: 'post', path: '/pets', summary: 'Create a pet' },
    ])
  })

  it('detects a simple parameter description change', () => {
    const next = structuredClone(baseDoc)
    next.paths['/pets'].get.parameters = [
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
    ]
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(diff.changed.map((op) => op.id)).toEqual(['listPets'])
  })

  it('locates the modified field for in-situ marking', () => {
    const next = structuredClone(baseDoc)
    next.paths['/pets'].post.requestBody.content['application/json'].schema.properties.tag = {
      type: 'string',
    }
    next.paths['/pets'].post.requestBody.content[
      'application/json'
    ].schema.properties.name.maxLength = 40
    next.paths['/pets'].get.parameters = [
      { name: 'limit', in: 'query', schema: { type: 'integer' } },
    ]
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(diff.byOp.createPet).toEqual({
      status: 'changed',
      fields: {
        'body:application/json:tag': 'added',
        'body:application/json:name': 'changed',
      },
    })
    expect(diff.byOp.listPets).toEqual({
      status: 'changed',
      fields: { 'param:query:limit': 'added' },
    })
  })

  it('an added operation is not detailed field by field', () => {
    const next = structuredClone(baseDoc)
    next.paths['/pets'].put = {
      operationId: 'replacePets',
      parameters: [{ name: 'dry', in: 'query', schema: { type: 'boolean' } }],
      responses: { 200: { description: 'ok' } },
    }
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(diff.byOp.replacePets).toEqual({ status: 'added', fields: {} })
  })

  it('an unchanged operation does not appear in the index', () => {
    const next = structuredClone(baseDoc)
    next.paths['/pets'].get.summary = 'List all pets'
    const diff = diffOperations(fingerprintsOf(baseDoc), fingerprintsOf(next))
    expect(Object.keys(diff.byOp)).toEqual(['listPets'])
  })

  it('fingerprints a truly cyclic schema without looping', async () => {
    // The normalized model reproduces $ref circularity (cf. model.test.js):
    // the fingerprint must terminate and stay stable across loads.
    const load = async () =>
      operationFingerprints(
        buildModel(
          await $RefParser.dereference(
            JSON.parse(readFileSync(new URL('./fixtures/circular.json', import.meta.url), 'utf8')),
          ),
        ),
      )
    const diff = diffOperations(await load(), await load())
    expect(diff.empty).toBe(true)
    expect(diff.byOp).toEqual({})
  })

  // Algorithmic safeguard: a node's fingerprint must depend only on its
  // subtree, so it must be memoizable. A version where a cycle disqualifies
  // the memo re-walks shared subtrees on every reference and blows up —
  // this case took 2.9s in the browser on a real schema.
  it('stays linear on a recursive schema whose subtrees are massively shared', () => {
    // Exact shape of a real dereferenced schema: a DAG (the same sub-schema
    // referenced several times per level) closed off by a recursive $ref. Without
    // a valid memo, each level triples the work — 3^12 traversals here.
    const bottom = { kind: 'object', properties: [{ name: 'leaf', schema: { kind: 'string' } }] }
    let node = bottom
    for (let depth = 0; depth < 12; depth += 1) {
      node = {
        kind: 'object',
        properties: [
          { name: 'a', schema: node },
          { name: 'b', schema: node },
          { name: 'c', schema: node },
        ],
      }
    }
    const shared = node
    bottom.properties.push({ name: 'root', schema: shared })

    const model = {
      operations: Array.from({ length: 3 }, (_, i) => ({
        id: `op${i}`,
        method: 'get',
        path: `/thing/${i}`,
        summary: `Thing ${i}`,
        parameters: [{ in: 'query', name: 'filter', schema: shared }],
        responses: [
          { status: '200', contents: [{ mediaType: 'application/json', schema: shared }] },
        ],
      })),
      webhooks: [],
    }

    const startedAt = performance.now()
    const fingerprints = operationFingerprints(model)
    const elapsed = performance.now() - startedAt

    expect(fingerprints).toHaveLength(3)
    // All operations share the same structure: same field fingerprint,
    // proof that the memo did serve across operations.
    const fieldKey = 'param:query:filter'
    const distinct = new Set(fingerprints.map((op) => op.fields[fieldKey]))
    expect(distinct.size).toBe(1)
    // Loose bound: we're looking for combinatorial explosion, not the millisecond.
    expect(elapsed, `${Math.round(elapsed)} ms`).toBeLessThan(1000)
  })

  it('tolerates missing lists (first load, corrupted snapshot)', () => {
    const current = fingerprintsOf(baseDoc)
    expect(diffOperations(undefined, current).added).toHaveLength(3)
    expect(diffOperations(current, undefined).removed).toHaveLength(3)
  })
})
