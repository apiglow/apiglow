import { describe, expect, it } from 'vitest'
import { auditSchema } from '../src/audit/engine.js'
import { dereferenceInternal } from '../src/openapi/deref.js'
import { normalizeDocument } from '../src/openapi/model.js'
import polymorphism32 from './fixtures/polymorphism-3.2.json'
import petstore30 from './fixtures/petstore-3.0.json'

// A field holding the wrong kind of value — `tags: pets`, `parameters: {}`,
// `allOf: 42` — is something the audit reports (`field-value-kind`), not
// something that takes the documentation down with it. Every field of two
// real documents is swapped, one at a time, for a value of another kind; the
// model and the audit must both come through. A crash here is the whole page
// failing for one typo.

// One contrasting value per kind, then `null` — what a `$ref` the loader could
// not resolve inside another file leaves behind.
const WRONG = (value) =>
  Array.isArray(value)
    ? 'text'
    : value && typeof value === 'object'
      ? 42
      : typeof value === 'string'
        ? {}
        : []

function* mutations(document) {
  const paths = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      paths.push([...path, key])
      walk(value, [...path, key])
    }
  }
  walk(document, [])
  for (const path of paths) {
    for (const replace of [WRONG, () => null]) {
      const copy = structuredClone(document)
      let parent = copy
      for (const key of path.slice(0, -1)) parent = parent[key]
      parent[path.at(-1)] = replace(parent[path.at(-1)])
      yield [path.join('.'), copy]
    }
  }
}

describe('a malformed document', () => {
  for (const [name, fixture] of [
    ['petstore-3.0', petstore30],
    ['polymorphism-3.2', polymorphism32],
  ]) {
    it(`renders and audits whatever field of ${name} holds the wrong kind of value`, () => {
      const crashes = []
      for (const [path, document] of mutations(fixture)) {
        try {
          const source = structuredClone(document)
          const dereferenced = dereferenceInternal(document)
          auditSchema({ source, document: dereferenced, model: normalizeDocument(dereferenced) })
        } catch (err) {
          crashes.push(`${path}: ${err.message}`)
        }
      }
      expect(crashes).toEqual([])
    })
  }

  it('shows the info fields as text, or not at all', () => {
    const info = (value) => normalizeDocument({ openapi: '3.1.0', info: value, paths: {} }).info
    // What a document recovered from a broken file can hold, and a YAML number.
    expect(info({ title: { 'T version': '1' }, version: 1.0, description: ['x'] })).toEqual({
      title: '',
      version: '1',
    })
    expect(info({ title: 'Pets', version: '2.1', summary: true })).toMatchObject({
      title: 'Pets',
      version: '2.1',
      summary: 'true',
    })
  })
})
