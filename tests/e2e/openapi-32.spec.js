// OpenAPI 3.2: the constructs that did not
// exist in 3.1 must travel through the whole pipeline — normalization,
// nav, doc, and above all the try-it's real send.
import { test, expect } from '@playwright/test'
import { clickNavOp, credentialsCard, mockApi, panelField, send, tryIt } from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-32.html'

async function goto(page) {
  await page.goto(PAGE)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

test('the query method and a free-form method are documented and sent', async ({ page }) => {
  const calls = await mockApi(page)
  await goto(page)

  await clickNavOp(page, 'searchPets')
  await expect(page.locator('main h1')).toHaveText('Search pets')
  await expect(page.locator('main header .badge').first()).toHaveText('query')
  // response `summary` (3.2): displayed in place of the absent description.
  await expect(page.locator('main #responses')).toContainText('Matching pets')

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].method).toBe('QUERY')
  expect(calls[0].url).toBe('https://api.e2e.test/v3/pets')
  // The `dataValue` example pre-filled the body.
  expect(JSON.parse(calls[0].body)).toEqual({ q: 'Rex' })

  await clickNavOp(page, 'purgePets')
  await expect(page.locator('main header .badge').first()).toHaveText('purge')
  await send(page)
  await expect.poll(() => calls.length).toBe(2)
  expect(calls[1].method).toBe('PURGE')
})

test('an in: querystring parameter goes out as-is, without re-encoding', async ({ page }) => {
  const calls = await mockApi(page)
  await goto(page)

  await clickNavOp(page, 'findPets')
  await expect(tryIt(page)).toContainText('Query string')
  await panelField(page, 'filter').fill("$.pets[?(@.name=='Rex')]")

  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(decodeURIComponent(calls[0].url)).toBe(
    "https://api.e2e.test/v3/pets/find?$.pets[?(@.name=='Rex')]",
  )
})

// Tier T3 (docs/openapi-coverage.md §1.1): a construct the browser cannot
// execute is still rendered, and the UI says why — silence would read as a
// broken try-it. Checked where the credential is entered as well as in the
// doc: the cartouche is what promises the send.
test('mutualTLS and the device flow state their browser limit', async ({ page }) => {
  await goto(page)
  await clickNavOp(page, 'streamPets')

  const auth = page.locator('api-endpoint-doc details', { hasText: 'Authentication' })
  await expect(auth).toContainText('cannot present a client certificate')
  await expect(auth).toContainText('polls the token endpoint outside the browser')

  const credentials = credentialsCard(page)
  await expect(credentials).toContainText('cannot present a client certificate')
  await credentials.getByLabel('Credentials').selectOption('deviceOauth')
  await expect(credentials).toContainText('polls the token endpoint outside the browser')
})

// 3.2 tags: `summary` names the section, `parent` nests it, `kind` decides
// whether the tag is a section at all.
test('the nav is a tag hierarchy labelled by the tag summaries', async ({ page }) => {
  await goto(page)

  const pets = page.locator('api-nav details[data-group="Pets"]')
  const streams = page.locator('api-nav details[data-group="Streams"]')
  // The display label is the tag `summary`, and the count covers the subgroup
  // too — a folded parent hides what its children hold.
  await expect(pets.locator('> summary')).toContainText('Pet catalogue')
  await expect(pets.locator('> summary')).toContainText('3')
  // Nested, not a section of its own.
  await expect(pets.locator('details[data-group="Streams"]')).toBeAttached()
  await expect(page.locator('api-nav ul.menu > li > details[data-group="Streams"]')).toHaveCount(0)
  await expect(streams.locator('> summary')).toContainText('Live streams')
  // A tag whose parent no tag declares is an author error the spec forbids;
  // it comes back to the root rather than vanishing.
  await expect(page.locator('api-nav ul.menu > li > details[data-group="Orphans"]')).toBeAttached()

  await clickNavOp(page, 'streamPets')
  await expect(page.locator('main h1')).toHaveText('Stream pets')
})

// A deep link into a nested group has to unfold the whole chain above it: the
// subgroup is out of reach while its parent is folded.
test('a deep link into a subgroup opens every group above it', async ({ page }) => {
  await page.goto(`${PAGE}#/op/streamPets`)
  await expect(page.locator('main h1')).toHaveText('Stream pets')
  // Below lg the nav lives in a closed drawer, so what is checked is the state
  // of the disclosures, not their visibility.
  await expect(page.locator('api-nav details[data-group="Pets"]')).toHaveAttribute('open', '')
  await expect(page.locator('api-nav details[data-group="Streams"]')).toHaveAttribute('open', '')
  await expect(page.locator('api-nav a[data-op-id="streamPets"]')).toHaveClass(/menu-active/)
})

test('a tag whose kind is not navigational badges the operation instead', async ({ page }) => {
  await goto(page)

  await expect(page.locator('api-nav details[data-group="partner"]')).toHaveCount(0)
  await clickNavOp(page, 'findPets')
  const label = page.locator('main header .badge', { hasText: 'Partners' })
  await expect(label).toBeVisible()
  await expect(label).toHaveAttribute('title', 'Reserved for the partner network')
})

test('a sequential media type displays the schema of a stream item', async ({ page }) => {
  await goto(page)
  await clickNavOp(page, 'streamPets')
  const responses = page.locator('main #responses')
  await expect(responses).toContainText('text/event-stream')
  await expect(responses).toContainText('Stream item')
  await expect(responses).toContainText('name')
})
