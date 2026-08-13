import { describe, expect, it } from 'vitest'
import { loadInlineApiModel } from '../src/openapi/loader.js'
import { applyOverlay, applyOverlays } from '../src/openapi/overlay.js'

// OpenAPI Overlay 1.1 (docs/openapi-coverage.md §4.7): the merge rules, the
// three action kinds, RFC 9535 targets, and what an overlay that does nothing
// has to say about it.

const DOC = () => ({
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  tags: [{ name: 'pets' }, { name: 'internal' }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'debug', in: 'query', schema: { type: 'boolean' } },
        ],
      },
      post: { operationId: 'createPet', summary: 'Create a pet' },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Read a pet',
        parameters: [{ name: 'petId', in: 'path', required: true }],
      },
    },
  },
})

const overlay = (actions) => ({ overlay: '1.0.0', info: { title: 'o', version: '1' }, actions })

const apply = (actions, doc = DOC()) => applyOverlay(doc, overlay(actions))

const codes = (result) => result.warnings.map((warning) => warning.code)

describe('applyOverlay — update', () => {
  it('deep-merges into an object target and leaves siblings alone', () => {
    const { document, warnings, actions } = apply([
      { target: "$.paths['/pets'].get", update: { summary: 'All pets', deprecated: true } },
    ])
    expect(warnings).toEqual([])
    expect(actions).toBe(1)
    expect(document.paths['/pets'].get.summary).toBe('All pets')
    expect(document.paths['/pets'].get.deprecated).toBe(true)
    expect(document.paths['/pets'].get.operationId).toBe('listPets')
    expect(document.paths['/pets'].post.summary).toBe('Create a pet')
  })

  it('merges nested objects rather than replacing them', () => {
    const { document } = apply([{ target: '$.info', update: { contact: { name: 'API team' } } }])
    expect(document.info).toEqual({
      title: 'Pets',
      version: '1.0.0',
      contact: { name: 'API team' },
    })
  })

  it('appends a non-array update to an array target', () => {
    const { document } = apply([{ target: '$.tags', update: { name: 'billing' } }])
    expect(document.tags).toEqual([{ name: 'pets' }, { name: 'internal' }, { name: 'billing' }])
  })

  it('concatenates an array update with an array target', () => {
    const { document } = apply([
      { target: '$.tags', update: [{ name: 'billing' }, { name: 'ops' }] },
    ])
    expect(document.tags.map((tag) => tag.name)).toEqual(['pets', 'internal', 'billing', 'ops'])
  })

  it('concatenates a nested array present on both sides', () => {
    const { document } = apply([
      {
        target: "$.paths['/pets'].get",
        update: { parameters: [{ name: 'cursor', in: 'query' }] },
      },
    ])
    expect(document.paths['/pets'].get.parameters.map((p) => p.name)).toEqual([
      'limit',
      'debug',
      'cursor',
    ])
  })

  it('replaces a primitive target with a primitive update', () => {
    const { document, warnings } = apply([{ target: '$.info.title', update: 'Pets, revised' }])
    expect(warnings).toEqual([])
    expect(document.info.title).toBe('Pets, revised')
  })

  it('replaces a primitive inside an array in place', () => {
    const { document } = apply([{ target: '$.tags[0].name', update: 'companions' }])
    expect(document.tags[0]).toEqual({ name: 'companions' })
  })

  it('refuses to merge an object onto a scalar and says so', () => {
    const result = apply([{ target: '$.info.title', update: { x: 1 } }])
    expect(codes(result)).toEqual(['overlay-update-mismatch'])
    expect(result.document.info.title).toBe('Pets')
  })

  it('refuses to replace an object with a scalar and says so', () => {
    const result = apply([{ target: '$.info', update: 'nope' }])
    expect(codes(result)).toEqual(['overlay-update-mismatch'])
    expect(result.document.info.title).toBe('Pets')
  })

  it('will not replace the document itself, having no parent to write through', () => {
    const result = apply([{ target: '$', update: 'nope' }])
    expect(codes(result)).toEqual(['overlay-update-mismatch'])
    expect(result.document.openapi).toBe('3.1.0')
  })

  it('flags an action that declares no operation at all', () => {
    const result = apply([{ target: '$.info' }])
    expect(codes(result)).toEqual(['overlay-update-missing'])
  })
})

