import { describe, expect, it } from 'vitest'
import { parseBodyTemplate, stringifyBodyTemplate } from '../src/env/json-template.js'

describe('parseBodyTemplate', () => {
  it('reads a plain JSON body', () => {
    expect(parseBodyTemplate('{"a": 1, "b": "x"}')).toEqual({ value: { a: 1, b: 'x' }, bare: [] })
  })

  it('reads a bare token as the value of its field', () => {
    expect(parseBodyTemplate('{"petId": {{petId}}, "quantity": 1}')).toEqual({
      value: { petId: '{{petId}}', quantity: 1 },
      bare: ['["petId"]'],
    })
  })

  it('leaves a quoted token quoted, and does not report it as bare', () => {
    expect(parseBodyTemplate('{"status": "{{status}}"}')).toEqual({
      value: { status: '{{status}}' },
      bare: [],
    })
  })

  it('ignores braces that live inside a string', () => {
    const text = '{"note": "not {{a}} token because escaped \\" quote", "id": {{id}}}'
    const { value, bare } = parseBodyTemplate(text)
    expect(value.note).toBe('not {{a}} token because escaped " quote')
    expect(bare).toEqual(['["id"]'])
  })

  it('records the path of tokens nested in objects and arrays', () => {
    const { bare } = parseBodyTemplate('{"a": {"b": [1, {{x}}]}}')
    expect(bare).toEqual(['["a","b",1]'])
  })

  it('returns null on a body that is not JSON, template or not', () => {
    expect(parseBodyTemplate('{"a": ')).toBeNull()
    expect(parseBodyTemplate('   ')).toBeNull()
    // Not a lone token: nothing to quote, the text stays invalid.
    expect(parseBodyTemplate('{"a": {{ not a token }}}')).toBeNull()
  })

  it('does not collide with a body that contains the placeholder base', () => {
    const { value } = parseBodyTemplate('{"a": "__apidoc_tpl_0__", "b": {{b}}}')
    expect(value).toEqual({ a: '__apidoc_tpl_0__', b: '{{b}}' })
  })
})

describe('stringifyBodyTemplate', () => {
  it('puts the recorded tokens back unquoted', () => {
    const source = '{\n  "petId": {{petId}},\n  "quantity": 1\n}'
    const { value, bare } = parseBodyTemplate(source)
    value.quantity = 2
    expect(stringifyBodyTemplate(value, bare)).toBe('{\n  "petId": {{petId}},\n  "quantity": 2\n}')
  })

  it('round-trips a quoted token as quoted', () => {
    const source = '{\n  "status": "{{status}}"\n}'
    const { value, bare } = parseBodyTemplate(source)
    expect(stringifyBodyTemplate(value, bare)).toBe(source)
  })

  it('quotes back a bare path where the user typed a real value', () => {
    const { value, bare } = parseBodyTemplate('{"petId": {{petId}}}')
    value.petId = 'abc'
    expect(stringifyBodyTemplate(value, bare)).toBe('{\n  "petId": "abc"\n}')
  })

  it('keeps a numeric replacement of a bare path numeric', () => {
    const { value, bare } = parseBodyTemplate('{"petId": {{petId}}}')
    value.petId = 7
    expect(stringifyBodyTemplate(value, bare)).toBe('{\n  "petId": 7\n}')
  })

  it('restores tokens nested in arrays', () => {
    const source = '{"ids": [{{a}}, 2]}'
    const { value, bare } = parseBodyTemplate(source)
    expect(stringifyBodyTemplate(value, bare)).toBe('{\n  "ids": [\n    {{a}},\n    2\n  ]\n}')
  })

  it('is empty for an absent value', () => {
    expect(stringifyBodyTemplate(undefined)).toBe('')
  })
})
