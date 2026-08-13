// The install contract: the inline config + the packed bundle are enough to
// get a complete doc; distinct loading error states (docs/architecture.md §5.1).
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import {
  APP_PAGE,
  clickNavOp,
  clipboardText,
  expectResponded,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openSettings,
  send,
} from './helpers.js'

test('boots from inline config + CDN bundle: branding, nav, welcome stats', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('header')).toContainText('E2E Docs')
  // 6 operations across the reference groups — declared on `data-ops`, since
  // a closed group's links only build when it opens — plus the 2 webhooks,
  // whose flat links are always in the DOM.
  await expect(page.locator('api-nav details[data-ops]').first()).toBeAttached()
  const declaredOps = await page
    .locator('api-nav details[data-ops]')
    .evaluateAll((groups) => groups.flatMap((group) => group.dataset.ops.split(' ')).length)
  expect(declaredOps).toBe(6)
  await expect(page.locator('api-nav li > a[data-op-id]:not(details a)')).toHaveCount(2)
  await expect(page.locator('.stat').filter({ hasText: 'Operations' })).toContainText('6')
  await expect(page.locator('.stat').filter({ hasText: 'Groups' })).toContainText('2')
  await expect(page.locator('.stat').filter({ hasText: 'Webhooks' })).toContainText('2')
  await expect(page.locator('.stat').filter({ hasText: 'Security schemes' })).toContainText('4')
})

test('schema URL returning 404 shows the http error state', async ({ page }) => {
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) =>
    r.fulfill({ status: 404, body: 'gone' }),
  )
  await page.goto(APP_PAGE)
  await expect(page.getByRole('alert')).toContainText('HTTP 404')
})

test('unparseable schema shows the malformed error state', async ({ page }) => {
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{ this is not json' }),
  )
  await page.goto(APP_PAGE)
  await expect(page.getByRole('alert')).toContainText('could not be parsed')
})

// 2.0 itself is read by conversion (`swagger2.spec.js`): what is left
// unsupported is a Swagger version with no conversion table.
test('pre-2.0 swagger document shows the unsupported-version error state', async ({ page }) => {
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ swagger: '1.2', paths: {} }),
    }),
  )
  await page.goto(APP_PAGE)
  await expect(page.getByRole('alert')).toContainText('Unsupported version')
})

test('unreachable schema URL shows the network/CORS error state', async ({ page }) => {
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) => r.abort('failed'))
  await page.goto(APP_PAGE)
  await expect(page.getByRole('alert')).toContainText('network failure or a CORS restriction')
})

test('HTML in schema descriptions is sanitized — no script ever executes (docs/architecture.md §8)', async ({
  page,
}) => {
  const schema = JSON.parse(
    readFileSync(new URL('./fixtures/e2e-api.json', import.meta.url), 'utf8'),
  )
  const payload = '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> **legit**'
  schema.info.description = payload
  schema.paths['/pets'].get.description = payload
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(schema) }),
  )
  await gotoApp(page)
  // home view: schema description rendered as sanitized Markdown
  await expect(page.locator('main strong', { hasText: 'legit' })).toBeVisible()
  await gotoApp(page, '#/op/listPets')
  await expect(page.locator('main h1')).toHaveText('List all pets')
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  expect(await page.locator('main [onerror]').count()).toBe(0)
})

test('the home spec download serves the OpenAPI file as served', async ({ page }) => {
  await gotoApp(page)
  const explanation = page.locator('main p', { hasText: 'The machine-readable contract' })
  await expect(explanation).toBeHidden()
  await page.getByRole('button', { name: 'What is this file?' }).click()
  await expect(explanation).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download the OpenAPI file' }).click()
  const download = await downloadPromise
  // Name and content of the original file: no renaming, no reformatting.
  expect(download.suggestedFilename()).toBe('e2e-api.json')
  const served = readFileSync(new URL('./fixtures/e2e-api.json', import.meta.url), 'utf8')
  expect(readFileSync(await download.path(), 'utf8')).toBe(served)
})

test('the home security callout details every scheme, folded by default', async ({ page }) => {
  await gotoApp(page)
  const card = page.locator('main .card', { hasText: 'Credentials live in environment variables' })
  await expect(card.locator('.collapse, .rounded-box')).toHaveCount(4)
  await expect(card).toContainText('bearerAuth')
  await expect(card).toContainText('header X-Api-Key')
  await expect(card).toContainText('{{auth.apiKeyAuth}}')
  // The detail (flows, scopes, URLs) only appears once expanded.
  const oauth = card.locator('details', { hasText: 'oauth2Auth' })
  await expect(oauth).toContainText('OAuth 2.0')
  await expect(oauth.getByText('read:orders').first()).toBeHidden()
  await oauth.locator('summary').click()
  await expect(oauth.getByText('Authorization Code + PKCE')).toBeVisible()
  await expect(oauth.getByText('https://auth.e2e.test/authorize')).toBeVisible()
  await expect(oauth.getByText('Read the orders').first()).toBeVisible()
})

