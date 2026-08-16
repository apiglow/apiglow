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

// The FAB floats over the doc column, so a line of body text sits under it for
// as long as the reader stops there. Away is `visibility: hidden`, which is
// also what keeps an off-screen control out of the tab order.
test('the FAB steps out of the way going down and comes back going up', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/createPet`)
  await expect(fab(page)).toBeVisible()

  // The touch is what makes it the reader's scroll rather than the page's —
  // a section anchor moves the same row and must leave the button alone.
  const scrollTo = (top, { byHand = true } = {}) =>
    page.evaluate(
      ([y, hand]) => {
        const row = document.querySelector('main').parentElement
        if (hand) row.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }))
        row.scrollTop = y
        return { at: row.scrollTop, scrollable: row.scrollHeight - row.clientHeight }
      },
      [top, byHand],
    )

  // The premise: this page is long enough to scroll past the threshold.
  expect((await scrollTo(0)).scrollable).toBeGreaterThan(400)

  await scrollTo(400)
  await expect(fab(page)).not.toBeVisible()
  await scrollTo(120)
  await expect(fab(page)).toBeVisible()
  // Back at the top it stays, whatever the last direction was.
  await scrollTo(0)
  await expect(fab(page)).toBeVisible()
})

test('a scroll the page did on its own leaves the FAB alone', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets/responses`)
  await expect(page.locator('section#responses')).toBeInViewport()
  await expect(fab(page)).toBeVisible()
})

// A shortcut is advertised where there is a keyboard to press it with. The
// device profile is what makes this a real question: `pointer: coarse` comes
// from the emulated phone, not from the viewport.
test('the keyboard hints stay off a touch device', async ({ page }) => {
  await page.goto(`${APP_PAGE}#/op/listPets`)
  // The bar holds both search triggers at all times and shows one: below md
  // the icon, above it the field carrying the chip. Counted first: `toBeHidden`
  // is also true of an element that is not there, and the point is that the
  // chip exists and is withheld.
  const chip = page.locator('header .api-kbd-hint')
  await expect(chip).toHaveCount(1)
  await expect(chip).toBeHidden()

  await page.getByRole('button', { name: /Search the docs/ }).click()
  await expect(page.locator('search-palette .modal-box')).toBeVisible()
  // Counted first: `toBeHidden` is also true of an element that is not there,
  // and the point is that the legend exists and is withheld.
  const legend = page.locator('search-palette .api-kbd-hint')
  await expect(legend).toHaveCount(1)
  await expect(legend).toBeHidden()
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
