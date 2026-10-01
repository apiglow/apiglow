import { describe, expect, it } from 'vitest'
import { bodyStateFor } from '../src/components/try-it/body-state.js'
import { mergeAllOf } from '../src/openapi/all-of.js'
import { normalizeDocument } from '../src/openapi/model.js'
import { sampleValue } from '../src/openapi/sample.js'
import { xmlSample } from '../src/openapi/sample-xml.js'

// `allOf` of objects builds one object (src/openapi/all-of.js): the samples, the
// try-it prefill and its form fields all carry every member's properties.

const contents = (schema) => {
  const model = normalizeDocument({
    openapi: '3.1.0',
    info: { title: 'T', version: '1' },
    paths: {
      '/a': {
        post: {
          requestBody: {
            content: {
              'application/json': { schema },
              'multipart/form-data': { schema },
              'application/xml': { schema },
            },
          },
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  })
  return model.operations[0].requestBody.contents
}

const COMPOSED = {
  allOf: [
    { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    {
      allOf: [
        { type: 'object', properties: { age: { type: 'integer' }, name: { type: 'string' } } },
      ],
    },
  ],
}

describe('allOf of objects', () => {
  it('merges the members into one object, required if any member requires', () => {
    const [json] = contents(COMPOSED)
    const merged = mergeAllOf(json.schema)
    expect(merged.kind).toBe('object')
    expect(merged.properties.map((p) => [p.name, p.required])).toEqual([
      ['name', true],
      ['age', false],
    ])
  })

  it('samples, prefills and builds form fields from every member', () => {
    const [json, multipart, xml] = contents(COMPOSED)
    expect(sampleValue(json.schema)).toEqual({ name: 'string', age: 0 })
    expect(JSON.parse(bodyStateFor(json).body)).toEqual({ name: 'string', age: 0 })
    expect(bodyStateFor(multipart).formFields.map((field) => field.name)).toEqual(['name', 'age'])
    expect(xmlSample(xml.schema)).toContain('<age>')
  })

  it('leaves an allOf that is not all objects to the composite reading', () => {
    const [json] = contents({ allOf: [{ type: 'string' }, { minLength: 2 }] })
    expect(mergeAllOf(json.schema)).toBeNull()
    expect(typeof sampleValue(json.schema)).toBe('string')
  })
})
