# Cross-browser testing — the contract

Goal: guarantee that the distributed bundle works for the ~97–98% of real
users the baseline covers (§2), through two complementary levers:

1. **A declared support baseline enforced at build time** — the only honest
   answer to "old browser versions", since Playwright only ever ships one
   version of each engine.
2. **The full e2e suite running on the three browser engines** (Chromium,
   Firefox, WebKit) **plus two emulated mobile devices** in CI — catching
   real engine divergences on the current versions.

Scope guard: the multi-engine matrix is **CI-only**. Local development and
agent runs keep the single-Chromium behavior (`npm run test:e2e`); running
five projects locally is opt-in (`test:e2e:all`).

## 1. Decisions

- **Three engines via Playwright on `ubuntu-latest`.** No macOS runner
  (Playwright's Linux WebKit is an engine-accurate Safari approximation;
  real-Safari-only bugs are accepted residual risk, revisit only on a real
  user report). No branded `chrome`/`msedge` channels (their deltas are
  codecs/DRM, irrelevant here). No cloud grid (BrowserStack et al.):
  paid, slow, flaky, and redundant with the baseline lever for a
  front-end-only bundle.
- **Old versions are handled statically, not executed.** Declared
  browserslist baseline + build target derived from it + syntax tripwire
  on the built artifact. Running old versions is explicitly out of scope.
- **Full suite, every PR and every push to main.** Jobs are parallel, so
  wall-clock time is unchanged; only runner minutes grow. No
  label-gating, no nightly-only matrix: a Firefox regression must block
  the PR that introduces it.
- **Mobile is first-class, not a later tier**: two emulated device
  projects, same CI-only rule. Emulation (viewport, touch, UA, DPR) — not
  real devices; that is the accepted fidelity level.
- **Local default stays Chromium-only.** Agents and dev loops never pay
  the 5× cost by accident.

The a11y sweep and perf budgets stay green on their pinned project, and a
perf budget is never weakened to accommodate an engine (rule 14): budgets
are a Chromium-calibrated contract, see §4.3.

## 2. Support policy (the baseline)

**Chrome/Edge ≥ 111, Firefox ≥ 128, Safari/iOS ≥ 16.4.**

This is exactly the Tailwind CSS 4 / daisyUI 5 floor — the stack already
imposes it, so declaring anything looser would be a lie — and it matches
the web-platform "widely available" Baseline (~30 months). Combined with
evergreen auto-update on Chrome/Edge/Firefox, this covers ~97–98% of
global traffic; the residual is browsers the CSS layer already cannot
serve.

Enforcement chain (single source of truth: the `browserslist` field in
`package.json`):

1. `browserslist`: `["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4", "ios_saf >= 16.4"]`.
2. Vite `build.target` is derived from it via `browserslist-to-esbuild`
   (a devDependency — the closed-runtime-dependencies rule restricts
   *runtime* deps only), never hardcoded.
3. CI tripwire in the quality job: `es-check` validates `dist/app.js`
   syntax after build, catching a config regression that would silently
   ship too-new syntax.

Runtime *API* compatibility (as opposed to syntax) is covered by the live
three-engine matrix for current versions, and by the baseline floor being
recent enough that our used APIs (dialog, structuredClone, `:has`, ES2022)
are all within it — audited against the floor and documented in
`docs/architecture.md` ("Browser support"). An API above the floor is
feature-detected and degraded, never called unconditionally (§4.5).

## 3. Architecture

### 3.1 Playwright projects

| Project | Engine | Device profile | Runs |
|---|---|---|---|
| `chromium` | Chromium | Desktop Chrome | full suite − `mobile.spec` (incl. `perf.spec`, `a11y.spec`) |
| `firefox` | Firefox | Desktop Firefox | full suite − `perf.spec` − `mobile.spec` |
| `webkit` | WebKit | Desktop Safari | full suite − `perf.spec` − `mobile.spec` |
| `mobile-chrome` | Chromium | Pixel 7 | full suite − `perf.spec` |
| `mobile-safari` | WebKit | iPhone 14 | full suite − `perf.spec` |

