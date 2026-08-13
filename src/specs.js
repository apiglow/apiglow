// Multi-spec (docs/multi-spec.md): normalization of the openapi config
// (single `url` form ↔ `specs[]` array form), resolution of the active spec at
// boot, and above all `resolveSpecConfig` — the EFFECTIVE config of the active
// spec, from which the shell draws without ever having to know where a value
// came from.
// Pure functions — the effective sources (hash, storage, pending OAuth) are
// read by the shell and passed in as candidates.
//
// General rule: almost everything can be overridden per spec. A multi-API
// installation has no reason to impose the same theme, the same branding, the
// same environments, or the same features on APIs that only have their portal
// in common. The exceptions are listed in ROOT_ONLY_KEYS, with their reason.

import { mergeDocsPages } from './docs/pages.js'

const ID_PATTERN = /^[a-z0-9-]+$/

// Keys of an `openapi.specs[]` entry. The first three identify the spec; the
// others override the root key of the same name.
const SPEC_KEYS = new Set([
  'id',
  'title',
  'url',
  'spec',
  'docsPages',
  'environments',
  'scenarios',
  'hide',
  'overlays',
  'userOverlay',
  'tryIt',
  'branding',
  'features',
  'oauth',
  'theme',
  'language',
  'environmentsLocked',
])

// What can NOT be overridden, and why — declared here so the host config gets
// a named warning instead of silence.
const ROOT_ONLY_KEYS = {
  // Retention is a browser storage cap, not a business view: purging applies
  // to all specs at once (see HistoryStore#purge). Two competing values would
  // make the effective retention depend on the last spec visited.
  history: 'retention is a browser-wide storage cap, applied across all specs',
  // The spec list and the default one describe the whole installation:
  // nesting them per spec wouldn't make sense.
  openapi: 'declares the specs themselves',
  // Indexability describes the served page, and every spec shares one: a
  // crawler reads the HTML at that URL without ever choosing a spec.
  seo: 'indexability describes the served page, which all specs share',
}

// Same promise one level down: a root-only key INSIDE a block that is
// otherwise overridable key by key. Without this, the key merges normally into
// the effective config and is simply never read — the treasure hunt
// ROOT_ONLY_KEYS exists to prevent.
const ROOT_ONLY_SUBKEYS = {
  theme: {
    // Host-defined themes are generated and injected once at boot, from the
    // root config (docs/custom-themes.md, decision 7): they are global chrome,
    // like the <html> element they hang off, and switching spec doesn't reload
    // the page. `default`/`available` stay overridable — a spec narrows what is
    // selectable, it never defines a theme.
    custom: 'custom themes are injected once at boot, for the whole installation',
  },
}

// Reserved id of the single form: `openapi.url` ≡ specs: [{ id: 'default', url }].
export const MONO_SPEC_ID = 'default'

// Modes accepted by fetch(): any other value of tryIt.requestCredentials
// (root or per-spec override) would make fetch throw a TypeError on every send.
const REQUEST_CREDENTIALS_MODES = ['omit', 'same-origin', 'include']

export class SpecConfigError extends Error {}

// tryIt override of a specs[] entry: unknown keys are kept as-is (they will
// follow the evolution of the root config), only requestCredentials is
// validated — if invalid, it is ignored in favor of the root value rather
// than breaking every send for the spec.
function normalizeSpecTryIt(raw, id, warnings) {
  const tryIt = specBlock(raw, 'tryIt', id, warnings)
  if (
    'requestCredentials' in tryIt &&
    !REQUEST_CREDENTIALS_MODES.includes(tryIt.requestCredentials)
  ) {
    warnings.push(
      `openapi.specs ("${id}"): invalid tryIt.requestCredentials "${tryIt.requestCredentials}", falling back to the root value`,
    )
    delete tryIt.requestCredentials
  }
  return tryIt
}

// Override of a config block by a specs[] entry: no validation, no expected
// keys — these are the same keys as the root block, whose meaning is checked
// where they are consumed. A value of a type other than object doesn't count
// as a declaration.
function plainObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
}

