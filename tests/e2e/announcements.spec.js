// Operator announcements (docs/architecture.md §5.17): the strip through which
// the documentation's operator says what the schema cannot. What is asserted
// here is everything the pure model cannot see — that the strip renders above
// the app, that its Markdown is a real link, that a dismissal outlives a reload,
// and that a file named in the config is fetched and shown.
import { expect, test } from '@playwright/test'
import { gotoFixture } from './helpers.js'

const INLINE_PAGE = '/tests/e2e/fixtures/app-announcements.html'
const FILE_PAGE = '/tests/e2e/fixtures/app-news.html'

const strip = (page) => page.locator('[data-announcements]')
const rows = (page) => strip(page).locator('[data-announcement]')

test('shows the announcements whose window is open, and only those', async ({ page }) => {
  await gotoFixture(page, INLINE_PAGE)
  await expect(rows(page)).toHaveCount(2)
  // Declared order, and the level rides on the row: the reader sees a warning
  // as a warning, not as one more grey line.
  await expect(rows(page).nth(0)).toHaveAttribute('data-announcement', 'info')
  await expect(rows(page).nth(1)).toHaveAttribute('data-announcement', 'warning')
  await expect(strip(page)).toContainText('Payments are degraded.')
  // Scheduled out on both ends: an expired notice and one that has not opened.
  await expect(strip(page)).not.toContainText("Last year's maintenance")
  await expect(strip(page)).not.toContainText("Next decade's maintenance")
})

test('renders the message as inline Markdown, link included', async ({ page }) => {
  await gotoFixture(page, INLINE_PAGE)
  const link = strip(page).getByRole('link', { name: 'migration guide' })
  await expect(link).toHaveAttribute('href', 'https://example.test/migrate')
  await expect(strip(page).locator('strong')).toHaveText('v2 is live')
  await expect(strip(page).locator('code')).toHaveText('2026-12-01')
})

test('sits above the header, without displacing the skip link', async ({ page }) => {
  await gotoFixture(page, INLINE_PAGE)
  const stripBox = await strip(page).boundingBox()
  const headerBox = await page.locator('header').first().boundingBox()
  expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(headerBox.y + 1)
  // The strip comes second in the tree on purpose: a keyboard reader's first
  // stop stays the skip link, not a close button.
  await page.keyboard.press('Tab')
  await expect(page.locator('[data-skip-link]')).toBeFocused()
})

// The reflow criterion applies to the strip like the rest of the chrome
// (§12): a long sentence wraps, it never pushes the page sideways.
test('wraps rather than scrolling the page sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await gotoFixture(page, INLINE_PAGE)
  await expect(strip(page)).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    ),
  ).toBe(false)
})

test('a dismissal outlives a reload, a pinned notice does not go away', async ({ page }) => {
  await gotoFixture(page, INLINE_PAGE)
  // The pinned entry offers no way out: one button for two announcements.
  await expect(strip(page).getByRole('button')).toHaveCount(1)
  await strip(page).getByRole('button').click()
  await expect(rows(page)).toHaveCount(1)
  await expect(strip(page)).not.toContainText('v2 is live')

  await gotoFixture(page, INLINE_PAGE)
  await expect(rows(page)).toHaveCount(1)
  await expect(strip(page)).toContainText('Payments are degraded.')
})

test('closing the last one removes the strip itself', async ({ page }) => {
  await gotoFixture(page, FILE_PAGE)
  await expect(rows(page)).toHaveCount(1)
  await strip(page).getByRole('button').click()
  await expect(strip(page)).toHaveCount(0)
})

test('fetches the file the config names, and honours what it holds', async ({ page }) => {
  await gotoFixture(page, FILE_PAGE)
  await expect(rows(page)).toHaveAttribute('data-announcement', 'success')
  await expect(strip(page)).toContainText('Release 2.4 shipped today.')
})

// A file that does not load is not the reader's problem: no strip, no error,
// and a documentation that behaves exactly as if nothing had been declared.
test('a file that fails to load costs the reader nothing', async ({ page }) => {
  await page.route('**/e2e-announcements.json', (route) => route.fulfill({ status: 404 }))
  await gotoFixture(page, FILE_PAGE)
  await expect(page.locator('main h1')).toBeVisible()
  await expect(strip(page)).toHaveCount(0)
})

test.describe('a browser asking for French', () => {
  test.use({ locale: 'fr-FR' })

  test('reads the announcement in French', async ({ page }) => {
    await gotoFixture(page, FILE_PAGE)
    await expect(strip(page)).toContainText('La version 2.4 est sortie.')
  })
})
