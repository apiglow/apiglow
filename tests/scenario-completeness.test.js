// The companion of `export-completeness.test.js` for the scenario model
// (docs/scenario-handoff.md §5). Its absence is what let the AI surface ignore
// scenarios in silence: that guard walks the normalized *OpenAPI* model, and a
// scenario does not live there, so nothing could ever fail over an export that
// forgot one.
//
// Same technique, other model: from `normalizeScenario`'s own keys to the
// exports. Every key a rich scenario produces is either emitted — with a probe
// proving its content reaches the artifact — or explicitly waived with the
// reason it is not there. A key that is neither belongs to a model that
// outgrew its exports.
//
// Two subjects, because a scenario leaves through two doors and they lose
// different things: the Arazzo document a runner executes, and the Markdown an
// agent reads. `steps[].continueOnFailure` is the case that makes the pair
// worth having — waived on one side, emitted on the other.
import { describe, expect, it } from 'vitest'
import { toArazzo } from '../src/export/arazzo.js'
import { toScenarioMarkdown } from '../src/export/scenario-markdown.js'
import { normalizeScenario } from '../src/scenarios/model.js'
import { recordKeys, scenarioModelKinds } from './support/scenario-model.js'

const OPS = [
  {
    id: 'createPet',
    operationId: 'createPet',
    method: 'post',
    path: '/pets',
    summary: 'Create a pet',
    parameters: [],
    requestBody: {
      contents: [
        { mediaType: 'application/json', schema: null },
        { mediaType: 'application/xml', schema: null },
      ],
    },
  },
  {
    id: 'get-pets-petid',
    operationId: null,
    method: 'get',
    path: '/pets/{petId}',
    summary: 'Read a pet',
    parameters: [{ name: 'petId', in: 'path', required: true }],
    requestBody: null,
  },
  {
    id: 'searchPets',
    operationId: 'searchPets',
    method: 'get',
    path: '/pets',
    summary: 'Search pets',
    parameters: [
      { name: 'filter', in: 'querystring' },
      { name: 'session', in: 'cookie' },
    ],
    requestBody: null,
  },
  {
    id: 'uploadPetPhoto',
    operationId: 'uploadPetPhoto',
    method: 'post',
    path: '/pets/{petId}/photo',
    summary: 'Upload a photo',
    parameters: [],
    requestBody: { contents: [{ mediaType: 'multipart/form-data', schema: { kind: 'object' } }] },
  },
]

// One scenario carrying every construct the model can express. Step ids are
// frozen: the snapshot below must be stable.
const SCENARIO = normalizeScenario(
  {
    id: 'onboarding',
    name: 'Onboarding',
    description: 'Create a pet, then read it back.',
    inputs: { ownerName: 'Ada' },
    steps: [
      {
        id: 'step-create',
        opId: 'createPet',
        note: 'First we create the pet.',
        request: {
          headers: [{ name: 'X-Key', value: '{{auth.apiKey}}' }],
          body: '{"name":"Rex","owner":"{{ownerName}}"}',
        },
        expect: { status: 201, assertions: [{ pointer: '/name', op: 'equals', value: 'Rex' }] },
        extract: [
          { name: 'petId', source: 'body', pointer: '/id' },
          { name: 'auth.session', source: 'header', pointer: 'X-Session', persist: true },
        ],
        timeout: 2500,
      },
      {
        id: 'step-read',
        opId: 'get-pets-petid',
        request: {
          path: { petId: '{{petId}}' },
          query: { verbose: 'true' },
          cookie: { session: '{{auth.session}}' },
        },
        expect: {
          assertions: [
            { pointer: '/id', op: 'exists' },
            { pointer: '/status', op: 'regex', value: '^avail' },
          ],
        },
        continueOnFailure: true,
      },
      {
        id: 'step-search',
        opId: 'searchPets',
        request: { queryString: 'sort=name&limit=10' },
        expect: { assertions: [{ op: 'matches', query: '$[?count(@.pets) > 0]' }] },
        extract: [{ name: 'firstPet', source: 'body', query: '$.pets[0].id' }],
      },
      {
        id: 'step-xml',
        opId: 'createPet',
        request: { body: '<pet><name>Rex</name></pet>', mediaTypeIndex: 1 },
      },
      {
        id: 'step-photo',
        opId: 'uploadPetPhoto',
        request: {
          formFields: [
            { name: 'caption', value: 'Rex at the park' },
            { name: 'photo', value: '', fileName: 'rex.png' },
          ],
        },
      },
      { id: 'step-bulk', opId: 'createPet', request: { body: '', bodyFileName: 'pets.json' } },
    ],
  },
  { source: 'config', id: 'onboarding' },
).scenario

