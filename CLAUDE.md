# CLAUDE.md

## Project

100 % front-end interactive API documentation ("web Postman" / Swagger++),
generated at runtime from an OpenAPI schema, distributed via CDN as a single
`<script>`.

**`docs/architecture.md` is the functional source of truth** (with
`docs/scenarios.md` and `docs/multi-spec.md`). Read it before substantial
work. Design rationale: `docs/architecture.md` §14. Contributor guide: `CONTRIBUTING.md`.

## Commands

- `npm run dev` — Vite dev server (unbundled ESM sources)
- `npm run build` — two passes that share nothing: the browser bundle
  (`dist/app.js`, `dist/app.css`, `dist/i18n/*.json`, `dist/fonts/`) and the
  author-side bake CLI (`dist/bake.js`, shipped as the `apiglow` bin —
  `docs/seo.md` §4)
- `npm test` — Vitest (pure core only); must be green before any commit
  touching the core
- `npm run test:e2e` — Playwright (Chromium) against the CDN simulation;
  fixtures in `tests/e2e/fixtures/`
- `npm run preview:cdn` — serves the packed tarball statically to simulate
  the CDN install; refuses to start if `demo/cdn-install.html` and
  `package.json` disagree on the version
- `npm run lint` / `npm run lint:fix` — Biome (format + lint); CI runs
  `biome ci` and it must be green
- `npm run check:invariants`, `check:dist`, `check:syntax` — the gates CI
  enforces on top of the suites; green unit tests alone do not mean a change
  is committable. What each one covers: `CONTRIBUTING.md`

Both demo pages get their API from `demo/mock-sw.js`, a service worker
answering `/demo-api/v3` in the browser (see CONTRIBUTING). The e2e suite
does not use it.

## Stack (pinned)

- Vite (dev + lib build), Tailwind CSS 4, daisyUI 5 — exact versions frozen
  in `package.json`.
- Vanilla JS ESM, Web Components in **light DOM**, zero framework, zero
  state-management lib.
- Runtime dependencies: `@apidevtools/json-schema-ref-parser`, `marked`,
  `dompurify`, `highlight.js`, `json-p3`, plus what **spec/format work**
  justifies
  (`docs/architecture.md` §14.2). A new one
  is allowed only if it reads/transforms/queries/emits a document of a
  claimed spec, **and** we actually want that whole job done — a bounded
  subset kept on purpose stays a subset, and the library is refused
  (standing case: no Ajv, body validation is minimal by choice). Serious,
  browser-ready, exactly pinned, weight stated in `docs/architecture.md` §2.
  Everywhere
  else — UI, state, utilities — build on the platform.
