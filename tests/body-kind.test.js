import { describe, expect, it } from 'vitest'
import {
  bodyKind,
  fileBodyLabel,
  formatFileSize,
  isFieldsKind,
  isFileSchema,
} from '../src/openapi/body-kind.js'

describe('bodyKind', () => {
  it.each([
    ['application/json', 'json'],
    ['application/json; charset=utf-8', 'json'],
    ['application/hal+json', 'json'],
    ['APPLICATION/JSON', 'json'],
    ['application/x-www-form-urlencoded', 'urlencoded'],
    ['multipart/form-data', 'multipart'],
    ['multipart/mixed', 'multipart'],
    ['text/plain', 'text'],
    ['text/csv', 'text'],
    ['application/xml', 'text'],
    ['application/atom+xml', 'text'],
    ['application/yaml', 'text'],
    ['application/graphql', 'text'],
    ['application/octet-stream', 'binary'],
    ['image/png', 'binary'],
    ['application/pdf', 'binary'],
    ['application/zip', 'binary'],
  ])('classifies %s as %s', (mediaType, expected) => {
    expect(bodyKind({ mediaType })).toBe(expected)
  })

  // 3.0 spells a file `format: binary`; 3.1+ lets the media type carry it
  // alone. Both land on the same kind — that absorption is the whole point.
  it('reads a 3.0 file marker whatever media type wraps it', () => {
    expect(bodyKind({ mediaType: 'text/plain', schema: { format: 'binary' } })).toBe('binary')
    expect(bodyKind({ mediaType: 'application/octet-stream', schema: {} })).toBe('binary')
  })

  it('leaves a base64 string as text: `format: byte` is not a file', () => {
    expect(bodyKind({ mediaType: 'text/plain', schema: { format: 'byte' } })).toBe('text')
    expect(isFileSchema({ format: 'byte' })).toBe(false)
  })

  // An operation with no requestBody at all still asks for a kind.
  it('falls back to text with no media type', () => {
    expect(bodyKind(undefined)).toBe('text')
    expect(bodyKind({ mediaType: null })).toBe('text')
  })

  it('names the two field-edited kinds', () => {
    expect(isFieldsKind('multipart')).toBe(true)
    expect(isFieldsKind('urlencoded')).toBe(true)
    expect(isFieldsKind('binary')).toBe(false)
    expect(isFieldsKind('json')).toBe(false)
  })
})

describe('fileBodyLabel', () => {
  it('names the file, its size and its type', () => {
    expect(fileBodyLabel({ name: 'cat.png', size: 2048, type: 'image/png' })).toBe(
      '@cat.png (2.0 kB, image/png)',
    )
  })

  it('degrades to the bare name when nothing else is known', () => {
    expect(fileBodyLabel({ name: 'blob.bin', size: Number.NaN, type: '' })).toBe('@blob.bin')
    expect(fileBodyLabel(null)).toBe('')
  })

  it.each([
    [512, '512 B'],
    [1024, '1.0 kB'],
    [1024 * 1024 * 3, '3.0 MB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })
})
