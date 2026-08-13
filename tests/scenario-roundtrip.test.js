import { describe, expect, it } from 'vitest'
import { toArazzo } from '../src/export/arazzo.js'
import { parseArazzo } from '../src/import/arazzo.js'
import { normalizeScenario } from '../src/scenarios/model.js'
import { recordKeys, scenarioModelKinds } from './support/scenario-model.js'

// The authoring loop a declared Arazzo document makes possible
// (docs/scenario-handoff.md §5): build a scenario in the UI, export it as
// Arazzo, commit it for CI, declare that same file. It crosses three pieces of
// code each tested alone — `toArazzo`, `parseArazzo`, `normalizeScenario` — and
// nothing tested them together over the whole model.
//
// So this file asserts a property rather than an example: exported and read
// back, a scenario differs from itself in the declared places and nowhere else.
// Every loss is named with the reason it is one; an undeclared difference fails,
// which is what makes a silent loss impossible to add.
//
// The second half is the corpus's own guard: every key the scenario model
// expresses has to be exercised by at least one case, or the property above
// holds over the constructs we happened to think of.

const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    // Two media types: a step editing the second one is the only way to
    // exercise `mediaTypeIndex`.
    requestBody: {
      contents: [
        { mediaType: 'application/json', schema: null },
        { mediaType: 'application/xml', schema: null },
      ],
    },
  },
  {
    // No `operationId`: the export falls back on `operationPath`, and the
    // import has to decode it back to this same id.
    id: 'get-pets-petid',
    operationId: null,
    method: 'get',
    path: '/pets/{petId}',
    requestBody: null,
    parameters: [{ name: 'petId', in: 'path' }],
  },
  {
    id: 'searchPets',
    operationId: 'searchPets',
    method: 'get',
    path: '/pets',
    requestBody: null,
    parameters: [
      { name: 'q', in: 'querystring' },
      { name: 'session', in: 'cookie' },
    ],
  },
  {
    id: 'uploadPetPhoto',
    operationId: 'uploadPetPhoto',
    method: 'post',
    path: '/pets/{petId}/photo',
    requestBody: { contents: [{ mediaType: 'multipart/form-data', schema: { kind: 'object' } }] },
  },
]

// Each case: the scenario as an author builds it, the losses the trip is
// allowed to take (path → why), and the warnings the importer is expected to
// name. Anything else is a defect.
const CORPUS = [
  {
    name: 'a chained scenario with a body, parameters, a criterion and an extraction',
    raw: {
      id: 'onboarding',
      name: 'Onboarding',
      description: 'Create a pet, then read it back.',
      inputs: { 'auth.apiKey': 'demo', ownerName: 'Ada' },
      steps: [
        {
          opId: 'createPet',
          note: 'First we create the pet.',
          request: {
            headers: [{ name: 'X-Key', value: '{{auth.apiKey}}' }],
            body: JSON.stringify({ name: 'Rex', owner: '{{ownerName}}' }, null, 2),
          },
          expect: { status: 201, assertions: [{ pointer: '/name', op: 'equals', value: 'Rex' }] },
          extract: [{ name: 'petId', source: 'body', pointer: '/id' }],
          timeout: 2500,
        },
        {
          opId: 'get-pets-petid',
          request: {
            path: { petId: '{{petId}}' },
            query: { verbose: 'true', tags: ['cat', 'dog'] },
          },
          expect: { status: 404, assertions: [{ pointer: '/id', op: 'exists' }] },
        },
      ],
    },
  },
  {
    name: 'a body on the operation’s second media type',
    raw: {
      id: 'xml-body',
      name: 'XML body',
      steps: [
        {
          opId: 'createPet',
          request: { body: '<pet><name>Rex</name></pet>', mediaTypeIndex: 1 },
        },
      ],
    },
  },
  {
    name: 'the whole query string, and a header extraction',
    raw: {
      id: 'search',
      name: 'Search',
      steps: [
        {
          opId: 'searchPets',
          request: { queryString: 'sort=name&limit=10' },
          extract: [{ name: 'requestId', source: 'header', pointer: 'X-Request-Id' }],
        },
      ],
    },
  },
  {
    name: 'the two query languages: a jsonpath criterion and a jsonpath extraction',
    raw: {
      id: 'queries',
      name: 'Queries',
      steps: [
        {
          opId: 'searchPets',
          expect: { assertions: [{ op: 'matches', query: '$[?count(@.pets) > 0]' }] },
          extract: [{ name: 'firstPet', source: 'body', query: '$.pets[0].id' }],
        },
      ],
    },
  },
  {
    name: 'a regex criterion over a pointed-at value',
    raw: {
      id: 'available',
      name: 'Available',
      steps: [
        {
          opId: 'searchPets',
          expect: { assertions: [{ pointer: '/status', op: 'regex', value: '^avail' }] },
        },
      ],
    },
  },
  {
    name: 'a form body',
    raw: {
      id: 'upload',
      name: 'Upload',
      steps: [
        {
          opId: 'uploadPetPhoto',
          request: {
            path: { petId: '{{petId}}' },
            formFields: [
              { name: 'caption', value: 'Rex at the park' },
              { name: 'alt', value: '{{ownerName}}’s pet' },
            ],
          },
        },
      ],
    },
  },
  {
    name: 'a status class rather than an exact code',
    raw: {
      id: 'any-success',
      name: 'Any success',
      steps: [{ opId: 'searchPets', expect: { status: '2xx' } }],
    },
    loses: {
      'steps[0].expect':
        'a 2xx expectation IS the default verdict: it exports as the criterion every step carries, and comes back as no expectation of its own',
    },
  },
  {
    name: 'a cookie parameter',
    raw: {
      id: 'with-cookie',
      name: 'With cookie',
      steps: [{ opId: 'searchPets', request: { cookie: { session: '{{token}}' } } }],
    },
  },
  {
    name: 'a step that goes on after a failure',
    raw: {
      id: 'resilient',
      name: 'Resilient',
      steps: [{ opId: 'searchPets', continueOnFailure: true }],
    },
    loses: {
      'steps[0].continueOnFailure':
        'Arazzo has no field for it: the nearest spelling is an `onFailure` `goto` onto the next step, which tells a CI runner the failure does not count — where our flag means the failure IS recorded and the run carries on. Exporting it would trade a loss for a wrong workflow, so the flag stays here and the Markdown export (§3.1) is what states it',
    },
  },
  {
    name: 'an extraction the reader persists into their environment',
    raw: {
      id: 'login',
      name: 'Login',
      steps: [
        {
          opId: 'createPet',
          extract: [{ name: 'auth.session', source: 'body', pointer: '/token', persist: true }],
        },
      ],
    },
    loses: {
      'steps[0].extract[0].name':
        'a dot separates an Arazzo expression: `auth.session` leaves as `auth_session`, and only a workflow INPUT records the original in its description — an output has no such place (docs/scenarios.md §8.4)',
      'steps[0].extract[0].persist':
        'Arazzo has no notion of a value written into the reader’s environment (docs/scenarios.md §8.4)',
      'steps[0].extract[0].sensitive':
        'the same: redaction is ours, and a document that cannot say `persist` cannot say what it implies',
    },
  },
  {
    name: 'a request whose body and form field are files',
    raw: {
      id: 'photos',
      name: 'Photos',
      steps: [
        {
          opId: 'uploadPetPhoto',
          request: {
            formFields: [{ name: 'photo', value: '', fileName: 'rex.png' }],
          },
        },
        {
          opId: 'createPet',
          request: { body: '', bodyFileName: 'pets.json' },
        },
      ],
    },
    loses: {
      'steps[1].request.body':
        'a file body has nothing to export: the empty string it stands for comes back as no body at all',
      'steps[1].request.bodyFileName':
        'the bytes were never stored, only the name, and an empty body carries no `@name` convention to read it back from — unlike a form field, which does and survives',
    },
  },
]

