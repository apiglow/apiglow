// Footer + About dialog: the distribution's only carrier for the license and
// third-party notices (docs/architecture.md §5.13). The suite checks what those
// notices actually say against the packed bundle — a credits list that renders
// empty, or a version that reads "undefined", is a compliance defect, not a
// cosmetic one.
import { expect, test } from '@playwright/test'
import { APP_NAME, APP_PAGE, APP_VERSION, gotoApp, openAppMenu } from './helpers.js'

const footer = (page) => page.locator('footer')
const dialog = (page) => page.locator('about-dialog .modal-box')

async function openAbout(page) {
  await footer(page).getByRole('button', { name: 'About' }).click()
  await expect(dialog(page)).toBeVisible()
}

test('the footer names the tool and its version', async ({ page }) => {
  await gotoApp(page)
  // The tool's own name, not the host's product name, which stays in the header.
  await expect(footer(page)).toContainText(`Powered by ${APP_NAME} v${APP_VERSION}`)
  await expect(page.locator('header')).toContainText('E2E Docs')
})

test('About states the license, what it reads, and what it bundles', async ({ page }) => {
  await gotoApp(page)
  await openAbout(page)
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

test('About closes on Escape and gives focus back to the footer link', async ({ page }) => {
  await gotoApp(page)
  const opener = footer(page).getByRole('button', { name: 'About' })
  await openAbout(page)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(opener).toBeFocused()
})

// The second door (§5.13): the footer is a scroll away at the bottom of a long
// page, and the dialog is where the keyboard shortcuts are listed. Closing
// lands on the menu trigger, not on the item — the item folded away with the
// menu, and focus must come back to something the reader can still see.
test('the preferences menu opens About too, and hands focus back to its trigger', async ({
  page,
}) => {
  await gotoApp(page)
  await openAppMenu(page)
  await page.locator('[data-menu-about]').click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('[data-app-menu]')).toBeFocused()
})

test('host footer links sit next to About without replacing it', async ({ page }) => {
  await gotoApp(page)
  const legal = footer(page).getByRole('link', { name: 'Legal notice' })
  await expect(legal).toHaveAttribute('href', 'https://legal.e2e.test')
  await expect(legal).toHaveAttribute('target', '_blank')
  await expect(footer(page).getByRole('button', { name: 'About' })).toBeVisible()
})

test('the footer speaks the active language', async ({ page }) => {
  await gotoApp(page)
  await openAppMenu(page)
  await page.locator('lang-switcher [data-lang-choice="fr"]').click()
  await page.waitForLoadState()
  await expect(footer(page)).toContainText(`Propulsé par ${APP_NAME} v${APP_VERSION}`)
  await footer(page).getByRole('button', { name: 'À propos' }).click()
  await expect(dialog(page)).toContainText('Composants open source')
  await expect(dialog(page)).toContainText('coloration syntaxique')
})

// Below lg the "Try it" FAB floats over the bottom right of the viewport, right
// where the footer's links are on desktop. The click is the assertion:
// Playwright refuses to click an element another one covers.
test.describe('on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the About link stays clickable under the try-it FAB', async ({ page }) => {
    // Raw goto, not gotoApp: the shared helper opens the sheet on an operation
    // route so desktop-written specs reach the panel, and the sheet is exactly
    // what would take the FAB off screen here. The FAB is the subject.
    await page.goto(`${APP_PAGE}#/op/listPets`)
    await expect(page.locator('.fab')).toBeVisible()
    await openAbout(page)
  })
})
