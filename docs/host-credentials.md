# Host credentials — runtime bridge from the host page

This document is the functional source of truth for the feature.
Code comments reference the numbered sections below; renumber with care.
Core:
`src/env/host-credentials.js`. Tests: `tests/host-credentials.test.js`,
`tests/e2e/host-credentials.spec.js`.

## 1. Problem and product model

The docs page is static: no server renders it, so nothing can inject a
per-user token into the page at delivery time. Yet the person reading the
docs often already *has* a session (cookie, SSO) in the same browser, and
the host backend could mint an API token for them on demand.

This feature is the bridge: **the host page provides credentials to the app
at runtime through a small public JS API**, and the app routes them into the
existing conventional `auth.X` environment variables — the single path that
already drives injection, missing-credential badges and the try-it
credentials cartouche (architecture §5.4). The feature adds a *source* of
credentials, never a new injection mechanism.

Product rules:

- **Pull first, push as sugar.** The core primitive is a *provider*
  callback registered by the host; the app calls it when it needs
  credentials (boot, 401 refresh, manual refresh). A `setCredentials()`
  push exists for the trivial case where the host already holds the value.
- **Fill only the void.** A host-provided value applies only where the
  selected environment has no value. A value typed by the user (or written
  by an OAuth flow) always wins; clearing it falls back to the host value.
  The host never steals the hand.
- **Ephemeral, memory only.** Host-provided values are never persisted —
  not in `localStorage`, not in IndexedDB, not in exports. Page reload →
  the provider is asked again. No stale token can outlive its page.
- **Auto-retry ×1 on 401.** A 401 on a request whose credentials came from
  the host triggers one provider refresh and one replay, with a visible
  signal.

## 2. Public runtime API

The app exposes a single global, created **synchronously at module
evaluation** (before any top-level `await` in `app.js`), so any
`<script type="module">` placed after the app's script tag sees it
directly. For classic scripts (which execute before module scripts), a
`CustomEvent` is dispatched on `document` immediately after the global is
created:

```html
<script src="https://cdn…/dist/app.js" type="module"></script>
<script type="module">
  // Module script after the app tag: the global is guaranteed present.
  apidoc.registerCredentialsProvider(async ({ specId, reason }) => {
    const r = await fetch('/api/docs-token', { credentials: 'include' })
    if (!r.ok) return null
    return { bearerAuth: (await r.json()).access_token }
  })
</script>
```

Order-independent form (works from anywhere, including classic scripts):

```js
function whenApidocReady(cb) {
  window.apidoc ? cb(window.apidoc) : document.addEventListener('apidoc:ready', (e) => cb(e.detail))
}
```

Surface (closed):

| Member | Contract |
|---|---|
| `apidoc.registerCredentialsProvider(fn)` | Registers *the* provider (§3). Single slot: registering again replaces the previous one with a `[api-doc]` console warning. Registering after boot triggers an initial fill pass (§5). |
| `apidoc.setCredentials(map)` | Pushes values into the ephemeral overlay immediately. Same map shape as the provider return value (§3). Per-scheme replace; UI refreshes. |
| `apidoc.clearCredentials()` | Empties the overlay (host logout). Missing-credential badges recompute. Does not unregister the provider. |
| `apidoc:ready` event on `document` | Dispatched once, right after the global exists; `event.detail` is the API object. |

Naming: `apidoc` is deliberately name-neutral — the global is host-facing
contract surface that outlives releases, so like the storage keys and
`window.API_DOC_CONFIG` it carries no product name.

Guard: if `window.apidoc` already exists at module evaluation (double
script include), warn and keep the existing object — never clobber a live
registration.

Multi-spec: there is one overlay and it belongs to the **active spec**
(exactly one per page lifetime, multi-spec §1). The provider is global to
the installation and receives `specId` in its context: one registration
serves every spec across reloads, routing internally if it handles several
APIs.

## 3. Provider contract

```js
async (ctx) => map | null

ctx = {
  specId,      // active spec id ('default' in mono-spec)
  reason,      // 'initial' | 'expired' | 'manual'
  schemes,     // credential descriptors of the active spec's securitySchemes,
               // one entry per conventional variable (same source as the
               // cartouche fields, src/openapi/auth.js): { name, type, field }
  schemeName,  // only for 'expired'/'manual' when a single scheme is
               // targeted; undefined otherwise
}

map = {
  bearerAuth: 'eyJ…',                          // string → variable auth.bearerAuth
  basicAuth: { username: 'u', password: 'p' }, // object → auth.basicAuth.username / .password
}
```

- Keys are **scheme names** as declared in `components.securitySchemes`.
  A string value maps to `auth.X`; an object maps each key to `auth.X.<key>`.
  This reuses the conventional-variable machinery (`credentialFields`) —
  the provider cannot invent variable names outside the `auth.` namespace.
- Values are coerced to `String`. Unknown scheme names — and, inside an
  object value, suffixes that are not conventional fields of the scheme
  (`credentialFields`) — are dropped with a
  `[api-doc]` console warning. `null`/`undefined` (or an empty map) means
  "nothing to offer" and is not an error.
