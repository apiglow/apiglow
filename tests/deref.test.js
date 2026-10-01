import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { DerefBailout, dereferenceInternal } from '../src/openapi/deref.js'
import { isPayloadPointer } from '../src/openapi/payload.js'
import circular from './fixtures/circular.json'
import keywords31 from './fixtures/keywords-3.1.json'
import petstore30 from './fixtures/petstore-3.0.json'
import petstore31 from './fixtures/petstore-3.1.json'
import polymorphism32 from './fixtures/polymorphism-3.2.json'

// The fast pass exists as a boot-time shortcut over ref-parser, never as a
// second opinion: on every document it accepts, its output must be
// indistinguishable from the crawler's — object identity of shared targets
// and circular references included. These comparisons are that contract.
const FIXTURES = {
  'petstore-3.0': petstore30,
  'petstore-3.1': petstore31,
  'keywords-3.1': keywords31,
  'polymorphism-3.2': polymorphism32,
  circular,
}

describe('dereferenceInternal equivalence with ref-parser', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`matches ref-parser on ${name}`, async () => {
      const fast = dereferenceInternal(structuredClone(doc))
      const reference = await $RefParser.dereference(structuredClone(doc))
      // toEqual handles circular structures; it does not compare identity,
      // which the dedicated cases below pin.
      expect(fast).toEqual(reference)
    })
  }

  it('substitutes the target object itself, not a copy', () => {
    const doc = {
      components: { schemas: { Pet: { type: 'object' } } },
      a: { $ref: '#/components/schemas/Pet' },
      b: { $ref: '#/components/schemas/Pet' },
    }
    const out = dereferenceInternal(doc)
    expect(out.a).toBe(out.components.schemas.Pet)
    expect(out.b).toBe(out.a)
  })

  it('materializes circular schemas as circular references', () => {
    const out = dereferenceInternal(structuredClone(circular))
    const category = out.components.schemas.Category
    expect(category.properties.parent).toBe(category)
    expect(category.properties.children.items).toBe(category)
  })

  it('resolves escaped and percent-encoded pointer segments', () => {
    const doc = {
      components: { schemas: { 'a/b c': { type: 'string' } } },
      x: { $ref: '#/components/schemas/a~1b%20c' },
    }
    expect(dereferenceInternal(doc).x).toEqual({ type: 'string' })
  })

  it('follows a $ref whose target is itself a $ref', () => {
    const doc = {
      components: {
        schemas: { A: { $ref: '#/components/schemas/B' }, B: { type: 'integer' } },
      },
      x: { $ref: '#/components/schemas/A' },
    }
    expect(dereferenceInternal(doc).x).toEqual({ type: 'integer' })
  })
})

// The three places the fast pass and the loader's ref-parser options both
// depart from a plain dereference — and still agree with each other.
describe('dereferenceInternal on payloads, siblings and broken references', () => {
  const crawl = (doc) =>
    $RefParser.dereference(doc, {
      continueOnError: true,
      dereference: { excludedPathMatcher: isPayloadPointer },
    })

  it('leaves a $ref inside an example, a default or an enum as written', async () => {
    const doc = {
      components: {
        schemas: {
          Ref: { type: 'object', example: { $ref: '#/components/schemas/Ref' } },
          // A property NAMED example is a schema, not a payload.
          Holder: { properties: { example: { $ref: '#/components/schemas/Ref' } } },
        },
        examples: { Doc: { value: { $ref: '#/components/schemas/Ref' } } },
      },
      x: { schema: { default: { $ref: '#/a' }, examples: [{ $ref: '#/b' }] } },
    }
    const fast = dereferenceInternal(structuredClone(doc))
    expect(fast.components.schemas.Ref.example).toEqual({ $ref: '#/components/schemas/Ref' })
    expect(fast.components.examples.Doc.value).toEqual({ $ref: '#/components/schemas/Ref' })
    expect(fast.x.schema.default).toEqual({ $ref: '#/a' })
    expect(fast.x.schema.examples).toEqual([{ $ref: '#/b' }])
    expect(fast.components.schemas.Holder.properties.example).toBe(fast.components.schemas.Ref)
    expect(fast).toEqual(await crawl(structuredClone(doc)))
  })

  it('lays the siblings of a $ref over a copy of its target, as ref-parser does', async () => {
    const doc = {
      components: { parameters: { P: { name: 'p', in: 'query', description: 'Shared' } } },
      a: { $ref: '#/components/parameters/P', description: 'Here' },
      b: { $ref: '#/components/parameters/P' },
    }
    const fast = dereferenceInternal(structuredClone(doc))
    expect(fast.a).toEqual({ name: 'p', in: 'query', description: 'Here' })
    expect(fast.b).toBe(fast.components.parameters.P)
    expect(fast.b.description).toBe('Shared')
    expect(fast).toEqual(await crawl(structuredClone(doc)))
  })

  it('leaves a $ref to nothing in place rather than failing', () => {
    const out = dereferenceInternal({ x: { $ref: '#/nowhere' }, y: { $ref: '#/a/b' }, a: {} })
    expect(out.x).toEqual({ $ref: '#/nowhere' })
    expect(out.y).toEqual({ $ref: '#/a/b' })
  })
})

describe('dereferenceInternal bailouts', () => {
  const bails = (doc) => expect(() => dereferenceInternal(doc)).toThrow(DerefBailout)

  it('declines external references', () => {
    bails({ x: { $ref: 'https://example.com/schema.json#/Pet' } })
    bails({ x: { $ref: 'other.json#/Pet' } })
  })

  // A pointer routed through another `$ref` depends on walk order: met after
  // the ref it crosses was substituted, it resolves to what ref-parser would
  // give; met before, the raw ref node blocks the path and the pass declines.
  // Both outcomes end at the canonical result — these two pin the fork.
  it('declines a pointer routed through a not-yet-substituted $ref', () => {
    bails({
      x: { $ref: '#/components/schemas/A/type' },
      components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { type: 'object' } } },
    })
  })

  it('resolves a pointer routed through an already-substituted $ref', () => {
    const out = dereferenceInternal({
      components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { type: 'object' } } },
      x: { $ref: '#/components/schemas/A/type' },
    })
    expect(out.x).toBe('object')
  })

  it('declines a pure $ref-to-$ref cycle', () => {
    bails({
      a: { $ref: '#/b' },
      b: { $ref: '#/a' },
    })
  })

  it('declines an undecodable percent sequence', () => {
    bails({ x: { $ref: '#/a%ZZ' } })
  })
})