// Same thing, minus the ROOT_ONLY_SUBKEYS of the block: dropped rather than
// merged, so the effective config never carries a value no consumer reads.
function specBlock(raw, block, id, warnings) {
  const values = plainObject(raw)
  for (const [key, reason] of Object.entries(ROOT_ONLY_SUBKEYS[block] ?? {})) {
    if (!(key in values)) continue
    warnings.push(
      `openapi.specs ("${id}"): "${block}.${key}" cannot be overridden per spec (${reason}) — declare it at the root`,
    )
    delete values[key]
  }
  return values
}

// Inline schema: the host page carries the document itself (JS object or JSON
// string) instead of a URL — self-sufficient installation, no fetch, no CORS.
// An empty string or a value of another type doesn't count as a declaration.
function normalizeInlineSpec(raw) {
  if (typeof raw === 'string') return raw.trim() ? raw : null
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  return null
}

// Neutral entry: all overrides empty. This is the single form, and the
// template for any specs[] entry — adding an override is done here and in
// SPEC_KEYS, nowhere else.
function emptySpec(id, { title = null, url = null, spec = null } = {}) {
  return {
    id,
    title,
    url,
    spec,
    docsPages: [],
    environments: [],
    scenarios: [],
    hide: [],
    overlays: [],
    // undefined = not declared, so the root document still reaches this spec;
    // any declared value replaces it, `null` included — a spec can refuse the
    // installation-wide starting patch.
    userOverlay: undefined,
    tryIt: {},
    branding: {},
    features: {},
    oauth: {},
    theme: {},
    language: {},
    // undefined = not declared, to be distinguished from an explicit `false`.
    environmentsLocked: undefined,
  }
}

// → { multi, specs: [...], defaultId, warnings }. `multi` = the specs[] form
// is used: prefixed routes and storage namespaced by id, even with a single
// entry (the id is explicit, the selector stays invisible). The `url`-only
// form is the single-spec one documented in the README, not a deprecated
// shape: bare routes and unprefixed storage keys, which is what a host page
// documenting one API should get.
// `spec` (inline document) and `url` are exclusive, the former takes priority.
export function normalizeSpecsConfig(openapi = {}) {
  const warnings = []
  const rawSpecs = openapi.specs
  if (!Array.isArray(rawSpecs) || !rawSpecs.length) {
    const spec = normalizeInlineSpec(openapi.spec)
    if (spec && openapi.url) warnings.push('openapi.url is ignored when openapi.spec is provided')
    return {
      multi: false,
      specs: [emptySpec(MONO_SPEC_ID, { url: spec ? null : (openapi.url ?? null), spec })],
      defaultId: MONO_SPEC_ID,
      warnings,
    }
  }
  if (openapi.url || openapi.spec) {
    warnings.push('openapi.url/openapi.spec are ignored when openapi.specs is provided')
  }
  const specs = rawSpecs.map((raw, i) => {
    const id = String(raw?.id ?? '')
    // The id is used as a route segment and a storage prefix: strict slug,
    // and an explicit error is better than silently broken storage.
    if (!ID_PATTERN.test(id)) {
      throw new SpecConfigError(`openapi.specs[${i}]: invalid id "${id}" (expected [a-z0-9-]+)`)
    }
    const spec = normalizeInlineSpec(raw.spec)
    if (!raw.url && !spec)
      throw new SpecConfigError(`openapi.specs[${i}] ("${id}"): missing url or spec`)
    if (spec && raw.url)
      warnings.push(`openapi.specs ("${id}"): url is ignored when spec is provided`)
    // A root key mistakenly set on an entry has no effect: flagging it by
    // name avoids the hunt for the setting that "doesn't take".
    for (const key of Object.keys(raw)) {
      if (SPEC_KEYS.has(key)) continue
      const reason = ROOT_ONLY_KEYS[key]
      warnings.push(
        reason
          ? `openapi.specs ("${id}"): "${key}" cannot be overridden per spec (${reason}) — declare it at the root`
          : `openapi.specs ("${id}"): unknown key "${key}", ignored`,
      )
    }
    return {
      ...emptySpec(id, {
        // Inactive specs are never loaded (info.title unknown): the selector
        // label comes from the config, falling back to the id.
        title: raw.title ? String(raw.title) : id,
        url: spec ? null : String(raw.url),
        spec,
      }),
      // Array or manifest URL (docs-pages.md §2.2), both carried as declared:
      // the shell turns a string into entries before anything reads it.
      docsPages:
        Array.isArray(raw.docsPages) || typeof raw.docsPages === 'string' ? raw.docsPages : [],
      environments: Array.isArray(raw.environments) ? raw.environments : [],
      scenarios: Array.isArray(raw.scenarios) ? raw.scenarios : [],
      hide: Array.isArray(raw.hide) ? raw.hide : [],
      overlays: Array.isArray(raw.overlays) ? raw.overlays : [],
      userOverlay: raw.userOverlay,
      tryIt: normalizeSpecTryIt(raw.tryIt, id, warnings),
      branding: specBlock(raw.branding, 'branding', id, warnings),
      features: specBlock(raw.features, 'features', id, warnings),
      oauth: specBlock(raw.oauth, 'oauth', id, warnings),
      theme: specBlock(raw.theme, 'theme', id, warnings),
      language: specBlock(raw.language, 'language', id, warnings),
      environmentsLocked: raw.environmentsLocked ?? undefined,
    }
  })
  const ids = new Set()
  for (const spec of specs) {
    if (ids.has(spec.id)) throw new SpecConfigError(`openapi.specs: duplicate id "${spec.id}"`)
    ids.add(spec.id)
  }
  let defaultId = specs[0].id
  if (openapi.default != null) {
    if (!ids.has(openapi.default)) {
      throw new SpecConfigError(`openapi.default: unknown spec id "${openapi.default}"`)
    }
    defaultId = openapi.default
  }
  return { multi: true, specs, defaultId, warnings }
}