- daisyUI skill: check it is available before writing component code;
  otherwise install it (https://daisyui.com/docs/skill/). `skills-lock.json`
  at the repo root pins the installed skill for agent environments.

## Imperative rules (anti-footguns)

Rationale for each lives in `CONTRIBUTING.md` and `docs/architecture.md` §14.

1. **Never Shadow DOM.** Light DOM + class-convention scoping.
2. **Never dynamically built Tailwind/daisyUI classes** (`badge-${x}` is
   banned — the JIT purge deletes them). Always explicit static maps, e.g.
   `{ GET: 'badge-success', POST: 'badge-info', DELETE: 'badge-error', … }`.
3. **The built CSS includes all standard daisyUI themes** (Tailwind/daisyUI
   config accordingly), otherwise `theme.available` silently breaks for end
   users.
4. **All runtime asset paths** (`app.css`, `i18n/*.json`) resolve via
   `new URL('./…', import.meta.url)`. **Never `document.currentScript`**
   (null in an ES module). Verify the Vite build preserves this.
5. **All HTML from external content** (OpenAPI descriptions, examples,
   `.md`, scenario files) goes through DOMPurify. No unsanitized
   `innerHTML`, no `eval`/`new Function`.
6. **Rendering consumes only the internal normalized model**
   (`src/openapi/model.js`), never the raw OpenAPI schema. No `if (isV31)`
   branch outside normalization.
7. **Recursive schemas**: lazy expansion with max depth, cycle detection.
   No unbounded recursion, in the model or in the rendering.
8. **Storage**: history/scenarios/snapshots = IndexedDB;
   environments/preferences/theme/language = localStorage. No other
   mechanism, no dual paths. Storage keys and DB names keep the
   name-neutral `apidoc` prefix (`docs/architecture.md` §14.11).
9. **Every UI string via `t('key')`** — zero hardcoded text in components.
   English is bundled as the fallback; `i18n/fr.json` is a shipped feature
   (keep `en`/`fr` keys in sync), never "French debt".
10. **Core vs shell**: `src/app.js` (bootstrap) is the only module reading
    the host config and branding. The core (`openapi/`, `components/`,
    `scenarios/`, `storage/`, `export/`, `i18n/`, …) never sees the host
    config directly.
11. **`{{var}}` interpolation**: missing variable = send blocked + visible
    signal. Never send the literal.
12. **Exports**: generators = pure functions in `src/export/`,
    snapshot-tested. Sensitive values redacted by default.
13. **Bounded storage**: every persisted dataset declares its policy
    (TTL + cap, hard cap, or LRU) and documents it in
    `docs/architecture.md`.
14. **Performance is a feature**: the perf e2e budgets are a contract, not
    a knob to loosen when a change regresses.
15. **Accessibility is mandatory**: keyboard-operable components, focus
    returned on dialog close, live regions for async outcomes, i18n'd
    `aria-*`. Shared primitives in `src/components/a11y.js`; the axe sweep
    (`tests/e2e/a11y.spec.js`) stays green. Model + the one documented
    waiver: `docs/architecture.md` §12.
16. **Every feature has at least one test** (core logic → Vitest; UI
    behavior → Playwright against the packed bundle). The feature→test map
    lives in `CONTRIBUTING.md`.
17. **English-only codebase, bilingual product**: code, comments, tests,
    docs and commit messages in English; `i18n/fr.json` is the only
    sanctioned French, and it is a feature.
18. **Biome is the arbiter of style** (`biome.jsonc`). Don't hand-argue
    formatting, and don't reformat untouched code inside a feature change.
19. **Maximal OpenAPI spec support is a priority and an obligation.** An
    unsupported construct of a supported OpenAPI version is a defect, not a
    scope choice: model it and render it, or degrade with an explicit,
    documented fallback when the browser platform forbids execution. When
    versions conflict on a concept, normalize to the newest version's
    semantics. Coverage contract: `docs/openapi-coverage.md`.
20. **The doc↔panel mirror: the try-it panel is the single source of
    truth, the central doc holds no choice of its own.** Doc-side widgets
    render from the panel's `tryit-state` and push edits up through
    `tryit-edit`, never acting locally — drift between the two columns is
    silent, so before touching any editable surface read the mechanics in
    `docs/architecture.md` §5.5.4, and extend the guard
    (`tests/e2e/doc-panel-sync.spec.js`) with every new one.

## Process

- **`README.md` is the shop window, written for humans only** — it
  demonstrates and convinces; reference material lives in `docs/` and
  `config.example.js`, never in the README. Don't grow it with feature
  enumeration or config semantics: add one pitch line + a docs link, or
  nothing. Its assets are reproducible: `.github/readme/CAPTURE.md`.

- **Documents describe state, never history** (doctrine in
  `CONTRIBUTING.md`): no dates on decisions, no process narration, no
  references to documents outside the tree.
- Comments carry only non-obvious rationale (comment policy in
  `CONTRIBUTING.md`). Existing comments are the design record — never strip
  them in a refactor.
- Snapshots: regenerate deliberately and review the diff; never a blind
  `-u`.
- e2e validates the packed tarball: after touching the build config,
  `package.json` `files`/`exports`, or `scripts/`, run `npm run test:e2e`
  even if unit tests pass.
- When a functional question isn't answered by `docs/`, prefer the simplest
  option and record it (a `docs/architecture.md` §14 entry if the decision
  is structural).
