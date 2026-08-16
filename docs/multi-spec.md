# Multi-spec — several OpenAPI schemas in one installation

The functional source of truth for the multi-spec feature. Code
comments reference the numbered sections below; renumber with care.

## 1. Product model

- One installation can declare **N OpenAPI specs**; **exactly one is active at
  a time** (same model as Scalar's `sources`). A selector in the header
  switches between them.
- **Only the active spec is downloaded, parsed and indexed.** Inactive specs
  cost nothing until selected — no merged nav, no cross-spec Cmd+K search.
- **In single-spec form (`openapi.url`), nothing changes**: no selector,
  identical routes and storage keys. Non-regression of the single-spec form
  is pinned by e2e (§7).

## 2. Configuration

```json
"openapi": {
  "specs": [
    { "id": "payments", "title": "Payments API", "url": "https://…/payments.json" },
    { "id": "accounts", "title": "Accounts API", "url": "https://…/accounts.yaml",
      "docsPages": [], "environments": [] }
  ],
  "default": "payments"
}
```

- `openapi.url` (string) stays supported as-is = single-spec form, strictly
  equivalent to `specs: [{ id: "default", url }]` internally. If both `url`
  and `specs` are provided, `specs` wins (console warning). This is the
  "object → array" extension the config shape was designed for.
- `id`: **mandatory stable slug** (`[a-z0-9-]`), unique within the array — it
  serves as a route segment and a storage prefix, so changing it is
  equivalent to resetting the spec's local data (documented in
  `config.example.js`). Duplicate or invalid id = explicit config error at
  boot.
- `title`: selector label. Needed because inactive specs are never loaded
  (their `info.title` is unknown); falls back to `id`. Once the active spec is
  loaded, the selector can display its version (`info.version`).
- An entry carries its schema by `url` **or inline by `spec`** (the document
  itself, exactly as at the root — `spec` wins over `url` with a console
  warning when both are declared; an entry declaring neither is a config
  error).
- **Almost the entire config can be overridden per spec.** The root carries
  the values common to the installation; a `specs[]` entry redeclares what is
  specific to it. Four merge rules, chosen by the nature of the value:
  - **settings objects** (`tryIt`, `branding`, `theme`, `language`,
    `features`, `oauth`): key-by-key merge, the spec wins. A key not
    redeclared keeps the root value; a declared key wins even at `null` (a
    spec can disable the root proxy);
  - **lists of named entities** (`docsPages` by slug, `environments` by
    name): merge by identifier, the spec wins;
  - **lists of patterns** (`hide`): accumulate — hiding cannot be
    "unhidden". Same rule for `overlays`, where the accumulation order is
    also the application order: the root's overlays run first, the spec's
    own edit what they produced. Same rule again for `announcements`
    (architecture.md §5.17), where the order is the reading order: a
    platform-wide maintenance window and "this API is deprecated" are both
    true at once, and neither is a version of the other;
  - **lone scalars and documents** (`environmentsLocked`,
    `openapi.userOverlay`): replaced if the spec declares them — the
    starting patch is one document per spec (user-overlay.md decision 1),
    so stacking two of them would need an order the reader's single storage
    slot cannot hold; `null` on an entry refuses the root's.

  `scenarios` is an
  exception: in multi-spec, only the entry's own declarations count (a
  scenario references operation ids that belong to one specific spec); root
  declarations are ignored with an explicit warning.
- **Two keys stay root-only**: `history` — retention is a browser storage
  cap whose purge applies to all specs at once (`HistoryStore#purge`), and
  two competing values would make the effective retention depend on the last
  spec visited — and `seo`, because indexability describes the served page,
  which every spec shares (one URL, one `<meta>`). (`openapi` itself is
  root-only by construction: the entries live inside it.) Any other key set
  on a `specs[]` entry is ignored and **flagged by
  name** in the console (root-only key, or unknown key): a silently inert
  setting is a treasure hunt.
