// Multi-spec (docs/multi-spec.md, criteria §7): spec selector,
// deep-links prefixed #/s/{id}/…, storage isolation per spec, and single
// form unchanged (bare routes, unprefixed keys).
import { test, expect } from '@playwright/test'
import {
  clickNavOp,
  envOptions,
  expectResponded,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openEnvSwitcher,
  openHistory,
  send,
} from './helpers.js'

const MULTI_PAGE = '/tests/e2e/fixtures/app-multi.html'

async function gotoMulti(page, hash = '') {
  await page.goto(MULTI_PAGE + hash)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

function specTrigger(page) {
  return page.locator('spec-switcher summary')
}

async function switchSpec(page, specId) {
  await specTrigger(page).click()
  await page.locator(`spec-switcher [data-spec-option="${specId}"]`).click()
  // The switch reloads the page: we wait for the new spec's nav.
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

function localStorageKeys(page) {
  return page.evaluate(() => Object.keys(window.localStorage))
}

test('the selector switches nav, doc, environments and routes (criterion 1)', async ({ page }) => {
  await gotoMulti(page)
  // The trigger no longer names the spec — the brand does that, and carries its
  // version. The selector only keeps the tooltip.
  await expect(specTrigger(page)).toHaveAttribute('title', /Pets API/)
  await expect(page.locator('header .navbar-start')).toContainText('1.0.0')
  await expect(page.locator('api-nav a[data-op-id="listPets"]')).toBeAttached()

  await switchSpec(page, 'billing')
  expect(page.url()).toContain('#/s/billing/')
  await expect(specTrigger(page)).toHaveAttribute('title', /Billing API/)
  await expect(page.locator('header .navbar-start')).toContainText('2.0.0')
  await expect(page.locator('api-nav a[data-op-id="listInvoices"]')).toBeAttached()
  await expect(page.locator('api-nav a[data-op-id="listPets"]')).toHaveCount(0)
  await expect(page.locator('main h1')).toHaveText('Billing E2E API')
  // Spec environments: root (shared) + the one declared by billing.
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(2)
  await expect(envOptions(page).filter({ hasText: 'billing-env' })).toHaveCount(1)

  // The choice persists: returning without a hash reopens the selected spec.
  await page.goto(MULTI_PAGE)
  await expect(page.locator('api-nav a[data-op-id="listInvoices"]').first()).toBeAttached()
})

test('the header branding follows the active spec, with fallback to the root', async ({ page }) => {
  const brand = page.locator('header .navbar-start a')
  await gotoMulti(page)
  // pets declares nothing: root name, no logo. The version badge
  // lives in the brand in multi-spec too, hence the contains.
  await expect(brand).toContainText('E2E Multi Docs')
  await expect(brand.locator('img')).toHaveCount(0)

  await switchSpec(page, 'billing')
  await expect(brand).toContainText('Billing Docs')
  await expect(brand.locator('img')).toHaveAttribute('src', '/tests/e2e/fixtures/billing.svg')
})

test('a deep-link to a non-selected spec loads it directly (criterion 2)', async ({ page }) => {
  // Preference set on pets, then reload on a billing route: the
  // hash (rule 2) wins over the preference (rule 3).
  await gotoMulti(page)
  await gotoMulti(page, '#/s/billing/op/listInvoices')
  await expect(page.locator('api-endpoint-doc')).toContainText('List invoices')
  expect(page.url()).toContain('#/s/billing/op/listInvoices')
})

test('an unknown specId silently falls back to the home (§4.4)', async ({ page }) => {
  await gotoMulti(page, '#/s/nope/op/listPets')
  await expect(page.locator('main h1')).toHaveText('E2E Test API')
  await expect(() => expect(page.url()).toContain('#/s/pets/')).toPass()
})

test('environments and history are isolated per spec (criterion 4)', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoMulti(page, '#/s/pets/op/listPets')
  await send(page)
  await expectResponded(page)
  await expect.poll(() => calls.length).toBe(1)

  // Storage prefixed by spec: pets values cannot leak
  // to billing, they live under distinct keys.
  const keys = await localStorageKeys(page)
  expect(keys).toContain('apidoc:pets:environments')
  expect(keys).not.toContain('apidoc:environments')

  await openHistory(page)
  await expect(page.locator('request-history-list .modal-box .collapse')).toHaveCount(1)
  await page.keyboard.press('Escape')

  await switchSpec(page, 'billing')
  const billingKeys = await localStorageKeys(page)
  expect(billingKeys).toContain('apidoc:billing:environments')
  // billing's history does not show the entry sent from pets.
  await openHistory(page)
  await expect(page.locator('request-history-list .modal-box')).toBeVisible()
  await expect(page.locator('request-history-list .modal-box .collapse')).toHaveCount(0)
  // The list is scoped, the retention bound is not: it counts the entry sent
  // from pets, because that is the entry the purge will act on.
  await expect(page.locator('request-history-list .modal-box')).toContainText('1/500 entries kept')
})

test('scenarios are declared, routed and stored per spec (docs/scenarios.md §9)', async ({
  page,
}) => {
  await gotoMulti(page)
  const scenarios = page.locator('api-nav a[data-scenario-id]')
  // Declared in pets' specs[] entry: visible here, prefixed route.
  await openDrawerIfMobile(page)
  await scenarios.filter({ hasText: 'Onboarding' }).click()
  expect(page.url()).toContain('#/s/pets/scenario/onboarding')
  await expect(page.locator('api-scenario-view')).toContainText('3 step(s)')

  // A local scenario created under pets belongs only to pets.
  await openDrawerIfMobile(page)
  await page.locator('api-nav').getByRole('button', { name: '+ New scenario' }).click()
  await expect(scenarios).toHaveCount(2)
  expect(page.url()).toContain('#/s/pets/scenario/')

  await switchSpec(page, 'billing')
  // Neither pets' config scenario (no root merge), nor its local one.
  await expect(scenarios).toHaveCount(0)
})

// Per-spec overrides: almost all config is redeclared in an
// openapi.specs[] entry. billing cuts scenarios, imposes its theme and locks
// its environments — pets, meanwhile, keeps the root values.
test('each spec carries its own settings: theme, features, environment lock', async ({ page }) => {
  await gotoMulti(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await openDrawerIfMobile(page)
  await expect(
    page.locator('api-nav').getByRole('button', { name: '+ New scenario' }),
  ).toBeVisible()
  // Two root themes available: the selector is there.
  await expect(page.locator('theme-switcher')).toHaveCount(1)
  await openEnvSwitcher(page)
  await expect(
    page.locator('env-switcher').getByText('Environments', { exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')

  await switchSpec(page, 'billing')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // Only one theme offered: nothing left to choose, the selector disappears.
  await expect(page.locator('theme-switcher')).toHaveCount(0)
  // Scenarios feature cut for this spec only.
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav').getByText('SCENARIOS')).toHaveCount(0)
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav').getByRole('button', { name: '+ New scenario' })).toHaveCount(
    0,
  )
  // Locked environments: the selector remains, management disappears.
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(2)
  await expect(page.locator('env-switcher').getByText('Environments', { exact: true })).toHaveCount(
    0,
  )
})

test('single spec: bare routes, unprefixed keys, no selector (criterion 3)', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await clickNavOp(page, 'getPet')
  // No spec prefix in generated URLs, no spec selector.
  expect(page.url()).toContain('#/op/getPet')
  expect(page.url()).not.toContain('#/s/')
  await expect(page.locator('spec-switcher summary')).toHaveCount(0)
  const keys = await localStorageKeys(page)
  expect(keys).toContain('apidoc:environments')
  expect(keys.filter((k) => k.includes(':pets:'))).toEqual([])
})

// The selector sits mid-header, between the brand and the tools, so its list
// starts around 250 px in — and daisyUI aligns it to that start. An 18 rem list
// therefore ran off the right edge and gave the whole page a horizontal scroll,
// which nothing else here would notice: the reflow suite measures the
// single-spec fixture, where there is no selector at all.
//
// A phone width and not 320 px: narrower, the header's first row runs out of
// room, the trigger wraps back to the left and the list fits by accident — the
// defect needs the brand, the version badge and the trigger to share a line.
test.describe('the spec list on a phone', () => {
  test.use({ viewport: { width: 412, height: 800 } })

  test('opens inside the viewport, and over the header rather than under it', async ({ page }) => {
    await gotoMulti(page)
    await specTrigger(page).click()
    const menu = page.locator('spec-switcher .dropdown-content')
    await expect(menu).toBeVisible()
    const geometry = await page.evaluate(() => {
      const box = document.querySelector('spec-switcher .dropdown-content').getBoundingClientRect()
      const option = document.querySelector('spec-switcher [data-spec-option]')
      const middle = { x: box.left + box.width / 2, y: option.getBoundingClientRect().top + 4 }
      return {
        left: box.left,
        right: box.right,
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        // Below lg the header wraps: level with the environment pill, that pill
        // came later in the DOM and painted over the list's first entry.
        onTop: document.elementFromPoint(middle.x, middle.y)?.closest('spec-switcher') !== null,
      }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(geometry.width)
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width)
    expect(geometry.onTop).toBe(true)
  })
})