test('the home LLM callout downloads the full llms-full.txt', async ({ page }) => {
  await gotoApp(page)
  // The explanation is collapsed behind the help button.
  const explanation = page.locator('main p', { hasText: 'The entire documentation' })
  await expect(explanation).toBeHidden()
  await page.getByRole('button', { name: 'What is llms-full.txt?' }).click()
  await expect(explanation).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms-full.txt' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('llms-full.txt')
  const content = readFileSync(await download.path(), 'utf8')
  // info + Markdown pages + operations: the same content as the doc menu export
  expect(content).toContain('# E2E Test API')
  expect(content).toContain('GET https://api.e2e.test/v1/pets')
  // Strings only the page BODY can produce: the fixture's frontmatter declares
  // `title: Getting started`, so matching the title alone would pass on a file
  // carrying nothing but the metadata block.
  expect(content).toContain('# Page: Getting started')
  expect(content).toContain('Welcome to the **Petstore API** guide.')
  expect(content).not.toContain('Frontmatter written for another tool')
  // The declared scenario, downloaded by the export itself, with the recipe
  // inlined rather than linked (docs/scenario-handoff.md §3.3).
  expect(content).toContain('# Workflow: Onboarding')
  expect(content).toContain('## Arazzo recipe')
  expect(content).toContain('"arazzo": "1.1.0"')
})

test('the home LLM callout downloads the llms.txt index', async ({ page }) => {
  await gotoApp(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms.txt' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('llms.txt')
  const content = readFileSync(await download.path(), 'utf8')
  expect(content).toContain('# E2E Test API')
  // Absolute links into the host page's own hash routes, the Markdown pages
  // included — the index points, it doesn't inline.
  expect(content).toMatch(/- \[GET \/pets]\(http:\/\/[^)]+\/tests\/e2e\/fixtures\/app\.html#\/op\//)
  expect(content).toContain('#/page/getting-started')
  // The workflows sit between the guides and the endpoints, as they do in the
  // nav; without a bake there is no `.md` to fetch, so the line links the hash
  // route and no recipe URL is invented for a file nobody serves (§3.2).
  expect(content).toMatch(
    /## Workflows\n\n- \[Onboarding]\([^)]+#\/scenario\/onboarding\): \d+ step/,
  )
  expect(content).not.toContain('Arazzo recipe')
  expect(content.indexOf('## Workflows')).toBeLessThan(content.indexOf('## Reference'))
  expect(content).toContain('## Reference')
  expect(content).toContain('/tests/e2e/fixtures/e2e-api.json')
})

test('the MCP card generates a config for the selected bridge', async ({ page }) => {
  await gotoApp(page)
  const card = page.locator('details', { hasText: 'Use this API from an AI agent' })
  await card.locator('summary').click()
  const config = card.locator('pre')
  await expect(config).toContainText('"mcpServers"')
  await expect(config).toContainText('@ivotoby/openapi-mcp-server')
  await expect(config).toContainText('/tests/e2e/fixtures/e2e-api.json')
  // The schema declares an apiKey and a bearer scheme: placeholders, never the
  // environment's real token.
  await expect(config).toContainText('YOUR_API_KEY')
  await expect(config).not.toContainText('e2e-bearer-token')
  await expect(card.getByText('placeholders')).toBeVisible()
  // Switching bridge rewrites the block in place.
  await card.getByLabel('OpenAPI → MCP bridge').selectOption('api-to-mcp')
  await expect(config).toContainText('@tyk-technologies/api-to-mcp')
  await expect(config).toContainText('--targetUrl')
  const downloadPromise = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Download mcp.json' }).click()
  expect((await downloadPromise).suggestedFilename()).toBe('mcp.json')
  // The command and the install links follow the same selector: what the block
  // shows is what they register.
  await expect(card.getByRole('link', { name: 'Add to Cursor' })).toHaveAttribute(
    'href',
    /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=e2e-test-api/,
  )
  await card.getByRole('button', { name: 'Copy the command' }).click()
  expect(await clipboardText(page)).toContain('@tyk-technologies/api-to-mcp')
})

// What the reader opened and chose here is theirs, and outlives a write they
// did not make: the welcome view is rebuilt whole when a history read or a
// purge lands on it, and a card that collapsed under their fingers — or snapped
// back to the first bridge while they were reading the second one's config —
// is a defect, not a redraw.
test('the MCP card keeps its open state and its bridge across a re-render', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  // One history entry, so the purge below has something to clear and fires the
  // store change that rebuilds the view under the card.
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)
  await page.goto(`${APP_PAGE}#/overview`)

  const card = page.locator('details', { hasText: 'Use this API from an AI agent' })
  await card.locator('summary').click()
  await card.getByLabel('OpenAPI → MCP bridge').selectOption('api-to-mcp')
  await expect(card.locator('pre')).toContainText('@tyk-technologies/api-to-mcp')

  await openSettings(page)
  const historyRow = page.locator('settings-panel .modal-box li[data-dataset="history"]')
  await historyRow.getByRole('button', { name: 'Clear', exact: true }).click()
  await historyRow.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('settings-panel .modal-box [data-count-for="history"]')).toHaveText('0')
  await page.locator('settings-panel .modal-box button.btn-circle').click()

  await expect(card).toHaveAttribute('open', '')
  await expect(card.getByLabel('OpenAPI → MCP bridge')).toHaveValue('api-to-mcp')
  await expect(card.locator('pre')).toContainText('@tyk-technologies/api-to-mcp')
})

test('the nav closes its documentation zone with the llms.txt index', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  const downloadPromise = page.waitForEvent('download')
  await page.locator('api-nav [data-llms-text]').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('llms.txt')
  expect(readFileSync(await download.path(), 'utf8')).toContain('# E2E Test API')
})
