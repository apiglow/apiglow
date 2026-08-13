// The one thing a snapshot cannot do: notice what the model GAINED and the
// export quietly ignored. `llms-full.test.js` and `endpoint-markdown.test.js`
// freeze the bytes we emit today — they stay green forever while a new
// construct is modeled, rendered by the doc, and dropped on the floor by every
// model-derived generator.
//
// So this file walks the other way round: from the normalized model's own
// keys to the export. Every key a rich document produces is either emitted
// (with a probe proving its content reaches the text) or explicitly waived
// with a reason. A key that is neither belongs to a model that outgrew its
// exports, and that is what fails here.
import { readFileSync } from 'node:fs'
import $RefParser from '@apidevtools/json-schema-ref-parser'
import { describe, expect, it } from 'vitest'
import { toEndpointMarkdown } from '../src/export/endpoint-markdown.js'
import { toLlmsFullText } from '../src/export/llms-full.js'
import { toLlmsText } from '../src/export/llms.js'
import { buildModel } from '../src/openapi/loader.js'

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const load = async (name) => buildModel(await $RefParser.dereference(fixture(name)))

// Probes are substrings of the generated Markdown, chosen so that only the
// key under test can produce them.
const OP_EMITTED = {
  method: 'POST',
  path: '/things/{thingId}',
  operationId: 'createThing',
  summary: 'Create a thing',
  description: 'Creates a thing and schedules its indexing.',
  deprecated: '> Deprecated',
  tags: 'Things',
  externalDocs: 'https://docs.example.test/things',
  parameters: '`thingId`',
  requestBody: '## Request body',
  responses: '## Responses',
  callbacks: '## Callbacks',
  security: 'apiKeyAuth',
  servers: 'https://ops.example.test/v9',
}

const OP_WAIVED = {
  id: 'routing key for the deep link — an app-internal identity, not documentation (`operationId` above is the one a reader can act on)',
}

const DOC_EMITTED = {
  sourceVersion: 'OpenAPI 3.1.0',
  info: '# Completeness API',
  servers: 'https://api.example.test/v9',
  externalDocs: 'https://docs.example.test',
  securitySchemes: 'apiKeyAuth',
  security: 'Applies to every operation unless overridden',
  operations: '# Create a thing',
  webhooks: '# Webhook:',
}

const DOC_WAIVED = {
  baseUri:
    '3.2 `$self`, resolved at load time — where the document was read from, not what it documents',
  convertedFrom:
    'conversion diagnostic, surfaced by the settings panel; a reader gets the effective version above',
  sourceDialect:
    'recorded but never acted upon (every schema is read as 2020-12) — an audit finding, not doc content',
  groups: 'nav structure, derived from `tags`, which is emitted per operation',
  tags: 'the document tag list is nav metadata; each operation emits its own tags',
}

// `llms.txt` is an index, not the documentation: it exists to orient an agent
// and hand it the next file to read. So more keys are legitimately waived here
// than in `llms-full` — but each waiver has to say why an index does not carry
// it, which is the difference between a scope decision and an oversight.
const INDEX_EMITTED = {
  sourceVersion: 'OpenAPI 3.1.0',
  info: '# Completeness API',
  groups: '## Things',
  operations: '[POST /things/{thingId}]',
  webhooks: '## Webhooks',
  externalDocs: '[External documentation]',
  securitySchemes: 'Authentication: apiKeyAuth',
}

const INDEX_WAIVED = {
  servers:
    'the index states the one base URL the reader is pointed at; the server list is documentation, and it is in llms-full.txt',
  security:
    'which requirement applies to which operation is the contract, not the map — the index names the schemes and links to the full text',
  tags: 'nav metadata; the index groups by `groups`, which is derived from it',
  baseUri: '3.2 `$self`, where the document was read from — not what it documents',
  convertedFrom: 'conversion diagnostic, surfaced by the settings panel',
  sourceDialect: 'recorded but never acted upon (every schema is read as 2020-12)',
}

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

describe('model-derived exports keep pace with the model', () => {
  it('emits or waives every key of a normalized operation', async () => {
    const model = await load('completeness-3.1.json')
    const op = model.operations.find((o) => o.id === 'createThing')
    const text = toEndpointMarkdown(op, { baseUrl: 'https://api.example.test/v9' })
    assertCovered('a normalized operation', Object.keys(op), OP_EMITTED, OP_WAIVED, text)
  })

  it('emits or waives every key of a normalized document', async () => {
    const model = await load('completeness-3.1.json')
    const text = toLlmsFullText(model, { baseUrl: 'https://api.example.test/v9' })
    assertCovered('a normalized document', Object.keys(model), DOC_EMITTED, DOC_WAIVED, text)
  })

  it('emits or waives every key of the document in the llms.txt index', async () => {
    const model = await load('completeness-3.1.json')
    const text = toLlmsText(model, {
      docsUrl: 'https://docs.example.test/api/index.html',
      baseUrl: 'https://api.example.test/v9',
      specUrl: 'https://api.example.test/openapi.json',
    })
    assertCovered('the llms.txt index', Object.keys(model), INDEX_EMITTED, INDEX_WAIVED, text)
  })

  // The checklist proves each key reaches the text; this pins how. The other
  // two snapshot fixtures are hand-written model literals that carry none of
  // these constructs, so without this one the new emitters' formatting would
  // be asserted by a `toContain` and nothing else.
  it('renders the whole construct set the same way run to run', async () => {
    const model = await load('completeness-3.1.json')
    expect(toLlmsFullText(model, { baseUrl: 'https://api.example.test/v9' })).toMatchSnapshot()
  })

  // The docs zone is the other half of what the exports carry, and it has its
  // own shapes (docs/docs-pages.md §2.1) — a kind added there must reach the
  // index, or it exists for the reader and not for the agent.
  it('carries every docs entry kind into the llms.txt index', async () => {
    const model = await load('completeness-3.1.json')
    const text = toLlmsText(model, {
      docsUrl: 'https://docs.example.test/api/index.html',
      baseUrl: 'https://api.example.test/v9',
      specUrl: 'https://api.example.test/openapi.json',
      outline: [
        { kind: 'page', slug: 'intro', title: 'Intro' },
        {
          kind: 'group',
          title: 'How-to',
          entries: [
            { kind: 'page', slug: 'pagination', title: 'Pagination' },
            { kind: 'link', title: 'Status', href: 'https://status.example.test' },
          ],
        },
        { kind: 'link', title: 'GitHub', href: 'https://github.example.test/acme' },
      ],
    })
    expect(text).toContain('## Guides')
    expect(text).toContain('- [Intro](https://docs.example.test/api/index.html#/page/intro)')
    expect(text).toContain('## How-to')
    expect(text).toContain(
      '- [Pagination](https://docs.example.test/api/index.html#/page/pagination)',
    )
    expect(text).toContain('- [Status](https://status.example.test)')
    expect(text).toContain('- [GitHub](https://github.example.test/acme)')
  })

  // The guard's own guard: a model key nobody listed must fail, or the two
  // maps above would silently become a list of everything that ever existed.
  it('fails on a key that is neither emitted nor waived', () => {
    expect(() =>
      assertCovered('a probe model', ['brandNew'], OP_EMITTED, OP_WAIVED, 'irrelevant text'),
    ).toThrow(/gained `brandNew`/)
  })
})
