import { afterEach, describe, expect, it } from 'vitest'
import {
  auditHash,
  overviewHash,
  homeHash,
  opHash,
  opShareHash,
  pageHash,
  parseHash,
  parseSetupLink,
  scenarioHash,
  setupLinkHash,
  scenarioImportHash,
  setRouteSpecId,
} from '../src/router.js'

afterEach(() => setRouteSpecId(null))

describe('routing hash', () => {
  it('parses op and page routes', () => {
    expect(parseHash('#/op/listPets')).toEqual({
      specId: null,
      type: 'op',
      id: 'listPets',
      anchor: null,
      req: null,
      data: null,
    })
    expect(parseHash('#/page/guides')).toEqual({
      specId: null,
      type: 'page',
      id: 'guides',
      anchor: null,
      req: null,
      data: null,
    })
  })

  it('parses endpoint section anchors', () => {
    expect(parseHash('#/op/listPets/params-query')).toEqual({
      specId: null,
      type: 'op',
      id: 'listPets',
      anchor: 'params-query',
      req: null,
      data: null,
    })
    expect(parseHash(opHash('listPets', 'body'))).toEqual({
      specId: null,
      type: 'op',
      id: 'listPets',
      anchor: 'body',
      req: null,
      data: null,
    })
  })

  it('parses page anchors', () => {
    expect(parseHash('#/page/guides/authentication')).toEqual({
      specId: null,
      type: 'page',
      id: 'guides',
      anchor: 'authentication',
      req: null,
      data: null,
    })
    expect(parseHash(pageHash('guides', 'first steps'))).toEqual({
      specId: null,
      type: 'page',
      id: 'guides',
      anchor: 'first steps',
      req: null,
      data: null,
    })
  })

  it('parses the share payload (?req=…) without disturbing the route', () => {
    expect(parseHash('#/op/listPets?req=eyJ2IjoxfQ')).toEqual({
      specId: null,
      type: 'op',
      id: 'listPets',
      anchor: null,
      req: 'eyJ2IjoxfQ',
      data: null,
    })
    expect(parseHash(opShareHash('delete-pets-petid-π', 'abc-123_x'))).toEqual({
      specId: null,
      type: 'op',
      id: 'delete-pets-petid-π',
      anchor: null,
      req: 'abc-123_x',
      data: null,
    })
    // ?req= empty or absent = no payload.
    expect(parseHash('#/op/listPets?req=').req).toBeNull()
    expect(parseHash('#/op/listPets?other=1').req).toBeNull()
  })

  it('falls back to the null route for everything else', () => {
    const nullRoute = { specId: null, type: null, id: null, anchor: null, req: null, data: null }
    expect(parseHash('')).toEqual(nullRoute)
    expect(parseHash(undefined)).toEqual(nullRoute)
    expect(parseHash('#/junk')).toEqual(nullRoute)
    expect(parseHash('#/op/')).toEqual(nullRoute)
  })

  it('round-trips with ids requiring encoding', () => {
    const id = 'delete-pets-petid-π'
    expect(parseHash(opHash(id))).toEqual({
      specId: null,
      type: 'op',
      id,
      anchor: null,
      req: null,
      data: null,
    })
    expect(parseHash(pageHash('mon guide'))).toEqual({
      specId: null,
      type: 'page',
      id: 'mon guide',
      anchor: null,
      req: null,
      data: null,
    })
  })
})

