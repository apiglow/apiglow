import { defineConfig, devices } from '@playwright/test'

// Headless Chromium probes the D-Bus session bus at startup; under parallel
// workers and repeated runs those probes pile up (spawned dbus daemons,
// connection stalls) and congest the host. Chromium runs fine without a bus,
// so point it at nothing — launched browsers inherit the runner's env. The
// manual launch sites (scripts/render-social.mjs,
// scripts/report-theme-contrast.mjs) restate this line.
process.env.DBUS_SESSION_BUS_ADDRESS = '/dev/null'

// e2e runs against the CDN simulation (npm run build + npm pack + static
// server): it tests the actually-distributed bundle, not the dev sources.
// The build is re-run every time the server starts; locally, a server
// already running (npm run preview:cdn) is reused as-is to iterate faster.
//
// Several projects, but `npm run test:e2e` only ever runs `chromium`: the
// matrix is a CI lever (and an opt-in `npm run test:e2e:all` locally), so a
// dev loop or an agent run never pays for it by accident.
// Decision record: docs/cross-browser.md.

// The perf budgets are a Chromium-calibrated regression tripwire, not a
// cross-engine benchmark: `perf.spec.js` measures through
// `PerformanceObserver('longtask')`, which only Chromium implements. Rule 14
// forbids loosening a budget to accommodate an engine — so the contract stays
// pinned to one engine instead (docs/cross-browser.md §4.3).
const CHROMIUM_ONLY = ['perf.spec.js']

// The drawer and the bottom sheet as the subject rather than the obstacle:
// gestures, the FAB, one-panel-at-a-time. It runs on the emulated devices,
// where those exist for real, instead of on a desktop engine holding a 390 px
// viewport — and Playwright's Firefox does not support `isMobile` anyway.
const MOBILE_ONLY = ['mobile.spec.js']

// Specs whose subject is the desktop layout itself, and which a mobile
// viewport therefore cannot ask the question of. Kept as short as the triage
// could make it — the list is the exception, and every line of it is argued in
// docs/cross-browser.md §4.4.
const DESKTOP_LAYOUT_ONLY = []

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI, the github reporter annotates the diff; the HTML report is what the
  // failure artifact carries (traces included, thanks to on-first-retry).
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Pinned, not inherited: the UI now boots in the language the browser asks
    // for, so a machine set to French would translate the whole suite out from
    // under assertions written in English. The specs that are about the
    // language override it locally.
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: MOBILE_ONLY,
      use: {
        ...devices['Desktop Chrome'],
        // Chromium is the only engine that accepts these — Firefox and WebKit
        // throw on the unknown permission names, which is why they cannot stay
        // in the global `use`. It is therefore also the only project where the
        // real clipboard is readable, hence the fidelity test pinned to it in
        // tryit.spec.js; everywhere else the suite asserts the copied payload
        // through the capture stub (helpers.js).
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    // No mobile project is Firefox-based: there is no mobile Firefox profile
    // to emulate faithfully, and Playwright's Firefox has no `isMobile`.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [...CHROMIUM_ONLY, ...MOBILE_ONLY],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [...CHROMIUM_ONLY, ...MOBILE_ONLY],
    },
    // Emulation — viewport, touch, user agent, device pixel ratio — not real
    // devices; that is the accepted fidelity level (docs/cross-browser.md §1).
    // They run the same specs as their desktop siblings: what is being checked
    // is that the drawer/sheet layout serves the whole product, not a
    // hand-picked subset of it.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testIgnore: [...CHROMIUM_ONLY, ...DESKTOP_LAYOUT_ONLY],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
      testIgnore: [...CHROMIUM_ONLY, ...DESKTOP_LAYOUT_ONLY],
    },
  ],
  webServer: {
    command: 'node scripts/preview-cdn.mjs',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
