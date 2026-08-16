// Settings panel: the storage inventory, the targeted purges and the full
// reset. The point of the suite is that a "Clear" claim matches what the
// browser actually holds afterwards — a panel that reports success on an
// untouched database is worse than no panel.
import { expect, test } from '@playwright/test'
import {
  APP_VERSION,
  clickNavOp,
  closeMobilePanels,
  expectResponded,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openHistory,
  openSettings,
  openThemeList,
  send,
} from './helpers.js'

function panel(page) {
  return page.locator('settings-panel .modal-box')
}

function row(page, id) {
  return panel(page).locator(`li[data-dataset="${id}"]`)
}

function count(page, id) {
  return panel(page).locator(`[data-count-for="${id}"]`)
}

// The schema snapshot is written on idle, off the boot critical path, and the
// inventory counts are read once when the panel opens. Opening it straight
// after a reload is therefore a race the panel cannot win on its own — lost on
// WebKit, won on Chromium, which is exactly the kind of engine luck a fixed
// wait would bake in. Waited on at the source instead.
function snapshotCount(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        // No version: the app owns the schema, the test piggybacks.
        const request = indexedDB.open('apidoc-schema')
        request.onerror = () => resolve(-1)
        request.onsuccess = () => {
          const counted = request.result.transaction('snapshots').objectStore('snapshots').count()
          counted.onsuccess = () => resolve(counted.result)
          counted.onerror = () => resolve(-1)
        }
      }),
  )
}

// Confirms a row's purge: the button swaps to a confirm/cancel pair in place.
async function clearRow(page, id) {
  await row(page, id).getByRole('button', { name: 'Clear', exact: true }).click()
  await row(page, id).getByRole('button', { name: 'Clear', exact: true }).click()
}

test('the inventory reports what the browser holds', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)

  await openSettings(page)
  await expect(count(page, 'history')).toHaveText('1')
  // One environment comes from the host config.
  await expect(count(page, 'environments')).toHaveText('1')
  await expect(count(page, 'scenarios')).toHaveText('0')
  // Nothing was chosen yet: the theme and language resolved at boot come from
  // the host config, and the app writes a preference only when the user picks
  // one. An inventory that reported stored preferences here would be lying.
  await expect(count(page, 'preferences')).toHaveText('0')

  await page.locator('settings-panel .modal-box button.btn-circle').click()
  await openThemeList(page)
  await page.locator('theme-switcher li button', { hasText: /^dark$/ }).click()
  await openSettings(page)
  await expect(count(page, 'preferences')).toHaveText('1')
})

// A scenario declared by the host config is served from its URL on every load,
// not stored: it cannot be cleared, so it must not be counted. Only the
// explicit local copy is data this browser holds. The fixture ships a pinned
// config scenario, which is what makes the first assertion meaningful.
test('a config scenario is not stored data, its duplicate is', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await openSettings(page)
  await expect(count(page, 'scenarios')).toHaveText('0')

  await page.locator('settings-panel .modal-box button.btn-circle').click()
  await openDrawerIfMobile(page)
  await page.locator('api-nav a[data-scenario-id="onboarding"]').click()
  await page.locator('api-scenario-view').getByRole('button', { name: 'Duplicate' }).click()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-scenario-id]')).toHaveCount(2)

  await openSettings(page)
  await expect(count(page, 'scenarios')).toHaveText('1')
})

test('an empty dataset offers no purge', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  await expect(count(page, 'history')).toHaveText('0')
  await expect(row(page, 'history').getByRole('button', { name: 'Clear' })).toBeDisabled()
})

test('clearing the history empties it for real, and only it', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)

  await openSettings(page)
  await clearRow(page, 'history')
  await expect(count(page, 'history')).toHaveText('0')
  await expect(page.locator('[data-live-region]')).toContainText('Request history')
  // The environments row is untouched: a targeted purge stays targeted.
  await expect(count(page, 'environments')).toHaveText('1')

  await page.locator('settings-panel .modal-box button.btn-circle').click()
  await openHistory(page)
  await expect(page.locator('request-history-list .modal-box')).not.toContainText('/pets')
})

test('a purge asks before running and can be called off', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)

  await openSettings(page)
  const clear = row(page, 'history').getByRole('button', { name: 'Clear', exact: true })
  await clear.click()
  await expect(row(page, 'history').getByRole('button', { name: 'Cancel' })).toBeVisible()
  await row(page, 'history').getByRole('button', { name: 'Cancel' }).click()
  await expect(count(page, 'history')).toHaveText('1')
  // Focus goes back to the button that opened the confirmation, not to <body>.
  await expect(clear).toBeFocused()
})

test('erasing everything reloads on a first-visit state', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)
  // A preference written by hand: it must not survive either. The switcher is
  // in the header, which the open sheet covers below lg.
  await closeMobilePanels(page)
  await openThemeList(page)
  await page.locator('theme-switcher li button', { hasText: /^dark$/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await openSettings(page)
  await panel(page).getByRole('button', { name: 'Erase everything and reload' }).click()
  // The erase reloads the page itself. Waiting on the load state alone can be
  // answered by the document about to be replaced, and the next helper call
  // then dies in a destroyed execution context: the navigation is what has to
  // be awaited, and it is armed before the click that causes it.
  const reloaded = page.waitForEvent('framenavigated')
  await panel(page).getByRole('button', { name: 'Erase everything', exact: true }).click()
  await reloaded

  await page.waitForLoadState()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  // Back to the fixture default: 'system', resolved to the pair's light side.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow')
  // The snapshot row is back at 1 on purpose and is not a leftover: the reload
  // that follows the reset finds no baseline, so it writes today's schema as a
  // first visit would — and flags no change.
  await expect.poll(() => snapshotCount(page)).toBe(1)
  await openSettings(page)
  await expect(count(page, 'history')).toHaveText('0')
  await expect(count(page, 'preferences')).toHaveText('0')
  await expect(count(page, 'snapshots')).toHaveText('1')
  await expect(page.getByRole('button', { name: /Schema changed/ })).toHaveCount(0)
})

test('diagnostics name the bundle and the schema behind the page', async ({ page }) => {
  await gotoApp(page)
  await openSettings(page)
  const diagnostics = panel(page).locator('dl')
  await expect(diagnostics).toContainText(APP_VERSION)
  await expect(diagnostics).toContainText('e2e-api.json')
  // Single-spec install: no spec line to leave empty.
  await expect(diagnostics).not.toContainText('Spec')
})
