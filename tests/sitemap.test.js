import { describe, expect, it } from 'vitest'
import { bakedPath, bakedUrl, bakedUrls, fileSlug, siteRoot } from '../src/export/site-layout.js'
import { toSitemap } from '../src/export/sitemap.js'

// The bake's own map (docs/seo.md §4). Everything a crawler can reach is in
// this file and nowhere else — the app's routes live in a fragment — so what
// the generator omits is invisible to the whole strategy.

const model = {
  operations: [
    { id: 'listPets', method: 'get', path: '/pets' },
    { id: 'createPet', method: 'post', path: '/pets' },
  ],
  webhooks: [{ id: 'webhook-post-petadopted', kind: 'webhook', name: 'petAdopted' }],
}

const source = {
  model,
  pages: [{ slug: 'getting-started' }, { slug: 'pagination' }],
  scenarios: [{ id: 'create-pet' }],
}

const options = { siteUrl: 'https://docs.example.com/api/index.html' }

describe('sitemap.xml', () => {
  it('lists every baked page of the install', () => {
    expect(toSitemap([source], options)).toMatchSnapshot()
  })

  // The `.md` mirrors are for agents and are reached through `llms.txt`; a
  // crawler is given the indexable form only, or it indexes the same page
  // twice and picks the wrong one to show.
  it('lists the HTML snapshots and not the Markdown mirrors', () => {
    expect(toSitemap([source], options)).not.toContain('.md<')
  })

  // A webhook shares the `#/op/…` route with an operation, so it shares the
  // directory too — one namespace in the app, one on disk.
  it('gives a webhook a page like any operation', () => {
    expect(toSitemap([source], options)).toContain(
      '<loc>https://docs.example.com/api/op/webhook-post-petadopted.html</loc>',
    )
  })

  // One file for the whole site: a crawler is handed one address, and the
  // spec segment is the route prefix the app itself builds.
  it('covers every spec of a multi-spec install, nested under its own prefix', () => {
    const xml = toSitemap(
      [
        { ...source, specId: 'v1' },
        { model: { operations: [{ id: 'listPets' }] }, specId: 'v2' },
      ],
      options,
    )
    expect(xml).toContain('<loc>https://docs.example.com/api/s/v1/op/listPets.html</loc>')
    expect(xml).toContain('<loc>https://docs.example.com/api/s/v2/op/listPets.html</loc>')
    expect(xml).toContain('<loc>https://docs.example.com/api/s/v2/overview.html</loc>')
  })

  it('escapes what would close a tag from the inside', () => {
    const xml = toSitemap([{ model: { operations: [{ id: 'a&b' }] } }], options)
    expect(xml).toContain('a-b-')
    expect(xml).not.toContain('a&b')
  })
})

describe('baked layout', () => {
  // The tree is deposited next to the host page, which is where `llms.txt`
  // already expects its siblings — the reader's current route is not part of
  // the address.
  it('roots the tree at the host page directory', () => {
    expect(siteRoot('https://docs.example.com/api/index.html')).toBe(
      'https://docs.example.com/api/',
    )
    expect(siteRoot('https://docs.example.com/')).toBe('https://docs.example.com/')
    expect(siteRoot('https://docs.example.com/api/index.html#/op/ping')).toBe(
      'https://docs.example.com/api/',
    )
  })

  it('leaves an id that was already a file name alone', () => {
    expect(fileSlug('listPets')).toBe('listPets')
    expect(fileSlug('pets.list_v2-3')).toBe('pets.list_v2-3')
    expect(bakedPath({ kind: 'op', id: 'listPets' })).toBe('op/listPets.html')
    expect(bakedPath({ kind: 'page', id: 'intro', specId: 'v2' }, 'md')).toBe('s/v2/page/intro.md')
  })

  // `operationId` and a page `slug` are free-form: the OpenAPI specification
  // constrains neither, and one holding a path separator would name a file
  // outside the tree it belongs to.
  it('keeps a free-form id inside the tree, and apart from its neighbours', () => {
    expect(fileSlug('../../etc/passwd')).not.toContain('/')
    expect(fileSlug('../../etc/passwd')).not.toContain('..')
    expect(fileSlug('pets/list')).not.toBe(fileSlug('pets-list'))
    expect(fileSlug('pets/list')).toBe(fileSlug('pets/list'))
  })

  it('maps a target to the file the bake serves for it', () => {
    const urls = bakedUrls('https://docs.example.com/api/index.html', { specId: 'v2' })
    expect(urls.op('listPets')).toBe('https://docs.example.com/api/s/v2/op/listPets.md')
    expect(urls.page('intro')).toBe('https://docs.example.com/api/s/v2/page/intro.md')
    expect(urls.scenario('create-pet')).toBe(
      'https://docs.example.com/api/s/v2/scenario/create-pet.md',
    )
    expect(bakedUrl('https://docs.example.com/api/index.html', { kind: 'overview' })).toBe(
      'https://docs.example.com/api/overview.html',
    )
  })
})
