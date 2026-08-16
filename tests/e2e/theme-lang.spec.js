// Persisted daisyUI theme (docs/architecture.md §5.9) and lazy-loaded i18n
// (§5.10: only the active language's file is downloaded).
import { test, expect } from '@playwright/test'
import { gotoApp, openAppMenu, openThemeList } from './helpers.js'

test('theme switcher applies the theme and survives a reload', async ({ page }) => {
  await gotoApp(page)
  // default: 'system' resolves within the first pair of theme.available —
  // apiglow here, Playwright emulating a light-scheme OS.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow')
  await openThemeList(page)
  // The five themes of theme.available; System lives in the mode toggle, not
  // in the list.
  await expect(page.locator('theme-switcher li button')).toHaveCount(5)
  await expect(page.locator('theme-switcher [data-mode="system"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.locator('theme-switcher li button', { hasText: /^dark$/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await openThemeList(page)
  await expect(page.locator('theme-switcher li button[aria-current="true"]')).toHaveText('dark')
})

// The 'system' choice is live, not a boot-time resolution: flipping the OS
// scheme repaints without a reload — until an explicit theme is picked, which
// detaches it.
test('system theme follows the OS scheme and an explicit pick detaches it', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow')
  // Explicit choice wins and stops following the OS.
  await openThemeList(page)
  await page.locator('theme-switcher li button', { hasText: /^corporate$/ }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'corporate')
  // Picking System again re-attaches, still without a reload.
  await openThemeList(page)
  await page.locator('theme-switcher [data-mode="system"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow-dark')
})

// The quick toggle (docs/architecture.md §5.9): light/dark/system operating on
// the pair the current choice lives in — from a paired theme it flips the
// side, from an unpaired one it lands on the signature pair.
test('the mode toggle flips within the current pair', async ({ page }) => {
  await gotoApp(page)
  await openThemeList(page)
  await page.locator('theme-switcher [data-mode="dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow-dark')
  await expect(page.locator('theme-switcher [data-mode="dark"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // The menu stayed open: flipping to compare is what the row is for.
  await page.locator('theme-switcher [data-mode="light"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow')

  // From the light/dark pair, the toggle flips that pair, not the signature's.
  await page.locator('theme-switcher li button', { hasText: /^light$/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await openThemeList(page)
  await page.locator('theme-switcher [data-mode="dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // From an unpaired theme, no side is lit and "dark" lands on the signature pair.
  await page.locator('theme-switcher li button', { hasText: /^corporate$/ }).click()
  await openThemeList(page)
  await expect(page.locator('theme-switcher [aria-pressed="true"]')).toHaveCount(0)
  await page.locator('theme-switcher [data-mode="dark"]').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'apiglow-dark')
})

// Rule 3's runtime half. The test above only reads `data-theme`, and that
// attribute flips whatever the built CSS contains — it stays green on a bundle
// built without `themes: all`, which is exactly the silent failure (the host
// lists a theme, the user clicks, nothing repaints). `corporate` is a standard
// daisyUI theme present in the bundle *only* because of `themes: all`; reading
// real colors is what proves its block shipped. check-dist.mjs guards the same
// invariant from the artifact's side; this one guards it from the browser's.
test('a standard built-in theme repaints for real, not just the attribute', async ({ page }) => {
  await gotoApp(page)
  const rootColor = (prop) =>
    page.evaluate(
      (p) => getComputedStyle(document.documentElement).getPropertyValue(p).trim(),
      prop,
    )
  const swatchPrimary = (theme) =>
    page
      .locator(`theme-switcher [data-theme="${theme}"] .bg-primary`)
      .first()
      .evaluate((n) => getComputedStyle(n).backgroundColor)

  const initialPrimary = await rootColor('--color-primary')
  const initialContent = await rootColor('--color-base-content')
  expect(initialPrimary).not.toBe('')

  await openThemeList(page)
  // The swatches carry a local data-theme, so each one already paints from its
  // own block: two identical swatches mean one of the blocks is missing.
  expect(await swatchPrimary('corporate')).not.toBe(await swatchPrimary('light'))
  // Same proof for the signature pair, which ships next to the standard set.
  expect(await swatchPrimary('apiglow')).not.toBe(await swatchPrimary('apiglow-dark'))

  await page.locator('theme-switcher li button', { hasText: /^corporate$/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'corporate')
  await expect.poll(() => rootColor('--color-primary')).not.toBe(initialPrimary)
  await expect.poll(() => rootColor('--color-base-content')).not.toBe(initialContent)

  await openThemeList(page)
  await page.locator('theme-switcher li button', { hasText: /^ApiGlow$/ }).click()
  await expect.poll(() => rootColor('--color-primary')).toBe(initialPrimary)
})

test('switching language downloads only that language file and translates the UI', async ({
  page,
}) => {
  const i18nRequests = []
  page.on('request', (r) => {
    if (r.url().includes('/i18n/') && r.url().endsWith('.json')) i18nRequests.push(r.url())
  })
  await gotoApp(page)
  // English = embedded in the bundle, no language file downloaded
  expect(i18nRequests).toHaveLength(0)
  await openAppMenu(page)
  await page.locator('lang-switcher [data-lang-choice="fr"]').click()
  // switching language reloads the page (docs/architecture.md §14.7)
  await page.waitForLoadState()
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  await expect(page.getByRole('button', { name: 'Historique' })).toBeVisible()
  expect(i18nRequests.some((u) => u.endsWith('/fr.json'))).toBe(true)
  expect(i18nRequests.some((u) => u.endsWith('/en.json'))).toBe(false)
})

// The language half of the theme's 'system' (docs/architecture.md §14.7): a
// reader whose browser asks for French reads French, on an installation that
// configured nothing — and the menu, once touched, outranks the browser for
// good.
test.describe('a browser asking for French', () => {
  test.use({ locale: 'fr-CA' })

  test('is served French by default, and the menu still has the last word', async ({ page }) => {
    // fr-CA: matched on the primary subtag, which is what real browsers send.
    await gotoApp(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    await expect(page.getByRole('button', { name: 'Historique' })).toBeVisible()

    // The pressed segment is the mode, not the language it resolved to.
    await openAppMenu(page)
    await expect(page.locator('lang-switcher [data-lang-choice="browser"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await page.locator('lang-switcher [data-lang-choice="en"]').click()
    await page.waitForLoadState()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    // A choice, not a session accident: the browser keeps asking for French.
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    // And "Automatic" is the way back to following the browser.
    await openAppMenu(page)
    await page.locator('lang-switcher [data-lang-choice="browser"]').click()
    await page.waitForLoadState()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })
})