describe('routing hash multi-spec (#/s/{specId}/…)', () => {
  it('parses the spec segment on all route forms', () => {
    expect(parseHash('#/s/payments/op/listPets/body?req=abc')).toEqual({
      specId: 'payments',
      type: 'op',
      id: 'listPets',
      anchor: 'body',
      req: 'abc',
      data: null,
    })
    expect(parseHash('#/s/payments/page/guides')).toEqual({
      specId: 'payments',
      type: 'page',
      id: 'guides',
      anchor: null,
      req: null,
      data: null,
    })
    // Spec home: segment alone, with or without trailing slash.
    expect(parseHash('#/s/payments/')).toEqual({
      specId: 'payments',
      type: null,
      id: null,
      anchor: null,
      req: null,
      data: null,
    })
    expect(parseHash('#/s/payments')).toEqual({
      specId: 'payments',
      type: null,
      id: null,
      anchor: null,
      req: null,
      data: null,
    })
  })

  it('ignores a spec segment outside the slug pattern ([a-z0-9-])', () => {
    expect(parseHash('#/s/Payments!/op/x')).toEqual({
      specId: null,
      type: null,
      id: null,
      anchor: null,
      req: null,
      data: null,
    })
  })

  it('parses the scenario route', () => {
    expect(parseHash('#/scenario/onboarding')).toEqual({
      specId: null,
      type: 'scenario',
      id: 'onboarding',
      anchor: null,
      req: null,
      data: null,
    })
    expect(parseHash(scenarioHash('a-b-c'))).toMatchObject({ type: 'scenario', id: 'a-b-c' })
    // A local scenario uuid goes through the same path as a config slug.
    const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6'
    expect(parseHash(scenarioHash(uuid))).toMatchObject({ type: 'scenario', id: uuid })
  })

  it('parses the shared scenario import route', () => {
    expect(parseHash('#/scenario-import?d=eyJ2IjoxfQ')).toEqual({
      specId: null,
      type: 'scenario-import',
      id: null,
      anchor: null,
      req: null,
      data: 'eyJ2IjoxfQ',
    })
    expect(parseHash(scenarioImportHash('abc-123_x'))).toMatchObject({
      type: 'scenario-import',
      data: 'abc-123_x',
    })
    // Without a payload the route still exists: the view will say what's missing.
    expect(parseHash('#/scenario-import')).toMatchObject({ type: 'scenario-import', data: null })
    expect(parseHash('#/s/payments/scenario-import?d=abc')).toMatchObject({
      specId: 'payments',
      type: 'scenario-import',
      data: 'abc',
    })
    // A scenario's payload is not confused with a request's payload.
    expect(parseHash('#/op/listPets?d=abc').data).toBeNull()
  })

  it('parses the audit route, which has no id segment', () => {
    expect(parseHash('#/audit')).toEqual({
      specId: null,
      type: 'audit',
      id: null,
      anchor: null,
      req: null,
      data: null,
    })
    expect(parseHash('#/audit/')).toMatchObject({ type: 'audit' })
    expect(parseHash(auditHash())).toMatchObject({ type: 'audit' })
    expect(parseHash('#/s/payments/audit')).toMatchObject({ specId: 'payments', type: 'audit' })
    // Not a prefix match: only the route itself resolves.
    expect(parseHash('#/audits')).toMatchObject({ type: null })
  })

  it('parses the overview route, which always exists', () => {
    expect(parseHash('#/overview')).toMatchObject({ type: 'overview', id: null })
    expect(parseHash('#/overview/')).toMatchObject({ type: 'overview' })
    expect(parseHash(overviewHash())).toMatchObject({ type: 'overview' })
    expect(parseHash('#/s/payments/overview')).toMatchObject({
      specId: 'payments',
      type: 'overview',
    })
    expect(parseHash('#/overviews')).toMatchObject({ type: null })
  })

  it('prefixes the builders once the active spec is set', () => {
    setRouteSpecId('payments')
    expect(opHash('listPets')).toBe('#/s/payments/op/listPets')
    expect(opHash('listPets', 'body')).toBe('#/s/payments/op/listPets/body')
    expect(opShareHash('listPets', 'abc')).toBe('#/s/payments/op/listPets?req=abc')
    expect(pageHash('guides')).toBe('#/s/payments/page/guides')
    expect(scenarioHash('onboarding')).toBe('#/s/payments/scenario/onboarding')
    expect(scenarioImportHash('abc')).toBe('#/s/payments/scenario-import?d=abc')
    expect(setupLinkHash('abc')).toBe('#/s/payments/?setup=abc')
    expect(auditHash()).toBe('#/s/payments/audit')
    expect(overviewHash()).toBe('#/s/payments/overview')
    expect(homeHash()).toBe('#/s/payments/')
  })

  it('round-trips builders → parseHash with a spec segment', () => {
    setRouteSpecId('payments')
    expect(parseHash(opHash('listPets', 'body'))).toEqual({
      specId: 'payments',
      type: 'op',
      id: 'listPets',
      anchor: 'body',
      req: null,
      data: null,
    })
  })

  it('reverts to bare routes in single-spec mode', () => {
    setRouteSpecId('payments')
    setRouteSpecId(null)
    expect(opHash('listPets')).toBe('#/op/listPets')
    expect(homeHash()).toBe('#/')
  })
})