The mobile projects run the desktop suite **plus** `mobile.spec.js` — the
one file whose subject is the emulated device itself, which is why every
desktop project ignores it — rather
than a hand-picked subset: what they check is that the drawer/sheet layout
serves the whole product. That works because the shared helpers
(`tests/e2e/helpers.js`) open whatever hides the thing a desktop-written
spec reaches for — `openDrawerIfMobile`, `openTryItIfMobile`,
`closeMobilePanels`, `clickInDoc` — and are no-ops above the breakpoint.
Two rules they encode:

- a panel's open state is its `is-open` class, never `isVisible()`:
  `visibility` stays `visible` for the whole 0.25 s slide-out, so a panel the
  app has just closed still reads as open;
- a panel is ready when its `transform` reaches `none`, not when it becomes
  visible — Playwright refuses to click a moving target.

### 3.2 npm scripts

- `test:e2e` → `playwright test --project=chromium` (the local/agent
  default).
- `test:e2e:all` → `playwright test` (all five projects; requires
  `npx playwright install firefox webkit` locally).

`test:e2e:all` pins `--workers=4`. Firefox and WebKit contexts are far
heavier than Chromium's, and at Playwright's default worker count (half
the cores) a full local run loses a shifting handful of tests to resource
contention — never the same ones, never reproducible in isolation, and not
fixable by raising timeouts (the failures are contention, not slowness).
CI is unaffected: each engine gets its own runner. Even at 4 workers an
occasional full run still trips on contention; if that becomes a nuisance
locally, run one project at a time (`npx playwright test --project=webkit`)
rather than loosening a timeout.

Local WebKit on Ubuntu: `npx playwright install webkit` leaves three
system libraries out (`libavif16`, `libgav1-1`, `libyuv0`) and the browser
fails to launch. `sudo npx playwright install-deps webkit` is the
supported fix; CI does it through `--with-deps`.

### 3.3 CI shape

The e2e job is a 3-way matrix keyed on the browser binary — not five
jobs, because the mobile projects reuse a binary already installed by
their desktop sibling:

| Matrix entry | Installs | Runs projects |
|---|---|---|
| `chromium` | chromium | `chromium`, `mobile-chrome` |
| `firefox` | firefox | `firefox` |
| `webkit` | webkit | `webkit`, `mobile-safari` |

Each entry rebuilds and packs the tarball itself (the Playwright
`webServer` already does this), uploads `playwright-report-⟨browser⟩` on
failure, and keeps the 2-retry/trace-on-first-retry settings.
`fail-fast: false`, so one engine's failure still reports the others, and
each check is individually required-green.

## 4. Known engine obstacles

### 4.1 Clipboard

`context.grantPermissions(['clipboard-read', 'clipboard-write'])` is
Chromium-only — as a global `permissions` config it **throws** on Firefox
and WebKit. So: permissions are per-project config on `chromium` only, and
a capture stub installed by a shared helper (`addInitScript` overriding
`navigator.clipboard.writeText` to record into `window.__copied`, still
delegating to the original where it works) lets `helpers.clipboardText()`
read the capture on every engine. One Chromium-only fidelity test keeps
the real end-to-end clipboard path. Rationale: what the suite asserts is
the *payload* the app hands to the clipboard, not the OS integration.

### 4.2 `isMobile`

Playwright's Firefox does not support `isMobile`, so no mobile project can
ever be Firefox-based (there is no mobile Firefox profile to emulate
faithfully anyway). `mobile.spec.js` itself is ignored by all three desktop
projects for a different reason: its subject is the emulated device, not
a layout a desktop viewport could exercise (§3.1).

### 4.3 Perf budgets

