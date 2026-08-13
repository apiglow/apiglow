import { describe, expect, it } from 'vitest'
import { normalizeSchema } from '../src/openapi/model.js'
import { suggestSources } from '../src/scenarios/suggest.js'

const jsonResponse = (status, contents, headers = []) => ({ status, headers, contents })

const petOp = {
  responses: [
    jsonResponse(
      '201',
      [
        {
          mediaType: 'application/json',
          schema: normalizeSchema({
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          }),
        },
      ],
      [{ name: 'Location', schema: { type: 'string' } }],
    ),
  ],
}
// The component name is what links `/id` to `{{petId}}`.
petOp.responses[0].contents[0].schema.schemaName = 'Pet'

const step = (opId, extra = {}) => ({ id: opId, opId, extract: [], ...extra })

describe('suggestSources', () => {
  it('suggests /id from the declared schema for {{petId}}, without any send', () => {
    const suggestions = suggestSources('petId', {
      steps: [step('createPet')],
      opFor: () => petOp,
    })
    expect(suggestions[0]).toMatchObject({
      stepIndex: 0,
      pointer: '/id',
      source: 'body',
      observed: false,
    })
    expect(suggestions.map((s) => s.pointer)).not.toContain('/name')
  })

  it('prefers the observed response over the schema when it exists', () => {
    const suggestions = suggestSources('petId', {
      steps: [step('createPet')],
      opFor: () => petOp,
      responseFor: () => ({ status: 201, headers: [], body: JSON.stringify({ petId: 7, id: 1 }) }),
    })
    expect(suggestions[0]).toMatchObject({ pointer: '/petId', observed: true })
  })

  it('also suggests declared headers', () => {
    const suggestions = suggestSources('location', {
      steps: [step('createPet')],
      opFor: () => petOp,
    })
    expect(suggestions[0]).toMatchObject({ source: 'header', pointer: 'Location' })
  })

  it('ranks the last step that produces the value first', () => {
    const suggestions = suggestSources('petId', {
      steps: [step('createPet'), step('otherPet')],
      opFor: () => petOp,
    })
    expect(suggestions[0].stepIndex).toBe(1)
  })

  it('suggests nothing when no name is close enough', () => {
    expect(
      suggestSources('invoiceReference', { steps: [step('createPet')], opFor: () => petOp }),
    ).toEqual([])
    expect(suggestSources('', { steps: [step('createPet')], opFor: () => petOp })).toEqual([])
    expect(suggestSources('petId', {})).toEqual([])
  })

  it('does not throw on a step with no usable operation or response', () => {
    expect(suggestSources('petId', { steps: [step('gone')], opFor: () => null })).toEqual([])
    expect(
      suggestSources('petId', {
        steps: [step('createPet')],
        opFor: () => petOp,
        responseFor: () => ({ status: 200, headers: [], body: '<html/>' }),
      })[0].pointer,
    ).toBe('/id')
  })
})
