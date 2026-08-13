import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import {
  displayableExample,
  exampleText,
  isExternalExample,
  isSerializedExample,
} from '../src/openapi/examples.js'
import { buildModel } from '../src/openapi/loader.js'

// The four surfaces that show an example — the doc block, the try-it pre-fill,
// the response viewer and the Markdown export — used to decide what they were
// looking at with `typeof value === 'string'`. That guess is wrong in both
// directions, so the kind is normalized and this is its contract.

async function load(file) {
  const raw = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
  return buildModel(await $RefParser.dereference(raw))
}

const opById = (model, id) => model.operations.find((op) => op.id === id)

function examplesOf(doc, container) {
  return {
    openapi: '3.2.0',
    info: { title: 't', version: '1' },
    paths: {
      '/x': {
        get: {
          operationId: 'x',
          parameters: [{ name: 'p', in: 'query', examples: { one: container } }],
          responses: { 200: { description: 'ok' } },
        },
      },
    },
    ...doc,
  }
}

async function paramExample(container) {
  const model = buildModel(examplesOf({}, container))
  return opById(model, 'x').parameters[0].examples[0]
}

describe('example kinds', () => {
  it('labels each 3.2 form, and leaves 3.0/3.1 `value` unlabelled', async () => {
    expect(await paramExample({ dataValue: { a: 1 } })).toEqual({
      name: 'one',
      value: { a: 1 },
      kind: 'data',
    })
    expect(await paramExample({ serializedValue: 'a=1' })).toEqual({
      name: 'one',
      value: 'a=1',
      kind: 'serialized',
    })
    // The single `value` claims nothing about its form: no kind, and the
    // readers fall back to the type — which is all the document ever said.
    expect(await paramExample({ value: 'plain' })).toEqual({ name: 'one', value: 'plain' })
  })

  // The kind must describe the value that was actually kept, or a malformed
  // example declaring two forms would be labelled as the one it dropped.
  it('keeps the kind in step with the value it picked', async () => {
    expect(await paramExample({ value: 'kept', dataValue: { a: 1 } })).toEqual({
      name: 'one',
      value: 'kept',
    })
  })

  // It becomes an href: same http(s) gate as every other URL the model exposes
  // (rule 5). One that does not pass carries no value, so nothing renders it.
  it('gates an external example through http(s), and drops the rest', async () => {
    expect(await paramExample({ externalValue: 'https://cdn.test/pet.json' })).toEqual({
      name: 'one',
      value: 'https://cdn.test/pet.json',
      kind: 'external',
    })
    expect(await paramExample({ externalValue: 'javascript:alert(1)' })).toEqual({
      name: 'one',
      kind: 'external',
    })
  })

  it('reads the 3.2 fixture the way the document meant it', async () => {
    const model = await load('petstore-3.2.json')
    const structured = opById(model, 'listPets').responses[0].contents[0].examples[0]
    expect(structured.kind).toBe('data')
    expect(exampleText(structured)).toEqual({
      text: JSON.stringify([{ id: 1, name: 'Rex' }], null, 2),
      json: true,
    })
    const serialized = opById(model, 'findPets').parameters.find((p) => p.name === 'filter')
      .examples[0]
    expect(serialized.kind).toBe('serialized')
    expect(exampleText(serialized)).toEqual({ text: "$.pets[?(@.name=='Rex')]", json: false })
  })
})

describe('reading an example', () => {
  // The defect this exists to stop: a JSON body whose example is legitimately
  // the string "hello" pre-filled the editor with a bare `hello`, which is no
  // longer JSON. A `dataValue` is structured even when it IS a string.
  it('keeps a structured string structured', () => {
    expect(exampleText({ value: 'hello', kind: 'data' })).toEqual({ text: '"hello"', json: true })
    expect(isSerializedExample({ value: 'hello', kind: 'data' })).toBe(false)
    expect(isSerializedExample({ value: 'hello' })).toBe(true)
  })

  // The other half: the URL is not the payload, and no surface may show it as
  // one or pre-fill an editor with it.
  it('refuses to render an external example inline', () => {
    const external = { value: 'https://cdn.test/pet.json', kind: 'external' }
    expect(isExternalExample(external)).toBe(true)
    expect(exampleText(external)).toBeNull()
    expect(displayableExample([external])).toBeNull()
    expect(displayableExample([external, { value: { a: 1 } }])).toEqual({ value: { a: 1 } })
  })

  it('has nothing to show for an example carrying no value', () => {
    expect(exampleText({ name: 'gone', kind: 'external' })).toBeNull()
    expect(exampleText(undefined)).toBeNull()
    expect(displayableExample(undefined)).toBeNull()
  })
})