describe('a scenario survives the Arazzo round trip', () => {
  for (const entry of CORPUS) {
    it(entry.name, () => {
      const scenario = normalizeScenario(entry.raw).scenario
      const exported = toArazzo(scenario, { ops: OPS, sourceUrl: 'https://api.test/openapi.json' })
      const result = parseArazzo(exported, { ops: OPS })
      expect(result.errors).toEqual([])
      expect(result.warnings.map((warning) => warning.code)).toEqual(entry.warnings ?? [])
      expect(result.scenarios).toHaveLength(1)
      expect(differences(scenario, result.scenarios[0])).toEqual(
        Object.keys(entry.loses ?? {}).sort(),
      )
    })
  }
})

// The corpus's guard. `export-completeness.test.js` walks the OpenAPI model's
// keys for the same reason: a property proved over half a model is a property
// about the half somebody happened to write down.
describe('the corpus covers the scenario model', () => {
  const KINDS = scenarioModelKinds(CORPUS.map((entry) => normalizeScenario(entry.raw).scenario))

  for (const [kind, group] of Object.entries(KINDS)) {
    it(`exercises every key of a ${kind}`, () => {
      const { instances } = group
      const idle = recordKeys(group).filter(
        (key) => !instances.some((instance) => carries(instance[key])),
      )
      expect(
        idle,
        `no case in the corpus gives ${kind} a value for ${idle.join(', ')} — the round trip ` +
          'says nothing about those keys. Add a case, or the model gained something the ' +
          'authoring loop was never proved to carry.',
      ).toEqual([])
    })
  }
})

// "The document says something here": an empty string, an empty list, a false
// flag or a zero index are what the model holds when nothing was said.
function carries(value) {
  if (value === undefined || value === null || value === '' || value === false || value === 0)
    return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

// Ids apart — a local id is a private uuid, and a step id is regenerated on
// import — every path where the two scenarios disagree.
function differences(before, after) {
  return diffPaths(withoutIds(before), withoutIds(after), '').sort()
}

function withoutIds(scenario) {
  const { id, steps, ...rest } = scenario
  return { ...rest, steps: steps.map(({ id: stepId, ...step }) => step) }
}

function diffPaths(a, b, path) {
  if (Object.is(a, b)) return []
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [path]
    return a.flatMap((item, index) => diffPaths(item, b[index], `${path}[${index}]`))
  }
  if (isRecord(a) && isRecord(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      diffPaths(a[key], b[key], path ? `${path}.${key}` : key),
    )
  }
  return [path]
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