// Priority rules (multi-spec.md §2), candidates in order: pending OAuth > hash > stored
// preference. An unknown candidate is ignored (silent fallback); defaultId
// covers rules 4 and 5 (it is the first entry when there's no explicit
// openapi.default).
export function resolveActiveSpecId({ specs, defaultId }, candidates) {
  const known = new Set(specs.map((s) => s.id))
  for (const candidate of candidates) {
    if (candidate && known.has(candidate)) return candidate
  }
  return defaultId
}

// --- root + spec merge, one rule per key -----------------------------------
//
// Only four rules, chosen by the nature of the value:
//   • settings object → merge by key, spec takes priority;
//   • list of named entities → merge by identifier, spec takes priority;
//   • list of patterns → concatenation (nothing gets replaced);
//   • lone scalar or document → replaced if the spec declares it
//     (`environmentsLocked`, `userOverlay`).
// Any new config key must fall into one of the four — and if it doesn't,
// it probably belongs in ROOT_ONLY_KEYS.
//
// The last rule has two readings of `null`, and both are deliberate:
// `environmentsLocked` falls back to the root value (there is nothing to say by
// declaring "not locked" twice), while `userOverlay: null` is a refusal — the
// only way a spec can decline the installation-wide starting patch.

// Declared scenarios (docs/scenarios.md §3): NO root/spec merge, unlike pages. A
// scenario references opIds specific to a spec — in multi-spec, only the
// `specs[]` entry's declarations count, root ones wouldn't apply to any
// particular spec.
//
// An invalid or duplicate id discards the entry and is flagged to the
// integrator (console): unlike a spec id, it cannot break storage or the
// docs — losing the entire documentation for a badly-written scenario slug
// would be disproportionate.
function resolveScenarios(rootScenarios, spec, multi, warnings) {
  if (multi && (rootScenarios ?? []).length) {
    warnings.push(
      'scenarios: root declarations are ignored in multi-spec mode (declare them in openapi.specs[])',
    )
  }
  const raw = multi ? (spec.scenarios ?? []) : (rootScenarios ?? [])
  const entries = []
  const seen = new Set()
  raw.forEach((item, i) => {
    const id = String(item?.id ?? '')
    if (!ID_PATTERN.test(id)) {
      warnings.push(`scenarios[${i}]: invalid id "${id}" (expected [a-z0-9-]+)`)
      return
    }
    if (seen.has(id)) {
      warnings.push(`scenarios: duplicate id "${id}"`)
      return
    }
    // Two carriers, one entry: a file to fetch, or the document itself sitting
    // in the config — for an installation that cannot serve files next to its
    // page, the population `docsPages.content` already exists for. Neither
    // says which FORMAT it holds: the loader sniffs that from the document.
    const carried = item.document && typeof item.document === 'object' ? item.document : null
    if (!carried && !item.url) {
      warnings.push(`scenarios ("${id}"): missing url or document`)
      return
    }
    seen.add(id)
    // `title` is the nav label BEFORE the file loads, and stays empty when the
    // config declares none: the nav falls back to the id on its own, and an id
    // recorded here as a title would win over the name the document carries —
    // which is the whole point of declaring an Arazzo file we did not write.
    // `pinned`: featured on the home page in addition to the nav (§3).
    // Reserved for config — a local scenario cannot be pinned, the home page
    // belongs to the API.
    entries.push({
      id,
      title: item.title ? String(item.title) : '',
      url: item.url ? String(item.url) : '',
      document: carried,
      pinned: item.pinned === true,
    })
  })
  return entries
}