// Probes are substrings of the generated artifact, chosen so that only the key
// under test can produce them.
const ARAZZO_EMITTED = {
  'scenario.name': '"title":"Onboarding"',
  'scenario.description': '"description":"Create a pet, then read it back."',
  'scenario.inputs': '"default":"Ada"',
  'scenario.steps': '"stepId":"createPet"',
  'step.opId': '"operationId":"$sourceDescriptions.openapi.createPet"',
  'step.note': '"description":"First we create the pet."',
  'step.request': '"parameters":',
  'step.expect': '"successCriteria":',
  'step.extract': '"outputs":',
  'step.timeout': '"timeout":2500',
  'request.path': '"in":"path"',
  'request.query': '"in":"query"',
  'request.cookie': '"in":"cookie"',
  'request.queryString': '"in":"querystring"',
  'request.headers': '"in":"header"',
  'request.body': '"name":"Rex"',
  'request.mediaTypeIndex': '"contentType":"application/xml"',
  'request.formFields': '"caption":"Rex at the park"',
  'request.headers.name': '"name":"X-Key"',
  'request.headers.value': '$inputs.auth_apiKey',
  'request.formFields.name': '"photo":',
  'request.formFields.value': 'Rex at the park',
  'request.formFields.fileName': '"@rex.png"',
  'expect.status': '$statusCode == 201',
  'expect.assertions': "$response.body#/name == 'Rex'",
  'expect.assertions.pointer': '$response.body#/status',
  'expect.assertions.op': '"type":"regex"',
  'expect.assertions.value': '"condition":"^avail"',
  'expect.assertions.query': '$[?count(@.pets) > 0]',
  'extract.name': '"petId":',
  'extract.source': '$response.header.X-Session',
  'extract.pointer': '$response.body#/id',
  'extract.query': '"selector":"$.pets[0].id"',
}

const ARAZZO_WAIVED = {
  'scenario.id':
    'the route id of this documentation (a private uuid for a local scenario) — the `workflowId` is derived from the name, which is what a runner names the workflow by',
  'scenario.source':
    'whether the scenario came from the config or the reader — an edit-rights and publication flag of this app, invisible to anything that runs the document',
  'step.id':
    'a private uuid; the readable `stepId` is derived from the operation, and it is what `$steps.x.outputs.y` references',
  'step.continueOnFailure':
    'Arazzo has no field for it. The nearest spelling is an `onFailure` `goto` onto the next step, which tells a CI runner the failure does not count — where our flag means the failure IS recorded and the run carries on. Emitting it would trade a loss for a wrong workflow; the Markdown export states the flag instead, and `scenario-roundtrip.test.js` pins the loss',
  'request.bodyFileName':
    'the bytes were never stored, only the name (docs/scenarios.md §2), and an empty body carries no `@name` convention to read one back from — unlike a form field, which does and is emitted above',
  'extract.persist':
    'Arazzo has no notion of a value written into the reader’s own environment (docs/scenarios.md §8.4)',
  'extract.sensitive':
    'the same: redaction is ours, and a document that cannot say `persist` cannot say what it implies',
}

