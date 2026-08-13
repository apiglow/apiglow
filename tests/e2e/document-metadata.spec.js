// What the document says about itself: the `info` block, the `externalDocs` of
// every level that declares one, and the response links that chain one
// operation to the next. A link the page cannot navigate is the case worth
// pinning — it must still show what the schema declared.
import { expect, test } from '@playwright/test'
import { clickInDoc, gotoFixture, gotoOp, openDrawerIfMobile } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-metadata.html'

test('the home page carries the whole info block', async ({ page }) => {
  await gotoFixture(page, PAGE)
  const main = page.locator('main')

  await expect(main).toContainText('Everything the info block can say.')
  await expect(main).toContainText('Apache 2.0')
  // Newest-wins: the SPDX identifier is displayed, the licence URL dropped.
  await expect(main).toContainText('Apache-2.0')
  await expect(main.getByRole('link', { name: 'API team' })).toHaveAttribute(
    'href',
    'mailto:api@metadata.e2e.test',
  )
  await expect(main.getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
    'href',
    'https://metadata.e2e.test/terms',
  )
  const portal = main.getByRole('link', { name: /Developer portal/ })
  await expect(portal).toHaveAttribute('href', 'https://metadata.e2e.test/docs')
  await expect(portal).toHaveAttribute('rel', 'noopener noreferrer')
})

test('external documentation shows up at each level that declares it', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')
  await openDrawerIfMobile(page)

  // Tag: first entry of its nav group, never inside the <summary> — a link
  // nested in the disclosure control would be a control inside a control.
  const tagDocs = page.locator('api-nav').getByRole('link', { name: /Pet guide/ })
  await expect(tagDocs).toHaveAttribute('href', 'https://metadata.e2e.test/docs/pets')
  // Operation: under its header.
  await expect(
    page.locator('main header').getByRole('link', { name: /Creation rules/ }),
  ).toHaveAttribute('href', 'https://metadata.e2e.test/docs/create')
  // Schema: a chip among the constraint chips.
  await expect(page.locator('main #body').getByRole('link', { name: /Pet model/ })).toHaveAttribute(
    'href',
    'https://metadata.e2e.test/docs/pet-model',
  )
})

test('a resolved link navigates to its target operation', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')
  const responses = page.locator('main #responses')

  await expect(responses).toContainText('GetPetById')
  // The runtime expression is documentation: shown as written, never evaluated.
  await expect(responses).toContainText('petId = $response.body#/id')

  await clickInDoc(
    page,
    responses
      .locator('div')
      .filter({ has: page.locator('code:text-is("GetPetById")') })
      .last()
      .getByRole('link', { name: 'Go to operation' }),
  )
  await expect(page.locator('main h1')).toHaveText('Read a pet')
  expect(new URL(page.url()).hash).toBe('#/op/getPet')
})

test('a pointer link resolves, an external one shows what it declared', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet', 'Create a pet')
  const responses = page.locator('main #responses')

  // No operationId on the target: the fallback route id is what it lands on.
  const pointerRow = responses
    .locator('div')
    .filter({ has: page.locator('code:text-is("DropPet")') })
    .last()
  await expect(pointerRow.getByRole('link', { name: 'Go to operation' })).toHaveAttribute(
    'href',
    /#\/op\/delete-pets-petid$/,
  )

  // Another document: no destination to offer, so the page shows the ref
  // rather than pretending there is somewhere to go.
  const externalRow = responses
    .locator('div')
    .filter({ has: page.locator('code:text-is("Elsewhere")') })
    .last()
  await expect(externalRow.getByRole('link', { name: 'Go to operation' })).toHaveCount(0)
  await expect(externalRow).toContainText('https://other.e2e.test/openapi.json#/paths/~1x/get')
})
