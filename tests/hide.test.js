import { describe, expect, it } from 'vitest'
import { buildModel } from '../src/openapi/loader.js'
import { diffOperations, operationFingerprints } from '../src/openapi/diff.js'
import { toLlmsFullText } from '../src/export/llms-full.js'
import { compileHideRules } from '../src/openapi/hide.js'
import { buildSearchIndex, searchIndex } from '../src/search/index.js'

// Document without $ref: buildModel accepts a dereferenced object directly.
const doc = () => ({
  openapi: '3.1.0',
  info: { title: 'Hide', version: '1' },
  tags: [{ name: 'pets' }, { name: 'internal', description: 'Do not publish' }],
  paths: {
    '/pets': {
      get: { operationId: 'listPets', tags: ['pets'], responses: { 200: { description: 'OK' } } },
      post: { tags: ['pets'], responses: { 201: { description: 'Created' } } },
    },
    '/pets/{petId}': {
      delete: {
        operationId: 'deletePet',
        tags: ['pets'],
        responses: { 204: { description: 'Gone' } },
      },
    },
    '/admin/reset': {
      post: {
        operationId: 'resetDatabase',
        tags: ['internal'],
        responses: { 200: { description: 'OK' } },
      },
    },
    '/admin/flush': {
      post: {
        operationId: 'flushCache',
        tags: ['internal'],
        responses: { 200: { description: 'OK' } },
      },
    },
  },
  webhooks: {
    petStatus: { post: { operationId: 'onPetStatus', responses: { 200: { description: 'OK' } } } },
  },
})

const ids = (model) => model.operations.map((o) => o.id)

describe('x-apiglow-hide extension', () => {
  it('hides an operation', () => {
    const raw = doc()
    raw.paths['/pets'].get['x-apiglow-hide'] = true
    expect(ids(buildModel(raw))).toEqual(['post-pets', 'deletePet', 'resetDatabase', 'flushCache'])
  })

  it('hides an entire Path Item', () => {
    const raw = doc()
    raw.paths['/pets']['x-apiglow-hide'] = true
    expect(ids(buildModel(raw))).toEqual(['deletePet', 'resetDatabase', 'flushCache'])
  })

  it('hides all operations of a tag, and the tag itself', () => {
    const raw = doc()
    raw.tags[1]['x-apiglow-hide'] = true
    const model = buildModel(raw)
    expect(ids(model)).toEqual(['listPets', 'post-pets', 'deletePet'])
    expect(model.tags.map((t) => t.name)).toEqual(['pets'])
    expect(model.groups.map((g) => g.tag)).toEqual(['pets'])
  })

  it('hides a webhook', () => {
    const raw = doc()
    raw.webhooks.petStatus.post['x-apiglow-hide'] = true
    expect(buildModel(raw).webhooks).toEqual([])
  })
})

describe('openapi.hide patterns', () => {
  const hidden = (hide) => ids(buildModel(doc(), { hide }))

  it('targets an operationId', () => {
    expect(hidden(['resetDatabase'])).toEqual(['listPets', 'post-pets', 'deletePet', 'flushCache'])
  })

  it('targets the fallback id of an operation without operationId', () => {
    expect(hidden(['post-pets'])).toEqual(['listPets', 'deletePet', 'resetDatabase', 'flushCache'])
  })

  it('targets a path with a wildcard, across all methods', () => {
    expect(hidden(['/admin/*'])).toEqual(['listPets', 'post-pets', 'deletePet'])
  })

  it('targets a method on a path', () => {
    expect(hidden(['DELETE /pets/{petId}'])).toEqual([
      'listPets',
      'post-pets',
      'resetDatabase',
      'flushCache',
    ])
  })

  it('hides nothing when the method does not match', () => {
    expect(hidden(['GET /admin/reset'])).toEqual([
      'listPets',
      'post-pets',
      'deletePet',
      'resetDatabase',
      'flushCache',
    ])
  })

  it('targets a tag, and removes it from groups', () => {
    const model = buildModel(doc(), { hide: ['tag:internal'] })
    expect(ids(model)).toEqual(['listPets', 'post-pets', 'deletePet'])
    // The tag stays declared (only x-apiglow-hide removes it), but its group
    // is empty so it is absent from the nav.
    expect(model.groups.map((g) => g.tag)).toEqual(['pets'])
  })

  it('targets a webhook by its operationId', () => {
    expect(buildModel(doc(), { hide: ['onPetStatus'] }).webhooks).toEqual([])
  })

  it('accumulates patterns', () => {
    expect(hidden(['/admin/*', 'listPets'])).toEqual(['post-pets', 'deletePet'])
  })

  it('ignores empty and missing patterns', () => {
    expect(hidden(['', '   '])).toEqual([
      'listPets',
      'post-pets',
      'deletePet',
      'resetDatabase',
      'flushCache',
    ])
    expect(hidden(undefined)).toHaveLength(5)
  })
})

