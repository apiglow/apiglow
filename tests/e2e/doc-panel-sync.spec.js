// The doc↔panel mirror contract (rule 20). The central doc holds no choice of
// its own: every widget in it derives from the try-it panel's state. This
// suite is the guard for the widgets that decide WHAT is editable — they are
// the ones whose drift is silent, because the page keeps looking plausible
// while the two columns edit different things.
import { expect, test } from '@playwright/test'
import { clickInDoc, editInDoc, gotoOp, panelField, tryIt } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-sync.html'

const setBody = (page, json) => tryIt(page).locator('textarea').fill(json)

// "Expand" builds brand-new editors. Left to wait for the next unrelated
// state push, they open empty over a body that has values.
test('an expanded subtree opens on the values the body already holds', async ({ page }) => {
  await gotoOp(page, PAGE, 'createDeep')
  await setBody(
    page,
    JSON.stringify({
      label: 'top',
      level1: { level2: { level3: { level4: { buried: 'gold' } } } },
    }),
  )

  const doc = page.locator('main #body')
  await expect(doc.getByRole('button', { name: /Expand/ })).toBeVisible()
  // Nothing below the auto-expansion budget is editable yet.
  await expect(
    page.locator('main [aria-label="Try-it value for level1.level2.level3.level4.buried"]'),
  ).toHaveCount(0)

  await clickInDoc(page, doc.getByRole('button', { name: /Expand/ }).first())
  await expect(
    page.locator('main [aria-label="Try-it value for level1.level2.level3.level4.buried"]'),
  ).toHaveValue('gold')
})

test('a recursive subtree expanded by hand is editable, and edits reach the panel', async ({
  page,
}) => {
  await gotoOp(page, PAGE, 'createNode')
  await setBody(page, JSON.stringify({ name: 'root', child: { name: 'kid' } }))

  const doc = page.locator('main #body')
  await clickInDoc(page, doc.getByRole('button', { name: /Expand/ }).first())
  const childName = page.locator('main [aria-label="Try-it value for child.name"]')
  await expect(childName).toHaveValue('kid')

  await editInDoc(page, () => childName.fill('renamed'))
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"renamed"/)
})

// The scalar parameter is the baseline mirror, guarded on the stacked-row
// layout: the field now lives inside the parameter's own row (`.api-param-row`)
// instead of a table cell, and a restyle that rebuilt the row without
// re-registering the field would keep the page plausible while this exact
// round-trip dies.
test('a scalar parameter mirrors both ways from its stacked row', async ({ page }) => {
  await gotoOp(page, PAGE, 'createDeep')
  const docField = page
    .locator('section#params-query .api-param-row', {
      has: page.locator('code:text-is("limit")'),
    })
    .getByLabel('Try-it value for limit')
  await editInDoc(page, () => docField.fill('25'))
  await expect(panelField(page, 'limit')).toHaveValue('25')
  await panelField(page, 'limit').fill('50')
  await expect(docField).toHaveValue('50')
})

// Every editable parameter shape, in one pass: the panel writes, the doc
// must show the same thing without being told twice.
test('parameters of every shape mirror both ways', async ({ page }) => {
  await gotoOp(page, PAGE, 'createDeep')

  // Array parameter: the doc's rows are rebuilt from the panel's value.
  const panelTags = tryIt(page).locator('.api-param').filter({ hasText: 'tags' }).locator('input')
  await panelTags.first().fill('cat')
  await expect(page.locator('main [aria-label="Try-it value for tags"]').first()).toHaveValue('cat')

  // Object parameter (deepObject): one field per property, on both sides.
  await editInDoc(page, () =>
    page.locator('main [aria-label="Try-it value for owner city"]').fill('Lyon'),
  )
  await expect(tryIt(page).locator('[aria-label="owner city"]')).toHaveValue('Lyon')
})

// A declared header parameter is the one param the panel does NOT render as
// an `.api-param`: it lands in the free header rows, under its name. The
// mirror therefore crosses two different widgets, which is why it gets its
// own test rather than riding along with the parameter shapes above.
test('a header parameter mirrors into the panel header rows, both ways', async ({ page }) => {
  await gotoOp(page, PAGE, 'createShapes')
  const docField = page.locator('main [aria-label="Try-it value for X-Trace-Id"]')
  // The operation declares exactly one header, so the first row is it.
  const panelName = tryIt(page).locator('[aria-label="Header name"]').first()
  const panelValue = tryIt(page).locator('[aria-label="Header value"]').first()

  await expect(panelName).toHaveValue('X-Trace-Id')
  await editInDoc(page, () => docField.fill('from-doc'))
  await expect(panelValue).toHaveValue('from-doc')
  await panelValue.fill('from-panel')
  await expect(docField).toHaveValue('from-panel')
})

// `in: querystring` (3.2) is the one parameter with no per-name bucket in the
// panel's state — it IS the whole query string. That special case is exactly
// where a mirror silently stops being one.
test('an in: querystring parameter mirrors both ways', async ({ page }) => {
  await gotoOp(page, PAGE, 'searchShapes')
  const docField = page.locator('main [aria-label="Try-it value for filter"]')
  await editInDoc(page, () => docField.fill('$.a[0]'))
  await expect(panelField(page, 'filter')).toHaveValue('$.a[0]')
  await panelField(page, 'filter').fill('$.b[1]')
  await expect(docField).toHaveValue('$.b[1]')
})

