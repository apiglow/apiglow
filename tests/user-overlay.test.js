import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadInlineApiModel } from '../src/openapi/loader.js'
import {
  checkUserOverlay,
  clearUserOverlay,
  formatUserOverlay,
  parseUserOverlay,
  readUserOverlay,
  saveUserOverlay,
  USER_OVERLAY_INVALID_JSON,
  USER_OVERLAY_KEY,
  USER_OVERLAY_MAX_BYTES,
  USER_OVERLAY_NOT_OVERLAY,
  USER_OVERLAY_SKELETON,
  USER_OVERLAY_TOO_LARGE,
  userOverlayFilename,
  userOverlayOrigin,
} from '../src/openapi/user-overlay.js'
import { setSpecScope } from '../src/storage/prefs.js'
import { fakeStorage } from './support/fake-storage.js'

// The user overlay (docs/user-overlay.md): storage and its cap, what counts as
// an overlay document, the dry run, and the one ordering decision the loader
// carries — the user's fix applies last.

let storage

beforeEach(() => {
  storage = fakeStorage()
  globalThis.window = { localStorage: storage }
})

afterEach(() => {
  setSpecScope(null)
  delete globalThis.window
})

const SOURCE = () => ({
  openapi: '3.1.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List pets',
        responses: { 200: { description: 'ok' } },
      },
    },
  },
})

const overlay = (actions, extra = {}) =>
  JSON.stringify({ overlay: '1.1', info: { title: 'fixes' }, actions, ...extra })

describe('storage', () => {
  it('round-trips a document through the spec-scoped preference', () => {
    expect(readUserOverlay()).toBe(null)
    const saved = saveUserOverlay(overlay([{ target: '$.info', update: { version: '2.0.0' } }]))
    expect(saved.ok).toBe(true)
    expect(readUserOverlay()).toEqual({
      overlay: '1.1',
      info: { title: 'fixes' },
      actions: [{ target: '$.info', update: { version: '2.0.0' } }],
    })
    expect([...storage.map.keys()]).toEqual([`apidoc:${USER_OVERLAY_KEY}`])
  })

  it('keeps one document per spec, and none of them collides with the bare key', () => {
    saveUserOverlay(overlay([], { info: { title: 'mono' } }))
    setSpecScope('petstore')
    saveUserOverlay(overlay([], { info: { title: 'petstore' } }))
    setSpecScope('billing')
    expect(readUserOverlay()).toBe(null)
    saveUserOverlay(overlay([], { info: { title: 'billing' } }))

    expect(readUserOverlay().info.title).toBe('billing')
    setSpecScope('petstore')
    expect(readUserOverlay().info.title).toBe('petstore')
    setSpecScope(null)
    expect(readUserOverlay().info.title).toBe('mono')
  })

  it('clears by removing the key, not by storing nothing in it', () => {
    saveUserOverlay(overlay([]))
    clearUserOverlay()
    expect(readUserOverlay()).toBe(null)
    expect(storage.map.size).toBe(0)
  })

  it('ignores a stored value that is not a document', () => {
    storage.map.set(`apidoc:${USER_OVERLAY_KEY}`, '["not", "a", "document"]')
    expect(readUserOverlay()).toBe(null)
  })
})

describe('the hard cap', () => {
  // Serialized size is what the cap promises, so the fixture is built by
  // measuring rather than by guessing how many bytes a padded action costs.
  const sized = (bytes) => {
    const document = { overlay: '1.1', actions: [{ target: '$.info', update: { pad: '' } }] }
    const overhead = new TextEncoder().encode(JSON.stringify(document)).length
    document.actions[0].update.pad = 'x'.repeat(bytes - overhead)
    return JSON.stringify(document)
  }

  it('accepts a document sitting exactly on the cap', () => {
    const result = saveUserOverlay(sized(USER_OVERLAY_MAX_BYTES))
    expect(result.ok).toBe(true)
    expect(result.bytes).toBe(USER_OVERLAY_MAX_BYTES)
    expect(readUserOverlay()).not.toBe(null)
  })

  it('refuses one byte past it and writes nothing', () => {
    saveUserOverlay(overlay([{ target: '$.info', update: { version: '2.0.0' } }]))
    const before = storage.map.get(`apidoc:${USER_OVERLAY_KEY}`)

    const result = saveUserOverlay(sized(USER_OVERLAY_MAX_BYTES + 1))
    expect(result).toMatchObject({ ok: false, code: USER_OVERLAY_TOO_LARGE })
    expect(result.bytes).toBe(USER_OVERLAY_MAX_BYTES + 1)
    // The previous document survives: a refused save is not a clear.
    expect(storage.map.get(`apidoc:${USER_OVERLAY_KEY}`)).toBe(before)
  })
})

