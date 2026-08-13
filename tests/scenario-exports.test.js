import { describe, expect, it } from 'vitest'
import { toArazzo } from '../src/export/arazzo.js'
import {
  decodeScenarioLink,
  encodeScenarioLink,
  SHARE_URL_MAX,
} from '../src/export/scenario-share.js'
import {
  decodeScenarioFile,
  encodeScenarioFile,
  normalizeScenario,
} from '../src/scenarios/model.js'

const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    parameters: [],
    requestBody: { contents: [{ mediaType: 'application/json', schema: null }] },
  },
  {
    id: 'get-pets-petid',
    // No operationId in the schema: the Arazzo reference goes through the path.
    operationId: null,
    method: 'get',
    path: '/pets/{petId}',
    parameters: [{ name: 'petId', in: 'path', required: true }],
    requestBody: null,
  },
]

// Frozen scenario (stable step ids): the snapshots must be stable too.
const SCENARIO = normalizeScenario(
  {
    id: 'onboarding',
    name: 'Onboarding',
    description: 'Create a pet, then read it back.',
    steps: [
      {
        id: 'step-create',
        opId: 'createPet',
        note: 'First we create the pet.',
        request: {
          headers: [{ name: 'Authorization', value: 'Bearer {{auth.bearerAuth}}' }],
          body: '{"name":"Rex","owner":"{{ownerName}}"}',
        },
        expect: { status: 201, assertions: [{ pointer: '/name', op: 'equals', value: 'Rex' }] },
        extract: [
          { name: 'petId', source: 'body', pointer: '/id' },
          { name: 'auth.session', source: 'header', pointer: 'X-Session', persist: true },
        ],
      },
      {
        id: 'step-read',
        opId: 'get-pets-petid',
        request: { path: { petId: '{{petId}}' }, query: { verbose: 'true' } },
        expect: { status: '2xx' },
      },
    ],
  },
  { source: 'config', id: 'onboarding' },
).scenario

describe('export Arazzo 1.1', () => {
  it('renders a stable and structurally complete document', () => {
    expect(
      toArazzo(SCENARIO, { ops: OPS, sourceUrl: 'https://api.example.com/openapi.json' }),
    ).toMatchSnapshot()
  })

  it('chains steps via runtime expressions rather than variables', () => {
    const doc = toArazzo(SCENARIO, { ops: OPS, sourceUrl: 'https://x/openapi.json' })
    const [create, read] = doc.workflows[0].steps
    // What step 1 extracts becomes an output…
    expect(create.outputs).toEqual({
      petId: '$response.body#/id',
      // The dot would break `$steps.x.outputs.auth.session`.
      auth_session: '$response.header.X-Session',
    })
    // …and step 2 consumes it as such, not as a workflow input.
    expect(read.parameters).toContainEqual({
      name: 'petId',
      in: 'path',
      value: '$steps.createPet.outputs.petId',
    })
    expect(doc.workflows[0].inputs.required).toEqual(['auth_bearerAuth', 'ownerName'])
  })

  // 1.1's `in: querystring` (OAS 3.2's construct): a whole query string had no
  // 1.0 spelling, so this field used to leave the document silently.
  it('exports a whole query string as a querystring parameter', () => {
    const ops = [
      {
        ...OPS[1],
        parameters: [...OPS[1].parameters, { name: 'filter', in: 'querystring' }],
      },
    ]
    const scenario = normalizeScenario({
      id: 'search',
      name: 'Search',
      steps: [
        {
          id: 'step-read',
          opId: 'get-pets-petid',
          request: { path: { petId: '7' }, queryString: 'sort=name&limit={{max}}' },
        },
      ],
    }).scenario
    const doc = toArazzo(scenario, { ops, sourceUrl: '' })
    expect(doc.workflows[0].steps[0].parameters).toContainEqual({
      name: 'filter',
      in: 'querystring',
      // Same `{{var}}` translation as every other parameter.
      value: 'sort=name&limit={$inputs.max}',
    })
  })

  it('falls back to a plain name when the operation declares no querystring parameter', () => {
    const scenario = normalizeScenario({
      id: 'search',
      name: 'Search',
      steps: [{ id: 'step-read', opId: 'get-pets-petid', request: { queryString: 'a=1' } }],
    }).scenario
    const doc = toArazzo(scenario, { ops: OPS, sourceUrl: '' })
    expect(doc.workflows[0].steps[0].parameters).toEqual([
      { name: 'querystring', in: 'querystring', value: 'a=1' },
    ])
  })

  it('translates the success criteria, exact status or class', () => {
    const doc = toArazzo(SCENARIO, { ops: OPS, sourceUrl: '' })
    expect(doc.workflows[0].steps[0].successCriteria).toEqual([
      { condition: '$statusCode == 201' },
      { condition: "$response.body#/name == 'Rex'" },
    ])
    expect(doc.workflows[0].steps[1].successCriteria).toEqual([
      { condition: '$statusCode >= 200 && $statusCode <= 299' },
    ])
  })

  it('does not export a criteria row left empty', () => {
    const scenario = {
      ...SCENARIO,
      steps: [
        {
          ...SCENARIO.steps[1],
          expect: { status: '2xx', assertions: [{ pointer: '', op: 'exists' }] },
        },
      ],
    }
    expect(
      toArazzo(scenario, { ops: OPS, sourceUrl: '' }).workflows[0].steps[0].successCriteria,
    ).toEqual([{ condition: '$statusCode >= 200 && $statusCode <= 299' }])
  })

  it('designates the operation by operationId when the schema has one, by path otherwise', () => {
    const doc = toArazzo(SCENARIO, { ops: OPS, sourceUrl: 'https://x/openapi.json' })
    expect(doc.workflows[0].steps[0].operationId).toBe('$sourceDescriptions.openapi.createPet')
    expect(doc.workflows[0].steps[1].operationPath).toBe(
      '{$sourceDescriptions.openapi.url}#/paths/~1pets~1{petId}/get',
    )
  })

  it('embeds expressions in a JSON body without breaking its shape', () => {
    const doc = toArazzo(SCENARIO, { ops: OPS, sourceUrl: '' })
    expect(doc.workflows[0].steps[0].requestBody).toEqual({
      contentType: 'application/json',
      payload: { name: 'Rex', owner: '$inputs.ownerName' },
    })
  })

  it('does not break on an orphan step nor on an empty scenario', () => {
    const orphan = normalizeScenario({ name: 'X', steps: [{ id: 's1', opId: 'gone' }] }).scenario
    expect(toArazzo(orphan, { ops: OPS }).workflows[0].steps[0]).toMatchObject({
      operationId: 'gone',
    })
    expect(toArazzo(normalizeScenario({ name: 'Vide' }).scenario, {}).workflows[0].steps).toEqual(
      [],
    )
    expect(() => toArazzo(null, {})).not.toThrow()
  })
})

