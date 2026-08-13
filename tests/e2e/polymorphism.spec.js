// Discriminated schemas: the mapping keys have to orient what the page shows
// AND what the try-it sends — a body whose discriminator property contradicts
// its shape is exactly what the construct exists to prevent.
import { expect, test } from '@playwright/test'
import { gotoOp, mockApi, send } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-polymorphism.html'

test('the composite names its discriminator and labels variants by mapping key', async ({
  page,
}) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')
  const body = page.locator('main #body')

  await expect(body).toContainText('One of')
  await expect(body).toContainText('discriminator: petType')
  // The mapping key beats the schema name (`dog` for `Dog`), and a variant the
  // mapping never names is addressed by its own name.
  const options = body.locator('select[aria-label*="petType"] option')
  await expect(options).toHaveText([/^cat —/, /^dog —/, /^Lizard —/])
})

test('the discriminator property is the selector mirror, not a field', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')
  const field = page.locator('main [aria-label="Try-it value for petType"]')

  await expect(field).toHaveValue('cat')
  await expect(field).toBeDisabled()
  // Only the selected variant is on screen: a Cat's fields and a Dog's must
  // never be fillable into the same body.
  await expect(page.locator('main [aria-label="Try-it value for livesLeft"]')).toBeVisible()
  await expect(page.locator('main [aria-label="Try-it value for packSize"]')).toHaveCount(0)
})

test('picking a variant rewrites the body and sends its key', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')

  // The pre-filled body starts on the variant the selector starts on.
  await expect(page.locator('api-try-it-panel textarea')).toHaveValue(/"petType": "cat"/)

  await page.locator('main select[aria-label*="petType"]').selectOption({ label: 'dog — object' })
  await expect(page.locator('main [aria-label="Try-it value for petType"]')).toHaveValue('dog')
  await page.locator('main [aria-label="Try-it value for packSize"]').fill('4')

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  // The previous variant's field left the body with it.
  expect(JSON.parse(calls[0].body)).toEqual({ petType: 'dog', packSize: 4 })
})

// The picker decides which subtree exists, so it belongs to the body and not
// to the doc. Left free, the doc showed a Cat's fields under a body saying
// "dog" — while the mirror field, which DOES follow the body, said "dog" right
// above them. The page contradicted itself and packSize was editable nowhere.
test('a body arriving from elsewhere moves the variant picker', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')

  // What a history reload, a share link or a scenario step hands over.
  await page.locator('api-try-it-panel textarea').fill('{"petType": "dog", "packSize": 4}')

  await expect(page.locator('main select[aria-label*="petType"]')).toHaveValue('1')
  await expect(page.locator('main [aria-label="Try-it value for packSize"]')).toHaveValue('4')
  await expect(page.locator('main [aria-label="Try-it value for livesLeft"]')).toHaveCount(0)
  // Following the body must not rewrite it: an echo here would drop the very
  // keys we were just told about.
  await expect(page.locator('api-try-it-panel textarea')).toHaveValue(
    '{"petType": "dog", "packSize": 4}',
  )
})

test('a parent-side allOf hierarchy names its subtypes', async ({ page }) => {
  await gotoOp(page, PAGE, 'createAnimal', 'Create an animal')
  const body = page.locator('main #body')

  // Nothing on Animal lists Kitten and Puppy: they point back at it through
  // allOf, and the reverse index is what surfaces them here.
  await expect(body).toContainText('discriminator: species → feline, Puppy')
  const row = body
    .locator('div')
    .filter({ has: page.locator('code:text-is("species")') })
    .last()
  await expect(row).toContainText('discriminator')
})