describe('what counts as an overlay document', () => {
  it('refuses text that is not JSON', () => {
    expect(parseUserOverlay('overlay: 1.1\nactions: []\n')).toEqual({
      ok: false,
      code: USER_OVERLAY_INVALID_JSON,
    })
    expect(parseUserOverlay('')).toEqual({ ok: false, code: USER_OVERLAY_INVALID_JSON })
  })

  it('refuses JSON that is not an overlay, saving nothing', () => {
    expect(saveUserOverlay(JSON.stringify(SOURCE()))).toEqual({
      ok: false,
      code: USER_OVERLAY_NOT_OVERLAY,
    })
    expect(parseUserOverlay('[]').code).toBe(USER_OVERLAY_NOT_OVERLAY)
    expect(parseUserOverlay('42').code).toBe(USER_OVERLAY_NOT_OVERLAY)
    expect(storage.map.size).toBe(0)
  })

  it('accepts either half of the shape: a version alone, or actions alone', () => {
    expect(parseUserOverlay('{"overlay":"1.1"}').ok).toBe(true)
    expect(parseUserOverlay('{"actions":[]}').ok).toBe(true)
  })

  it('seeds an empty editor with a document that parses and does nothing', () => {
    const parsed = parseUserOverlay(USER_OVERLAY_SKELETON)
    expect(parsed.ok).toBe(true)
    expect(parsed.document.actions).toEqual([])
    // The example lives outside `actions` precisely so that saving the seed
    // untouched cannot edit the schema.
    expect(parsed.document['x-example-action'].target).toBeTypeOf('string')
  })

  it('formats a document back into editable text', () => {
    const document = parseUserOverlay(overlay([])).document
    expect(parseUserOverlay(formatUserOverlay(document)).document).toEqual(document)
    expect(formatUserOverlay(document)).toContain('\n  "overlay": "1.1"')
  })

  it('names the downloaded file after the spec it patches, bare when there is one', () => {
    expect(userOverlayFilename('pets')).toBe('overlay-pets.json')
    expect(userOverlayFilename(null)).toBe('overlay.json')
  })
})

describe('the dry run', () => {
  it('counts the matches of every action, in order, without touching the source', () => {
    const source = SOURCE()
    const result = checkUserOverlay(
      overlay([
        { target: '$.paths..get', update: { deprecated: true } },
        { target: "$.paths['/pets'].delete", update: { summary: 'gone' } },
      ]),
      source,
    )
    expect(result.ok).toBe(true)
    expect(result.actions).toBe(1)
    expect(result.trace).toEqual([
      { target: '$.paths..get', matches: 1, applied: true, warnings: [] },
      {
        target: "$.paths['/pets'].delete",
        matches: 0,
        applied: false,
        warnings: [{ code: 'overlay-target-empty', target: "$.paths['/pets'].delete" }],
      },
    ])
    expect(source).toEqual(SOURCE())
  })

  it('reports a target that is not RFC 9535 as unresolved, not as empty', () => {
    const result = checkUserOverlay(overlay([{ target: '$.paths[/pets]', update: {} }]), SOURCE())
    expect(result.trace[0]).toMatchObject({ matches: null, applied: false })
    expect(result.warnings.map((w) => w.code)).toEqual(['overlay-target-unsupported'])
  })

  it('sees each action against what the previous ones left', () => {
    const result = checkUserOverlay(
      overlay([
        { target: "$.paths['/pets']", update: { post: { summary: 'Create' } } },
        { target: '$.paths..post', update: { deprecated: true } },
      ]),
      SOURCE(),
    )
    expect(result.trace[1].matches).toBe(1)
  })

  // The panel prints these two lists in two places — under the action they
  // belong to, or on their own. Splitting them by identity downstream is what
  // this contract exists to make unnecessary.
  it('separates what the document said from what its actions did', () => {
    const result = checkUserOverlay(
      JSON.stringify({ overlay: '0.9', actions: [{ target: '$.nope', update: {} }] }),
      SOURCE(),
    )
    expect(result.documentWarnings.map((w) => w.code)).toEqual(['overlay-version-unknown'])
    expect(result.trace[0].warnings.map((w) => w.code)).toEqual(['overlay-target-empty'])
    expect(result.warnings).toHaveLength(2)
  })

  it('calls a document with no action document-level, with nothing to trace', () => {
    const result = checkUserOverlay(overlay([]), SOURCE())
    expect(result.trace).toEqual([])
    expect(result.documentWarnings.map((w) => w.code)).toEqual(['overlay-no-actions'])
  })

  it('reports a parse failure the way a save does', () => {
    expect(checkUserOverlay('nope', SOURCE())).toEqual({
      ok: false,
      code: USER_OVERLAY_INVALID_JSON,
    })
  })
})