describe('compileHideRules', () => {
  it('escapes regex metacharacters outside the wildcard', () => {
    const match = compileHideRules(['/pets/{petId}'])
    expect(match({ id: 'x', method: 'get', path: '/pets/{petId}', tags: [] })).toBe(true)
    // Without escaping, `{petId}` would be a quantifier and `.` a wildcard.
    expect(match({ id: 'x', method: 'get', path: '/petsXpetId', tags: [] })).toBe(false)
  })

  it('with no pattern, never hides anything', () => {
    expect(compileHideRules([])({ id: 'x', method: 'get', path: '/x', tags: [] })).toBe(false)
  })
})

// Hiding at normalization is the whole mechanism, but its promise is about
// what the user can reach: an operation that reappears in the palette, in an
// export or in the changelog is not hidden, it is just missing from the nav.
// These assertions are what make the mechanism's placement a guarantee rather
// than a coincidence.
describe('a hidden operation is gone from everything downstream', () => {
  const hidden = () => {
    const raw = doc()
    raw.paths['/admin/reset'].post['x-apiglow-hide'] = true
    raw.paths['/admin/flush'].post.summary = 'Flush the cache'
    return buildModel(raw, { hide: ['flushCache'] })
  }

  it('never enters the search index', () => {
    const entries = buildSearchIndex(hidden())
    const ids = entries.map((e) => e.id)
    expect(ids).not.toContain('resetDatabase')
    expect(ids).not.toContain('flushCache')
    expect(searchIndex(entries, 'reset')).toEqual([])
    expect(searchIndex(entries, 'flush')).toEqual([])
    // The rest of the document is still indexed: this is a filter, not a break.
    expect(ids).toContain('listPets')
  })

  it('never reaches the llms-full export', () => {
    const text = toLlmsFullText(hidden(), { baseUrl: 'https://api.test' })
    expect(text).not.toContain('/admin/reset')
    expect(text).not.toContain('/admin/flush')
    expect(text).not.toContain('Flush the cache')
    expect(text).toContain('/pets')
  })

  it('has no fingerprint, so the changelog has nothing to name it with', () => {
    const before = operationFingerprints(buildModel(doc()))
    const after = operationFingerprints(hidden())
    expect(after.map((op) => op.id)).not.toContain('resetDatabase')
    expect(after.map((op) => op.id)).not.toContain('flushCache')
    // Two visits to the same hidden document compare clean: hiding must not
    // read as a change either.
    expect(diffOperations(after, after).empty).toBe(true)
    // What remains fingerprints exactly as it did without the hiding — the
    // filter changes the set, never the contents.
    const kept = (list) => list.filter((op) => op.id === 'listPets')
    expect(kept(after)).toEqual(kept(before))
  })

  // The one trace hiding deliberately leaves: a count, so the page offering the
  // published file can say that file declares more than it shows. The names
  // stay out — this is a figure about the document, not a way back in.
  it('leaves a count behind, and only a count', () => {
    const model = hidden()
    expect(model.hiddenOperations).toBe(2)
    expect(JSON.stringify(model)).not.toContain('resetDatabase')
    // A document that hides nothing carries no such key at all.
    expect(buildModel(doc()).hiddenOperations).toBeUndefined()
  })

  it('counts what a hidden Path Item and a hidden webhook took with them', () => {
    const raw = doc()
    // Two operations under one Path Item, plus the webhook's single one.
    raw.paths['/pets']['x-apiglow-hide'] = true
    raw.webhooks.petStatus['x-apiglow-hide'] = true
    expect(buildModel(raw).hiddenOperations).toBe(3)

    const byTag = buildModel(doc(), { hide: ['tag:internal'] })
    expect(byTag.hiddenOperations).toBe(2)
  })

  it('is absent from the navigation order the pager walks', () => {
    const model = hidden()
    const navIds = model.groups.flatMap((group) => group.operationIds)
    expect(navIds).not.toContain('resetDatabase')
    expect(navIds).not.toContain('flushCache')
    // The tag that held only hidden operations goes with them.
    expect(model.groups.map((g) => g.name)).not.toContain('internal')
  })
})
