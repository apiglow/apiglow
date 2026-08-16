import { describe, expect, it } from 'vitest'
import {
  MONO_SPEC_ID,
  normalizeSpecsConfig,
  resolveActiveSpecId,
  resolveSpecConfig,
  SpecConfigError,
} from '../src/specs.js'

// Empty overrides for a specs[] entry: what `normalizeSpecsConfig` sets
// when the host config declares nothing.
const NO_OVERRIDES = {
  docsPages: [],
  announcements: [],
  environments: [],
  scenarios: [],
  hide: [],
  overlays: [],
  userOverlay: undefined,
  tryIt: {},
  branding: {},
  features: {},
  oauth: {},
  theme: {},
  language: {},
  environmentsLocked: undefined,
}

const TWO_SPECS = {
  specs: [
    { id: 'payments', title: 'Payments API', url: 'https://ex.test/payments.json' },
    { id: 'accounts', url: 'https://ex.test/accounts.yaml' },
  ],
}

describe('normalizeSpecsConfig', () => {
  it('treats the single `url` form as a single non-multi spec', () => {
    const out = normalizeSpecsConfig({ url: 'https://ex.test/api.json' })
    expect(out.multi).toBe(false)
    expect(out.defaultId).toBe(MONO_SPEC_ID)
    expect(out.specs).toEqual([
      { id: 'default', title: null, url: 'https://ex.test/api.json', spec: null, ...NO_OVERRIDES },
    ])
    expect(out.warnings).toEqual([])
  })

  it('tolerates the total absence of openapi config (null url, reported later)', () => {
    expect(normalizeSpecsConfig({}).specs[0].url).toBeNull()
    expect(normalizeSpecsConfig().multi).toBe(false)
  })

  it('normalizes the specs[] form: title falls back to id, default lists', () => {
    const out = normalizeSpecsConfig(TWO_SPECS)
    expect(out.multi).toBe(true)
    expect(out.defaultId).toBe('payments')
    expect(out.specs[0].title).toBe('Payments API')
    expect(out.specs[1]).toEqual({
      id: 'accounts',
      title: 'accounts',
      url: 'https://ex.test/accounts.yaml',
      spec: null,
      ...NO_OVERRIDES,
    })
  })

  it('keeps the tryIt override of each spec', () => {
    const out = normalizeSpecsConfig({
      specs: [
        { id: 'a', url: 'x', tryIt: { requestCredentials: 'include' } },
        { id: 'b', url: 'y', tryIt: { proxyUrl: 'https://p.test/?url={{target}}' } },
      ],
    })
    expect(out.specs[0].tryIt).toEqual({ requestCredentials: 'include' })
    expect(out.specs[1].tryIt).toEqual({ proxyUrl: 'https://p.test/?url={{target}}' })
    expect(out.warnings).toEqual([])
  })

  it('ignores an out-of-spec per-spec requestCredentials value, with a warning', () => {
    const out = normalizeSpecsConfig({
      specs: [{ id: 'a', url: 'x', tryIt: { requestCredentials: 'always', proxyUrl: null } }],
    })
    expect(out.specs[0].tryIt).toEqual({ proxyUrl: null })
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings.join('\n')).toMatch(/requestCredentials/)
  })

  it('specs[] wins over url, with a warning', () => {
    const out = normalizeSpecsConfig({ ...TWO_SPECS, url: 'https://ex.test/ignored.json' })
    expect(out.multi).toBe(true)
    expect(out.warnings).toHaveLength(1)
  })

  it('specifically flags an unknown or non-overridable spec key', () => {
    const out = normalizeSpecsConfig({
      specs: [
        {
          id: 'a',
          url: 'x',
          history: { maxEntries: 10 },
          openapi: {},
          seo: { index: false },
          colr: 'blue',
        },
      ],
    })
    expect(out.warnings).toHaveLength(4)
    // Non-overridable: the reason is stated, and where to declare the key.
    expect(out.warnings[0]).toMatch(
      /"history" cannot be overridden per spec .*browser-wide.*declare it at the root/,
    )
    expect(out.warnings[1]).toMatch(/"openapi" cannot be overridden per spec/)
    expect(out.warnings[2]).toMatch(
      /"seo" cannot be overridden per spec .*served page.*declare it at the root/,
    )
    // Unknown: simply ignored, but not silently.
    expect(out.warnings[3]).toMatch(/unknown key "colr"/)
  })

  it('flags and drops a root-only key nested in an overridable block', () => {
    const out = normalizeSpecsConfig({
      specs: [
        {
          id: 'a',
          url: 'x',
          theme: { default: 'acme', available: ['acme'], custom: [{ name: 'acme' }] },
        },
      ],
    })
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toMatch(
      /"theme\.custom" cannot be overridden per spec .*once at boot.*declare it at the root/,
    )
    // Dropped, not merged: the effective config never carries a value that no
    // consumer reads. The rest of the block still overrides.
    expect(out.specs[0].theme).toEqual({ default: 'acme', available: ['acme'] })
  })

  it('accepts overrides for theme, language, features, oauth and environments lock', () => {
    const out = normalizeSpecsConfig({
      specs: [
        {
          id: 'a',
          url: 'x',
          theme: { default: 'corporate' },
          language: { available: ['fr'] },
          features: { scenarios: false },
          oauth: { scheme: { clientId: 'c' } },
          environmentsLocked: true,
        },
      ],
    })
    expect(out.warnings).toEqual([])
    expect(out.specs[0]).toMatchObject({
      theme: { default: 'corporate' },
      language: { available: ['fr'] },
      features: { scenarios: false },
      oauth: { scheme: { clientId: 'c' } },
      environmentsLocked: true,
    })
  })

  it('honors openapi.default, first entry otherwise', () => {
    expect(normalizeSpecsConfig({ ...TWO_SPECS, default: 'accounts' }).defaultId).toBe('accounts')
    expect(normalizeSpecsConfig(TWO_SPECS).defaultId).toBe('payments')
  })

  it('rejects invalid id, duplicate id, missing url and unknown default', () => {
    expect(() => normalizeSpecsConfig({ specs: [{ id: 'Bad Id', url: 'x' }] })).toThrow(
      SpecConfigError,
    )
    expect(() => normalizeSpecsConfig({ specs: [{ url: 'x' }] })).toThrow(SpecConfigError)
    expect(() =>
      normalizeSpecsConfig({
        specs: [
          { id: 'a', url: 'x' },
          { id: 'a', url: 'y' },
        ],
      }),
    ).toThrow(/duplicate/)
    expect(() => normalizeSpecsConfig({ specs: [{ id: 'a' }] })).toThrow(/missing url or spec/)
    expect(() => normalizeSpecsConfig({ ...TWO_SPECS, default: 'nope' })).toThrow(/unknown spec id/)
  })

  it('accepts an inline schema, object or JSON string, in place of the url', () => {
    const doc = { openapi: '3.1.0', info: { title: 'Inline', version: '1' }, paths: {} }
    const fromObject = normalizeSpecsConfig({ spec: doc })
    expect(fromObject.specs[0].spec).toBe(doc)
    expect(fromObject.specs[0].url).toBeNull()
    const json = JSON.stringify(doc)
    expect(normalizeSpecsConfig({ spec: json }).specs[0].spec).toBe(json)
    // A specs[] entry can be inline, the others remote.
    const multi = normalizeSpecsConfig({
      specs: [
        { id: 'inline', spec: doc },
        { id: 'remote', url: 'https://ex.test/a.json' },
      ],
    })
    expect(multi.specs[0]).toMatchObject({ id: 'inline', url: null, spec: doc })
    expect(multi.specs[1]).toMatchObject({
      id: 'remote',
      url: 'https://ex.test/a.json',
      spec: null,
    })
  })

  it('ignores an unusable spec value and the competing url, with a warning', () => {
    const doc = { openapi: '3.1.0' }
    expect(
      normalizeSpecsConfig({ spec: '   ', url: 'https://ex.test/a.json' }).specs[0],
    ).toMatchObject({
      spec: null,
      url: 'https://ex.test/a.json',
    })
    expect(
      normalizeSpecsConfig({ spec: [], url: 'https://ex.test/a.json' }).specs[0].spec,
    ).toBeNull()
    const mono = normalizeSpecsConfig({ spec: doc, url: 'https://ex.test/a.json' })
    expect(mono.specs[0]).toMatchObject({ spec: doc, url: null })
    expect(mono.warnings).toHaveLength(1)
    const multi = normalizeSpecsConfig({
      specs: [{ id: 'a', spec: doc, url: 'https://ex.test/a.json' }],
    })
    expect(multi.specs[0]).toMatchObject({ spec: doc, url: null })
    expect(multi.warnings).toHaveLength(1)
  })
})

