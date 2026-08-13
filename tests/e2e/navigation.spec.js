// Side nav, Cmd+K search palette, hash deep-linking (docs/architecture.md §5.2,
// deep links restore state) and embedded Markdown pages (§5.8).
import { test, expect } from '@playwright/test'
import {
  clickInDoc,
  clickNavOp,
  clipboardText,
  gotoApp,
  openDrawerIfMobile,
  panelField,
  panelParam,
  tryIt,
} from './helpers.js'

test('nav groups mirror the schema tags, with endpoint counts', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  const pets = page.locator('api-nav details[data-group="Pets"]')
  await expect(pets.locator('summary')).toContainText('Pets')
  await expect(pets.locator('summary')).toContainText('3')
  await expect(page.locator('api-nav details[data-group="Orders"] summary')).toContainText('3')
  // The tag's description is carried over as the group's tooltip.
  await expect(pets.locator('summary')).toHaveAttribute('title', 'Everything about pets')
  await expect(
    page.locator('api-nav li.menu-title').filter({ hasText: 'Documentation' }),
  ).toBeVisible()
  await expect(page.locator('api-nav [data-page-slug="getting-started"]')).toBeVisible()
})

test('clicking an endpoint renders its doc and updates the hash', async ({ page }) => {
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await expect(page.locator('main h1')).toHaveText('List all pets')
  expect(new URL(page.url()).hash).toBe('#/op/listPets')
  // stacked parameter rows + responses by status with a switcher
  await expect(
    page.locator('section#params-query .api-param-row', { hasText: 'status' }),
  ).toBeVisible()
  await expect(page.locator('section#responses [role="tab"]')).toHaveCount(2)
  // sanitized Markdown description: the **status** in the description is rendered as <strong>
  await expect(page.locator('main strong', { hasText: 'status' })).toBeVisible()
})

test('Ctrl+K opens the search palette; Enter navigates to the selected result', async ({
  page,
}) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.keyboard.press('Control+k')
  const input = page.locator('search-palette input[type="search"]')
  await expect(input).toBeFocused()
  await input.fill('orders')
  await expect(page.locator('search-palette a[data-result-id="listOrders"]')).toBeVisible()
  await expect(page.locator('search-palette a[data-result-id="listPets"]')).toHaveCount(0)
  await input.press('Enter')
  await expect(page.locator('search-palette .modal-box')).not.toBeVisible()
  await expect(page.locator('main h1')).toHaveText('List orders')
  expect(new URL(page.url()).hash).toBe('#/op/listOrders')
  // The nav follows the selection: group open, active entry visible.
  await openDrawerIfMobile(page)
  const navLink = page.locator('api-nav a[data-op-id="listOrders"]')
  await expect(navLink).toBeVisible()
  await expect(navLink).toHaveClass(/menu-active/)
  await expect(navLink).toBeInViewport()
})

test('palette searches schema property names and markdown page titles', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  // One visible trigger per viewport: the header's from lg up, the drawer's below.
  await page.getByRole('button', { name: /Search the docs/ }).click()
  const input = page.locator('search-palette input[type="search"]')
  // "quantity" only appears in the Order schema, the listOrders and createOrder responses
  await input.fill('quantity')
  const hit = page.locator('search-palette a[data-result-id="listOrders"]')
  await expect(hit).toBeVisible()
  await expect(hit).toContainText('quantity')
  // The group is the heading a run of results sits under (same label as the
  // nav section), no longer a column repeated on every row.
  await expect(page.locator('search-palette li.menu-title', { hasText: 'Orders' })).toBeVisible()
  await expect(page.locator('search-palette')).toContainText('2 result(s)')
  await input.fill('getting started')
  await expect(page.locator('search-palette a[data-result-id="getting-started"]')).toBeVisible()
  await input.fill('zzz-nothing')
  await expect(page.locator('search-palette')).toContainText('No results.')
})

test('scope chips narrow the results to one kind', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('Control+k')
  const input = page.locator('search-palette input[type="search"]')
  // "get" lives in both zones: the getPet operation and the Getting started page.
  await input.fill('get')
  await expect(page.locator('search-palette a[data-result-id="getPet"]')).toBeVisible()
  await expect(page.locator('search-palette a[data-result-id="getting-started"]')).toBeVisible()

  await page.locator('search-palette input[name="search-scope"][value="pages"]').check()
  await expect(page.locator('search-palette a[data-result-id="getting-started"]')).toBeVisible()
  await expect(page.locator('search-palette a[data-result-id="getPet"]')).toHaveCount(0)

  await page.locator('search-palette input[name="search-scope"][value="reference"]').check()
  await expect(page.locator('search-palette a[data-result-id="getPet"]')).toBeVisible()
  await expect(page.locator('search-palette a[data-result-id="getting-started"]')).toHaveCount(0)

  // The keyboard contract survives the filter: arrows and Enter still work
  // from the input, and the scope kept only reference results to land on.
  await input.focus()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page).toHaveURL(/#\/op\//)
})