describe('applyOverlay — copy', () => {
  it('merges the copied node into each target', () => {
    const { document, warnings, actions } = apply([
      { target: '$.paths.*.get', copy: "$.paths['/pets'].post" },
    ])
    expect(warnings).toEqual([])
    expect(actions).toBe(1)
    // Merged, not replaced: the target keeps what the source does not carry.
    expect(document.paths['/pets'].get.operationId).toBe('createPet')
    expect(document.paths['/pets'].get.summary).toBe('Create a pet')
    expect(document.paths['/pets'].get.parameters).toHaveLength(2)
    expect(document.paths['/pets/{petId}'].get.summary).toBe('Create a pet')
  })

  it('detaches the copy from its source, so a later action cannot reach it', () => {
    const { document } = apply([
      { target: '$.info', copy: "$.paths['/pets'].post" },
      { target: "$.paths['/pets'].post", remove: true },
    ])
    expect(document.paths['/pets'].post).toBeUndefined()
    expect(document.info.operationId).toBe('createPet')
  })

  it('sees what the actions before it produced', () => {
    const { document } = apply([
      { target: "$.paths['/pets'].post", update: { 'x-owner': 'billing' } },
      { target: "$.paths['/pets'].get", copy: "$.paths['/pets'].post" },
    ])
    expect(document.paths['/pets'].get['x-owner']).toBe('billing')
  })

  it('changes nothing when the copy source matches no node', () => {
    const before = JSON.stringify(DOC())
    const result = apply([{ target: '$.info', copy: '$.nope' }])
    expect(result.warnings).toEqual([{ code: 'overlay-copy-empty', copy: '$.nope' }])
    expect(JSON.stringify(result.document)).toBe(before)
  })

  it('refuses a copy source matching several nodes', () => {
    const result = apply([{ target: '$.info', copy: '$.tags[*]' }])
    expect(result.warnings).toEqual([
      { code: 'overlay-copy-ambiguous', copy: '$.tags[*]', count: 2 },
    ])
    expect(result.document.info.name).toBeUndefined()
  })

  // Its own code, not the target's: a reader looking at the diagnostics has to
  // be able to tell the two ends of one action apart.
  it('names an unsupported copy expression as a copy problem', () => {
    const result = apply([{ target: '$.info', copy: '$.tags[?(@.name =~ /pets/)]' }])
    expect(result.warnings).toEqual([
      { code: 'overlay-copy-unsupported', copy: '$.tags[?(@.name =~ /pets/)]' },
    ])
  })

  it('applies neither when an action declares both update and copy', () => {
    const result = apply([{ target: '$.info', update: { title: 'Other' }, copy: '$.tags[0]' }])
    expect(result.warnings).toEqual([{ code: 'overlay-action-ambiguous', target: '$.info' }])
    expect(result.document.info.title).toBe('Pets')
    expect(result.document.info.name).toBeUndefined()
  })

  it('lets remove empty both of the others', () => {
    const { document, warnings } = apply([
      { target: "$.paths['/pets'].post", remove: true, copy: '$.tags[0]', update: { a: 1 } },
    ])
    expect(warnings).toEqual([])
    expect(document.paths['/pets'].post).toBeUndefined()
  })
})

describe('applyOverlay — remove', () => {
  it('deletes an object entry', () => {
    const { document, actions } = apply([{ target: "$.paths['/pets'].post", remove: true }])
    expect(actions).toBe(1)
    expect(Object.keys(document.paths['/pets'])).toEqual(['get'])
  })

  it('deletes several array entries in one action', () => {
    const { document } = apply([{ target: "$..parameters[?(@.in == 'query')]", remove: true }])
    expect(document.paths['/pets'].get.parameters).toEqual([])
    expect(document.paths['/pets/{petId}'].get.parameters).toHaveLength(1)
  })

  it('will not remove the document itself', () => {
    const result = apply([{ target: '$', remove: true }])
    expect(codes(result)).toEqual(['overlay-remove-root', 'overlay-remove-failed'])
    expect(result.document.openapi).toBe('3.1.0')
  })
})