// A free-form map's KEYS are data too: the mirror has to carry the pair, not
// just the value, or the doc rebuilds rows under the wrong names.
test('a free-form map mirrors its keys as well as its values', async ({ page }) => {
  await gotoOp(page, PAGE, 'createShapes')
  await setBody(page, JSON.stringify({ map: { alpha: 'one' } }))

  const doc = page.locator('main #body')
  await expect(doc.locator('[aria-label="map key"]')).toHaveValue('alpha')
  await expect(doc.locator('[aria-label="Try-it value for map"]')).toHaveValue('one')

  await editInDoc(page, () => doc.locator('[aria-label="map key"]').fill('beta'))
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"beta"/)
  await editInDoc(page, () => doc.locator('[aria-label="Try-it value for map"]').fill('two'))
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"two"/)
})

// A tuple's positions are its type: a mirror that drops an empty slot shifts
// every following element onto the wrong schema.
test('a tuple mirrors position by position', async ({ page }) => {
  await gotoOp(page, PAGE, 'createShapes')
  await setBody(page, JSON.stringify({ pair: ['left', 7] }))

  const doc = page.locator('main #body')
  await expect(doc.locator('[aria-label="Try-it value for pair[0]"]')).toHaveValue('left')
  await expect(doc.locator('[aria-label="Try-it value for pair[1]"]')).toHaveValue('7')

  await editInDoc(page, () => doc.locator('[aria-label="Try-it value for pair[1]"]').fill('9'))
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"left",\s*9/)
})

// The response status tabs are the one mirror where neither side edits the
// request: both columns document the same status, and a drift means reading
// the 422 shape while the example mockup shows the 201.
test('the response status is one choice, shared by both columns', async ({ page }) => {
  await gotoOp(page, PAGE, 'createShapes')
  const docTabs = page.locator('main #responses [role="tab"]')
  const panelPills = tryIt(page)
    .locator('button[title]')
    .filter({ hasText: /^(201|422)$/ })

  await panelPills.filter({ hasText: '422' }).click()
  await expect(docTabs.filter({ hasText: '422' })).toHaveClass(/tab-active/)

  await clickInDoc(page, docTabs.filter({ hasText: '201' }))
  await expect(panelPills.filter({ hasText: '422' })).toHaveAttribute('aria-pressed', 'false')
})

// The ordering contract of §5.5.4: media type → variant → fields. Switching
// the media type rebuilds the variant picker, which rebuilds the fields. A
// pass applied out of order fills editors that are about to be thrown away
// and leaves their replacements empty — and the page still looks plausible.
test('a media type change rebuilds the variant and its fields, in that order', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet')
  const doc = page.locator('main #body')

  // First media type: a flat object, no discriminator anywhere.
  await expect(doc.locator('[aria-label="Try-it value for note"]')).toBeVisible()
  await expect(doc.locator('[aria-label="Try-it value for petType"]')).toHaveCount(0)

  await doc.locator('select[aria-label="Media type"]').selectOption({ label: 'application/json' })

  // Everything below is asserted on the state the switch itself produced —
  // no further interaction. `show()` does not call `onEditorsChanged`, so
  // these brand-new editors are filled by the *same* state push that carried
  // the media type: applied in the wrong order, they stay empty and the page
  // still looks plausible.
  const variant = doc.locator('select[aria-label*="petType"]')
  await expect(variant).toHaveValue('0')
  await expect(doc.locator('[aria-label="Try-it value for petType"]')).toHaveValue('cat')
  await expect(doc.locator('[aria-label="Try-it value for note"]')).toHaveCount(0)
  await expect(tryIt(page).locator('select[aria-label="Media type"]')).toHaveValue('1')
  // The one assertion the wrong order cannot satisfy: `livesLeft` carries a
  // value the freshly-built editor has no way to invent — it can only come
  // from the same push, applied after the rebuild.
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"livesLeft":\s*0/)
  await expect(doc.locator('[aria-label="Try-it value for livesLeft"]')).toHaveValue('0')

  // And the picker still owns the subtree below it, one media type later.
  await variant.selectOption({ label: 'dog — object' })
  await expect(doc.locator('[aria-label="Try-it value for petType"]')).toHaveValue('dog')
  await expect(doc.locator('[aria-label="Try-it value for packSize"]')).toBeVisible()
  await expect(doc.locator('[aria-label="Try-it value for livesLeft"]')).toHaveCount(0)
  await expect(tryIt(page).locator('textarea')).toHaveValue(/"petType":\s*"dog"/)
})

// Which scheme the send injects is a choice, and it was the panel's alone: the
// doc painted the same badge on every applicable scheme, so a reader looking at
// three "configured" rows could not tell which credential was about to travel.
// The doc holds no choice of its own here either — it derives the mark.
test('the auth scheme the send will use is marked in the doc', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPet')
  // Nothing is configured in this fixture, so the section renders open: no
  // click, which would close it.
  const auth = page.locator('api-endpoint-doc details', { hasText: 'Authentication' })

  // The first applicable scheme is the panel's default, and the doc says so
  // without being asked twice.
  await expect(auth.locator('[data-auth-active="bearerAuth"]')).toBeVisible()
  await expect(auth.locator('[data-auth-active="apiKeyAuth"]')).toBeHidden()

  await tryIt(page).getByLabel('Credentials').selectOption('apiKeyAuth')
  await expect(auth.locator('[data-auth-active="apiKeyAuth"]')).toBeVisible()
  await expect(auth.locator('[data-auth-active="bearerAuth"]')).toBeHidden()
})
