// The About dialog: the distribution's only carrier for the license and
// third-party notices (docs/architecture.md §5.13). The suite checks what those
// notices actually say against the packed bundle — a credits list that renders
// empty, or a version that reads "undefined", is a compliance defect, not a
// cosmetic one.
import { expect, test } from '@playwright/test'
import { APP_NAME, APP_VERSION, gotoApp, openAppMenu } from './helpers.js'

const dialog = (page) => page.locator('about-dialog .modal-box')

async function openAbout(page) {
  await openAppMenu(page)
  await page.locator('[data-menu-about]').click()
  await expect(dialog(page)).toBeVisible()
}

test('About states the license, what it reads, and what it bundles', async ({ page }) => {
  await gotoApp(page)
  await openAbout(page)
  // The tool's own name, not the host's product name, which stays in the header.
  await expect(dialog(page)).toContainText(APP_NAME)
  await expect(dialog(page)).toContainText(`v${APP_VERSION}`)
  await expect(dialog(page)).toContainText('MIT — Copyright (c) 2026 Jeremy Perret')
  await expect(dialog(page)).toContainText('OpenAPI 3.0.x · 3.1.x · 3.2.x')
  await expect(dialog(page)).toContainText('Overlay 1.1')
  // Two separate promises: what comes in, and what goes out.
  await expect(dialog(page)).toContainText('Imports')
  await expect(dialog(page)).toContainText('Arazzo 1.1.0')
  // Every bundled component is credited with its version and its license.
  for (const [name, version] of [
    ['daisyUI', '5.7.17'],
    ['Tailwind CSS', '4.3.3'],
    ['JSON Schema $Ref Parser', '16.0.0'],
    ['Marked', '18.0.9'],
    ['DOMPurify', '3.4.13'],
    ['highlight.js', '11.12.0'],
  ]) {
    const item = dialog(page).locator('li', { hasText: name }).first()
    await expect(item).toContainText(version)
  }
  await expect(dialog(page)).toContainText('MPL-2.0 OR Apache-2.0')
  // Build tooling never reaches the browser and must not be credited as if it did.
  await expect(dialog(page)).not.toContainText('Vite')
  await expect(dialog(page)).not.toContainText('Playwright')
})

test('About links to the project and to the issue tracker, in a new tab', async ({ page }) => {
  await gotoApp(page)
  await openAbout(page)
  const project = dialog(page).getByRole('link', { name: 'Project & source' })
  await expect(project).toHaveAttribute('target', '_blank')
  await expect(project).toHaveAttribute('rel', /noopener/)
  await expect(dialog(page).getByRole('link', { name: 'Report a bug' })).toBeVisible()
  // Credit links leave the app too: the docs are a single page, and unloading
  // it would drop whatever the reader had typed in the try-it.
  await expect(dialog(page).getByRole('link', { name: 'daisyUI' })).toHaveAttribute(
    'target',
    '_blank',
  )
})

// Closing lands on the menu trigger, not on the item — the item folded away
// with the menu, and focus must come back to something the reader can still
// see.
test('About closes on Escape and hands focus back to the menu trigger', async ({ page }) => {
  await gotoApp(page)
  await openAbout(page)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('[data-app-menu]')).toBeFocused()
})

test('About speaks the active language', async ({ page }) => {
  await gotoApp(page)
  await openAppMenu(page)
  await page.locator('lang-switcher [data-lang-choice="fr"]').click()
  await page.waitForLoadState()
  await openAppMenu(page)
  await page.locator('[data-menu-about]').click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Composants open source')
  await expect(dialog(page)).toContainText('coloration syntaxique')
})

// The menu is the dialog's only door, and on a phone the bar it sits in is the
// narrowest it ever gets: a trigger the thumb cannot reach there is a license
// notice nobody can read.
test.describe('on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('About stays reachable from the header menu', async ({ page }) => {
    await gotoApp(page)
    await openAbout(page)
  })
})