describe('applyOverlay — target expressions', () => {
  it('walks a wildcard over the path items', () => {
    const { document } = apply([{ target: '$.paths.*.get', update: { 'x-audience': 'public' } }])
    expect(document.paths['/pets'].get['x-audience']).toBe('public')
    expect(document.paths['/pets/{petId}'].get['x-audience']).toBe('public')
    expect(document.paths['/pets'].post['x-audience']).toBeUndefined()
  })

  it('walks a bracket wildcard the same way', () => {
    const { document } = apply([{ target: '$.tags[*]', update: { description: 'group' } }])
    expect(document.tags.every((tag) => tag.description === 'group')).toBe(true)
  })

  it('indexes into an array', () => {
    const { document } = apply([{ target: '$.tags[1]', update: { description: 'staff only' } }])
    expect(document.tags[1]).toEqual({ name: 'internal', description: 'staff only' })
    expect(document.tags[0].description).toBeUndefined()
  })

  it('descends with `..` and filters on a property', () => {
    const { document } = apply([
      { target: "$..parameters[?(@.name == 'petId')]", update: { description: 'Pet id' } },
    ])
    expect(document.paths['/pets/{petId}'].get.parameters[0].description).toBe('Pet id')
    expect(document.paths['/pets'].get.parameters[0].description).toBeUndefined()
  })

  it('reads a quoted child, which is the only way to name a path', () => {
    const { document } = apply([
      { target: '$["paths"]["/pets/{petId}"]["get"]', update: { summary: 'Get one' } },
    ])
    expect(document.paths['/pets/{petId}'].get.summary).toBe('Get one')
  })

  it('names an expression that is not valid RFC 9535 instead of half-applying it', () => {
    const result = apply([{ target: '$.paths[?(@.get.summary =~ /List/)]', update: { a: 1 } }])
    expect(codes(result)).toEqual(['overlay-target-unsupported'])
  })

  it('flags a target that matches nothing — the silent way to change nothing', () => {
    const result = apply([{ target: "$.paths['/orders'].get", update: { summary: 'x' } }])
    expect(codes(result)).toEqual(['overlay-target-empty'])
  })

  it('flags an action with no target at all', () => {
    expect(codes(apply([{ update: { a: 1 } }]))).toEqual(['overlay-target-missing'])
  })
})

// What 1.1 made a MUST and the hand-written subset never parsed: everything
// below returned `overlay-target-unsupported` before the engine landed.
describe('applyOverlay — RFC 9535 beyond the old subset', () => {
  const wideDoc = () => {
    const doc = DOC()
    doc.tags = [
      { name: 'pets', weight: 3 },
      { name: 'internal', weight: 1 },
      { name: 'billing', weight: 7, deprecated: true },
      { name: 'ops', weight: 5 },
    ]
    return doc
  }

  // The tags the target selected, by name: every case below is "which of the
  // four did this expression reach?".
  const marked = (target, doc = wideDoc()) =>
    apply([{ target, update: { hit: true } }], doc)
      .document.tags.filter((tag) => tag.hit)
      .map((tag) => tag.name)

  it('slices an array', () => {
    expect(marked('$.tags[1:3]')).toEqual(['internal', 'billing'])
  })

  it('slices with a step', () => {
    expect(marked('$.tags[0:4:2]')).toEqual(['pets', 'billing'])
  })

  it('takes a union of indices', () => {
    expect(marked('$.tags[0,3]')).toEqual(['pets', 'ops'])
  })

  it('takes a union of names', () => {
    const { document } = apply([{ target: "$.info['title','version']", update: 'x' }])
    expect(document.info).toEqual({ title: 'x', version: 'x' })
  })

  it('filters on a relational operator', () => {
    expect(marked('$.tags[?@.weight > 4]')).toEqual(['billing', 'ops'])
  })

  it('filters on a logical conjunction', () => {
    expect(marked('$.tags[?@.weight > 2 && @.name != "pets"]')).toEqual(['billing', 'ops'])
  })

  it('filters on a negated existence test', () => {
    expect(marked('$.tags[?!@.deprecated]')).toEqual(['pets', 'internal', 'ops'])
  })

  it('filters through a nested path', () => {
    const { document } = apply([
      { target: "$.paths[?@.get.operationId == 'getPet']", update: { 'x-audience': 'public' } },
    ])
    expect(document.paths['/pets/{petId}']['x-audience']).toBe('public')
    expect(document.paths['/pets']['x-audience']).toBeUndefined()
  })

  it('calls a function extension', () => {
    expect(marked('$.tags[?length(@.name) < 5]')).toEqual(['pets', 'ops'])
  })

  it('calls the regex function extension', () => {
    expect(marked("$.tags[?match(@.name, 'b.*')]")).toEqual(['billing'])
  })

  it('acts in place through a filtered target, remove included', () => {
    const { document } = apply([{ target: '$.tags[?@.weight < 4]', remove: true }], wideDoc())
    expect(document.tags.map((tag) => tag.name)).toEqual(['billing', 'ops'])
  })

  it('stays bounded on a pathological descent and says it was cut short', () => {
    // 6000 nodes against MAX_MATCHES = 5000: the cap is the point, not the shape.
    const doc = DOC()
    doc.tags = Array.from({ length: 6000 }, (_, i) => ({ name: `tag-${i}` }))
    const result = apply([{ target: '$..name', update: 'flattened' }], doc)
    expect(codes(result)).toContain('overlay-target-truncated')
    expect(doc.tags[0].name).toBe('tag-0')
  })
})