describe('loader ordering', () => {
  it('applies the user overlay after the host overlays', async () => {
    saveUserOverlay(
      overlay([{ target: "$.paths['/pets'].get", update: { summary: 'User summary' } }]),
    )
    const loaded = await loadInlineApiModel(SOURCE(), {
      overlays: [
        {
          overlay: '1.1',
          info: { title: 'host' },
          actions: [
            { target: "$.paths['/pets'].get", update: { summary: 'Host summary', tags: ['pets'] } },
          ],
        },
      ],
    })
    expect(loaded.source.paths['/pets'].get.summary).toBe('User summary')
    // The host's edit is not lost, only outranked where the two collide.
    expect(loaded.source.paths['/pets'].get.tags).toEqual(['pets'])
    expect(loaded.overlays).toMatchObject({ count: 2, actions: 2, user: 2 })
  })

  it('applies alone when the host declared none', async () => {
    saveUserOverlay(overlay([{ target: '$.info', update: { title: 'Patched' } }]))
    const loaded = await loadInlineApiModel(SOURCE())
    expect(loaded.model.info.title).toBe('Patched')
    expect(loaded.overlays).toMatchObject({ count: 1, user: 1 })
  })

  it('leaves the pipeline untouched when nothing is stored', async () => {
    const loaded = await loadInlineApiModel(SOURCE())
    expect(loaded.overlays).toBe(null)
    expect(loaded.model.info.title).toBe('Pets')
  })
})

// The installation's starting patch (decision 11): declared by the host, written
// once into the reader's own slot, theirs from then on. What is tested here is
// the "once" — every way the seed could come back after the reader has had their
// say is the failure mode this feature had to buy off.
describe("the host's starting patch", () => {
  const hostDoc = (summary) => ({
    overlay: '1.1',
    info: { title: 'host fixes' },
    actions: [{ target: "$.paths['/pets'].get", update: { summary } }],
  })

  it('seeds an empty slot, applies it, and does not sign it with the reader', async () => {
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('From the host') })
    expect(loaded.model.operations[0].summary).toBe('From the host')
    expect(readUserOverlay()).toEqual(hostDoc('From the host'))
    expect(userOverlayOrigin()).toBe('host')
    expect(loaded.overlays).toMatchObject({ count: 1, user: 1 })
  })

  it('leaves the reader’s edit of the same document alone on the next load', async () => {
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('From the host') })
    saveUserOverlay(overlay([{ target: "$.paths['/pets'].get", update: { summary: 'Mine' } }]))
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('From the host') })
    expect(loaded.model.operations[0].summary).toBe('Mine')
    expect(userOverlayOrigin()).toBe('user')
  })

  it('does not resurrect a patch the reader removed', async () => {
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('From the host') })
    clearUserOverlay()
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('From the host') })
    expect(readUserOverlay()).toBe(null)
    expect(loaded.model.operations[0].summary).toBe('List pets')
    expect(loaded.overlays).toBe(null)
  })

  // The stated contract: a new version of the host's patch reaches every
  // browser, local edits included. Silent staleness on a schema that keeps
  // moving is the worse of the two, and the download button is the way out.
  it('replaces the local copy when the declared document changes', async () => {
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('First') })
    saveUserOverlay(overlay([{ target: '$.info', update: { title: 'Mine' } }]))
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('Second') })
    expect(readUserOverlay()).toEqual(hostDoc('Second'))
    expect(loaded.model.info.title).toBe('Pets')
    expect(userOverlayOrigin()).toBe('host')
  })

  it('comes back after the removal, once the host changes its document', async () => {
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('First') })
    clearUserOverlay()
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('Second') })
    expect(readUserOverlay()).toEqual(hostDoc('Second'))
  })

  it('refuses a seed that is not an overlay, and stores nothing', async () => {
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: { info: { title: 'nope' } } })
    expect(readUserOverlay()).toBe(null)
    expect(loaded.overlays.warnings.map((w) => w.code)).toEqual(['user-overlay-seed-invalid'])
  })

  it('refuses a seed over the cap the editor enforces', async () => {
    const huge = hostDoc('x'.repeat(USER_OVERLAY_MAX_BYTES))
    const loaded = await loadInlineApiModel(SOURCE(), { userOverlay: huge })
    expect(readUserOverlay()).toBe(null)
    expect(loaded.overlays.warnings.map((w) => w.code)).toEqual(['user-overlay-seed-too-large'])
  })

  it('seeds each spec separately', async () => {
    setSpecScope('pets')
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('Pets patch') })
    setSpecScope('bills')
    expect(readUserOverlay()).toBe(null)
    await loadInlineApiModel(SOURCE(), { userOverlay: hostDoc('Bills patch') })
    expect(readUserOverlay()).toEqual(hostDoc('Bills patch'))
    setSpecScope('pets')
    expect(readUserOverlay()).toEqual(hostDoc('Pets patch'))
  })
})
