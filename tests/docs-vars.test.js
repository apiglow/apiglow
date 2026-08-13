import { describe, expect, it } from 'vitest'
import { segmentVariables } from '../src/docs/vars.js'
import { splitVariables } from '../src/env/interpolate.js'

// docs/docs-pages.md §12 — what a `{{var}}` in prose becomes. The DOM half
// (chips, the walk, the re-walk) is e2e's job; what matters here is the
// decision: a value, a mask, a warning, or nothing at all.

const VARS = {
  baseUrl: { value: 'https://api.acme.test/v1' },
  tenant: { value: 'acme', sensitive: false },
  token: { value: 'eyJhbGciOi', sensitive: true },
  void: { value: '' },
}

describe('splitVariables (the shared grammar)', () => {
  it('alternates literal text and references, in order', () => {
    expect(splitVariables('a {{x}} b {{y}}')).toEqual([
      { text: 'a ' },
      { name: 'x', raw: '{{x}}' },
      { text: ' b ' },
      { name: 'y', raw: '{{y}}' },
    ])
  })

  it('is the same grammar as the interpolator, spaces included', () => {
    expect(splitVariables('{{ x }}')).toEqual([{ name: 'x', raw: '{{ x }}' }])
    expect(splitVariables('{{ not a name }}')).toEqual([{ text: '{{ not a name }}' }])
  })

  it('yields nothing for an empty template', () => {
    expect(splitVariables('')).toEqual([])
    expect(splitVariables(null)).toEqual([])
  })
})

describe('segments (§12.1)', () => {
  it('resolves a non-sensitive variable to its value', () => {
    expect(segmentVariables('GET {{baseUrl}}/pets', VARS)).toEqual([
      { kind: 'text', text: 'GET ' },
      { kind: 'value', name: 'baseUrl', value: 'https://api.acme.test/v1' },
      { kind: 'text', text: '/pets' },
    ])
  })

  // The value enters neither the DOM, nor the clipboard, nor an export,
  // because it never leaves this function: rule 12 by construction.
  it('never carries the value of a sensitive variable', () => {
    const segments = segmentVariables('Authorization: Bearer {{token}}', VARS)
    expect(segments.at(-1)).toEqual({ kind: 'masked', name: 'token' })
    expect(JSON.stringify(segments)).not.toContain('eyJhbGciOi')
  })

  it('flags an unknown variable as missing', () => {
    expect(segmentVariables('{{nowhere}}', VARS)).toEqual([{ kind: 'missing', name: 'nowhere' }])
  })

  // Same rule as the try-it's interpolator: an empty value is an oversight,
  // not a value.
  it('treats an empty value as missing', () => {
    expect(segmentVariables('{{void}}', VARS)).toEqual([{ kind: 'missing', name: 'void' }])
  })

  it('leaves text without a reference in one piece', () => {
    expect(segmentVariables('nothing to see', VARS)).toEqual([
      { kind: 'text', text: 'nothing to see' },
    ])
  })

  it('resolves several references in one run of text', () => {
    expect(segmentVariables('{{tenant}}@{{baseUrl}}', VARS).map((s) => s.kind)).toEqual([
      'value',
      'text',
      'value',
    ])
  })
})

describe('escaping (§12.1)', () => {
  // One backslash in the RENDERED text, whatever the author had to type to
  // produce it — `\{{x}}` in a fence, `\\{{x}}` in prose.
  it('drops the backslash and keeps the literal token', () => {
    expect(segmentVariables('type \\{{baseUrl}} to name it', VARS)).toEqual([
      { kind: 'text', text: 'type {{baseUrl}} to name it' },
    ])
  })

  it('escapes a reference nothing resolves too', () => {
    expect(segmentVariables('\\{{nowhere}}', VARS)).toEqual([{ kind: 'text', text: '{{nowhere}}' }])
  })

  it('escapes only the reference it precedes', () => {
    expect(segmentVariables('\\{{tenant}} then {{tenant}}', VARS)).toEqual([
      { kind: 'text', text: '{{tenant}} then ' },
      { kind: 'value', name: 'tenant', value: 'acme' },
    ])
  })

  it('leaves a backslash that precedes nothing alone', () => {
    expect(segmentVariables('a \\ b', VARS)).toEqual([{ kind: 'text', text: 'a \\ b' }])
  })
})

describe('inertness (§12.2)', () => {
  // Inserted as a text node by the caller, so markup is impossible by
  // construction — this only checks that the value travels whole and unescaped
  // rather than being pre-mangled here.
  it('carries a value containing markup punctuation verbatim', () => {
    const vars = { evil: { value: '<img src=x onerror=alert(1)> _not emphasis_' } }
    expect(segmentVariables('{{evil}}', vars)).toEqual([
      { kind: 'value', name: 'evil', value: '<img src=x onerror=alert(1)> _not emphasis_' },
    ])
  })

  // A value that itself looks like a reference is a value, full stop: the
  // segments are built in one pass over the source, never over the result.
  it('does not re-scan a value for references', () => {
    const vars = { a: { value: '{{b}}' }, b: { value: 'reached' } }
    expect(segmentVariables('{{a}}', vars)).toEqual([{ kind: 'value', name: 'a', value: '{{b}}' }])
  })
})
