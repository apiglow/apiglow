import { describe, expect, it } from 'vitest'
import { effectiveBaseUrl } from '../src/openapi/request-builder.js'
import { serverTemplate, serverUrl } from '../src/openapi/servers.js'

// A server URL is a template (src/openapi/servers.js): its variables take their
// defaults where the app needs a URL, and become environment variables where
// an environment is seeded from it.

const REGIONAL = {
  url: '{scheme}://{region}.api.example.com/{basePath}',
  variables: [
    { name: 'scheme', default: 'https' },
    { name: 'region', default: 'eu', enum: ['eu', 'us'] },
    { name: 'basePath', default: 'v2' },
  ],
}

describe('server URL templates', () => {
  it('fills every variable with its default, scheme and host included', () => {
    expect(serverUrl(REGIONAL, 'https://docs.example.com/')).toBe('https://eu.api.example.com/v2')
  })

  it('resolves a relative server against the base, after substitution', () => {
    const server = { url: '/api/{version}', variables: [{ name: 'version', default: 'v3' }] }
    expect(serverUrl(server, 'https://host.example/spec.json')).toBe('https://host.example/api/v3')
  })

  it('keeps an undeclared variable as written: there is no value to give it', () => {
    expect(serverUrl({ url: 'https://{tenant}.example.com' })).toBe('https://{tenant}.example.com')
  })

  it('turns the variables into environment variables for a seeded environment', () => {
    expect(serverTemplate(REGIONAL, 'https://docs.example.com/')).toBe(
      '{{scheme}}://{{region}}.api.example.com/{{basePath}}',
    )
    const relative = { url: '/api/{version}', variables: [{ name: 'version', default: 'v3' }] }
    expect(serverTemplate(relative, 'https://host.example/spec.json')).toBe(
      'https://host.example/api/{{version}}',
    )
  })

  it('gives an operation pinned to a server that server, defaults filled in', () => {
    const op = {
      servers: [{ url: 'https://{region}.files.example.com', variables: REGIONAL.variables }],
    }
    expect(effectiveBaseUrl(op, 'https://api.example.com')).toBe('https://eu.files.example.com')
    expect(effectiveBaseUrl({}, 'https://api.example.com')).toBe('https://api.example.com')
  })
})