// Environments: same merge as pages, by name.
function mergeEnvironments(rootEnvs, spec) {
  const specNames = new Set((spec.environments ?? []).map((e) => String(e?.name ?? '')))
  return [
    ...(rootEnvs ?? []).filter((e) => !specNames.has(String(e?.name ?? ''))),
    ...(spec.environments ?? []),
  ]
}

// Effective config of the active spec: the only object the shell draws from.
// It has exactly the shape of the host config — a value overridden by the
// spec is indistinguishable from a root value, and that is the point: no
// consumer needs to know multi-spec exists.
//
// → { config, warnings }. The warnings are meant for the integrator
// (console): nothing here is fatal, a dubious declaration is discarded and
// the docs stay usable.
export function resolveSpecConfig(config, spec, { multi = false } = {}) {
  const warnings = []
  // Merge by key for anything that's a settings object. `tryIt`:
  // `requestCredentials: "include"` is necessary for an API that
  // authenticates via a cross-origin session cookie, and a dealbreaker for an
  // API that responds `Access-Control-Allow-Origin: *` — a single value for
  // the whole installation doesn't hold up. `oauth` is indexed by scheme
  // name, and a scheme name only makes sense within ITS spec. `branding`,
  // `theme`, `language`, `features`: each API carries its own identity and
  // offering.
  const effective = {
    ...config,
    // Docs pages: merge by identity (slug / group id / href), one level deep.
    // The manifest form (docs-pages.md §2.2) is resolved upstream by the shell
    // — by the time we get here both sides are plain arrays of raw entries.
    docsPages: mergeDocsPages(config.docsPages, spec.docsPages, warnings),
    environments: mergeEnvironments(config.environments, spec),
    scenarios: resolveScenarios(config.scenarios, spec, multi, warnings),
    tryIt: { ...config.tryIt, ...spec.tryIt },
    branding: { ...config.branding, ...spec.branding },
    features: { ...config.features, ...spec.features },
    oauth: { ...config.oauth, ...spec.oauth },
    theme: { ...config.theme, ...spec.theme },
    language: { ...config.language, ...spec.language },
    environmentsLocked: spec.environmentsLocked ?? config.environmentsLocked,
    openapi: {
      ...config.openapi,
      // Hiding: concatenation, no notion of priority — a pattern cannot
      // "unhide", cumulating is the only composition that makes sense.
      hide: [
        ...(Array.isArray(config.openapi?.hide) ? config.openapi.hide : []),
        ...(spec.hide ?? []),
      ],
      // Overlays: same accumulation, and the order is the application order —
      // the root's overlays first, the spec's own on top of them.
      overlays: [
        ...(Array.isArray(config.openapi?.overlays) ? config.openapi.overlays : []),
        ...(spec.overlays ?? []),
      ],
      // The starting patch: one document per spec (user-overlay.md decision 1),
      // so this is the one openapi key that replaces instead of accumulating —
      // stacking two seeds would need an order the storage slot cannot hold.
      userOverlay:
        spec.userOverlay !== undefined ? spec.userOverlay : (config.openapi?.userOverlay ?? null),
    },
  }
  // Validated on the EFFECTIVE value, not on each source: this is the one
  // that goes into `fetch`, and an out-of-spec value there would make it
  // throw a TypeError on every send.
  if (!REQUEST_CREDENTIALS_MODES.includes(effective.tryIt.requestCredentials)) {
    warnings.push(
      `tryIt.requestCredentials: invalid value "${effective.tryIt.requestCredentials}", falling back to "same-origin"`,
    )
    effective.tryIt = { ...effective.tryIt, requestCredentials: 'same-origin' }
  }
  return { config: effective, warnings }
}