describe('resolveActiveSpecId', () => {
  const normalized = normalizeSpecsConfig(TWO_SPECS)

  it('takes the first known candidate, in priority order', () => {
    expect(resolveActiveSpecId(normalized, ['accounts', 'payments'])).toBe('accounts')
    expect(resolveActiveSpecId(normalized, [null, 'accounts'])).toBe('accounts')
  })

  it('silently ignores an unknown candidate', () => {
    expect(resolveActiveSpecId(normalized, ['nope', 'accounts'])).toBe('accounts')
  })

  it('falls back to the default spec without a valid candidate', () => {
    expect(resolveActiveSpecId(normalized, ['nope', null, undefined])).toBe('payments')
    expect(resolveActiveSpecId(normalized, [])).toBe('payments')
  })
})

describe('resolveSpecConfig — effective config of the active spec', () => {
  // Full root config, as produced by the shell (defaults merged
  // with the host config): this is exactly what resolveSpecConfig receives.
  const ROOT = {
    openapi: { url: null, hide: ['tag:internal'] },
    theme: { default: 'light', available: ['light', 'dark'] },
    language: { default: 'en', available: ['en', 'fr'] },
    environments: [{ name: 'Sandbox', baseUrl: 'https://root.test' }, { name: 'Prod' }],
    environmentsLocked: false,
    docsPages: [
      { slug: 'intro', title: 'Intro racine', url: '/docs/intro.md' },
      { slug: 'faq', title: 'FAQ', url: '/docs/faq.md' },
    ],
    scenarios: [],
    features: { scenarios: true },
    branding: { productName: 'Docs', logoUrl: '/root.svg' },
    tryIt: { proxyUrl: null, requestCredentials: 'same-origin' },
    oauth: { rootScheme: { clientId: 'root-id' } },
    history: { maxEntries: 500, maxAgeDays: 30 },
  }
  const spec = (overrides = {}) => ({ id: 'payments', ...NO_OVERRIDES, ...overrides })
  const resolve = (overrides, options) => resolveSpecConfig(ROOT, spec(overrides), options).config

  it('returns the root as-is without any override', () => {
    const out = resolve({})
    expect(out.theme).toEqual(ROOT.theme)
    expect(out.language).toEqual(ROOT.language)
    expect(out.branding).toEqual(ROOT.branding)
    expect(out.tryIt).toEqual(ROOT.tryIt)
    expect(out.oauth).toEqual(ROOT.oauth)
    expect(out.features).toEqual(ROOT.features)
    expect(out.environments).toEqual(ROOT.environments)
    expect(out.docsPages.map((p) => p.slug)).toEqual(['intro', 'faq'])
    expect(out.environmentsLocked).toBe(false)
    expect(out.openapi.hide).toEqual(['tag:internal'])
    expect(out.scenarios).toEqual([])
  })

  // The merge rules themselves live in docs-pages.test.js; what matters here
  // is that the effective config goes through them at all.
  it('merges docs pages by identity, spec entries replacing in place', () => {
    const out = resolve({
      docsPages: [
        { slug: 'intro', title: 'Intro spec', url: '/spec/intro.md' },
        { slug: 'billing', url: '/spec/billing.md' },
      ],
    })
    expect(out.docsPages.map((p) => [p.slug, p.title])).toEqual([
      ['intro', 'Intro spec'],
      ['faq', 'FAQ'],
      ['billing', 'billing'],
    ])
  })

  it('merges environments by name, spec takes priority', () => {
    const out = resolve({ environments: [{ name: 'Sandbox', baseUrl: 'https://spec.test' }] })
    expect(out.environments.map((e) => e.name)).toEqual(['Prod', 'Sandbox'])
    expect(out.environments[1].baseUrl).toBe('https://spec.test')
  })

  // A platform-wide notice and an API-specific one are both true at once:
  // neither side replaces the other, and the root's comes first.
  it('accumulates announcements, root first', () => {
    const root = { ...ROOT, announcements: [{ text: 'Migration on Sunday' }] }
    const out = resolveSpecConfig(root, spec({ announcements: [{ text: 'v1 is deprecated' }] }))
    expect(out.config.announcements).toEqual([
      { text: 'Migration on Sunday' },
      { text: 'v1 is deprecated' },
    ])
  })

  // The file form reaches here as the string it was declared as: it is the
  // shell that turns it into entries, once fetched.
  it('leaves the file form to the shell rather than merging a URL', () => {
    const root = { ...ROOT, announcements: '/news.json' }
    expect(resolveSpecConfig(root, spec({})).config.announcements).toEqual([])
  })

  it('accumulates hiding patterns: a pattern cannot "unhide"', () => {
    expect(resolve({ hide: ['/admin/*'] }).openapi.hide).toEqual(['tag:internal', '/admin/*'])
  })

  // Same accumulation for overlays, and the order IS the application order: a
  // spec's overlay edits what the root's overlays already produced.
  it('accumulates overlays, root first', () => {
    const root = { ...ROOT, openapi: { ...ROOT.openapi, overlays: ['/overlays/common.yaml'] } }
    const out = resolveSpecConfig(root, spec({ overlays: [{ overlay: '1.0.0', actions: [] }] }))
    expect(out.config.openapi.overlays).toEqual([
      '/overlays/common.yaml',
      { overlay: '1.0.0', actions: [] },
    ])
  })

  // The starting patch is one document per spec, so it is the one openapi key
  // that replaces — including at `null`, which is how a spec refuses the
  // installation-wide one.
  it('replaces the starting patch instead of accumulating it', () => {
    const root = { ...ROOT, openapi: { ...ROOT.openapi, userOverlay: '/overlays/seed.yaml' } }
    expect(resolveSpecConfig(root, spec({})).config.openapi.userOverlay).toBe('/overlays/seed.yaml')
    expect(
      resolveSpecConfig(root, spec({ userOverlay: { overlay: '1.1', actions: [] } })).config.openapi
        .userOverlay,
    ).toEqual({ overlay: '1.1', actions: [] })
    expect(resolveSpecConfig(root, spec({ userOverlay: null })).config.openapi.userOverlay).toBe(
      null,
    )
  })

  it('merges settings blocks key by key, spec takes priority', () => {
    const out = resolve({
      tryIt: { requestCredentials: 'include' },
      branding: { productName: 'Payments' },
      theme: { default: 'corporate', available: ['corporate'] },
      language: { default: 'fr' },
      features: { scenarios: false },
      oauth: { specScheme: { clientId: 'spec-id' } },
    })
    // Key not overridden: the root value remains.
    expect(out.tryIt).toEqual({ proxyUrl: null, requestCredentials: 'include' })
    expect(out.branding).toEqual({ productName: 'Payments', logoUrl: '/root.svg' })
    expect(out.theme).toEqual({ default: 'corporate', available: ['corporate'] })
    expect(out.language).toEqual({ default: 'fr', available: ['en', 'fr'] })
    expect(out.features).toEqual({ scenarios: false })
    expect(out.oauth).toEqual({
      rootScheme: { clientId: 'root-id' },
      specScheme: { clientId: 'spec-id' },
    })
  })

  it('lets a spec disable a root value (key declared as null/false)', () => {
    const withProxy = {
      ...ROOT,
      tryIt: { proxyUrl: 'https://p.test', requestCredentials: 'same-origin' },
    }
    expect(
      resolveSpecConfig(withProxy, spec({ tryIt: { proxyUrl: null } }), {}).config.tryIt.proxyUrl,
    ).toBeNull()
    const locked = { ...ROOT, environmentsLocked: true }
    expect(
      resolveSpecConfig(locked, spec({ environmentsLocked: false }), {}).config.environmentsLocked,
    ).toBe(false)
  })

  it('overrides environmentsLocked only if it is declared', () => {
    const locked = { ...ROOT, environmentsLocked: true }
    expect(resolveSpecConfig(locked, spec(), {}).config.environmentsLocked).toBe(true)
    expect(resolve({ environmentsLocked: true }).environmentsLocked).toBe(true)
  })

  it('leaves history retention at the root, with no merging possible', () => {
    expect(resolve({}).history).toEqual(ROOT.history)
  })

  it('validates requestCredentials on the EFFECTIVE value, not on each source', () => {
    const broken = { ...ROOT, tryIt: { proxyUrl: null, requestCredentials: 'yes-please' } }
    const out = resolveSpecConfig(broken, spec(), {})
    expect(out.config.tryIt.requestCredentials).toBe('same-origin')
    expect(out.warnings.join('\n')).toMatch(/requestCredentials/)
    // A valid spec override renders the invalid root value moot.
    const fixed = resolveSpecConfig(broken, spec({ tryIt: { requestCredentials: 'include' } }), {})
    expect(fixed.config.tryIt.requestCredentials).toBe('include')
    expect(fixed.warnings).toEqual([])
  })
})

