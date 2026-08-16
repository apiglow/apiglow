// The header bar (docs/architecture.md §5.16). Everything asserted here is a
// layout outcome — which zone yields when the bar runs out of room — so it can
// only be checked in a real browser against the built CSS, and only by moving
// the viewport rather than by reading a class list.
import { expect, test } from '@playwright/test'
import { APP_PAGE, openAppMenu } from './helpers.js'

// One row of `min-h-14`. Anything taller means a zone wrapped onto its own
// line, which is the state this whole layout exists to end.
const ONE_LINE = 56

// 320 px is the reflow criterion's own width (a 1280 px window at 400 % zoom)
// and the floor everything must hold; 360 px is the narrowest phone anyone
// actually browses on, and the floor the single line must hold. Above that,
// the breakpoints where a part appears or leaves, plus the two extremes.
const WIDTHS = [320, 360, 390, 414, 480, 640, 768, 834, 1024, 1280, 1440, 1920, 2560]

const header = (page) => page.locator('header').first()

const headerHeight = (page) =>
  header(page)
    .boundingBox()
    .then((box) => box.height)

const scrolls = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )

test('the bar holds one line from 360 px up, and never scrolls sideways', async ({ page }) => {
  await page.goto(APP_PAGE)
  await expect(page.locator('main h1')).toBeVisible()
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    // The bar re-lays out under the same frame the resize schedules; reading
    // the box is what waits for it.
    await expect
      .poll(() => scrolls(page), { message: `sideways scroll at ${width} px` })
      .toBe(false)
    if (width < 360) continue
    expect(await headerHeight(page), `wrapped at ${width} px`).toBeLessThanOrEqual(ONE_LINE)
  }
})

// The defect this replaced: below lg the bar carried no search at all and the
// only opener was two taps deep, inside the navigation drawer — on the control
// a documentation site is reached for first.
test('exactly one search trigger is on the bar at every width', async ({ page }) => {
  await page.goto(APP_PAGE)
  const triggers = page.getByRole('button', { name: /Search the docs/ })
  for (const width of [320, 390, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await expect(triggers, `at ${width} px`).toHaveCount(1)
    await expect(triggers, `at ${width} px`).toBeVisible()
  }
  // And it opens the palette on the phone, in one press rather than three.
  await page.setViewportSize({ width: 390, height: 800 })
  await triggers.click()
  await expect(page.locator('search-palette input[type="search"]')).toBeVisible()
})

// The nav column used to hold a trigger of its own below lg. Two buttons with
// the same accessible name is what the palette's name has to stay clear of.
test('the navigation column no longer carries a search trigger', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(APP_PAGE)
  await expect(
    page.locator('api-nav').getByRole('button', { name: /Search the docs/ }),
  ).toHaveCount(0)
  await expect(page.locator('api-nav [data-collapse-groups]')).toBeVisible()
})

// The document-status badges: permanent, amber, and named at every width —
// the label is what yields, never the badge (docs/user-overlay.md decision 3).
test('a status badge keeps its name when it drops its label', async ({ page }) => {
  await page.goto(APP_PAGE)
  const badge = page.locator('header button.btn-warning').first()
  // Raised by hand: the changelog badge needs a stored snapshot to disagree
  // with, and what is under test is the badge's own responsive shape.
  await badge.evaluate((node) => node.classList.remove('hidden'))

  await page.setViewportSize({ width: 390, height: 800 })
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAccessibleName(/Schema updated/i)
  await expect(badge.locator('[data-status-label]')).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 800 })
  await expect(badge.locator('[data-status-label]')).toBeVisible()
  await expect(badge).toHaveAccessibleName(/Schema updated/i)
})

// The preferences menu is the bar's fourth zone: everything about the app, and
// nothing about the API (§5.16).
test('the preferences menu holds the theme, the language, the settings and About', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.goto(APP_PAGE)
  await openAppMenu(page)
  await expect(page.locator('theme-switcher [data-mode="system"]')).toBeVisible()
  await expect(page.locator('lang-switcher [data-lang-choice="fr"]')).toBeVisible()
  await expect(page.locator('[data-menu-settings]')).toBeVisible()
  await expect(page.locator('[data-menu-about]')).toBeVisible()
  // None of them left a control of its own behind on the bar.
  await expect(page.locator('header > .navbar-end > theme-switcher')).toHaveCount(0)
  await expect(page.locator('header > .navbar-end > lang-switcher')).toHaveCount(0)
})