describe('setup link scrub (parseSetupLink)', () => {
  it('builds a link the scrub gives back whole', () => {
    expect(setupLinkHash('abc')).toBe('#/?setup=abc')
    // The generator can only produce a fragment link: there is no builder that
    // could put the payload in the real query string (decision 2).
    expect(setupLinkHash('abc').startsWith('#')).toBe(true)
    expect(parseSetupLink(setupLinkHash('abc'))).toEqual({
      payload: 'abc',
      scrubbedHash: '#/',
    })
  })

  it('takes the payload off every route shape and keeps the destination', () => {
    expect(parseSetupLink('#/?setup=abc')).toEqual({ payload: 'abc', scrubbedHash: '#/' })
    expect(parseSetupLink('#/op/getPetById?setup=abc')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/op/getPetById',
    })
    expect(parseSetupLink('#/s/petstore/?setup=abc')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/s/petstore/',
    })
    expect(parseSetupLink('#/s/petstore/op/getPetById/body?setup=abc')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/s/petstore/op/getPetById/body',
    })
  })

  it('leaves a hash without the parameter byte-identical', () => {
    for (const hash of [
      '',
      '#',
      '#/',
      '#/op/listPets',
      '#/op/listPets?req=zzz',
      '#/junk?setupx=1',
    ]) {
      expect(parseSetupLink(hash)).toEqual({ payload: null, scrubbedHash: hash })
    }
    expect(parseSetupLink(undefined).scrubbedHash).toBe('')
  })

  it('leaves the other payloads of the same query untouched, in place', () => {
    expect(parseSetupLink('#/op/x?req=a%2Bb&setup=abc')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/op/x?req=a%2Bb',
    })
    expect(parseSetupLink('#/op/x?setup=abc&req=a%2Bb')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/op/x?req=a%2Bb',
    })
    expect(parseSetupLink('#/scenario-import?d=zzz&setup=abc&x=1')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/scenario-import?d=zzz&x=1',
    })
    // What survives the scrub still parses as the route it was.
    expect(parseHash(parseSetupLink('#/op/x?req=zzz&setup=abc').scrubbedHash)).toMatchObject({
      type: 'op',
      id: 'x',
      req: 'zzz',
    })
  })

  it('falls back to the home hash when the scrub empties the URL', () => {
    expect(parseSetupLink('#?setup=abc')).toEqual({ payload: 'abc', scrubbedHash: '#/' })
    expect(parseSetupLink('?setup=abc')).toEqual({ payload: 'abc', scrubbedHash: '#/' })
  })

  it('scrubs even a payload it cannot make sense of', () => {
    // No payload to hand over, but the URL is cleaned all the same.
    expect(parseSetupLink('#/?setup=')).toEqual({ payload: null, scrubbedHash: '#/' })
    expect(parseSetupLink('#/?setup')).toEqual({ payload: null, scrubbedHash: '#/' })
    // Malformed percent-encoding: passed on raw, for the decoder to refuse.
    expect(parseSetupLink('#/?setup=%E0%A4%A')).toEqual({
      payload: '%E0%A4%A',
      scrubbedHash: '#/',
    })
    // A repeated parameter is stripped whole, and the first one wins.
    expect(parseSetupLink('#/?setup=abc&setup=def')).toEqual({
      payload: 'abc',
      scrubbedHash: '#/',
    })
  })

  it('decodes a percent-encoded payload', () => {
    expect(parseSetupLink('#/?setup=ab%2Dc').payload).toBe('ab-c')
  })
})
