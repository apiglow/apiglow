// JSON Schema 2020-12 keywords: what a 3.1 schema can say beyond properties and
// items must reach the page — and must leave the try-it's structured editor
// alone, which only ever walks the base shape.
import { expect, test } from '@playwright/test'
import { clickNavOp, gotoFixture, mockApi, send } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-keywords.html'

async function goto(page) {
  await gotoFixture(page, PAGE)
  await clickNavOp(page, 'createPayment')
  await expect(page.locator('main h1')).toHaveText('Create a payment')
}

test('the conditional keywords render as labeled panes', async ({ page }) => {
  await goto(page)
  const body = page.locator('main #body')

  await expect(body).toContainText('If — object')
  await expect(body).toContainText('Then — object')
  await expect(body).toContainText('Otherwise — object')
  await expect(body).toContainText('Must not match — object')
  // A dependent schema names the property that brings it in.
  await expect(body).toContainText('When iban is present')
  // The branches are real subtrees, not just headers.
  await expect(body).toContainText('cardNumber')
  await expect(body).toContainText('bic')
})

test('pattern keys are rows of the property table, badged as such', async ({ page }) => {
  await goto(page)
  const patternHead = page
    .locator('main #body div')
    .filter({ has: page.locator('code:text-is("^x-")') })
    .last()

  await expect(patternHead).toContainText('pattern')
  // No name to type a value under: never an editable field.
  await expect(page.locator('main [aria-label*="^x-"]')).toHaveCount(0)
})

test('the remaining keywords join the constraint chips', async ({ page }) => {
  await goto(page)
  const body = page.locator('main #body')

  await expect(body).toContainText('keys: /^[a-z-]+$/')
  await expect(body).toContainText('no unevaluated properties')
  await expect(body).toContainText('requires: cardNumber → cvv')
  await expect(body).toContainText('contains string 1–2')
  await expect(body).toContainText('encoding: base64')
  await expect(body).toContainText('media type: image/png')
})

test('the structured editor still builds and sends the base shape', async ({ page }) => {
  const calls = await mockApi(page)
  await goto(page)

  // The keywords are inert for the editor: the declared properties keep their
  // fields, and a `$defs` schema referenced from one of them keeps a name to
  // display, exactly like a components.schemas one.
  await expect(page.locator('main #body')).toContainText('array<Currency>')
  await page.locator('main [aria-label="Try-it value for method"]').selectOption('card')

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(JSON.parse(calls[0].body)).toMatchObject({ method: 'card' })
})

// A tuple's positions ARE its type. In the try-it form they have always been
// drawn as fixed slots; in the reference view — a response, a webhook, a
// callback — a `prefixItems`-only array declares no `items`, so it used to
// render as `array<any>` with no subtree at all. The documentation of a shape
// said strictly less than the form for filling it in (rule 19).
test('a tuple in a response documents each of its positions', async ({ page }) => {
  await goto(page)
  const responses = page.locator('main #responses')

  await expect(responses).toContainText('tuple[string, integer]')
  await expect(responses).not.toContainText('array<any>')
  // Named by index, as the editable slots are, and each carrying its own type.
  const span = responses.locator('.api-row', { hasText: 'span' }).first()
  await expect(span).toContainText('Fixed [start, end] instants')
  await expect(span.locator('.api-row', { hasText: '0' }).first()).toContainText('date-time')
  await expect(span.locator('.api-row', { hasText: '1' }).first()).toContainText('integer')
})