describe('resolveSpecConfig — declared scenarios', () => {
  const ROOT = {
    openapi: {},
    tryIt: { requestCredentials: 'same-origin' },
    scenarios: [
      { id: 'onboarding', title: 'Onboarding', url: '/s/onboarding.json' },
      { id: 'refund', url: '/s/refund.json' },
    ],
  }
  const spec = (overrides = {}) => ({ id: 'payments', ...NO_OVERRIDES, ...overrides })

  // An undeclared title stays empty rather than defaulting to the id: the
  // document's own name is what labels the scenario once it loads, and the nav
  // shows the id until then (docs/scenarios.md §3).
  it('reads root declarations in mono-spec mode, an undeclared title staying empty', () => {
    expect(resolveSpecConfig(ROOT, spec(), {}).config.scenarios).toEqual([
      {
        id: 'onboarding',
        title: 'Onboarding',
        url: '/s/onboarding.json',
        document: null,
        pinned: false,
      },
      { id: 'refund', title: '', url: '/s/refund.json', document: null, pinned: false },
    ])
  })

  it('reads ONLY the spec declarations in multi mode, and flags the root ones', () => {
    const out = resolveSpecConfig(
      ROOT,
      spec({ scenarios: [{ id: 'payout', url: '/s/payout.json' }] }),
      { multi: true },
    )
    expect(out.config.scenarios).toEqual([
      { id: 'payout', title: '', url: '/s/payout.json', document: null, pinned: false },
    ])
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toMatch(/root declarations are ignored/)
  })

  it('discards invalid id, duplicate and carrier-less entries while flagging them', () => {
    const root = {
      ...ROOT,
      scenarios: [
        { id: 'Onboarding', url: '/a.json' },
        { id: 'ok', url: '/b.json' },
        { id: 'ok', url: '/c.json' },
        { id: 'no-url' },
      ],
    }
    const out = resolveSpecConfig(root, spec(), {})
    expect(out.config.scenarios).toEqual([
      { id: 'ok', title: '', url: '/b.json', document: null, pinned: false },
    ])
    expect(out.warnings).toHaveLength(3)
  })

  it('propagates `pinned` as-is, and only for the true boolean value', () => {
    const root = {
      ...ROOT,
      scenarios: [
        { id: 'epingle', url: '/a.json', pinned: true },
        { id: 'presque', url: '/b.json', pinned: 'oui' },
      ],
    }
    expect(resolveSpecConfig(root, spec(), {}).config.scenarios.map((e) => e.pinned)).toEqual([
      true,
      false,
    ])
  })

  // The second carrier (docs/scenarios.md §3): the document itself in the
  // config, for an installation that cannot serve a file next to its page.
  it('accepts a carried document instead of a url, and keeps both when both are there', () => {
    const document = { arazzo: '1.0.1', workflows: [] }
    const out = resolveSpecConfig(
      {
        ...ROOT,
        scenarios: [
          { id: 'carried', title: 'Carried', document },
          { id: 'both', document, url: '/s/both.json' },
        ],
      },
      spec(),
      {},
    )
    expect(out.config.scenarios).toEqual([
      { id: 'carried', title: 'Carried', url: '', document, pinned: false },
      { id: 'both', title: '', url: '/s/both.json', document, pinned: false },
    ])
    expect(out.warnings).toEqual([])
  })

  it('returns nothing without a declaration', () => {
    expect(
      resolveSpecConfig({ ...ROOT, scenarios: undefined }, spec(), {}).config.scenarios,
    ).toEqual([])
    expect(
      resolveSpecConfig({ ...ROOT, scenarios: [] }, spec(), { multi: true }).config.scenarios,
    ).toEqual([])
  })
})
