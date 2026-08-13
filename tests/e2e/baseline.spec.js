// The declared support baseline (package.json `browserslist`: Chrome/Edge 111,
// Firefox 128, Safari/iOS 16.4) is a promise no engine in the matrix can keep
// us honest about — Playwright only ever ships current versions, all of them
// well above the floor. What is testable is the app's behavior when a platform
// API newer than the floor is missing: we remove it before boot and assert the
// documented degradation, not a crash.
//
// One test per API the audit of docs/architecture.md §13 found above the floor.
import { expect, test } from '@playwright/test'
import { gotoApp, panelField } from './helpers.js'

// Popover API: Chrome 114 / Safari 17, i.e. above the floor on both. Deleting
// it from the prototype is what a Chrome 111 actually looks like to feature
// detection, which is how the app decides (anchored-list.js).
async function withoutTopLayer(page) {
  await page.addInitScript(() => {
    delete HTMLElement.prototype.showPopover
    delete HTMLElement.prototype.hidePopover
  })
}

test('without the Popover API, the {{var}} completion still opens and inserts', async ({
  page,
}) => {
  await withoutTopLayer(page)
  await gotoApp(page, '#/op/getPet')

  const field = panelField(page, 'petId')
  await field.fill('')
  await field.pressSequentially('{{')

  // Same list, same keyboard: only the top layer is gone.
  const completion = page.locator('ul[id^="api-var-complete"]')
  await expect(completion).toBeVisible()
  await expect(completion).toContainText('{{token}}')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('{{token}}')
  await expect(completion).toBeHidden()
})

test('without the Popover API, a long enum degrades to a native select', async ({ page }) => {
  await withoutTopLayer(page)
  await gotoApp(page, '#/op/listPets')

  // The combobox would be painted under a modal <dialog> without the top
  // layer, so the documented fallback is the native control — which carries
  // the same 12 values, scrolling and prefix search included.
  const field = panelField(page, 'breed')
  await expect(field).not.toHaveAttribute('role', 'combobox')
  await expect(field.locator('option')).toHaveCount(13) // 12 + the empty row
  await field.selectOption('bulldog')
  await expect(field).toHaveValue('bulldog')
})
