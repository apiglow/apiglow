# App health registry — the critical paths and their guard net

Maintained by the `/app-health` skill (`.claude/skills/app-health/SKILL.md`).
One row per critical functional path — a path whose regression is silent
for the maintainer but fatal for a user. Every `/app-health` run reads this
file first and updates it last; it is what makes the runs idempotent.

**Active plan**: none

Verdicts: **green** = well-guarded, **partial** = guarded on a fraction of
the surface, **red** = unguarded.

| Critical path | Silent failure if it regresses | Main modules | Guards | Verdict |
|---|---|---|---|---|
| CDN bootstrap & single-file dist | every install gets a blank/unstyled page on the next publish | `src/app.js`, `vite.config.js`, `scripts/preview-cdn.mjs` | `tests/e2e/bootstrap.spec.js`, `inline-spec.spec.js`, whole e2e suite runs against the packed tarball (architecture.md §14.12); `scripts/check-dist.mjs` — one JS file, no `document.currentScript`, theme count, size caps | green |
| Doc↔try-it-panel mirror (rule 20) | the two columns edit different requests; page stays plausible | `api-try-it-panel.js` (`currentValues`/`applyDocEdit`), `api-endpoint-doc.js` (`#applyTryItValues`), `schema-view.js` | `tests/e2e/doc-panel-sync.spec.js` (9 tests: params of every shape incl. header + `querystring`, body fields at depth, expand, recursive subtree, free-form map, tuple, response status tabs, media type → variant → fields ordering) + mirror tests in `bodies`/`polymorphism`/`request-fidelity`; invariant 1 static key parity | green |
| `{{var}}` blocks sends (rule 11) | literal `{{token}}` sent to production | `src/env/interpolate.js`, `json-template.js`, `request-builder.js`, `send.js`, `scenarios/runner.js`, `api-webhook-simulator.js` | unit: `interpolate`/`json-template`/`request-builder`/`send`/`scenario-runner`; e2e: `tryit`, `scenarios`, `a11y`, and `webhooks.spec.js` — the simulator resolves the environment's variables and blocks on an unresolved one | green |
| DOMPurify on all external HTML (rule 5) | stored XSS from any description/example/imported file | `src/components/markdown.js` (only DOMPurify call sites) + its consumers | `tests/e2e/sanitize.spec.js` — the same hostile payload down six paths (remote `.md`, imported scenario description + step note, example value, nested property description, audit page, request-body description), each asserting the script never ran AND the legitimate Markdown still rendered; plus `bootstrap.spec.js`, `navigation.spec.js` | green |
| Send pipeline & param serialization | wrong bytes on the wire — the core promise | `send.js`, `request-builder.js`, `params.js`, `coerce.js`, `body-kind.js`, `no-cors.js` | 8 unit files (`file-containment.test.js` included) + `request-fidelity` snapshot; e2e: `tryit` (36 tests, `tryIt.requestCredentials` asserted on the wire through the browser's own credentialed-CORS rule), `bodies`, `request-fidelity`, `openapi-32`, `webhooks` | green |
| Normalized model, version absorption, cycles (rules 6/7/19) | a 3.1/3.2 construct renders empty; recursive schema hangs the tab | `model.js`, `loader.js`, `sample.js`, `sample-xml.js`, `schema-view.js` depth caps | `model.test.js` + snapshot, `sample`/`sample-xml`/`loader-inline`/`coerce` tests; e2e: `openapi-32`, `schema-keywords`, `polymorphism`, `document-metadata`, `doc-panel-sync` | green |
| User overlay (architecture.md §14.17) | a reader's patch silently stops applying, or the host's updated patch fails to re-seed and the reader argues with a stale schema | `src/openapi/user-overlay.js` (read/write/cap/validation/dry run/seed), `openapi/loader.js` (`seedFromHost`), `specs.js` (per-spec `openapi.userOverlay`), `storage/prefs.js`, the `settings-panel.js` editor, the `shell/toolbar.js` badge | `user-overlay.test.js` (29); e2e `user-overlay.spec.js` (14 tests, the two testable §14.17 decisions among them — JSON-only refused with its reason, and the host's patch re-seeding a reader's copy while a *removal* survives), `a11y.spec.js`, `specs.test.js` (per-spec resolution). The third decision — no config flag disables the editor — is guarded by absence: `config.js` declares no such switch, so one added later would ship untested | green |
| Storage bounds (rule 13) | QuotaExceeded, or "erase everything" reports success while leaving data | `src/storage/*` (`history`, `scenarios`, `schema-snapshot`, `header-memory`, `maintenance`) | per-store unit tests on `fake-indexeddb`, retention **boundaries** included (exactly `maxEntries`, an entry a minute inside the age window); `maintenance.test.js` seeds all six datasets before the erase, so a purge that never reaches one fails; e2e: `settings.spec.js`, `history-export.spec.js`, `schema-changelog.spec.js` (the LRU never evicts the document being read) | green |
| Export redaction (rule 12) | a bearer token leaks into a pasted cURL | `src/export/redact.js` + 12 generators | `redact.test.js`, per-generator snapshot tests; e2e: `history-export.spec.js` (17 tests), `scenarios.spec.js` | green |
| llms-full & model-derived export completeness | the doc renders a new construct but the export omits it — LLM consumers get an incomplete API picture while the UI looks right | `src/export/llms-full.js`, `endpoint-markdown.js`, `markdown.js` | `export-completeness.test.js` — walks the normalized model's own keys into `toEndpointMarkdown`/`toLlmsFullText`/`toLlmsText` and fails on any key neither emitted nor waived; plus the three snapshots. The remaining generators are request-derived (they take a history entry, not the model) and are covered by `redact`/`file-containment`/snapshot tests | green |
| i18n en/fr sync, zero hardcoded strings (rule 9) | French users see raw keys; en-speaking maintainer never sees it | `src/i18n/`, `src/i18n/en.json`, `i18n/fr.json` | `tests/i18n-sync.test.js` — en/fr parity both ways, every spelled-out `t()` key resolves, no orphan key (dynamic key families derived from the source, with a test guarding that derivation against becoming vacuous); invariant 5 in `check-invariants.mjs` for hardcoded text nodes and attributes; `i18n.test.js` (fallback); e2e `theme-lang`, `about` | green |
| All daisyUI themes in built CSS (rule 3) | host lists a theme, selector shows it, clicking does nothing | `src/styles/app.css` (`themes: all` — the entire guarantee), `theme-switcher.js`, `src/theming/custom-themes.js` | `scripts/check-dist.mjs` counts `[data-theme=` blocks in the built CSS (35, daisyUI 5.7); `theme-lang.spec.js` switches to `corporate` and reads real computed colors — the attribute alone flips even on a bundle built without `themes: all` | green |
| Accessibility (rule 15) | keyboard users lose the app; focus stranded on dialog close | `src/components/a11y.js` + all components | `tests/e2e/a11y.spec.js` (18 tests, axe over 14 surfaces, env manager, scenario step editor and search-palette results included), `about`/`mobile` focus tests | green |
| Performance budgets (rule 14) | heavy schema = white screen; only large-API hosts notice | budgets in `tests/e2e/perf.spec.js`, hot code in `model.js`/`api-nav.js`/`schema-view.js`/`audit/engine.js`/`diff.js` | `perf.spec.js` (5 tests: boot, diff, audit render, search-palette answer, deep recursive body editors); bundle-size caps in `check-dist.mjs`; invariant 18 — every budget constant has a recorded ceiling, so loosening one is a two-file commit and deleting one fails | green |
| Indexability: runtime head + bake (architecture.md §14.18) | shared links, tabs and history all carry the host page's one static title; or baked files disagree with the app and the site publishes a second, wrong source of truth | `src/shell/head.js` (`headFor` pure, `applyHead` the only DOM write), `scripts/bake.mjs` → `dist/bake.js` via `vite.bake.config.js`, and the §5.14 export layer it writes to disk (`export/site-layout.js`, `snapshot-html.js`, `sitemap.js`, `llms.js`, `llms-full.js`, `docs-page-markdown.js`) | `head.test.js` (22), `bake.test.js` (14) + its snapshot; e2e `head.spec.js` (6), `bake.spec.js` (5) over the baked fixtures in `tests/e2e/baked/`. The bake stays honest by sharing the in-app "Copy page" generators — the export snapshots move for both at once — and refuses to run against `seo: { index: false }` (`bake.mjs:384`); `check-dist.mjs` holds `dist/bake.js` in `EXPECTED_JS` with its shebang (invariant 8) | green |
| Multi-spec isolation | credential from spec A injected into a request to spec B | `src/specs.js`, `router.js`, `storage/prefs.js` (`setSpecScope`), `env/store.js` | `specs.test.js`, `router.test.js`; e2e: `multi-spec.spec.js` (8 tests, maps to `docs/multi-spec.md` §7) | green |
| Scenarios (model/runner/chaining) | chained variable resolves to the previous run's value | `src/scenarios/*` + scenario components | 9 unit files + export snapshots; e2e: `scenarios.spec.js` (37 tests), `scenarios-disabled`, `demo` | green |
| Auth / credentials / OAuth2 | Authorization never injected → every try-it 401s, user blames the API | `auth.js`, `oauth.js`, `oauth-flow.js`, `credentials-form.js` | `auth`/`oauth`/`oauth-flow` tests (scheme keys with dots, dashes and uppercase resolve to the variable names the card asks for); e2e: `oauth.spec.js` (mock server round-trip, plus a two-spec return proving the token lands in the spec that started the login), `tryit`, `environments`, `env-locked` | green |
| Schema audit engine & rules | a rule silently stops firing, or ships without i18n strings | `src/audit/*` (39 rule files), `audit-report.js` | engine + 6 rule test files + petstore snapshot + registry-driven `audit-strings.test.js`; e2e: `audit.spec.js` (13 tests) | green |
| Swagger 2.0 conversion | a 2.0 construct reaches the model and renders empty (§5.1.1: converter bug by definition) | `src/openapi/swagger2.js` | `swagger2.test.js` + 35 KB snapshot (largest in repo), `conversion-approximation` fixtures in `audit-rules-version.test.js`; e2e: `swagger2.spec.js` | green |
| History persistence & replay | history writes silently fail, or replay rebuilds the wrong request | `storage/history.js`, `request-history-list.js`, run selector in panel | `history-store.test.js`; e2e: `history-export.spec.js` (17 tests) | green |
| Routing, deep links, share, search | shared link opens a different request than the one shared | `router.js`, `export/share.js`, `search/`, `search-palette.js` | `router`/`search`/`share` tests; e2e: `navigation.spec.js` (12 tests, including a share link opened in a **fresh browser context** and compared field for field) | green |
| Docs pages (`docsPages` is a host contract) | a host-declared page silently absent from nav/palette/exports, or an operation reference in prose deep-linking to the wrong endpoint | `src/docs/*` (`pages`, `operations`, `sections`, `vars`, `markdown`), `src/shell/docs.js` (the fetching half), `components/docs-content.js`, `docs-source.js`, `export/docs-page-markdown.js` | unit: `docs-pages` (48), `docs-sections` (18), `docs-operations` (15), `docs-vars` (15), `docs-markdown` (12), `docs-page-markdown` (9), `specs.test.js:241-274` (per-spec merge); e2e: `docs-pages.spec.js` (61 tests, manifest form and a manifest that fails to load included), `navigation.spec.js:17,65,94,108`, `bootstrap.spec.js:122,136`, `sanitize.spec.js` (remote `.md`), `a11y.spec.js` | green |
| Schema changelog / diff / snapshot LRU | "schema changed" badge stops appearing or points at the wrong field | `diff.js`, `storage/schema-snapshot.js`, `schema-changelog.js`, `change-badge.js` | `diff`/`schema-snapshot` tests; e2e: `schema-changelog.spec.js` (5 tests — in-situ marking, removals in the modal, the unchanged second visit, the version-only note, and the LRU that never evicts the document being read) | green |
| Settings / storage inventory / reset | inventory hides a dataset; reset reports success while leaving data | `settings-panel.js`, `storage/maintenance.js` | `maintenance.test.js` (16 tests; the erase seeds every declared dataset and asserts each holds something first), e2e `settings.spec.js` (7 tests) | green |
| Body kinds & file handling | multipart/urlencoded/binary built wrong; a `File` leaks out of tab memory | `body-kind.js`, editors in panel + `schema-view.js` | `body-kind`/`request-builder`/`send` tests; e2e: `bodies.spec.js` (10 tests), `swagger2.spec.js` | green |
| Mobile shell | drawer/bottom-sheet unusable on phones | `src/app.js`, `api-nav.js`, panel | `tests/e2e/mobile.spec.js` (9 tests), `about`/`scenarios` mobile tests | green |
| Environments CRUD / locked mode | env vars lost or editable when the host locked them | `env/store.js`, `env/colors.js`, `env-manager.js` | `env-store`/`env-colors` tests; e2e: `environments.spec.js` (9), `env-locked.spec.js` (5) | green |
| Credits / shipped deps (architecture.md §14.2) | a new runtime dep ships uncredited | `src/credits.js`, `about-dialog.js` | `credits.test.js` — checks the declaration against `package.json` + `LICENSE`. **The model guard: self-enforcing, non-tautological.** | green |
| Hidden operations (`x-apiglow-hide`) | an operation the host hid reappears in nav/search/exports | `src/openapi/hide.js` (filters in normalization) | `hide.test.js` — hiding at normalization **and** downstream: absent from the search index, from `llms-full`, from the nav order the pager walks, and without a fingerprint for the changelog to name it with; partial e2e via `audit.spec.js` | green |
| Feature switches (`features.scenarios`, `features.audit`) | a disabled feature stays reachable (deep link, search, exports) or keeps computing/storing — the host's choice is only cosmetic | `src/app.js` (both flags gate at boot) | `expectFeatureUnreachable` in `tests/e2e/helpers.js` — six entry classes (nav, in-page, routes, search, exports, elements), and it refuses to run when a caller leaves one unanswered, so the next flag inherits the sweep; consumed by `scenarios-disabled.spec.js` and `audit-disabled.spec.js` | green |
| Preferences & header memory | remembered headers/columns silently stop persisting | `storage/prefs.js`, `storage/header-memory.js` | `prefs`/`header-memory` tests; e2e in `tryit.spec.js` — a header typed once follows the user to another operation and across a reload (and is forgotten when cleared), a resized column keeps its width; both fail when the write call is removed | green |

## Recorded gaps

**None.** Every row above is green, every invariant is enforced by a
permanent check or carries a validated waiver, and no plan is active. The
next `/app-health` run starts from a net with no known hole — its job is
drift, not backlog.

The backlog that does exist is future surface, not a present hole:
`docs/plan/scenarios-roadmap.md` (untracked — `docs/plan/` holds plans,
never committed) describes work not
yet written. It is no app-health gap today — but it will add rows
or widen existing ones the moment a workstream lands, and the run after
that landing is the one that has to say so.

Two things worth remembering rather than re-deriving:

- **A plan's evidence expires.** A session can describe a gap its own
  cited files no longer have — or a guard for a mechanism the code never
  had, where "test the block" is really "build the block". Re-reading the
  evidence at execution time is what catches both, and what turns the
  second into a user decision instead of an invented guard.
- **Opening a surface to a guard is how you find its defects.** A guard
  whose first run is green tells you less than one that isn't: a new
  sweep is allowed to fail, and a first-run failure is the guard doing
  its job.

## Cross-cutting invariants

Home of the statically checkable ones: `scripts/check-invariants.mjs`, run
by CI and by `npm run check:invariants`; the post-build ones live in
`scripts/check-dist.mjs`. Both are documented in `CONTRIBUTING.md`, so
a contributor can run locally the gates that would fail their PR. Every
invariant below is enforced or carries a validated waiver: a standard run
verifies the scripts still cover this list rather than re-deriving the
checks by hand.

| # | Invariant | Checkable | Enforced by |
|---|---|---|---|
| 1 | Every `currentValues()` key has a consumer in `#applyTryItValues()`; every `tryit-edit` `kind` has a branch in `applyDocEdit()` (rule 20) | static (literal keys both sides) | `scripts/check-invariants.mjs` |
| 2 | No dynamically built Tailwind/daisyUI class (rule 2) | static (regex) | `scripts/check-invariants.mjs` |
| 3 | No `innerHTML` from a non-constant expression outside `sanitize()`/`highlightSource()`/static SVG (rule 5) | static (whitelist) | `scripts/check-invariants.mjs` |
| 4 | Every IndexedDB database is declared in `storageInventory()` (rule 13; localStorage self-heals via prefix sweep) | static (`indexedDB.open` sites vs `DATASETS`) | `scripts/check-invariants.mjs` |
| 5 | No hardcoded user-visible string in components; every `t()` key exists; no orphan `en.json` key (rule 9) | heuristic static | `scripts/check-invariants.mjs` (hardcoded text/attributes) + `tests/i18n-sync.test.js` (unknown keys, orphans, en/fr parity) |
| 6 | Every export generator defaults to `redact = true` (rule 12) | static | `scripts/check-invariants.mjs` |
| 7 | Built CSS ships every standard daisyUI theme (rule 3) | post-build (`[data-theme=` count) | `scripts/check-dist.mjs` |
| 8 | `dist/` has exactly one JS file; `document.currentScript` absent; bundle-size budget (rules 4/8) | post-build | `scripts/check-dist.mjs` |
| 9 | Core never reads host config (rule 10); no version branch outside normalization (rule 6) | static (regex) | `scripts/check-invariants.mjs` |
| 10 | Every file in `src/audit/rules/` is registered in `rules/index.js` | static | `scripts/check-invariants.mjs` |
| 11 | `CONTRIBUTING.md` feature→test map: files exist, every e2e spec is mapped | static | `scripts/check-invariants.mjs` |
| 12 | `docs/architecture.md` §6.2 key table matches `storage/maintenance.js` | static (parse table) | `scripts/check-invariants.mjs` |
| 13 | File contents never reach an export/share/scenario payload | needs a targeted test, not static | `tests/file-containment.test.js` — a real `File` through `buildRequest`, then a deep scan of history, the five generators and a share link |
| 14 | No blind snapshot blessing (35 KB `swagger2` snap is the exposure) | process / CI heuristic | **waived** (see Waivers) — CLAUDE.md rule + review |
| 15 | No `attachShadow` / `shadowRoot` anywhere in `src/` — components stay light DOM, scoped by class convention (rule 1, architecture.md §14.1) | static (regex) | `scripts/check-invariants.mjs` |
| 16 | `docs/architecture.md` still describes the code for every section a registry row cites — the doc is the functional source of truth | reading, not static | the standard run's docs-coherence drift bullet |
| 17 | CI runs every guard family this registry cites: `npm test`, the e2e suite, and each `scripts/` check a ratchet installs appear in `.github/workflows/` | static (parse workflows) | `scripts/check-invariants.mjs` |
| 18 | Performance budgets only ever tighten, and none disappears (rule 14) | static (constants vs recorded ceilings) | `scripts/check-invariants.mjs` |
| 19 | The two demo pages carry the same config, outside the documented deltas (docsPages carrier, bundle URL) | static (parse both inline configs) | `scripts/check-invariants.mjs` (`scripts/health/demo-parity.mjs`) + `tests/demo-parity.test.js` (red test) |
| 20 | The runtime dependency set is exactly the five pinned names (§14.2) — changing it is a human checkpoint, recorded as a two-file commit | static (package.json vs recorded list) | `scripts/check-invariants.mjs` |
| 21 | Frozen public surfaces (tags, events, `apidoc…` names, IndexedDB stores, i18n keys) match the committed snapshot — a rename is a breaking change, never a refactor | static (pattern sweep vs `public-surface.json`) | `scripts/check-public-surface.mjs` |

Invariant 18 guards the guards' own numbers: rule 14 calls the budgets a
contract, and the cheapest way to break one is to edit the constant next to
the failing assertion. Recording each ceiling in `check-invariants.mjs` makes
a loosening a two-file commit — visible in review — while tightening stays
free.

Invariant 16 is the only reading check in the table: no script can judge
whether prose still describes behavior, so it lives in the standard run's
drift check rather than in `check-invariants.mjs`. Invariant 17 is what
keeps the ratchet contract honest — every ratchet promises its guard is
wired into what CI runs, and a guard CI quietly stopped running is a
guard in name only.

Invariant 15 is the one whose breach leaves no trace at all: `attachShadow`
in a new component passes every test and moves no snapshot, then voids the
styling contract at the host — the built CSS cannot cross a shadow
boundary, and the component renders fine in the demo.
`src/` has zero occurrences today; the check is what keeps it that way.

## Waivers

Gaps deliberately left unguarded. Each entry states its rationale and
carries the user's validation; `/app-health` re-checks on every run that
the rationale still holds.

- **A11y — color-contrast not gated** (documented in
  `docs/architecture.md` §12): measured but not failing the sweep; themes
  are daisyUI's, not ours.

- **Invariant 14 — no blind snapshot blessing** (waived): it stays a process
  rule (CLAUDE.md "regenerate deliberately and review the diff", restated in
  `CONTRIBUTING.md`), enforced by review rather than by CI. No script can
  tell a reviewed regeneration from a blind one; the only candidate guard —
  failing a PR whose diff touches `tests/__snapshots__/` without an
  explanatory commit body — taxes every legitimate snapshot commit and is
  satisfied by one word, so it would buy the appearance of enforcement
  rather than enforcement. Reopens if a regression ever ships through a
  blessed snapshot, or if the 35 KB `swagger2` snapshot is split into
  per-construct snapshots small enough to review line by line (the real
  fix, and a project of its own).

<!-- Template:
- **{path} — {gap}**: {why guarding it is not worth it or not possible;
  what would reopen the question}.
-->
