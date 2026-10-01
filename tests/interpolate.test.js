import { describe, expect, it } from 'vitest'
import { interpolate, publishableUrl, referencedVariables } from '../src/env/interpolate.js'

const vars = {
  host: { value: 'api.example.com', sensitive: false },
  token: { value: 's3cret', sensitive: true },
  empty: { value: '', sensitive: false },
}

describe('{{var}} interpolation', () => {
  it('substitutes present variables', () => {
    const r = interpolate('https://{{host}}/v1?key={{token}}', vars)
    expect(r.value).toBe('https://api.example.com/v1?key=s3cret')
    expect(r.missing).toEqual([])
  })

  it('tolerates spaces inside the braces', () => {
    expect(interpolate('{{ host }}', vars).value).toBe('api.example.com')
  })

  it('reports missing variables and leaves the literal in place', () => {
    const r = interpolate('https://{{host}}/{{nope}}/x/{{nope}}', vars)
    expect(r.missing).toEqual(['nope'])
    expect(r.value).toContain('{{nope}}')
  })

  it('treats an empty value as missing', () => {
    expect(interpolate('{{empty}}', vars).missing).toEqual(['empty'])
  })

  it('tracks used variables with their sensitive flag (for redaction)', () => {
    const r = interpolate('{{host}} {{token}} {{token}}', vars)
    expect(r.used).toEqual([
      { name: 'host', value: 'api.example.com', sensitive: false },
      { name: 'token', value: 's3cret', sensitive: true },
    ])
  })

  it('handles null and variable-free templates', () => {
    expect(interpolate(null, vars)).toEqual({ value: '', missing: [], used: [] })
    expect(interpolate('nothing', {}).value).toBe('nothing')
  })

  it('lists referenced variables without resolving them', () => {
    expect(referencedVariables('{{a}} and {{auth.bearerAuth}} and {{a}}')).toEqual([
      'a',
      'auth.bearerAuth',
    ])
  })
})

describe('publishableUrl', () => {
  it('fills the variables in, and refuses a URL that would need a secret or an unset one', () => {
    const variables = { region: { value: 'eu' }, tenant: { value: 'acme', sensitive: true } }
    expect(publishableUrl('https://{{region}}.api.test/v1', variables)).toBe(
      'https://eu.api.test/v1',
    )
    expect(publishableUrl('https://api.test', variables)).toBe('https://api.test')
    expect(publishableUrl('https://{{tenant}}.api.test', variables)).toBeNull()
    expect(publishableUrl('https://{{zone}}.api.test', variables)).toBeNull()
  })
})