- A thrown error or rejected promise is caught, logged with `[api-doc]`,
  and treated as an empty result. **A broken provider never blocks the UI**
  — the manual cartouche is always the fallback.
- **Single-flight**: concurrent needs (idle fill racing a send, double
  click on refresh) share one in-flight provider call; new requests await
  the pending promise instead of stacking calls. No hard timeout: a hung
  provider simply means the overlay is never filled (and a pending 401
  retry never fires).

## 4. Resolution — fill only the void

Host values live in an in-memory overlay, every entry `sensitive: true`,
already expanded to variable names (`auth.X`, `auth.X.suffix`).

Effective variables for request building, `{{var}}` interpolation and
credential-status computation:

```
{ ...overlay, ...nonEmpty(env variables), ...run variables }
```

- An environment variable with a **non-empty** value wins over the overlay.
  An absent variable *or one holding the empty string* is "void" and falls
  through to the overlay. Run variables (scenario execution) keep top
  precedence, unchanged.
- One shared helper implements this merge; **every** consumer of
  `EnvStore.variablesOf()` that feeds sends or credential status goes
  through it (try-it build, credentials status, scenario runner). No second
  divergent merge.
- The overlay only ever holds `auth.*` names, so resolution of every other
  variable is bit-for-bit unchanged.
- The environments manager popin shows **only real environment content**:
  the overlay is not an environment and never appears there. Its UI
  surfaces are the try-it cartouche and the presence half of the
  missing-credential badges — the env-switcher entries included (§6) —
  never the manager.
- Invariants that follow (and are tested): typing a value in the cartouche
  writes the env var and immediately wins; clearing that value falls back
  to the host value; `clearCredentials()` re-exposes the red "missing"
  badges wherever the env is void.

## 5. Lifecycle

- **Boot fill**: scheduled during shell construction and deferred through
  `whenIdle` → if a provider is
  registered and at least one conventional credential variable of the
  active spec's schemes is void, call the provider (`reason: 'initial'`)
  and fill the overlay. Off the critical path by design.
- **Late registration**: `registerCredentialsProvider()` after boot
  triggers the same idle fill pass. Registration order never matters.
- **Push**: `setCredentials()` fills the overlay synchronously (no
  provider round-trip) and refreshes badges/cartouche.
- **401 refresh + replay** — all conditions required:
  1. response status is exactly 401 (not 403, not network error);
  2. the request's injected credentials came (fully or partly) from the
     overlay — a 401 on user-typed credentials is the user's business.
     Answered by `HostCredentials.supplied(used)`, because the shape of the
     overlay is the overlay's business, not the panel's;
  3. a provider is registered;
  4. this send is not itself a replay (hard ×1 cap, no loops). The cap is
     carried by `rebuild`: only a send that can rebuild its request reaches
     the retry at all, and the replay dispatches without one.

  Flow: the 401 renders normally (status pill, announce). The app then
  calls the provider (`reason: 'expired'`, `schemeName` set when a single
  scheme was injected). If the expanded values **differ** from the current
  overlay, the overlay updates and the request is resent once — a normal
  send (new history entry) with an info alert in the response panel and a
  live-region announcement (§6). If the result is unchanged, empty, or the
  provider fails: keep the 401, do nothing visible, `console.warn`.
