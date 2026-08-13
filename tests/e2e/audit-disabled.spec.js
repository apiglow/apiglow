import { expect, test } from '@playwright/test'
import { expectFeatureUnreachable, gotoFixture, openSettings } from './helpers.js'

// `features.audit: false`: the mirror of `scenarios-disabled.spec.js`, run
// through the same shared checklist so neither flag is guarded on a different
// fraction of its entry points than the other.
const PAGE = '/tests/e2e/fixtures/app-no-audit.html'

const open = (page, hash = '') => gotoFixture(page, PAGE + hash)

test('features.audit false leaves no entry point at all', async ({ page }) => {
  await expectFeatureUnreachable(page, {
    open,
    // The audit never had a nav entry — the settings panel is its only door
    // (docs/audit.md §6) — but the flag has to hold if one is ever added.
    nav: ['Schema audit'],
    inPage: [
      { selector: 'settings-panel [data-audit-open]', reach: openSettings },
      { selector: 'settings-panel .modal-box:has-text("Schema audit")', reach: openSettings },
    ],
    routes: [{ hash: '#/audit', text: 'audit is disabled' }],
    search: ['audit'],
    // Reachable only from the report itself, so their absence is what proves
    // the audit's exports leave with it.
    exports: [{ selector: '[data-audit-copy]', reach: (p) => open(p, '#/audit') }],
    // The computation half of the promise (app.js: `auditInput` is null when
    // the flag is off, so the raw documents are not even retained): what a
    // browser can observe of it is that the view is never constructed.
    elements: ['audit-report'],
  })
})

test('the rest of the settings panel is intact', async ({ page }) => {
  await open(page)
  await openSettings(page)
  await expect(page.locator('settings-panel .modal-box')).toContainText('Stored data')
  await expect(page.locator('settings-panel [data-reset-all]')).toBeVisible()
})