describe('file and share link', () => {
  it('round-trips via file without carrying over the local id', () => {
    const file = encodeScenarioFile(SCENARIO)
    expect(file).toMatchObject({ format: 'apiglow-scenario', v: 1 })
    expect(file.scenario.id).toBeUndefined()
    expect(file.scenario.source).toBeUndefined()

    const { scenario, errors } = decodeScenarioFile(JSON.stringify(file))
    expect(errors).toEqual([])
    expect(scenario.name).toBe('Onboarding')
    expect(scenario.source).toBe('local')
    expect(scenario.steps.map((s) => s.opId)).toEqual(['createPet', 'get-pets-petid'])
    expect(scenario.steps[0].extract[1]).toMatchObject({
      name: 'auth.session',
      persist: true,
      sensitive: true,
    })
  })

  it('round-trips via link, non-ASCII content included', () => {
    const nonAscii = normalizeScenario({
      name: 'Checkout journey 🐈',
      steps: [{ id: 's', opId: 'createPet', request: { body: '{"name":"pet 🐈"}' } }],
    }).scenario
    const encoded = encodeScenarioLink(nonAscii)
    // base64url: nothing to re-encode in a URL.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    const { scenario } = decodeScenarioLink(encoded)
    expect(scenario.name).toBe('Checkout journey 🐈')
    expect(scenario.steps[0].request.body).toBe('{"name":"pet 🐈"}')
  })

  it('never leaks a known sensitive value (it is not in the model)', () => {
    const encoded = encodeScenarioLink(SCENARIO)
    expect(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))).toContain('{{auth.bearerAuth}}')
    expect(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('e2e-bearer-token')
  })

  it('returns null on unreadable input, without throwing', () => {
    expect(decodeScenarioLink('not-base64-!!')).toMatchObject({ scenario: null })
    expect(decodeScenarioLink('')).toMatchObject({
      scenario: null,
      errors: [{ code: 'link-invalid' }],
    })
    expect(decodeScenarioLink(btoa('{"format":"other"}'))).toMatchObject({
      scenario: null,
      errors: [{ code: 'file-format-unknown' }],
    })
  })

  it('caps the link to a length messaging apps do not truncate', () => {
    expect(SHARE_URL_MAX).toBeLessThanOrEqual(8000)
    expect(encodeScenarioLink(SCENARIO).length).toBeLessThan(SHARE_URL_MAX)
  })
})
