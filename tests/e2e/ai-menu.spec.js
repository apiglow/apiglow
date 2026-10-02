// The header's "Copy for AI" menu (docs/architecture.md §5.14.1): the whole
// API, handed to an assistant or wired to an agent, from any page. The
// per-page "Copy page" menu is covered in history-export.spec.js and
// docs-pages.spec.js.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { clipboardText, closeMobilePanels, gotoApp, gotoFixture, selectEnv } from './helpers.js'

const DOCS_PAGE = '/tests/e2e/fixtures/app-docs.html'

const openAiMenu = (page) => page.locator('header details[data-ai-menu] > summary').click()

test('copies the whole documentation, not the index', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await closeMobilePanels(page)
  await openAiMenu(page)
  await page.getByRole('button', { name: 'Copy full docs (llms-full.txt)' }).click()
  await expect.poll(() => clipboardText(page)).toContain('GET https://api.e2e.test/v1/pets')
  expect(await clipboardText(page)).toContain('# E2E Test API')
  await expect(page.getByRole('button', { name: 'Copied!' })).toBeVisible()
})

test('copies the llms.txt index', async ({ page }) => {
  await gotoApp(page)
  await openAiMenu(page)
  await page.getByRole('button', { name: 'Copy index (llms.txt)' }).click()
  await expect.poll(() => clipboardText(page)).toContain('## Reference')
  expect(await clipboardText(page)).toContain('# E2E Test API')
})

test('downloads both files', async ({ page }) => {
  await gotoApp(page)
  for (const [name, filename] of [
    ['Download index (llms.txt)', 'llms.txt'],
    ['Download full docs (llms-full.txt)', 'llms-full.txt'],
  ]) {
    await openAiMenu(page)
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(filename)
    expect(readFileSync(await download.path(), 'utf8')).toContain('# E2E Test API')
  }
})

test('the agent items register this API, never a credential', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await closeMobilePanels(page)
  await openAiMenu(page)
  // The install links carry the same entry, encoded for each editor.
  const cursor = await page.getByRole('link', { name: 'Add to Cursor' }).getAttribute('href')
  expect(cursor).toContain('cursor://anysphere.cursor-deeplink/mcp/install?name=e2e-test-api')
  const vscode = await page.getByRole('link', { name: 'Add to VS Code' }).getAttribute('href')
  expect(JSON.parse(decodeURIComponent(vscode.split('?')[1])).name).toBe('e2e-test-api')
  await page.getByRole('button', { name: 'Copy MCP command' }).click()
  const command = await clipboardText(page)
  expect(command).toMatch(/^claude mcp add e2e-test-api /)
  expect(command).toContain('@ivotoby/openapi-mcp-server')
  expect(command).toContain('/tests/e2e/fixtures/e2e-api.json')
  // Placeholders, never the environment's token (rule 12) — same guarantee as
  // the config block on the home page.
  expect(command).toContain('YOUR_API_KEY')
  expect(command).not.toContain('e2e-bearer-token')
})

// The bar is built once; an install link frozen with it would keep
// registering whichever environment was selected at boot.
test('the agent items follow the selected environment', async ({ page }) => {
  await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
  await selectEnv(page, 'other')
  await openAiMenu(page)
  const cursor = await page.getByRole('link', { name: 'Add to Cursor' }).getAttribute('href')
  const config = new URL(cursor).searchParams.get('config')
  expect(JSON.parse(Buffer.from(config, 'base64').toString()).env.API_BASE_URL).toBe(
    'https://other.e2e.test/v1',
  )
})

// One subject per menu: the page's own Markdown in "Copy page", the API in
// the header — an item in both would be two places to keep in step.
test('the page menu keeps to the page', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await closeMobilePanels(page)
  await page.locator('main details.dropdown > summary', { hasText: 'Copy page' }).click()
  await expect(page.getByRole('button', { name: 'Copy as Markdown' })).toBeVisible()
  await expect(page.locator('main').getByRole('button', { name: 'Copy MCP command' })).toHaveCount(
    0,
  )
  await expect(page.locator('main').getByText('llms-full.txt')).toHaveCount(0)
})
