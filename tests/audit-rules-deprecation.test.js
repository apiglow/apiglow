import { describe, expect, it } from 'vitest'
import { runRule } from '../src/audit/engine.js'
import { deprecatedInventory } from '../src/audit/rules/deprecated-inventory.js'
import { deprecationReplacement } from '../src/audit/rules/deprecation-replacement.js'
import { auditContext, doc, okResponse } from './audit-context.js'

const run = (rule, document, options) => runRule(rule, auditContext(document, options))

// One of each kind of deprecable element (docs/audit.md §4.3).
const deprecatingDoc = () =>
  doc({
    paths: {
      '/pets': {
        get: {
          deprecated: true,
          description: 'Use /animals instead.',
          parameters: [{ name: 'legacy', in: 'query', deprecated: true }],
          responses: okResponse,
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          properties: { nickname: { type: 'string', deprecated: true, description: 'Gone soon.' } },
        },
      },
      securitySchemes: {
        api_key: { type: 'apiKey', in: 'header', name: 'X-Key', deprecated: true },
      },
    },
  })

describe('deprecated-inventory', () => {
  it('scores over the whole deprecable surface, not only the deprecated part', () => {
    const result = run(
      deprecatedInventory,
      doc({ paths: { '/pets': { get: { responses: okResponse } } } }),
    )
    expect(result.findings).toEqual([])
    expect(result.checks).toBe(1)
  })

  it('lists every deprecated element, whatever kind it is', () => {
    const result = run(deprecatedInventory, deprecatingDoc())
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/paths/~1pets/get',
      '/paths/~1pets/get/parameters/0',
      '/components/schemas/Pet/properties/nickname',
      '/components/securitySchemes/api_key',
    ])
    expect(result.findings[0]).toMatchObject({
      ruleId: 'deprecated-inventory',
      severity: 'info',
      category: 'deprecation',
      location: 'GET /pets',
      opRef: 'get-pets',
    })
  })
})

describe('deprecation-replacement', () => {
  it('only checks the deprecated elements', () => {
    const result = run(
      deprecationReplacement,
      doc({ paths: { '/pets': { get: { responses: okResponse } } } }),
    )
    expect(result.checks).toBe(0)
  })

  it('accepts a migration hint in the prose, in either shipped language', () => {
    const result = run(
      deprecationReplacement,
      doc({
        paths: {
          '/pets': { get: { deprecated: true, summary: 'Replaced by /animals', responses: {} } },
          '/owners': {
            get: { deprecated: true, description: 'Utilisez /people à la place.', responses: {} },
          },
        },
      }),
    )
    expect(result).toMatchObject({ checks: 2, findings: [] })
  })

  it('accepts a sunset date as an answer of its own', () => {
    const result = run(
      deprecationReplacement,
      doc({ paths: { '/pets': { get: { deprecated: true, 'x-sunset': '2027-01-01' } } } }),
    )
    expect(result.findings).toEqual([])
  })

  it('flags a deprecation that says nothing', () => {
    const result = run(
      deprecationReplacement,
      doc({ paths: { '/pets': { get: { deprecated: true, description: 'Old.' } } } }),
    )
    expect(result.findings[0]).toMatchObject({
      ruleId: 'deprecation-replacement',
      severity: 'warning',
      category: 'deprecation',
      location: 'GET /pets',
    })
  })

  it('reads whole words naming a successor or a date, never a word that merely contains one', () => {
    const verdicts = (descriptions) => {
      const paths = Object.fromEntries(
        descriptions.map((description, index) => [
          `/p${index}`,
          { get: { deprecated: true, description, responses: {} } },
        ]),
      )
      const flagged = new Set(
        run(deprecationReplacement, doc({ paths })).findings.map((f) => f.location),
      )
      return descriptions.map((_, index) => !flagged.has(`GET /p${index}`))
    }
    const answers = [
      'Deprecated: use getPetV2.',
      'Its successor is /v2/pets.',
      'Remplacé par /v2/users.',
      'Déprécié au profit de /v2/users.',
      'À la place, appelez /v2/users.',
      'Removed on 2027-01-01.',
    ]
    const silences = [
      'Removes a pet.',
      'Supprime un utilisateur.',
      'Liste des utilisateurs.',
      'Reads the user preferences.',
    ]
    expect(verdicts(answers)).toEqual(answers.map(() => true))
    expect(verdicts(silences)).toEqual(silences.map(() => false))
  })

  it('accepts a Sunset or Deprecation header on any response of a deprecated operation', () => {
    for (const name of ['Sunset', 'deprecation']) {
      const result = run(
        deprecationReplacement,
        doc({
          paths: {
            '/pets': {
              get: {
                deprecated: true,
                responses: {
                  200: { description: 'OK' },
                  404: {
                    description: 'Missing',
                    headers: { [name]: { schema: { type: 'string' } } },
                  },
                },
              },
            },
          },
        }),
      )
      expect(result).toMatchObject({ checks: 1, findings: [] })
    }
  })

  it('accepts a Link header naming a successor or deprecation relation', () => {
    const link = (header) =>
      doc({
        paths: {
          '/pets': {
            get: {
              deprecated: true,
              responses: { 200: { description: 'OK', headers: { Link: header } } },
            },
          },
        },
      })
    for (const header of [
      { description: 'Points to the successor-version of this endpoint.' },
      {
        schema: { type: 'string' },
        example: '<https://api.example.com/v2/pets>; rel="latest-version"',
      },
      { examples: { notice: { value: '<https://example.com/notice>; rel="deprecation"' } } },
    ]) {
      expect(run(deprecationReplacement, link(header)).findings).toEqual([])
    }
    // Pagination links answer nothing about the deprecation.
    const paginated = run(
      deprecationReplacement,
      link({
        description: 'Pagination',
        example: '<https://api.example.com/pets?page=2>; rel="next"',
      }),
    )
    expect(paginated.findings).toHaveLength(1)
  })

  it('reads response headers only for operations', () => {
    const result = run(
      deprecationReplacement,
      doc({
        paths: {
          '/pets': {
            get: {
              parameters: [{ name: 'legacy', in: 'query', deprecated: true }],
              responses: { 200: { description: 'OK', headers: { Sunset: {} } } },
            },
          },
        },
      }),
    )
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/paths/~1pets/get/parameters/0',
    ])
  })

  it('checks the same elements the inventory walks', () => {
    const result = run(deprecationReplacement, deprecatingDoc())
    expect(result.checks).toBe(4)
    // The operation says "instead", the property "Gone soon" does not, and
    // neither the parameter nor the scheme says anything at all.
    expect(result.findings.map((finding) => finding.dataPath)).toEqual([
      '/paths/~1pets/get/parameters/0',
      '/components/schemas/Pet/properties/nickname',
      '/components/securitySchemes/api_key',
    ])
  })
})
