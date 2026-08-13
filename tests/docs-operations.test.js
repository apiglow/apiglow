import { afterEach, describe, expect, it } from 'vitest'
import { docsMarkdownToHtml } from '../src/docs/markdown.js'
import {
  buildOperationIndex,
  resolveOperationRef,
  setOperationIndex,
} from '../src/docs/operations.js'
import { setRouteSpecId } from '../src/router.js'

// docs/docs-pages.md §4.4 — addressing an operation from prose.

const MODEL = {
  operations: [
    { id: 'listPets', operationId: 'listPets', method: 'get', path: '/pets', summary: 'List pets' },
    {
      id: 'createPet',
      operationId: 'createPet',
      method: 'post',
      path: '/pets',
      summary: 'Add one',
    },
    // No operationId: the model's positional fallback id, reachable by
    // METHOD /path alone — which is the whole reason that form exists.
    { id: 'get-pets-petId', method: 'get', path: '/pets/{petId}', summary: 'One pet' },
    { id: 'oldPet', operationId: 'oldPet', method: 'delete', path: '/old', deprecated: true },
  ],
  webhooks: [{ id: 'petBorn', operationId: 'petBorn', method: 'post', path: 'petBorn' }],
}

const INDEX = buildOperationIndex(MODEL)

afterEach(() => {
  setOperationIndex(null)
  setRouteSpecId(null)
})

describe('reference resolution', () => {
  it('resolves an operationId first', () => {
    expect(resolveOperationRef(INDEX, 'createPet').id).toBe('createPet')
  })

  it('resolves "METHOD /path", method case-insensitively', () => {
    expect(resolveOperationRef(INDEX, 'GET /pets').id).toBe('listPets')
    expect(resolveOperationRef(INDEX, 'post /pets').id).toBe('createPet')
    expect(resolveOperationRef(INDEX, 'GET /pets/{petId}').id).toBe('get-pets-petId')
  })

  it('reaches webhooks by both addressings', () => {
    expect(resolveOperationRef(INDEX, 'petBorn').id).toBe('petBorn')
    expect(resolveOperationRef(INDEX, 'POST petBorn').id).toBe('petBorn')
  })

  it('decodes the percent-encoding a link destination picks up', () => {
    expect(resolveOperationRef(INDEX, 'GET%20/pets').id).toBe('listPets')
  })

  it('returns null rather than guessing', () => {
    expect(resolveOperationRef(INDEX, 'nope')).toBe(null)
    expect(resolveOperationRef(INDEX, 'GET /nope')).toBe(null)
    expect(resolveOperationRef(INDEX, 'PATCH /pets')).toBe(null)
    expect(resolveOperationRef(INDEX, '')).toBe(null)
  })
})

describe('enriched links', () => {
  it('turns an apidoc: link into a route with a method badge', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml('See [create a pet](apidoc:createPet).')
    expect(html).toContain('href="#/op/createPet"')
    expect(html).toContain('badge-success')
    expect(html).toContain('>post<')
    expect(html).toContain('create a pet')
  })

  it('accepts the "METHOD /path" form, space and all', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml('See [list pets](apidoc:GET /pets).')
    expect(html).toContain('href="#/op/listPets"')
    expect(html).toContain('list pets')
  })

  it('carries the multi-spec prefix, because the router builds the href', () => {
    setOperationIndex(INDEX)
    setRouteSpecId('payments')
    expect(docsMarkdownToHtml('[x](apidoc:createPet)')).toContain(
      'href="#/s/payments/op/createPet"',
    )
  })

  it('renders an unresolvable reference as visibly broken, never as a link', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml('See [ghost](apidoc:nope).')
    expect(html).toContain('apidoc-op-broken')
    expect(html).toContain('No operation matches')
    expect(html).not.toContain('<a')
  })

  it('leaves ordinary links alone', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml('[docs](https://example.test/x)')
    expect(html).toContain('href="https://example.test/x"')
    expect(html).not.toContain('apidoc-op')
  })
})

describe('operation cards', () => {
  const block = (body) => `\`\`\`apidoc:operation\n${body}\n\`\`\``

  it('renders one card per line, with badge, path and summary', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml(block('GET /pets\ncreatePet'))
    expect(html).toContain('apidoc-op-cards')
    expect(html).toContain('href="#/op/listPets"')
    expect(html).toContain('href="#/op/createPet"')
    expect(html).toContain('/pets')
    expect(html).toContain('List pets')
    expect(html).toContain('aria-label="GET /pets — List pets"')
  })

  it('flags a deprecated operation', () => {
    setOperationIndex(INDEX)
    expect(docsMarkdownToHtml(block('oldPet'))).toContain('deprecated')
  })

  it('renders an inline error card for an unresolvable line', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml(block('GET /pets\nGET /ghost'))
    expect(html).toContain('apidoc-op-card-broken')
    expect(html).toContain('No operation matches')
    // The good line still renders.
    expect(html).toContain('href="#/op/listPets"')
  })

  it('is not swallowed by an adjacent code fence', () => {
    setOperationIndex(INDEX)
    const html = docsMarkdownToHtml(['```bash\ncurl x\n```', block('createPet')].join('\n'))
    expect(html).not.toContain('data-code-tabs')
    expect(html).toContain('apidoc-op-cards')
  })

  it('degrades to a plain code fence when nothing resolves the references', () => {
    // No index set: the app hasn't booted a model, which is also what any
    // other markdown renderer sees.
    const html = docsMarkdownToHtml(block('GET /pets'))
    expect(html).toContain('apidoc-op-card-broken')
  })
})