- One key **inside** an overridable block is root-only too: `theme.custom`
  (host-defined themes, architecture.md §5.9). Themes are global UI chrome,
  injected once at boot from the root config, and switching spec doesn't
  reload the page. Declared on an entry it gets the same treatment as a
  root-only top-level key — named warning, then **dropped** instead of merged
  into an effective config no consumer reads it from (`ROOT_ONLY_SUBKEYS` in
  `src/specs.js`, which every settings block passes through, so the next such
  key is one entry away). `theme.default` and `theme.available` remain
  overridable — a spec narrows *what is selectable*, it never defines a theme.
- Why `tryIt.requestCredentials` was the first key to force per-spec
  overrides: the right mode depends on the target API — `"include"` for one
  that authenticates with a cross-origin session cookie, `"same-origin"` for
  one that responds `Access-Control-Allow-Origin: *`, whose preflight would
  fail with "No Allow Credentials". A value outside the three valid ones is
  ignored in favor of the root (console warning); the **effective** value is
  re-validated after the merge and falls back to `"same-origin"`.
- Boot consequence: the active spec is resolved **before** theme and
  language, since both are overridable. `resolveSpecConfig` returns the
  effective config, shaped exactly like the host config — no consumer in the
  shell needs to know where a value came from.

**Resolution of the active spec at boot** (first matching rule):

1. `specId` of the pending OAuth handshake in sessionStorage (PKCE flow
   return, see §6);
2. `#/s/{specId}/…` segment of the hash (deep link);
3. `apidoc:spec.selected` preference (localStorage, global);
4. `openapi.default`;
5. first entry of the array.

## 3. Spec selector (UI)

- `<spec-switcher>` component built on the exact pattern of `env-switcher`
  (`detailsDropdown()`, summary `btn btn-sm`, `dropdown-content menu` list),
  placed in **`navbar-start`, next to the brand**: it changes *what is being
  documented*, not *how it is displayed* — unlike the `navbar-end` tools. It
  **absorbs the version badge** (`model.info.version`): the trigger shows the
  active spec's `title` + version badge, adding no net element to an already
  saturated header.
- Each list entry: title, id in discreet `font-mono`, `menu-active` +
  `aria-current` check on the active spec.
- Invisible in single-spec. Below `lg` it stays in the header (it is the only
  `navbar-start` tool besides the brand); the mobile drawer is unchanged.