const MARKDOWN_EMITTED = {
  'scenario.name': '# Onboarding',
  'scenario.description': 'Create a pet, then read it back.',
  'scenario.inputs': '- `{{ownerName}}` = `Ada`',
  'scenario.steps': '6 steps, run in order.',
  'step.opId': 'POST /pets',
  'step.note': 'First we create the pet.',
  'step.request': 'Sends:',
  'step.expect': 'Asserts:',
  'step.extract': 'Extracts, under the names',
  'step.timeout': '- Timeout: 2500 ms',
  'step.continueOnFailure': '- The scenario carries on even if this step fails.',
  'request.path': '- Path `petId`: `{{petId}}`',
  'request.query': '- Query `verbose`: `true`',
  'request.cookie': '- Cookie `session`: `{{auth.session}}`',
  'request.queryString': '- Query string: `sort=name&limit=10`',
  'request.headers': '- Header `X-Key`',
  'request.body': '{"name":"Rex","owner":"{{ownerName}}"}',
  'request.mediaTypeIndex': 'Body (`application/xml`):',
  'request.formFields': '- Form field `caption`',
  'request.bodyFileName': 'the file `pets.json`',
  'request.headers.name': 'X-Key',
  'request.headers.value': '{{auth.apiKey}}',
  'request.formFields.name': '`photo`',
  'request.formFields.value': 'Rex at the park',
  'request.formFields.fileName': 'the file `rex.png`',
  'expect.status': '- Status is `201`',
  'expect.assertions': 'equals `Rex`',
  'expect.assertions.pointer': '- `/status` in the response body',
  'expect.assertions.op': '- `/id` exists in the response body',
  'expect.assertions.value': 'matches `^avail`',
  'expect.assertions.query': 'JSONPath `$[?count(@.pets) > 0]` selects at least one node',
  'extract.name': '- `petId` —',
  'extract.source': 'response header `X-Session`',
  'extract.pointer': 'response body at `/id`',
  'extract.query': 'JSONPath `$.pets[0].id`',
  'extract.persist': 'saved to the environment',
  'extract.sensitive': 'sensitive, masked wherever it is shown',
}

const MARKDOWN_WAIVED = {
  'scenario.id':
    'the address of the page, carried by whatever links to it (§3.2) — a document does not repeat its own, and for a local scenario it is a private uuid anyway',
  'scenario.source':
    'an edit-rights and publication flag of this app; the published document says nothing about how it was declared',
  'step.id':
    'a private uuid, keying run reports — the reader numbers steps by position, which is how they are addressed here',
}

// Container keys are named by their kind and checked there, so a key naming a
// nested record is not listed twice under two names.
const MODEL_KEYS = Object.entries(scenarioModelKinds([SCENARIO])).flatMap(([kind, group]) =>
  recordKeys(group).map((key) => `${kind}.${key}`),
)

// Collected rather than fail-fast: the interesting report is "here is
// everything the export ignores", not the first key in declaration order.
function assertCovered(subject, keys, emitted, waived, text) {
  const unlisted = []
  const missing = []
  for (const key of keys) {
    if (key in waived) continue
    if (!(key in emitted)) {
      unlisted.push(key)
      continue
    }
    if (!text.includes(emitted[key])) missing.push(key)
  }
  expect(
    unlisted,
    `${subject} gained ${unlisted.map((k) => `\`${k}\``).join(', ')} — the export neither ` +
      'emits them nor waives them. Add an emitter, or a line in the waiver map saying why a ' +
      'reader does not need it.',
  ).toEqual([])
  expect(missing, `in the model, nowhere in the export: ${missing.join(', ')}`).toEqual([])
}

describe('the scenario exports keep pace with the scenario model', () => {
  it('emits or waives every key of a normalized scenario, in the Arazzo document', () => {
    const document = toArazzo(SCENARIO, {
      ops: OPS,
      sourceUrl: 'https://api.example.test/openapi.json',
    })
    assertCovered(
      'the Arazzo export',
      MODEL_KEYS,
      ARAZZO_EMITTED,
      ARAZZO_WAIVED,
      JSON.stringify(document),
    )
  })

  it('emits or waives every key of a normalized scenario, in the Markdown', () => {
    const text = toScenarioMarkdown(SCENARIO, { ops: OPS })
    assertCovered('the Markdown export', MODEL_KEYS, MARKDOWN_EMITTED, MARKDOWN_WAIVED, text)
  })

  // The checklist proves each key reaches the text; this pins how. The
  // scenario-markdown fixture is a two-step literal carrying none of the
  // querystring, regex, jsonpath, form and file constructs, so without this one
  // their formatting would be asserted by a `toContain` and nothing else.
  it('renders the whole construct set the same way run to run', () => {
    expect(toScenarioMarkdown(SCENARIO, { ops: OPS })).toMatchSnapshot()
  })

  // The guard's own guard: a model key nobody listed must fail, or the maps
  // above would silently become a list of everything that ever existed.
  it('fails on a key that is neither emitted nor waived', () => {
    expect(() =>
      assertCovered('a probe model', ['step.brandNew'], {}, {}, 'irrelevant text'),
    ).toThrow(/gained `step\.brandNew`/)
  })
})