describe('applyOverlay — document handling', () => {
  it('never touches the document it was given', () => {
    const source = DOC()
    const { document } = applyOverlay(
      source,
      overlay([{ target: '$.info', update: { title: 'Other' } }]),
    )
    expect(source.info.title).toBe('Pets')
    expect(document.info.title).toBe('Other')
  })

  it('accepts a 1.1 document as readily as a 1.0 one', () => {
    for (const version of ['1.0.0', '1.1.0', '1.1']) {
      const result = applyOverlay(DOC(), {
        overlay: version,
        info: { title: 'o', version: '1' },
        actions: [{ target: '$.info', update: { title: 'Other' } }],
      })
      expect(codes(result)).toEqual([])
      expect(result.document.info.title).toBe('Other')
    }
  })

  // Only the overlays that say *why* they exist: a title alone adds nothing to
  // the "N overlays applied" line the panel already shows, so it is not
  // carried on its own.
  it('carries the identity of an overlay that describes itself, and only that one', () => {
    const result = applyOverlays(DOC(), [
      {
        overlay: '1.1.0',
        info: { title: 'Public trim', version: '1', description: 'Hides the *internal* bits.' },
        actions: [{ target: '$.tags[1]', remove: true }],
      },
      overlay([{ target: '$.info', update: { title: 'Other' } }]),
      {
        overlay: '1.1.0',
        info: { version: '1', description: 'Untitled, but it still says what it is for.' },
        actions: [{ target: '$.info', update: { version: '2.0.0' } }],
      },
    ])
    expect(result.infos).toEqual([
      { overlay: 1, title: 'Public trim', description: 'Hides the *internal* bits.' },
      { overlay: 3, title: '', description: 'Untitled, but it still says what it is for.' },
    ])
  })

  it('applies an unknown revision anyway, and says which', () => {
    const result = applyOverlay(DOC(), {
      overlay: '2.0.0',
      actions: [{ target: '$.info', update: { title: 'Other' } }],
    })
    expect(result.warnings).toEqual([{ code: 'overlay-version-unknown', version: '2.0.0' }])
    expect(result.document.info.title).toBe('Other')
  })

  it('rejects what is not an overlay document, and an empty one', () => {
    expect(codes(applyOverlay(DOC(), 'nope'))).toEqual(['overlay-invalid'])
    expect(codes(applyOverlay(DOC(), { overlay: '1.0.0', actions: [] }))).toEqual([
      'overlay-no-actions',
    ])
  })

  it('chains several overlays in declaration order and counts the actions', () => {
    const result = applyOverlays(DOC(), [
      overlay([{ target: '$.info', update: { title: 'First' } }]),
      overlay([
        { target: '$.info', update: { title: 'Second' } },
        { target: '$.tags[0]', update: { description: 'pets' } },
      ]),
    ])
    expect(result.document.info.title).toBe('Second')
    expect(result.count).toBe(2)
    expect(result.actions).toBe(3)
  })

  it('numbers its warnings by overlay, so a stack of them stays readable', () => {
    const result = applyOverlays(DOC(), [
      overlay([{ target: '$.info', update: { title: 'First' } }]),
      overlay([{ target: '$.nope', update: { a: 1 } }]),
    ])
    expect(result.warnings).toEqual([
      { code: 'overlay-target-empty', target: '$.nope', overlay: 2 },
    ])
  })
})

describe('loading with overlays', () => {
  it('renders the overlaid document, source included', async () => {
    const loaded = await loadInlineApiModel(DOC(), {
      overlays: [
        overlay([
          { target: "$.paths['/pets'].get", update: { summary: 'Every pet' } },
          { target: "$.paths['/pets'].post", remove: true },
        ]),
      ],
    })
    const listed = loaded.model.operations.find((op) => op.id === 'listPets')
    expect(listed.summary).toBe('Every pet')
    expect(loaded.model.operations.map((op) => op.id)).not.toContain('createPet')
    // The audit reads the source: it has to score the document the app renders.
    expect(loaded.source.paths['/pets'].post).toBeUndefined()
    expect(loaded.overlays).toEqual({ count: 1, actions: 2, warnings: [], infos: [], user: null })
  })

  it('reports an overlay entry that is neither a document nor a URL', async () => {
    const loaded = await loadInlineApiModel(DOC(), { overlays: [42] })
    expect(loaded.overlays.warnings).toEqual([{ code: 'overlay-invalid' }])
    expect(loaded.model.operations).toHaveLength(3)
  })

  it('carries no overlay diagnostics when none was declared', async () => {
    const loaded = await loadInlineApiModel(DOC())
    expect(loaded.overlays).toBeNull()
  })
})