- Selecting another spec: write `apidoc:spec.selected`, replace the hash with
  `#/s/{id}/` (the spec's home), then **`window.location.reload()`** — same
  mechanics as the language selector. Rationale: `appLayout()` wires ~800
  lines with no teardown (window/router/EnvStore listeners are never
  removed); hot re-rendering would require a risky refactor for a marginal
  gain.

## 4. Routing and deep links

- **Single-spec: routes unchanged** (`#/op/{id}`, `#/page/{slug}`, `?req=`).
- **Multi-spec: every generated route carries the `#/s/{specId}/` prefix** —
  `#/s/{specId}/op/{id}[/{anchor}][?req=…]`, `#/s/{specId}/page/{slug}[/{anchor}]`,
  home `#/s/{specId}/`. `parseHash()` returns `{ specId, type, id, anchor, req }`.
- Implementation note: hash builders (`opHash`/`opShareHash`/`pageHash`…) do
  **not** take a `specId` parameter — the active spec is locked once at boot
  as module state (`setRouteSpecId` in the router, `setSpecScope` in prefs).
  Safe precisely because a spec switch reloads the page: the prefix cannot
  change during the application's lifetime.
- A prefix-less link (`#/op/{id}?req=…`) opened on a multi-spec installation
  is interpreted on the active spec. It is **not** rewritten to the qualified
  form (deliberately unimplemented: the project had no deployed installations
  to keep old links alive for).
- Deep link to a **non-active** spec: boot resolution (§2) loads the right
  spec directly — no double load.
- Unknown `specId` in the URL: silent fallback to the default spec's home.
- Reminder: operation ids (`operationId` or `{method}-{slug}`) are **unique
  only within a spec** — the route prefix is what disambiguates them; no
  attempt is made to merge id spaces.

## 5. Storage: per-spec namespacing

Per-spec key = `apidoc:{specId}:{key}`; in single-spec mode the current bare
keys keep being used as-is (zero migration for existing data).

| Data | Scope | Key in multi mode |
|---|---|---|
| Environments + selection (`environments`, `environment.selected`) | **per spec** | `apidoc:{specId}:environments`… |
| Try-it header memory (`tryit.headers`) | **per spec** | `apidoc:{specId}:tryit.headers` |
| Webhook receiver URL (`webhookSim.url`) | **per spec** | `apidoc:{specId}:webhookSim.url` |
| Theme, language, snippet language, column widths | global | unchanged |
| Selected spec (`spec.selected`) | global | `apidoc:spec.selected` |

- **History (IndexedDB `apidoc-history`)**: schema **version 2** — `specId`
  field + index. The history list only shows entries of the active spec; in
  single-spec, `specId = "default"` is written but everything displays as
  before.
- **Scenarios (IndexedDB `apidoc-scenarios`)**: `specId` field + index; the
  nav, the routes and the 200-per-spec cap all act on the active spec's
  slice ([scenarios.md](scenarios.md) §4, §9).
- **Diff snapshots (`apidoc-schema`)**: already keyed by schema URL — they
  work per spec as-is. The "Schema changed" badge only concerns the active
  spec (no multi-spec aggregate, which would require loading every spec at
  boot).
- Deliberately unimplemented (nothing existed to migrate): copying legacy
  bare prefs keys into the default spec's namespace, and backfilling existing
  history entries during the IndexedDB upgrade. A single-spec installation
  switched to multi starts fresh (environments re-seeded from config, empty
  history).

## 6. Impact per subsystem

- **Environments & auth**: `EnvStore` is instantiated on the active spec's
  namespace — complete isolation (baseUrl, variables, `servers` seeding,
  suggested `auth.{scheme}` variables). Two specs declaring a same-named
  scheme (`bearerAuth`, very common) **never** share a variable: no token
  leaking between APIs, and the `auth.{schemeName}` convention is unchanged
  within a spec.
- **OAuth PKCE**: the sessionStorage pending state (`apidoc.oauth.pending`)
  carries a `specId` field; on redirect return, boot resolution (§2, rule 1)
  guarantees the token is written into the right spec's environment, and
  `returnHash` naturally carries the prefix.
- **Cmd+K search**: index built from the active spec's model only — boot cost
  unchanged.
- **llms-full / "Copy page"**: per active spec; `toLlmsFullText` unchanged
  (it already takes a single model). No aggregated multi-spec export (the
  other specs are not loaded).
- **Webhooks + simulator**: the only consumer to touch = the `webhookSim.url`
  key gets prefixed (the component already receives the operation as a
  property).
- **History exports** (cURL, Postman, HAR, Markdown, Debug, share): operate
  on history entries — **neutral**, no change.

## 7. Tests

Unit (Vitest): `parseHash`/`opHash`/`pageHash` with and without the spec
segment (legacy-form compatibility); active-spec resolution (priority rules);
config normalization (`url` alone, `specs[]`, both, invalid/duplicate ids).
E2E (Playwright): two-spec fixture in `tests/e2e/fixtures/`, pinning:

1. A config with two `specs[]` entries shows the selector in the header;
   switching changes nav, doc, try-it, environments and history.
2. Reloading the page on `#/s/{id}/op/{opId}` of a **non-selected** spec
   loads the right spec on the right operation directly.
3. Single-spec `openapi.url` config → no change: no selector, unprefixed
   routes, legacy storage keys (e2e non-regression).
4. Environments, OAuth tokens, header memory and history are isolated per
   spec; a token obtained on spec A is never injected into a request of
   spec B.
5. A prefix-less share link `#/op/{id}?req=…` opens on the active spec.
