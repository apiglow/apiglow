import { describe, expect, it } from 'vitest'
import { stepRequestFromEntry, stepRequestFromState } from '../src/scenarios/capture.js'

const OP = { id: 'get:/pets/{petId}', method: 'get', path: '/pets/{petId}' }

describe('capture from the editor', () => {
  it('renders the shape of a step request', () => {
    const request = stepRequestFromState({
      path: { petId: '{{petId}}' },
      query: { limit: '10' },
      queryString: 'raw=1',
      headers: [{ name: 'X-Trace', value: 'abc' }],
      body: '{"name":"Rex"}',
      mediaTypeIndex: 1,
    })
    expect(request).toEqual({
      path: { petId: '{{petId}}' },
      query: { limit: '10' },
      cookie: {},
      queryString: 'raw=1',
      headers: [{ name: 'X-Trace', value: 'abc' }],
      body: '{"name":"Rex"}',
      mediaTypeIndex: 1,
      formFields: null,
    })
  })

  it('retemplates a sensitive value pasted in clear', () => {
    const request = stepRequestFromState(
      {
        path: {},
        query: { key: 'sh-456-secret' },
        headers: [{ name: 'Authorization', value: 'Bearer sh-456-secret' }],
        body: '{"token":"sh-456-secret"}',
      },
      [{ name: 'secret', value: 'sh-456-secret', sensitive: true }],
    )
    expect(request.query.key).toBe('{{secret}}')
    expect(request.headers[0].value).toBe('Bearer {{secret}}')
    expect(request.body).toBe('{"token":"{{secret}}"}')
  })

  it("keeps a file's name, never its content", () => {
    const request = stepRequestFromState({
      path: {},
      query: {},
      headers: [],
      body: null,
      formFields: [
        { name: 'avatar', value: '', fileName: 'cat.png' },
        { name: 'label', value: 'photo' },
      ],
    })
    expect(request.formFields).toEqual([
      { name: 'avatar', value: '', fileName: 'cat.png' },
      { name: 'label', value: 'photo', fileName: undefined },
    ])
  })
})

describe('capture from history', () => {
  const entry = (over = {}) => ({
    opId: OP.id,
    method: 'GET',
    path: '/pets/{petId}',
    request: {
      method: 'GET',
      url: 'https://api.test/v1/pets/42?limit=10',
      headers: { Authorization: 'Bearer tok-123', 'X-Trace': 'abc' },
      body: null,
    },
    sensitiveValues: ['tok-123'],
    usedVariables: [
      { name: 'petId', value: '42', sensitive: false },
      { name: 'auth.bearerAuth', value: 'tok-123', sensitive: true },
    ],
    ...over,
  })

  it('redoes the reverse path: resolved request → template', () => {
    const request = stepRequestFromEntry(entry(), OP)
    // The path param becomes the variable that had produced it again…
    expect(request.path).toEqual({ petId: '{{petId}}' })
    // …and the token is never captured in clear.
    expect(request.headers).toEqual([
      { name: 'Authorization', value: 'Bearer {{auth.bearerAuth}}' },
      { name: 'X-Trace', value: 'abc' },
    ])
    expect(request.query).toEqual({ limit: '10' })
    expect(request.body).toBeNull()
    expect(request.mediaTypeIndex).toBe(0)
  })

  it('captures a body, retemplated as well', () => {
    const request = stepRequestFromEntry(
      entry({
        request: {
          method: 'POST',
          url: 'https://api.test/v1/pets/42',
          headers: {},
          body: '{"owner":"42"}',
        },
      }),
      OP,
    )
    expect(request.body).toBe('{"owner":"{{petId}}"}')
  })

  it('does not throw on an unreadable URL: the step is captured without query', () => {
    const request = stepRequestFromEntry(
      entry({ request: { url: '::not a url::', headers: {} } }),
      OP,
    )
    expect(request.query).toEqual({})
    expect(request.headers).toEqual([])
  })

  it('without a remembered variable, the resolved value is captured as-is', () => {
    const request = stepRequestFromEntry(entry({ usedVariables: [], sensitiveValues: [] }), OP)
    expect(request.path).toEqual({ petId: '42' })
  })
})
