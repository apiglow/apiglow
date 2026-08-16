// Custom themes (docs/custom-themes.md §7). Everything asserted here is a
// cascade outcome — which rule wins on the root element — so it can only be
// checked in a real browser, against the built CSS the host actually gets.
import { expect, test } from '@playwright/test'
import { gotoFixture, openThemeList, THEMES_PAGE } from './helpers.js'

const rootToken = (page, token) =>
  page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token,
  )

// Polled: the CSS of an extending theme is only filled once app.css fires its
// load event, which is not ordered against the app's first render.
const expectToken = (page, token, value) => expect.poll(() => rootToken(page, token)).toBe(value)

function themeOption(page, name) {
  return page.locator('theme-switcher li button', { hasText: new RegExp(`^${name}$`) })
}

async function selectTheme(page, name) {
  await openThemeList(page)
  await themeOption(page, name).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', name)
}

test('custom themes join the switcher, swatches included', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await openThemeList(page)
  // The five themes of the fixture; System sits in the mode toggle above.
  await expect(page.locator('theme-switcher li button')).toHaveCount(5)
  // The preview repaints off its own local data-theme: the injected rule is
  // global, so the swatch needs no knowledge of custom themes.
  await expect(themeOption(page, 'acme').locator('[data-theme="acme"] .bg-primary')).toHaveCSS(
    'background-color',
    'rgb(109, 40, 217)',
  )
  await expect(themeOption(page, 'neon').locator('[data-theme="neon"] .bg-primary')).toHaveCSS(
    'background-color',
    'rgb(34, 211, 238)',
  )
})

test('a standalone custom theme applies its tokens and its color scheme', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await selectTheme(page, 'neon')
  await expectToken(page, '--color-primary', '#22d3ee')
  await expectToken(page, '--radius-box', '1.5rem')
  await expectToken(page, '--border', '2px')
  // color-scheme drives the browser's own UI (scrollbars, form controls).
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
})

test('an extending theme inherits its base and overrides only what it declares', async ({
  page,
}) => {
  await gotoFixture(page, THEMES_PAGE)
  // Read from the built-in itself rather than hardcoded: the assertion is
  // "same value as dark", which must survive a daisyUI bump.
  const darkBase = await rootToken(page, '--color-base-100')
  const darkNeutral = await rootToken(page, '--color-neutral')
  expect(darkBase).not.toBe('')

  await selectTheme(page, 'acme')
  await expectToken(page, '--color-primary', '#6d28d9')
  await expectToken(page, '--radius-box', '0.25rem')
  await expectToken(page, '--color-base-100', darkBase)
  await expectToken(page, '--color-neutral', darkNeutral)
})

// The trap of §5: daisyUI scopes its themes under an :is(…) selector, so a bare
// [data-theme=light] block would lose. This is the regression guard.
test('an in-place override beats the built-in rule and keeps the rest of it', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  const darkBase = await rootToken(page, '--color-base-100')
  await selectTheme(page, 'light')
  await expectToken(page, '--color-primary', '#b91c1c')
  // Untouched tokens still come from the built-in light, by cascade.
  const lightBase = await rootToken(page, '--color-base-100')
  expect(lightBase).not.toBe(darkBase)
  expect(lightBase).not.toBe('')
})

test('a host-CSS theme applies without the app knowing about it', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await selectTheme(page, 'hostbrand')
  await expectToken(page, '--color-base-100', '#101820')
  await expectToken(page, '--color-primary', '#14b8a6')
})

// What settles §6: the built-in themes ship inside @layer base, so an unlayered
// host block wins over them whatever its selector — no :is(…) mirror needed
// outside the app. The day daisyUI stops layering, this test falls first.
test('a host-CSS block overrides a built-in theme in place', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectToken(page, '--color-accent', '#ff2d92')
})

test('a custom theme survives a reload', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await selectTheme(page, 'neon')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neon')
  await expectToken(page, '--color-primary', '#22d3ee')
})
