import { describe, expect, it } from 'vitest'
import { toEndpointMarkdown } from '../src/export/endpoint-markdown.js'

// Representative fixed operation: params with enum/default, nested object
// body + example, responses with headers — the snapshot covers the whole
// Markdown rendering.
const op = {
  id: 'put_pet',
  method: 'put',
  path: '/{_locale}/pets/{petId}',
  summary: 'Update a pet',
  description: 'Updates an existing pet.\n\nSupports partial updates.',
  deprecated: false,
  parameters: [
    {
      name: '_locale',
      in: 'path',
      required: true,
      schema: { kind: 'primitive', type: 'string', enum: ['fr', 'en'], default: 'fr' },
    },
    {
      name: 'petId',
      in: 'path',
      required: true,
      description: 'Pet identifier',
      schema: { kind: 'primitive', type: 'integer' },
    },
    {
      name: 'verbose',
      in: 'query',
      required: false,
      schema: { kind: 'primitive', type: 'boolean' },
    },
    {
      name: 'X-Api-Origin',
      in: 'header',
      required: true,
      schema: { kind: 'primitive', type: 'string' },
    },
  ],
  requestBody: {
    required: true,
    description: 'Pet payload',
    contents: [
      {
        mediaType: 'application/json',
        schema: {
          kind: 'object',
          properties: [
            {
              name: 'name',
              required: true,
              schema: { kind: 'primitive', type: 'string', minLength: 1, maxLength: 50 },
            },
            {
              name: 'tags',
              required: false,
              schema: { kind: 'array', items: { kind: 'primitive', type: 'string' } },
            },
            {
              name: 'owner',
              required: false,
              schema: {
                kind: 'object',
                description: 'Owner of the pet',
                properties: [
                  {
                    name: 'id',
                    required: true,
                    schema: { kind: 'primitive', type: 'integer', readOnly: true },
                  },
                  {
                    name: 'email',
                    required: false,
                    schema: { kind: 'primitive', type: 'string', format: 'email' },
                  },
                ],
              },
            },
          ],
        },
        examples: [{ value: { name: 'Rex', tags: ['dog'] } }],
      },
    ],
  },
  responses: [
    {
      status: '200',
      description: 'Updated pet',
      headers: [
        {
          name: 'X-Rate-Limit',
          description: 'Remaining calls',
          schema: { kind: 'primitive', type: 'integer' },
        },
      ],
      contents: [
        {
          mediaType: 'application/json',
          schema: {
            kind: 'object',
            properties: [
              { name: 'id', required: true, schema: { kind: 'primitive', type: 'integer' } },
            ],
          },
          examples: [],
        },
      ],
    },
    { status: '404', description: 'Pet not found', headers: [], contents: [] },
  ],
}

describe('endpoint page Markdown export', () => {
  it('full page: header, params, body, responses', () => {
    expect(toEndpointMarkdown(op, { baseUrl: 'https://api.example.com/v1/' })).toMatchSnapshot()
  })

  it('without base URL or summary: title falls back to method + path', () => {
    expect(
      toEndpointMarkdown({ ...op, summary: '', requestBody: null, responses: [] }),
    ).toMatchSnapshot()
  })

  it('webhook: dedicated title, direction note, no base URL', () => {
    const webhook = {
      id: 'webhook-post-petadopted',
      kind: 'webhook',
      name: 'petAdopted',
      method: 'post',
      path: 'petAdopted',
      summary: 'Pet adopted',
      description: 'Sent when a pet is adopted.',
      parameters: [
        {
          name: 'X-Webhook-Signature',
          in: 'header',
          required: true,
          schema: { kind: 'primitive', type: 'string' },
        },
      ],
      requestBody: {
        required: true,
        contents: [
          {
            mediaType: 'application/json',
            schema: {
              kind: 'object',
              properties: [
                { name: 'petId', required: true, schema: { kind: 'primitive', type: 'integer' } },
              ],
            },
            examples: [{ value: { petId: 1 } }],
          },
        ],
      },
      responses: [{ status: '200', description: 'Acknowledged', headers: [], contents: [] }],
    }
    const markdown = toEndpointMarkdown(webhook, { baseUrl: 'https://api.example.com/v1/' })
    expect(markdown).not.toContain('https://api.example.com')
    expect(markdown).toMatchSnapshot()
  })

  it('composite variants: named when the schema names them', () => {
    const variant = (schemaName, type) => ({
      kind: 'object',
      schemaName,
      properties: [
        {
          name: 'type',
          required: true,
          schema: { kind: 'primitive', type: 'string', enum: [type] },
        },
      ],
    })
    const withComposite = {
      ...op,
      requestBody: null,
      responses: [
        {
          status: '200',
          description: 'Certifications',
          headers: [],
          contents: [
            {
              mediaType: 'application/json',
              schema: {
                kind: 'array',
                items: {
                  kind: 'composite',
                  composite: {
                    keyword: 'anyOf',
                    // No component name or title: falls back to rank alone.
                    variants: [
                      variant('ProofOfAddress', 'ADDRESS'),
                      { kind: 'primitive', type: 'string' },
                    ],
                  },
                },
              },
              examples: [],
            },
          ],
        },
      ],
    }
    const markdown = toEndpointMarkdown(withComposite)
    expect(markdown).toContain('- anyOf variant 1: ProofOfAddress (object)')
    expect(markdown).toContain('- anyOf variant 2 (string)')
  })

  it('callbacks: payload and expected responses from the integrator server', () => {
    const withCallbacks = {
      ...op,
      requestBody: null,
      responses: [],
      callbacks: [
        {
          name: 'onPetStatus',
          expressions: [
            {
              expression: '{$request.body#/callbackUrl}',
              operations: [
                {
                  id: 'post-callback',
                  method: 'post',
                  path: '{$request.body#/callbackUrl}',
                  summary: 'Status update',
                  parameters: [],
                  requestBody: {
                    required: false,
                    contents: [
                      {
                        mediaType: 'application/json',
                        schema: {
                          kind: 'object',
                          properties: [
                            {
                              name: 'status',
                              required: false,
                              schema: { kind: 'primitive', type: 'string' },
                            },
                          ],
                        },
                        examples: [],
                      },
                    ],
                  },
                  responses: [
                    { status: '200', description: 'Received', headers: [], contents: [] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(
      toEndpointMarkdown(withCallbacks, { baseUrl: 'https://api.example.com/v1/' }),
    ).toMatchSnapshot()
  })

  it('3.2 constructs: free-form method, querystring, itemSchema, response summary', () => {
    const streaming = {
      id: 'streamPets',
      method: 'purge',
      path: '/pets/stream',
      summary: 'Stream pets',
      parameters: [
        {
          name: 'filter',
          in: 'querystring',
          required: false,
          description: 'JSONPath filter',
          schema: { kind: 'primitive', type: 'string' },
        },
      ],
      responses: [
        {
          status: '200',
          summary: 'Server-sent events',
          description: '',
          headers: [],
          contents: [
            {
              mediaType: 'text/event-stream',
              schema: { kind: 'any' },
              itemSchema: {
                kind: 'object',
                properties: [
                  { name: 'id', required: true, schema: { kind: 'primitive', type: 'integer' } },
                ],
              },
              examples: [],
            },
          ],
        },
      ],
    }
    expect(toEndpointMarkdown(streaming, { baseUrl: 'https://api.example.com' })).toMatchSnapshot()
  })
})
