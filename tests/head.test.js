import { describe, expect, it } from 'vitest'
import { headFor } from '../src/shell/head.js'

// docs/seo.md §3 — what the app puts in <head> for each route. Only the
// derivation is tested here; writing it into the document is e2e territory
// (tests/e2e/head.spec.js).

const model = {
  info: {
    title: 'Pet Store',
    version: '2.1.0',
    description: 'Everything about pets. Orders too, and a webhook.',
  },
}

const op = {
  id: 'listPets',
  method: 'get',
  path: '/pets',
  summary: 'List all pets',
  description: 'Returns the pets, optionally filtered by **status**. Paginated by cursor.',
}

describe('titles', () => {
  it('names the operation, then the API', () => {
    expect(headFor({ type: 'op', op }, model).title).toBe('List all pets — Pet Store')
  })

  it('falls back to method and path, verbatim', () => {
    const bare = { id: 'get-user_profile', method: 'get', path: '/user_profile/{id}' }
    expect(headFor({ type: 'op', op: bare }, model).title).toBe(
      'GET /user_profile/{id} — Pet Store',
    )
  })

  it('leaves the bare API title on home', () => {
    expect(headFor({ type: null }, model).title).toBe('Pet Store')
  })

  it('leaves the bare API title when the route resolved to nothing', () => {
    expect(headFor({ type: 'op', op: null }, model).title).toBe('Pet Store')
    expect(headFor({ type: 'page', page: null }, model).title).toBe('Pet Store')
  })

  it('names the docs page', () => {
    const page = { slug: 'start', title: 'Getting started' }
    expect(headFor({ type: 'page', page }, model).title).toBe('Getting started — Pet Store')
  })

  it('uses the i18n view names for the routes that show no document content', () => {
    expect(headFor({ type: 'audit' }, model).title).toBe('Schema audit — Pet Store')
    expect(headFor({ type: 'overview' }, model).title).toBe('API overview — Pet Store')
    expect(headFor({ type: 'first-call' }, model).title).toBe('Your first call — Pet Store')
    expect(headFor({ type: 'scenario' }, model).title).toBe('Scenarios — Pet Store')
    expect(headFor({ type: 'scenario-import' }, model).title).toBe('Scenarios — Pet Store')
  })

  it('names the workflow once its document is in hand', () => {
    const scenario = { id: 'onboarding', name: 'Adopt a pet' }
    expect(headFor({ type: 'scenario', scenario }, model).title).toBe('Adopt a pet — Pet Store')
    // A declared scenario is listed under the title the config gave it: the
    // head says what the nav says.
    expect(headFor({ type: 'scenario', scenario, title: 'Onboarding' }, model).title).toBe(
      'Onboarding — Pet Store',
    )
  })

  it('never repeats a name that is already the API title', () => {
    const page = { slug: 'home', title: 'Pet Store' }
    expect(headFor({ type: 'page', page }, model).title).toBe('Pet Store')
  })

  it('says nothing rather than something empty when the document has no title', () => {
    expect(headFor({ type: null }, { info: {} }).title).toBe('')
  })
})

describe('descriptions', () => {
  it('takes the first sentence of the operation description', () => {
    expect(headFor({ type: 'op', op }, model).description).toBe(
      'Returns the pets, optionally filtered by status.',
    )
  })

  it('falls back to the summary, then to the document', () => {
    expect(headFor({ type: 'op', op: { ...op, description: undefined } }, model).description).toBe(
      'List all pets',
    )
    expect(
      headFor({ type: 'op', op: { ...op, summary: undefined, description: undefined } }, model)
        .description,
    ).toBe('Everything about pets.')
  })

  it('prefers info.summary over the first sentence of info.description', () => {
    const summarized = { info: { ...model.info, summary: 'The pet API.' } }
    expect(headFor({ type: null }, summarized).description).toBe('The pet API.')
  })

  it('does not mistake an abbreviation for the end of a sentence', () => {
    const abbreviated = { ...op, description: 'Filters by status, e.g. sold. Cursor paginated.' }
    expect(headFor({ type: 'op', op: abbreviated }, model).description).toBe(
      'Filters by status, e.g. sold.',
    )
  })

  it('strips the Markdown down to the prose it renders to', () => {
    const marked = {
      ...op,
      description: '## Pets\n\nSee [the guide](https://x.test) and `GET /pets`, _now_.',
    }
    expect(headFor({ type: 'op', op: marked }, model).description).toBe(
      'Pets See the guide and GET /pets, now.',
    )
  })

  it('clamps on a word boundary', () => {
    const long = { ...op, description: `${'pets '.repeat(60)}end` }
    const { description } = headFor({ type: 'op', op: long }, model)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description).toMatch(/pets…$/)
  })

  it('reads the docs page body past its frontmatter and its title heading', () => {
    const page = { slug: 'start', title: 'Getting started' }
    const text = '---\ntitle: Ignored\n---\n\n# Getting started\n\nCall your first endpoint.\n'
    expect(headFor({ type: 'page', page, text, format: 'markdown' }, model).description).toBe(
      'Call your first endpoint.',
    )
  })

  it('stands in with the document description while the page body is in flight', () => {
    const page = { slug: 'start', title: 'Getting started' }
    expect(headFor({ type: 'page', page }, model).description).toBe('Everything about pets.')
  })
})

describe('json-ld', () => {
  it('describes an endpoint as an APIReference inside its API', () => {
    expect(headFor({ type: 'op', op }, model).jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'APIReference',
      name: 'List all pets',
      description: 'Returns the pets, optionally filtered by status.',
      identifier: 'listPets',
      assemblyVersion: '2.1.0',
      isPartOf: { '@type': 'WebAPI', name: 'Pet Store' },
    })
  })

  it('describes a docs page as a TechArticle', () => {
    const page = { slug: 'start', title: 'Getting started' }
    const { jsonLd } = headFor({ type: 'page', page, text: 'Call it.', format: 'markdown' }, model)
    expect(jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Getting started',
      description: 'Call it.',
      isPartOf: { '@type': 'WebSite', name: 'Pet Store' },
    })
  })

  it('describes home and the overview as the site itself', () => {
    const site = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Pet Store',
      description: 'Everything about pets.',
    }
    expect(headFor({ type: null }, model).jsonLd).toEqual(site)
    expect(headFor({ type: 'overview' }, model).jsonLd).toEqual(site)
  })

  it('describes a workflow as a TechArticle too', () => {
    const scenario = {
      id: 'onboarding',
      name: 'Adopt a pet',
      description: 'Three calls, in order.',
    }
    expect(headFor({ type: 'scenario', scenario }, model).jsonLd).toEqual({
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'Adopt a pet',
      description: 'Three calls, in order.',
      isPartOf: { '@type': 'WebSite', name: 'Pet Store' },
    })
  })

  it('claims nothing for the views that carry no document content', () => {
    expect(headFor({ type: 'audit' }, model).jsonLd).toBeNull()
    expect(headFor({ type: 'first-call' }, model).jsonLd).toBeNull()
    // A scenario route with nothing resolved yet, and an import that is
    // nobody's page.
    expect(headFor({ type: 'scenario' }, model).jsonLd).toBeNull()
    expect(headFor({ type: 'scenario-import' }, model).jsonLd).toBeNull()
  })
})
