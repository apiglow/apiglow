# Contributing

Thanks for considering a contribution. This file is the practical guide;
the functional source of truth lives in [`docs/`](docs/)
([architecture](docs/architecture.md), [scenarios](docs/scenarios.md),
[multi-spec](docs/multi-spec.md), [design rationale](docs/architecture.md#14-design-rationale)).

## Dev setup

```bash
npm install
npx playwright install chromium              # once, for the e2e suite
npx playwright install --with-deps firefox webkit   # only for `test:e2e:all`
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (unbundled ESM sources) |
| `npm test` | Vitest — pure core only |
| `npm run test:e2e` | Playwright (Chromium) against the CDN simulation |
| `npm run test:e2e:all` | The same suite on all five projects — three engines plus two emulated phones |
| `npm run test:coverage` | Vitest + a coverage summary over the pure core |
| `npm run build` | → `dist/app.js` + `dist/app.css` + `dist/i18n/*.json` |
| `npm run preview:cdn` | build + `npm pack` + jsDelivr simulation on :4173 |
| `npm run check:invariants` | The cross-cutting rules a test suite cannot see (rules 1, 2, 5, 6, 9, 10, 12, 13, 14, 20) |
| `npm run check:dist` | Post-build gate on `dist/`: one JS file, no `document.currentScript`, every daisyUI theme, size budgets (rules 3, 4, 8, 14) |
| `npm run check:surface` | Frozen public surfaces (tags, events, `apidoc…` names, i18n keys) against `public-surface.json`; `-- --update` accepts a deliberate change (CONVENTIONS.md) |
| `npm run check:syntax` | `es-check` against the declared `browserslist` baseline — the built bundle parses on every supported browser |
| `npm run report:contrast` | **Informative, gates nothing**: contrast of the design layer's ink recipes on every shipped daisyUI theme, measured in a browser against `dist/app.css` (`--all` lists every pair). Needs a build |
| `npm run lint` | Biome — format check + lint |
| `npm run lint:fix` | Biome — apply the safe fixes |
| `npm run format` | Biome — reformat in place |

### The demo API

The demo pages served by `npm run dev` and `npm run preview:cdn` talk to a
real API: `demo/mock-sw.js`, a service worker answering the petstore schema
(`/demo-api/v3`, same origin) from memory. It is registered by
`demo/register-mock-sw.js`, which publishes the result on
`<html data-mock-api>` — `ready` means the worker is in control, anything
else means requests would reach a 404. Because the worker file sits in
`demo/` but claims the whole origin, both servers serve it with a
`Service-Worker-Allowed: /` header; keep that in mind if you add a third
way to serve the demo.

The mock verifies no credential and keeps no data across a worker restart.
It is **not** used by the e2e suite, which keeps intercepting at the
Playwright level against synthetic fixtures — those tests validate the app,
not the demo. The one demo-level exception is `tests/e2e/demo.spec.js`,
which asserts that the demo itself works.

The worker also serves the demo's OAuth authorization server, same-origin
under `/demo-api/oauth/` — consent page included (a top-level navigation is
an in-scope request like any other). All four declared flows really answer,
with fanciful tokens, wherever the demo is hosted.

The demo declares a **second spec as a witness**: a frozen copy of a public
real-world OpenAPI description (`demo/schemas/github.json`, provenance,
upstream version and license recorded in `demo/schemas/NOTICE.md`). It is
there to prove the app on a document nobody wrote for it — multi-MB, deeply
`$ref`-ed, written by someone else. It is loaded **on selection, never at
bootstrap**: that laziness is what keeps the perf budgets (rule 14) meaningful
with a spec that size, and `demo.spec.js` asserts it.

The demo and the test suite do not reach into each other: the demo configs
load nothing under `tests/`, and the e2e fixture pages load nothing under
`demo/`. `scripts/preview-cdn.mjs` serves an allowlist — the packed tarball,
`demo/`, `docs-pages/` and `tests/e2e/fixtures/` — so `docs/` and the rest of
the repo are not fetchable from the demo origin.

`demo/cdn-install.html` hardcodes `/npm/apiglow@<version>/` the way a real
installation would; `preview:cdn` refuses to start when that version drifts
from `package.json`.

## Project structure

```
src/
├── app.js         # bootstrap (shell) — the ONLY module reading the host config
├── openapi/       # loader, $ref resolution, swagger2.js (2.0 → 3.0 conversion),
│                  # model.js (normalization), auth, send.js (shared send
│                  # pipeline), sample, diff, hide
├── components/    # light-DOM web components (UI only, e2e-covered)
├── scenarios/     # scenario model, runner (pure), step controller
├── search/        # Cmd+K index (pure)
├── env/           # environment model, colors, interpolation (pure)
├── storage/       # prefs (localStorage) + IndexedDB stores
├── export/        # export generators — pure functions, snapshot-tested
├── import/        # cURL/Postman/HAR parsers + operation matcher (pure)
├── i18n/          # t() runtime + bundled en.json
├── router.js      # hash routing (pure parse/build + startRouter)
├── specs.js       # multi-spec config normalization (pure)
└── styles/        # app.css (Tailwind 4 + daisyUI 5)
```

The split that matters: the **core** (everything except `app.js`) never
reads the host config and never knows where values come from. `app.js` is
the shell — bootstrap, config, branding, wiring.

## Project rules

These are the rules that keep the product's promises. PRs that break one
will be asked to change, however good the feature.

1. **Never Shadow DOM.** Light DOM + class-convention scoping
   ([architecture §14.1](docs/architecture.md#141-light-dom-never-shadow-dom)).
2. **Never dynamically built Tailwind/daisyUI class names** (`badge-${x}` is
   banned — the JIT purge deletes them). Always explicit static maps, e.g.
   `{ GET: 'badge-success', POST: 'badge-info', DELETE: 'badge-error', … }`.
3. **The built CSS includes all standard daisyUI themes**, otherwise
   `theme.available` silently breaks for end users. (`npm run check:dist`
   counts the themes in the built CSS.)
4. **All runtime asset paths** (`app.css`, `i18n/*.json`) resolve via
   `new URL('./…', import.meta.url)`. **Never `document.currentScript`**
   (null in an ES module). ([architecture §14.9](docs/architecture.md#149-assets-resolve-via-importmetaurl);
   `npm run check:dist` fails on it in the built bundle.)
5. **All HTML derived from external content** (OpenAPI descriptions,
   examples, `.md` files, scenario files) goes through DOMPurify. No
   unsanitized `innerHTML`, no `eval`/`new Function`.
6. **Rendering consumes only the internal normalized model**
   (`src/openapi/model.js`), never the raw OpenAPI schema. No version
   branch outside normalization. ([architecture §14.3](docs/architecture.md#143-one-normalized-model))
7. **Recursive schemas**: lazy expansion with a max depth, cycle detection.
   No unbounded recursion, in the model or in the rendering.
8. **Storage**: history/scenarios/snapshots = IndexedDB;
   environments/preferences/theme/language = localStorage. No other
   mechanism, no dual paths. ([architecture §14.4](docs/architecture.md#144-the-storage-split);
   `npm run check:invariants` checks every database is declared to the
   storage inventory, and `check:dist` holds the single-file guarantee.)
9. **Every UI string goes through `t('key')`** — zero hardcoded text in
   components. English is bundled as the fallback.
10. **Core vs shell**: `src/app.js` (bootstrap) is the only module reading
    the host config and branding. The core never sees the host config.
11. **`{{var}}` interpolation**: a missing variable blocks the send with a
    visible signal. The literal `{{var}}` is never sent.
12. **Exports**: generators are pure functions in `src/export/`,
    snapshot-tested. Sensitive values are redacted by default.
13. **Bounded storage.** Anything persisted on the user's device declares a
    policy: TTL + cap (history), hard cap with explicit user-facing
    rejection (user artifacts like scenarios), or LRU (caches like schema
    snapshots). No dataset may grow unbounded. Adding a new stored dataset
    requires declaring its policy in `docs/architecture.md`.
14. **Performance is a feature.** Parse/first-render budgets are enforced
    by the perf e2e against the demo's GitHub REST schema, the heaviest
    document the repo ships. A change that
    regresses the budget needs an explicit trade-off decision, not a budget
    bump — `npm run check:invariants` records every budget's ceiling, so
    loosening one is a two-file commit and deleting one fails.
15. **Accessibility is mandatory.** Every interactive component is
    keyboard-operable with visible focus; dialogs return focus on close;
    async outcomes are announced via live regions; labels via i18n'd
    `aria-*`. Use the primitives in `src/components/a11y.js` rather than a
    fourth hand-rolled variant, and keep the axe sweep green — the model and
    the one documented waiver are in
    [architecture §12](docs/architecture.md#12-accessibility).
16. **Every feature has at least one test.** Core logic → Vitest; UI
    behavior → Playwright against the packed bundle. A PR adding a feature
    without a test is incomplete.
17. **English-only codebase, bilingual product.** Code, comments, tests,
    docs and commit messages are English. The UI itself ships in English
    and French (`src/i18n/en.json` + `i18n/fr.json`, kept in key sync) —
    `i18n/fr.json` is the only sanctioned French in the repo, and it is a
    feature, not debt. New locales are welcome as `i18n/<lang>.json`.
18. **Biome is the arbiter of style.** `npx biome ci` green is a merge
    requirement; don't hand-argue formatting in reviews.

## Style & linting

[Biome](https://biomejs.dev) is the single tool for both formatting and
linting — config in [`biome.jsonc`](biome.jsonc), enforced by CI. It is
tuned to the codebase as written (100-column lines, single quotes, no
semicolons, trailing commas), not the other way round. Two deliberate
exclusions, documented in the config: `src/styles/app.css` (the Biome CSS
parser doesn't understand the Tailwind 4 at-rules) and import sorting (some
import order is load-bearing).

Run `npm run lint:fix` before pushing. Keep the reformatting of untouched
code out of feature PRs.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every PR and
every push to `main`, in two parallel jobs:

- **quality** — `biome ci`, `npm run check:invariants`,
  `npm run check:surface`, unit tests with coverage, `npm run build`, then
  `npm run check:dist` on its output
- **e2e** — three parallel jobs, one per browser binary (Chromium, Firefox,
  WebKit), each running its desktop project and the mobile project that
  shares its binary. `fail-fast: false`, so one engine's failure still
  reports the other two, and each uploads its own
  `playwright-report-⟨browser⟩` artifact. Playwright against the packed tarball; on failure the HTML
  report (traces included) is uploaded as an artifact

Coverage is informational: reported, never a gate. There is deliberately no
publish or release job.

## Documentation: state, never history

The repository documents **what is**, not how it came to be. Git is the
only history. Concretely, in every tracked file:

- **No calendar dates** on decisions, statuses, audits or measurements. A
  date is allowed only when it is product data (a `sunset` header in a
  fixture, an upstream release note quoted as such).
- **No process narration**: no session/phase tables with progress columns,
  no "supersedes / was previously / moved from X", no embedded commit
  hashes, no named runs of internal tooling.
- **No decision-journey framing**: state the rule and its current
  rationale as fact. Rationale is welcome — the *narrative of arriving at
  it* is not.
- **No references to documents that are not in the tree**: every
  cross-reference must resolve for a reader of the published repository.
- **No plans, todos or status banners in tracked docs.** A tracked
  document describes the current state of the project — being in the tree
  *is* the "implemented" statement, so no document says it. Plans,
  roadmaps, in-progress specs and todo lists live in `docs/plan/`
  (gitignored, like `docs/upgrade/`) and never enter a commit; what a
  plan produces enters the tree as state documentation once it exists.
  Recorded decisions belong in a doc only when the rationale is technical
  or genuinely worth highlighting — never as a journal of choices.

This applies to what tooling *produces* too: a script or skill that writes
dated decisions into a tracked file reintroduces the debt on its next run.

## Comment policy

Only write comments that carry information not deducible from the code: a
subtlety, a non-obvious behavior, the reason for a choice, a workaround.
No paraphrase comments (a class docblock repeating the class name,
`// fetch the client`, …). The existing comments are the project's design
record — don't strip them, and hold new code to the same bar.

## i18n layout

`src/i18n/en.json` is statically imported (bundled fallback — the UI can
never be broken by a network failure). Every other locale lives in the
root `i18n/` directory and is lazy-loaded at runtime from `dist/i18n/`.
The asymmetry is deliberate ([architecture §14.7](docs/architecture.md#147-bundled-en-lazy-loaded-other-locales)):
don't unify the two locations. Adding a language = one `i18n/<lang>.json`
file, key-synced with `en.json`.

## Test philosophy

- **Vitest** covers the pure core only — no DOM environment, no browser
  polyfills. Normalization, interpolation, exports (snapshots), auth
  mapping, scenario runner, routing, config merging.
- **Playwright** covers UI behavior, persistence (localStorage, IndexedDB)
  and the bootstrap — always against the **packed tarball**
  ([architecture §14.12](docs/architecture.md#1412-e2e-runs-against-the-packed-tarball)). Don't force unit
  tests onto DOM components; don't test UI logic in Vitest.
- Snapshots: when a change orphans or modifies snapshots, regenerate
  deliberately and review the diff — never a blind `-u`.
- `npm test` must be green before any commit touching the core; run
  `npm run test:e2e` after any change to the build output, `package.json`
  `files`/`exports`, or distribution scripts (unit tests can't catch those).

### The browser matrix

`npm run test:e2e` runs Chromium only, on purpose — a dev loop should not pay
for five projects. CI runs all of them (`docs/architecture.md` §13.0), and
`npm run test:e2e:all` is the local opt-in, after
`npx playwright install --with-deps firefox webkit`.

When CI fails on one engine, reproduce it alone and watch it:

```bash
npx playwright test --project=webkit tests/e2e/tryit.spec.js --headed
npx playwright test --project=mobile-safari --grep "the try-it FAB" --debug
npx playwright show-report        # after downloading playwright-report-webkit
```

Writing a spec that passes everywhere is mostly one habit: reach the UI
through `tests/e2e/helpers.js` rather than around it. The helpers open the
drawer or the bottom sheet when the viewport is below `lg`, and do nothing
above it — `clickNavOp`, `send`, `openHistory`, `openSettings`, `clickInDoc`
and `editInDoc` already carry it, which is why a desktop-written spec usually
passes on a phone unchanged. Writing to the central doc always goes through the
last two: an open panel makes the page behind it `inert`, so a `fill()` aimed
straight at a doc field lands nowhere below `lg`. A spec that navigates with a raw `page.goto`
opts out of all of it and has to say `openTryItIfMobile` itself.

Two engine facts worth knowing before blaming your test: a browser error
message is not portable (`Failed to fetch` / `NetworkError…` / `Load failed`
are the same failure), and Playwright's WebKit cannot show you a request body
that came from a `File`, nor fulfill a 3xx.

### Where a feature's tests live

Rule 16 in table form — the map from each feature advertised in the README
to the tests that hold it up. Use it to find the right file when you change
something, and extend it when you add a feature. A `—` cell is a choice,
not an omission: the feature is held entirely by the other column (pure
logic with no browser surface, or behavior only observable end-to-end).

| Feature | Unit (Vitest) | Behavior (Playwright) |
|---|---|---|
| Bootstrap, 3-column layout, error states | — | `bootstrap.spec.js`, `navigation.spec.js`, `mobile.spec.js` |
| Schema loading, `$ref`, 3.0/3.1/3.2 normalization | `model.test.js`, `loader-remote.test.js`, `loader-inline.test.js`, `coerce.test.js`, `sample.test.js` | `openapi-32.spec.js`, `inline-spec.spec.js` |
| Fast internal `$ref` pass (equivalence with ref-parser, bailouts) | `deref.test.js` | `perf.spec.js` |
| Accepted schema inputs (JSON / YAML × URL / inline, OpenAPI + Swagger 2.0) | `loader-remote.test.js`, `loader-inline.test.js` | `bootstrap.spec.js`, `swagger2.spec.js`, `inline-spec.spec.js` |
| JSON Schema 2020-12 keywords (conditionals, pattern keys, dependencies, `$defs` names) | `model.test.js`, `sample.test.js`, `audit-rules-version.test.js` | `schema-keywords.spec.js` |
| `discriminator` (mapping resolution, parent-side `allOf`, variant pick) | `model.test.js`, `sample.test.js`, `audit-rules-correctness.test.js`, `audit-rules-version.test.js` | `polymorphism.spec.js` |
| Document metadata (`info`, `externalDocs`, response `links`) | `model.test.js`, `audit-rules-correctness.test.js`, `audit-rules-version.test.js` | `document-metadata.spec.js` |
| Tag sections (`summary` label, `parent` hierarchy incl. unknown parent and cycles, non-navigational `kind`) | `model.test.js` | `openapi-32.spec.js`, `navigation.spec.js` |
| Per-route `<head>` (title, meta description, JSON-LD), `seo.index` noindex | `head.test.js` | `head.spec.js` |
| Request fidelity (`encoding`, `allowReserved`, `allowEmptyValue`, cookie params, XML samples, `$self`, inline YAML) | `request-fidelity.test.js`, `sample-xml.test.js`, `loader-inline.test.js`, `send.test.js`, `exports.test.js`, `audit-rules-version.test.js` | `request-fidelity.spec.js` |
| Swagger 2.0 conversion (whole table, `$ref` rewrite, `collectionFormat`, security mapping, approximation audit) | `swagger2.test.js`, `model.test.js`, `loader-inline.test.js`, `audit-rules-version.test.js` | `swagger2.spec.js`, `bootstrap.spec.js` |
| Environments, `{{var}}` interpolation, colors | `env-store.test.js`, `interpolate.test.js`, `env-colors.test.js`, `json-template.test.js` | `environments.spec.js`, `env-locked.spec.js` |
| Environment setup link (codec, caps, merge plan, plan execution, scrub, preview, generation, from-scratch builder) | `env-setup-link.test.js`, `router.test.js` | `env-setup-link.spec.js`, `env-locked.spec.js`, `a11y.spec.js` |
| Auth from `securitySchemes`, credentials card | `auth.test.js` | `tryit.spec.js` |
| Host-provided credentials (`window.apidoc`, overlay, merge source, 401 replay) | `host-credentials.test.js`, `variable-source.test.js` | `host-credentials.spec.js` |
| OAuth2 (PKCE + client credentials) | `oauth.test.js`, `oauth-flow.test.js` | `oauth.spec.js` |
| Send pipeline, CORS proxy, request building | `send.test.js`, `request-builder.test.js` | `tryit.spec.js` |
| Operation/path-level `servers` precedence; cancelable send | `request-builder.test.js`, `model.test.js` | `tryit.spec.js` |
| Schema type → form field (arrays, objects, maps, tuples, enums) | `params.test.js`, `model.test.js`, `coerce.test.js` | `tryit.spec.js` |
| Parameter serialization (`style`/`explode`, deepObject) | `params.test.js`, `request-builder.test.js` | `tryit.spec.js` |
| Body kinds (binary/file, multipart, urlencoded) | `body-kind.test.js`, `request-builder.test.js`, `send.test.js` | `bodies.spec.js` |
| File contents never leave the tab (only name/size/type travel) | `file-containment.test.js` | `bodies.spec.js` |
| Doc↔panel mirror (rule 20: media type, variants, expand, every field) | — | `doc-panel-sync.spec.js`, `polymorphism.spec.js`, `bodies.spec.js`, `request-fidelity.spec.js` |
| History (IndexedDB), retention, replay | `history-store.test.js` | `history-export.spec.js` |
| Local metrics: recent-calls strip, most-used card (local scope stated, empty renders nothing) | `metrics.test.js` | `local-metrics.spec.js`, `a11y.spec.js` |
| Exports (cURL, Postman, Markdown, HAR, debug) + redaction | `exports.test.js`, `endpoint-markdown.test.js`, `redact.test.js` | `history-export.spec.js` |
| Request import (cURL paste, Postman v2.1, HAR) + operation matching | `import-parsers.test.js`, `import-match.test.js` | `import.spec.js`, `a11y.spec.js` |
| OpenAPI Overlay 1.0 (targets, update/remove, load wiring, diagnostics) | `overlay.test.js`, `specs.test.js` | `workflows.spec.js` |
| Page vs published file (overlays applied, operations hidden): the notes on the schema download and the audit's, the qualified `llms.txt` reference, the MCP warnings | `llms.test.js`, `mcp.test.js`, `hide.test.js` | `workflows.spec.js`, `user-overlay.spec.js`, `audit.spec.js` |
| User overlay (storage + cap, dry run, editor, badge, download, purge, the host's starting patch) | `user-overlay.test.js` | `user-overlay.spec.js`, `a11y.spec.js` |
| Arazzo 1.0 import (mapping matrix, export/import round trip) | `import-arazzo.test.js` | `workflows.spec.js` |
| Code snippets (10 languages) | `snippets.test.js` | `tryit.spec.js` |
| First touch: parameter prefill, blocked credential focus, generated onboarding page | `prefill.test.js` | `first-touch.spec.js`, `a11y.spec.js` |
| Scenarios: model, run, chaining, step-by-step | `scenario-*.test.js` | `scenarios.spec.js`, `scenarios-disabled.spec.js` |
| Scenario sharing + Arazzo export | `share.test.js`, `scenario-exports.test.js` | `scenarios.spec.js` |
| Declared scenarios: the two formats (envelope, Arazzo document) and the two carriers (`url`, `document`), workflow ids, degraded render (`docs/scenario-handoff.md` §2.1) | `scenario-loader.test.js`, `specs.test.js`, `scenario-roundtrip.test.js` | `workflows.spec.js` |
| Scenario hand-off: the Markdown mirror, `## Workflows` in `llms.txt`, the recipe inlined in `llms-full.txt` and baked as `scenario/….arazzo.json`, the publishable set (declared only) (`docs/scenario-handoff.md` §2–§3) | `scenario-markdown.test.js`, `scenario-completeness.test.js`, `shell-exports.test.js`, `llms.test.js`, `llms-full.test.js`, `bake.test.js` | `bootstrap.spec.js`, `workflows.spec.js` |
| CI hand-off panel: `CI_RUNNERS`, the two platforms' snippets, secrets as names only, degradation warnings (`docs/scenario-handoff.md` §4) | `ci.test.js` | `scenarios.spec.js`, `workflows.spec.js` |
| Multi-spec (config merge, isolation, routes) | `specs.test.js`, `router.test.js` | `multi-spec.spec.js` |
| Search palette | `search.test.js` | `navigation.spec.js`, `webhooks.spec.js` |
| Schema changelog (diff) + snapshot store | `diff.test.js`, `schema-snapshot.test.js` | `schema-changelog.spec.js` |
| Hiding operations (`x-apiglow-hide`, `openapi.hide`) | `hide.test.js` | — |
| Schema audit engine, rules, scoring (`docs/audit.md`) | `audit-engine.test.js`, `audit-rules-*.test.js`, `audit-petstore.test.js` | `audit.spec.js` |
| Schema audit report as Markdown | `audit-export.test.js` | `audit.spec.js` |
| Schema audit strings (one `message` / `why` / `label` per rule, en + fr) | `audit-strings.test.js` | — |
| Schema audit page: identity, jumps, help, folding by rule | — | `audit.spec.js`, `perf.spec.js` |
| Host feature switches (`features.audit`, `features.scenarios`, `features.ci`, `features.onboarding`): every entry point closed | — | `audit-disabled.spec.js`, `scenarios-disabled.spec.js`, `first-touch.spec.js` |
| Themes, languages, lazy i18n | `i18n.test.js`, `i18n-sync.test.js` | `theme-lang.spec.js` |
| Custom themes (config JSON + host CSS) | `custom-themes.test.js` | `custom-themes.spec.js` |
| Markdown pages, sanitization (rule 5, one hostile payload per external-HTML path) | — | `sanitize.spec.js`, `navigation.spec.js`, `bootstrap.spec.js` |
| Docs pages: entry kinds, groups, external links, manifest, i18n maps, bodies carried by the host page, changelog timeline, feedback row (`docs/docs-pages.md`) | `docs-pages.test.js`, `specs.test.js` | `docs-pages.spec.js` |
| Docs pages: `{{var}}` in prose — resolved, masked, missing, escaped (`docs/docs-pages.md` §12) | `docs-vars.test.js` | `docs-pages.spec.js`, `a11y.spec.js` |
| Webhooks, callbacks, simulator | `no-cors.test.js` | `webhooks.spec.js` |
| `llms-full.txt` export | `llms-full.test.js`, `export-completeness.test.js` | `bootstrap.spec.js` |
| `llms.txt` index export | `llms.test.js` | `bootstrap.spec.js` |
| Baked-install generators: `sitemap.xml`, the output layout and its file names, the HTML snapshot (escaped raw HTML, refused link schemes) (`docs/seo.md`) | `sitemap.test.js`, `snapshot-html.test.js`, `llms.test.js`, `llms-full.test.js` | — |
| `apiglow bake` CLI: config resolution, output tree, multi-spec nesting, the packaged bin, snapshots served without JavaScript | `bake.test.js` | `bake.spec.js` |
| MCP server config export (bridge table, auth placeholders) | `mcp.test.js` | `bootstrap.spec.js` |
| Agent hand-off: raw Markdown view, `claude mcp add` command, Cursor/VS Code install links, `llms.txt` in the nav | `mcp.test.js` | `history-export.spec.js`, `bootstrap.spec.js` |
| "Copy page" on a prose page: the page as authored, `{{var}}` as a template, MCP context following the environment | `docs-page-markdown.test.js` | `docs-pages.spec.js` |
| Preferences, header memory (localStorage) | `prefs.test.js`, `header-memory.test.js` | — |
| Settings panel: storage inventory, targeted purges, full reset | `maintenance.test.js` | `settings.spec.js` |
| Footer, About dialog, license and third-party notices | `credits.test.js` | `about.spec.js` |
| Parse/render performance budgets | — | `perf.spec.js` |
| Accessibility: axe sweep, focus return, tablist keys, live regions | — | `a11y.spec.js` |
| Keyboard sweep: every visible control reachable by Tab, a visible ring at every stop, skip link to `<main>`, scrolling blocks as declared tab stops, an open mobile panel the walk cannot leave | — | `keyboard.spec.js` |
| Reflow at 320 px and the reader's text-spacing stylesheet: no sideways scrolling, no text clipped below half, no box newly cut short vertically | — | `reflow.spec.js` |
| Browser support baseline: degradation when an above-floor API is absent | — | `baseline.spec.js` |
| Demo API mock (service worker), demo page wiring | — | `demo.spec.js` |
| Demo failure showcase (`errors` tag: 429 chip, structured 422, 500) | `audit-petstore.test.js` (snapshot) | `demo.spec.js` |
| Demo OAuth in-worker (all four flows, consent page), witness-spec laziness | — | `demo.spec.js` |
| Demo config parity (invariant 19) | `demo-parity.test.js` | — |

`src/components/` has no unit tests by design — it is DOM, covered by the
e2e column.

## Commit messages

The format is `type(scope): subject`, with the usual conventional types
(`feat`, `fix`, `refactor`, `docs`, `test`, `chore`) and the feature area
as scope (`docs-pages`, `scenarios`, `export`, …) — two scopes,
comma-separated, when a change genuinely spans two. In English (rule 17).
What a commit contains — how big, how many concerns — is left to the
author's judgment; only the message format is conventioned.

The subject is where this repo differs from the mechanical norm: it is a
meaningful phrase about the product, not a description of the diff. State
the behavior that is now true, or the invariant that was at stake —
`git log --oneline` should read as the product's story, not as a list of
file operations. Lowercase, no trailing period.

```
feat(docs-pages): a prose page can take the landing spot
fix(docs-pages): the API overview entry has to be findable
refactor(overlay,arazzo): say what the guards guard, and decide before walking
docs(specs): a version watch needs a URL that answers
```

The body is optional for the self-evident. Everywhere else it carries the
why, as prose paragraphs (no bullet lists of files): the problem as it was
observed, the decision taken and its reason, the consequences that are not
obvious from the code. The comment policy above applies to commit bodies
too — anything that merely paraphrases the diff is noise.

## Pull requests

- Keep unrelated changes out of the PR; mechanical reformatting goes in its
  own commit.
- A feature PR includes its test (rule 16) and, if it stores anything, its
  storage policy (rule 13).
- If your change contradicts a design-rationale entry
  ([architecture §14](docs/architecture.md#14-design-rationale)), say so explicitly and
  make the case for revisiting the decision — don't work around it
  silently.
