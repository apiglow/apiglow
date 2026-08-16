// The shape of the host config: its defaults, and the merge that turns what an
// installation declares into a complete object (docs/architecture.md §4).
//
// It lives here rather than in `src/app.js` because two programs read the same
// config with the same semantics — the app at boot, and the bake CLI
// (docs/seo.md §4), which mirrors what a reader sees and would mirror nothing
// if it defaulted differently. Rule 10 is untouched: this module declares the
// shape, it never reads the host page.

const CONFIG_DEFAULTS = {
  // `hide`: operation-hiding patterns (see openapi/hide.js), combined with
  // those from a possible `specs[]` entry.
  // `overlays`: OpenAPI Overlay 1.1 documents (URL or inline object) applied
  // to the schema at load, same accumulation rule as `hide`.
  // `userOverlay`: the starting patch handed to a browser that has none, in the
  // reader's own editable slot (docs/user-overlay.md decision 11). One document,
  // so a specs[] entry replaces it rather than accumulating.
  openapi: { url: null, hide: [], overlays: [], userOverlay: null },
  // `custom`: host-defined daisyUI themes generated at boot
  // (docs/custom-themes.md). Root-only, unlike the rest of the block.
  // 'system' follows prefers-color-scheme within the signature pair.
  theme: { default: 'system', available: ['apiglow', 'apiglow-dark'], custom: [] },
  // 'browser' follows navigator.languages within `available`, the way the
  // theme's 'system' follows prefers-color-scheme — and, like it, it is the
  // built-in default: a reader whose browser asks for French reads French
  // without anyone configuring anything.
  language: { default: 'browser', available: ['en', 'fr'] },
  environments: [],
  // true = the config's environments are locked: no manager
  // (create/edit/delete), the selector stays available.
  environmentsLocked: false,
  docsPages: [],
  // `feedback.url`: host endpoint receiving a `{ page, verdict }` POST from
  // the "was this page helpful?" row on docs pages. Null — the default — means
  // the row does not exist: no backend of ours, so no widget without one of
  // the host's (docs/docs-pages.md §5).
  feedback: { url: null },
  // Declared scenarios: [{ id, title, url }] — in multi-spec, only within
  // the openapi.specs[] entries (docs/scenarios.md §3).
  scenarios: [],
  // Feature switches. `scenarios: false` removes the feature
  // entirely: nav section, capture buttons, routes, search
  // index, home card — along with the scenarios declared above.
  // `audit: false` removes the schema audit the same way: settings block,
  // #/audit route, and any computation (docs/audit.md §5).
  // `onboarding: true` (off by default, unlike the two above) adds the
  // generated "First call" page at the top of the reference nav.
  // `ci: false` removes the "Automate this scenario" panel from the scenario
  // pages (docs/scenario-handoff.md §4) — an install for whom a pipeline is
  // not the reader's business. It gates that panel and nothing else: what a
  // declared scenario publishes stays governed by its declaration alone (§2).
  features: { scenarios: true, audit: true, onboarding: false, ci: true },
  branding: { productName: 'API Docs', logoUrl: null },
  tryIt: { proxyUrl: null, requestCredentials: 'same-origin' },
  // Per OAuth2 scheme: { "schemeName": { "clientId": "…" } }. clientId
  // can be overridden by the auth.X.clientId env variable; never a
  // clientSecret here — a secret in the host page would be public.
  oauth: {},
  history: { maxEntries: 500, maxAgeDays: 30 },
  // `index: false` asks crawlers to leave this installation out of their
  // indexes (docs/seo.md §2). Installation-wide, like the served URL it talks
  // about — hence root-only, and read at boot rather than per route.
  seo: { index: true },
}

function mergeConfig(defaults, overrides) {
  const out = { ...defaults }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const base = defaults[key]
    const bothPlainObjects =
      base &&
      typeof base === 'object' &&
      !Array.isArray(base) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    out[key] = bothPlainObjects ? mergeConfig(base, value) : value
  }
  return out
}

// What a declaration becomes before anything reads it: the defaults, with the
// installation's own values merged over them. No validation here — values are
// checked on the EFFECTIVE config of the active spec (`resolveSpecConfig`),
// the only one that actually goes into the app.
export function hostConfig(raw) {
  return mergeConfig(CONFIG_DEFAULTS, raw)
}
