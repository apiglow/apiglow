// Under lg, the side columns leave the flow: nav as a drawer opened by
// the hamburger, try-it as a bottom sheet opened by the "Try it" FAB.
// Restricted to the `mobile-chrome` / `mobile-safari` projects
// (playwright.config.js), which is where the viewport, the touch input and the
// device pixel ratio come from the device profile rather than from a desktop
// engine told to pretend.
import { test, expect } from '@playwright/test'
import { APP_PAGE, mockApi, tryIt, envTrigger, envOptions } from './helpers.js'

const drawer = (page) => page.locator('aside.api-drawer')
const sheet = (page) => page.locator('aside.api-sheet')
const fab = (page) => page.locator('.fab')
const menuBtn = (page) => page.locator('header button[aria-label="Navigation"]')

test('the nav is a drawer: closed by default, opened by the burger, closed by navigating', async ({
  page,
}) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await expect(page.locator('main h1')).toHaveText('List all pets')
  await expect(drawer(page)).not.toBeVisible()

  await menuBtn(page).click()
  await expect(drawer(page)).toBeVisible()
  await expect(menuBtn(page)).toHaveAttribute('aria-expanded', 'true')

  await page.locator('api-nav a[data-op-id="getPet"]').click()
  await expect(page.locator('main h1')).toHaveText('Get a pet by id')
  await expect(drawer(page)).not.toBeVisible()
})

test('the try-it FAB opens the bottom sheet, and only exists on an operation', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/`)
  await expect(page.locator('main h1')).toBeVisible()
  await expect(fab(page)).not.toBeVisible()

  await page.goto(`${APP_PAGE}#/op/listPets`)
  await expect(fab(page)).toBeVisible()
  await expect(sheet(page)).not.toBeVisible()

  await page.getByRole('button', { name: 'Try it' }).click()
  await expect(sheet(page)).toBeVisible()
  // The FAB fades behind the sheet (it lives above the overlay).
  await expect(fab(page)).not.toBeVisible()

  await sheet(page).getByRole('button', { name: 'Close' }).click()
  await expect(sheet(page)).not.toBeVisible()
  await expect(fab(page)).toBeVisible()
})

test('a request can be sent from the bottom sheet', async ({ page }) => {
  const calls = await mockApi(page)
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await page.getByRole('button', { name: 'Try it' }).click()
  await expect(sheet(page)).toBeVisible()

  await tryIt(page).getByRole('button', { name: 'Send', exact: true }).click()
  await expect(tryIt(page)).toContainText('200')
  expect(calls).toHaveLength(1)
})

test('escape closes the open panel', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await page.getByRole('button', { name: 'Try it' }).click()
  await expect(sheet(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet(page)).not.toBeVisible()

  await menuBtn(page).click()
  await expect(drawer(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer(page)).not.toBeVisible()
})

test('dragging the sheet handle down closes it', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await page.getByRole('button', { name: 'Try it' }).click()
  await expect(sheet(page)).toBeVisible()

  // Synthetic touch gesture: the mouse is deliberately ignored by the
  // handler (it would steal the close button's click).
  const handle = sheet(page).locator('.touch-none').first()
  const box = await handle.boundingBox()
  await handle.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    clientX: box.x + box.width / 2,
    clientY: box.y + 8,
  })
  for (const dy of [40, 90, 140]) {
    await page.evaluate(
      ([x, y]) =>
        window.dispatchEvent(
          new PointerEvent('pointermove', { pointerType: 'touch', clientX: x, clientY: y }),
        ),
      [box.x + box.width / 2, box.y + 8 + dy],
    )
  }
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' })),
  )
  await expect(sheet(page)).not.toBeVisible()
})

test('a guided run opens the sheet by itself: the stepper lives above the form', async ({
  page,
}) => {
  await mockApi(page, { status: 201, body: { id: 42, name: 'Rex' } })
  await page.goto(`${APP_PAGE}#/scenario/onboarding`)
  await page.locator('api-scenario-view').getByRole('button', { name: 'Duplicate' }).click()
  await page.locator('api-scenario-view').getByRole('button', { name: 'Step by step' }).click()

  // Without automatic opening, the banner would be rendered inside a closed sheet.
  await expect(sheet(page)).toBeVisible()
  await expect(page.locator('scenario-stepper')).toContainText('Step 1/3')
  await expect(tryIt(page)).toBeVisible()

  await page.locator('scenario-stepper [data-step-action="quit"]').click()
  await expect(page.locator('scenario-stepper')).toBeHidden()
})

test('the env switcher opens on tap, without needing focus', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await expect(page.locator('main h1')).toBeVisible()
  // <details> variant of the dropdown: a tap is enough. daisyUI's "focusable
  // div" variant would not open on a finger tap.
  await envTrigger(page).click()
  await expect(page.locator('env-switcher .dropdown-content')).toBeVisible()
  await expect(envOptions(page)).toHaveCount(1)
})

test('the "Copy page" menu opens on tap, without needing focus', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  await expect(page.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible()
  // A tap outside closes it (behavior a <details> does not have natively)
  await page.locator('main h1').click()
  await expect(page.getByRole('button', { name: 'Copy as Markdown' })).not.toBeVisible()
})

test('the export format menu opens inside the sheet and closes on an outside tap', async ({
  page,
}) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  await page.getByRole('button', { name: 'Try it' }).click()
  const menu = page.locator('[data-export-bar] [data-format-picker] .dropdown-content')
  await page.locator('[data-export-bar] [data-format-picker] > summary').click()
  await expect(menu).toBeVisible()
  await page.locator('[data-export-bar]').getByText('EXPORT').click()
  await expect(menu).not.toBeVisible()
})