`perf.spec.js` relies on `PerformanceObserver('longtask')`
(Chromium-only) and its budgets were calibrated on Chromium. The perf
contract **stays pinned to the `chromium` project**: budgets are a
regression tripwire, not a cross-engine benchmark, and per-engine
calibration would only add flakiness without a user-facing claim behind
it. Documented as such next to the budgets.

### 4.4 Desktop specs at mobile viewports

Under `lg` the nav becomes a drawer and the try-it a bottom sheet: a
desktop-written spec that clicks a nav link or reaches into the try-it
panel would fail at 390 px if it addressed the layout directly. The fix
is centralized in the shared helpers (§3.1): `clickNavOp()` opens the
drawer first when the hamburger is visible, a `tryIt()`-adjacent helper
opens the FAB sheet when needed, and the `envTrigger`/modal helpers get
the same treatment.

The `DESKTOP_LAYOUT_ONLY` list in `playwright.config.js` — the blanket
mobile-ignore mechanism of last resort — is empty and should stay that
way: no spec's whole subject is desktop-only. Individual assertions
are scoped instead, each at its site — currently:

- `tryit.spec.js` "a resized nav column keeps its width" — skipped below
  `lg`: there is no draggable column edge, the nav is a fixed-width drawer.
- `tryit.spec.js` "the copy really reaches the system clipboard" — pinned
  to the `chromium` project, the only one granting `clipboard-read` (§4.1).
- `a11y.spec.js` "the search palette … returns focus on close" — the
  focus-return half runs on desktop only: below `lg` the opener lives in
  the drawer that the same Escape closed, so there is no opener left to
  return to.

### 4.5 Engine quirks and residual gaps

A divergence the matrix surfaces is fixed in the tests when it is a
testing artifact, and in the app when it is a real bug — that is the point
of the matrix. Divergences the app now guards against, none of which a
Chromium-only run could show:

- *The Popover API sits above the baseline floor* (Chrome 114 / Safari 17
  against a floor of 111 / 16.4), so the anchored `{{var}}` suggestion
  list must not call `showPopover()` unconditionally — a `TypeError` on a
  browser we claim to support. Detected once (`TOP_LAYER_SUPPORTED`),
  degraded, and covered by `baseline.spec.js` (architecture §13.1).
- *Firefox does not reflow before a synchronous post-`replaceChildren`
  scroll*: the scroll container still has its pre-render size and the
  deep-link anchor scroll is a silent no-op, where Chromium reflows. One
  shared `scrollToAnchor` (`dom.js`) waits for the next frame, for both
  the operation doc and docs pages.
- *Engine speed decides whether an IndexedDB round trip loses an edit*:
  the scenario view's `#commit` must not read state that only refreshes
  after an async write — two edits closer together than the round trip
  would both branch off the pre-edit scenario. The edited scenario is
  held locally before the write.
- *At 390 px, fixed-width form rows collapse their `grow` box to zero*:
  the environment manager's variable rows wrap, so a variable can be
  given a value on a phone.
- *WebKit takes focus back after `showModal()`*: a `focus()` call made
  right after it is undone by the dialog's own focusing steps, which run
  later there than in Chromium — the modal opened "on the editor" landed
  on `<body>` instead. `openModal` (`a11y.js`) names its landing point
  with `autofocus`, the hook those steps read, rather than racing them.

Residual gaps, accepted — Playwright harness limits, not app bugs:

- WebKit refuses `route.fulfill` on any 3xx status ("Cannot fulfill with
  redirect status"), and there is no other way to hand the app a staged
  `304` — the conditional-replay e2e is skipped on the `webkit` project.
- WebKit reports no request post body once it came from a `File`/`Blob`:
  the upload assertions that need the bytes are gated on `canSeeFileBytes`
  (`tests/e2e/helpers.js`) and assert everything but the bytes there
  (`bodies.spec.js`, `swagger2.spec.js`).
- The demo's full OAuth authorization-code round trip runs on the
  `chromium` project only (`demo.spec.js`): Playwright's Firefox and
  WebKit hand the post-consent navigation to the network instead of the
  service worker that plays the authorization server.