test('the query is highlighted inside the results', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('Control+k')
  await page.locator('search-palette input[type="search"]').fill('orders')
  const hit = page.locator('search-palette a[data-result-id="listOrders"]')
  // Twice: once in the title, once in the path.
  await expect(hit.locator('mark').first()).toContainText(/orders/i)
})

test('reloading on a deep-link #/op/{operationId} restores the operation view', async ({
  page,
}) => {
  await gotoApp(page, '#/op/getPet')
  await expect(page.locator('main h1')).toHaveText('Get a pet by id')
  await expect(page.locator('api-nav a[data-op-id="getPet"]')).toHaveClass(/menu-active/)
})

test('a deep-link with a section anchor scrolls to that section', async ({ page }) => {
  await gotoApp(page, '#/op/listPets/responses')
  await expect(page.locator('section#responses')).toBeInViewport()
})

test('unknown operation link shows a not-found warning', async ({ page }) => {
  await gotoApp(page, '#/op/doesNotExist')
  await expect(page.getByRole('alert')).toContainText('No operation matches this link.')
})

test('section anchor button copies a shareable deep-link', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await clickInDoc(
    page,
    page.locator('section#params-query button[aria-label="Copy link to this section"]'),
  )
  expect(await clipboardText(page)).toContain('#/op/listPets/params-query')
})

test('markdown page renders sanitized with heading anchors and highlighted code', async ({
  page,
}) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.locator('api-nav a[data-page-slug="getting-started"]').click()
  const content = page.locator('.md-content')
  await expect(content.locator('h1')).toContainText('Getting started')
  // heading anchor: slugified id + ¶ link to the page route
  const anchor = content.locator('h2#authentication a.md-anchor')
  await expect(anchor).toHaveAttribute('href', '#/page/getting-started/authentication')
  await expect(content.locator('pre code.hljs').first()).toBeVisible()
})

test('markdown page deep-link with anchor scrolls to the heading', async ({ page }) => {
  await gotoApp(page, '#/page/getting-started/troubleshooting')
  await expect(page.locator('.md-content h2#troubleshooting')).toBeInViewport()
})

test('the nav collapse button folds every open group at once', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  const pets = page.locator('api-nav details[data-group="Pets"]')
  const orders = page.locator('api-nav details[data-group="Orders"]')
  // The landing unfolds the first reference group on its own; opening a
  // second one puts two groups under the collapse button's jurisdiction.
  await expect(pets.locator('a[data-op-id="listPets"]')).toBeVisible()
  await orders.locator('summary').click()
  await expect(orders).toHaveAttribute('open', '')
  await page.locator('api-nav [data-collapse-groups]').click()
  await expect(pets.locator('a[data-op-id="listPets"]')).toBeHidden()
  await expect(orders).not.toHaveAttribute('open', '')
})

// A share link is the one export that has to work in someone else's browser:
// serialized in this tab, opened in a context that shares nothing with it — no
// storage, no in-memory panel state. Building a link and reopening it in the
// same page never proved that.
test('a shared request survives leaving the tab, field for field', async ({ page, browser }) => {
  await gotoApp(page, '#/op/listPets')
  await panelField(page, 'status').selectOption('sold')
  await panelField(page, 'limit').fill('7')
  await panelParam(page, 'tags').locator('input').first().fill('rare')
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  await tryIt(page).locator('input[aria-label="Header name"]').last().fill('X-Trace')
  await tryIt(page).locator('input[aria-label="Header value"]').last().fill('abc-123')

  await tryIt(page).getByRole('button', { name: /Share/ }).click()
  const shared = await clipboardText(page)
  expect(shared).toContain('?req=')

  // Fresh context: another browser profile, as far as the app is concerned.
  const other = await browser.newContext()
  const guest = await other.newPage()
  await guest.goto(shared)
  await expect(guest.locator('api-nav a[data-op-id]').first()).toBeAttached()

  await expect(panelField(guest, 'status')).toHaveValue('sold')
  await expect(panelField(guest, 'limit')).toHaveValue('7')
  await expect(panelParam(guest, 'tags').locator('input').first()).toHaveValue('rare')
  await expect(tryIt(guest).locator('input[aria-label="Header name"]').last()).toHaveValue(
    'X-Trace',
  )
  await expect(tryIt(guest).locator('input[aria-label="Header value"]').last()).toHaveValue(
    'abc-123',
  )
  await other.close()
})