- **Manual refresh**: a button in the cartouche (visible only when a
  provider is registered) calls the provider (`reason: 'manual'`,
  `schemeName` of that cartouche's scheme) with a spinner on the button.
- **Clear**: `clearCredentials()` empties the overlay; nothing else is
  forgotten (provider stays registered — the host's logout/login cycle is
  `clearCredentials()` then, later, another fill).

## 6. UI states

All strings via `t('key')` (rule 9), `en` + `fr` in the same commit:

| Key | Use |
|---|---|
| `tryit.credFromHost` | Cartouche badge replacing the red "missing" badge when the void is filled by the overlay (`badge-info badge-soft`). |
| `tryit.credHostRefresh` | Manual refresh button label + `aria-label`. |
| `tryit.credHostRetried` | Response-panel info alert + `announce()` text after an automatic 401 replay. |

- **Cartouche field** whose env value is void but overlay-covered: the
  input stays empty (it edits the *environment* variable, and typing wins
  per §4) and the row shows the `tryit.credFromHost` badge instead of the
  red missing badge. The input deliberately does **not** display the host value,
  even masked: the input's binding stays "env var only", no leak
  through the eye toggle, no ambiguity about what editing does.
- **Missing-credential badges** (env-switcher entries, cartouche): a field
  covered by the overlay counts as present.
- **401 replay**: `alert-info` in the response panel + `announce()` — a
  screen-reader user hears both the 401 and the replayed outcome
  (rule 15).
- **Send meter, history list, exports UI**: unchanged.

## 7. Security and privacy

- **Trust boundary**: the provider is host-page code — exactly the trust
  level of the page embedding the app. Nothing in the OpenAPI document can
  register a provider, trigger a call, or influence one beyond its scheme
  *names* appearing in `ctx.schemes`. No URL is ever fetched by the app
  itself for credentials (that declarative variant is a non-goal, §10).
- **Ephemeral by construction**: the overlay never touches `localStorage`
  or IndexedDB, so rule 13 (bounded storage) is satisfied vacuously, and
  environment exports can never contain host values.
- **History**: a sent request persists its built headers in IndexedDB —
  same exposure as a manually typed token today. Export redaction
  (rule 12, `src/export/redact.js`) keys off variable sensitivity:
  overlay-sourced values are captured as `sensitive: true` in history
  entry snapshots, so every export redacts them by default.
- **Cookies do the authenticating**: the typical provider fetch uses
  `credentials: 'include'`; the CORS prerequisites (explicit origin,
  `Access-Control-Allow-Credentials`, `SameSite=None; Secure`) are the
  host's to meet and are the same ones already documented for
  `tryIt.requestCredentials` (architecture §4). The provider doc links
  there instead of restating them.

## 8. Architecture map

| Where | What |
|---|---|
| `src/env/host-credentials.js` (core) | `HostCredentials extends EventTarget`: overlay map, provider slot (`registerProvider`, `hasProvider`), a `context` setter (spec id + schemes), `set(map)/clear()/values()`, `covers(name)`, `supplied(used)`, single-flight `request(reason, schemeName?)`, scheme-map → variable-name expansion. Pure of `window` — instantiated and exposed by the shell, unit-testable headless. |
| `src/app.js` (shell) | Synchronous creation of the instance + `window.apidoc` + `apidoc:ready` at module top, before any top-level `await` (`tests/e2e/host-credentials.spec.js` exercises the ordering against the packed page). Idle boot fill; wiring the instance into the try-it panel and badge computations (same pattern as `envStore`). |
| `src/components/api-try-it-panel.js` | Merge helper at the two `variablesOf()` sites (build + `credentialsStatus`); 401 refresh-replay in `#send()`; replay info alert. |
| `src/components/credentials-form.js` | "From host" badge state; manual refresh button. |
| `src/env/variables.js` (core) | `VariableSource({ envStore, host })`: `for(env, run)` (the one merge), `sourceOf(name, env)` → `'env' \| 'host' \| null` (the one credential-presence rule), and a `change` relay carrying `detail.origin` — an env change and a host fill are not interchangeable to a consumer. Components take this instead of the two stores. |
| `src/i18n/en.json`, `i18n/fr.json` | The three keys of §6, both languages. |
| `docs/architecture.md` | §5.4 bullet pointing here; storage note (ephemeral, no policy needed). |
| `CONTRIBUTING.md` | Feature→test map row. |
| `config.example.js` | No config key (the API is runtime-only); a short comment pointing to this doc where `oauth` is documented. |

## 9. Tests

Vitest (`tests/host-credentials.test.js` and `tests/variable-source.test.js`),
pure core:

- scheme-map expansion: string → `auth.X`, object → `auth.X.suffix`,
  unknown scheme ignored + warned, values stringified, all sensitive;
- merge helper: env non-empty wins, empty string falls through, run
  variables on top, non-`auth.` variables untouched;
- single-flight: two concurrent `request()` → one provider call;
- provider rejection → empty result, no throw;
- register-replace warns; `clear()` empties without unregistering;
- `VariableSource`: the composition and its order, `sourceOf` agreeing with
  `for` on what resolves, an explicit `env` argument (the switcher asks about
  rows that are not the selected one), and the `change` relay's origin.

Playwright (`tests/e2e/host-credentials.spec.js`), against the packed
bundle (the e2e suite validates the packed tarball, not the dev sources),
fixture page registering an inline provider:

- `window.apidoc` is present for a module script placed after the app tag;
  `apidoc:ready` fires for early listeners;
- boot fill: red missing badge → `credFromHost` badge without any user
  action; send carries `Authorization: Bearer <host token>`;
- typed value wins over host value; clearing it falls back;
- 401 replay: `page.route` serves 401 then 200 → exactly two requests, the
  second with the refreshed token, info alert visible, announced;
- ×1 cap: provider returning the same token on 'expired' → no second
  replay;
- manual refresh button calls the provider; `clearCredentials()` restores
  the missing badge;
- axe sweep (`a11y.spec.js`) stays green.

A page that never touches `window.apidoc` behaves bit-for-bit as if the
feature did not exist — pinned by the rest of the suite, which runs
without a provider.

## 10. Out of scope (recorded decisions)

- **Declarative bootstrap URL in the JSON config**: deliberately
  excluded. If ever needed for JSON-only hosts, it becomes a
  *built-in provider* layered on this exact overlay — nothing here blocks
  it, and the trust analysis of config-declared URLs belongs to that
  decision.
- **postMessage / iframe bridge**: only relevant for embedded-iframe
  installs; same layering argument.
- **Proactive expiry** (`expires_in` timers): the 401-driven refresh
  covers the need without clock management. Revisit only on evidence.
- **Per-spec provider registration**: `ctx.specId` already lets one global
  provider route; a registration API per spec is redundant surface.
- **Opt-in persistence of host values**: contradicts the ephemeral
  guarantee; a host that wants persistence writes environment variables
  through its own config instead.
