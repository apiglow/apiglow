// Environments: CRUD UI, sensitive variables, auth suggestions, seed
// from servers, localStorage persistence (docs/architecture.md §5.3/§5.4).
import { test, expect } from '@playwright/test'
import {
  activeEnvName,
  clickNavOp,
  closeEnvManager,
  envOptions,
  envTrigger,
  gotoApp,
  mockApi,
  openEnvManager,
  openEnvSwitcher,
  openTryItIfMobile,
  send,
  tryIt,
} from './helpers.js'

test('config environment is listed and selected in the header switcher', async ({ page }) => {
  await gotoApp(page)
  await expect(activeEnvName(page)).toHaveText('e2e')
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(1)
  await expect(envOptions(page).first()).toContainText('https://api.e2e.test/v1')
})

test('create an environment from the UI, use its base URL and variables in a real request', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoApp(page)
  await openEnvManager(page)
  await page.locator('env-manager').getByRole('button', { name: 'New', exact: true }).click()

  const nameInput = page
    .locator('env-manager .floating-label', { hasText: 'Name' })
    .locator('input')
  await nameInput.fill('staging')
  await nameInput.blur()
  const baseUrl = page.locator('env-manager input[placeholder="https://api.example.com/v1"]')
  await baseUrl.fill('https://api.e2e.test/staging')
  await baseUrl.blur()

  await page.locator('env-manager').getByRole('button', { name: 'Add variable' }).click()
  await page.locator('env-manager input[placeholder="name"]').last().fill('who')
  await page.locator('env-manager input[placeholder="name"]').last().blur()
  const valueInput = page.locator('env-manager label.input input').last()
  await valueInput.fill('world')
  await valueInput.blur()
  // the global bearer auth must also be satisfied in this new env
  await page.locator('env-manager').getByRole('button', { name: '+ auth.bearerAuth' }).click()
  const tokenInput = page.locator('env-manager label.input input').last()
  await tokenInput.fill('staging-token')
  await tokenInput.blur()
  await closeEnvManager(page)

  await expect(activeEnvName(page)).toHaveText('staging')

  await clickNavOp(page, 'listPets')
  await openTryItIfMobile(page)
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  await openTryItIfMobile(page)
  await tryIt(page).locator('input[aria-label="Header name"]').last().fill('X-Hello')
  await openTryItIfMobile(page)
  await tryIt(page).locator('input[aria-label="Header name"]').last().press('Tab')
  const headerValue = tryIt(page)
    .locator('input[aria-label="Header name"]')
    .last()
    .locator('xpath=following-sibling::input[1]')
  await headerValue.fill('{{who}}')
  await send(page)

  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].url).toBe('https://api.e2e.test/staging/pets')
  expect(calls[0].headers['x-hello']).toBe('world')
})

test('created environment persists across a reload', async ({ page }) => {
  await gotoApp(page)
  await openEnvManager(page)
  await page.locator('env-manager').getByRole('button', { name: 'New', exact: true }).click()
  await closeEnvManager(page)
  await page.reload()
  await expect(activeEnvName(page)).toHaveText('Environment 2')
})

test('sensitive variables are masked, with an eye toggle and a plain-storage disclaimer', async ({
  page,
}) => {
  await gotoApp(page)
  await openEnvManager(page)
  await expect(page.locator('env-manager [data-env-editor] [role="note"]')).toContainText(
    'unencrypted',
  )
  // env "e2e": secret and auth.bearerAuth are sensitive → password fields
  const masked = page.locator('env-manager input[type="password"]')
  await expect(masked).toHaveCount(2)
  await page.locator('env-manager button[title="Show / hide value"]').first().click()
  await expect(page.locator('env-manager input[type="password"]')).toHaveCount(1)
  // order of the e2e env variables: token, secret, auth.bearerAuth
  const revealed = page.locator('env-manager label.input input').nth(1)
  await expect(revealed).toHaveAttribute('type', 'text')
  await expect(revealed).toHaveValue('sh-456-secret')
})

test('schema auth schemes suggest their variables; created via one click as sensitive', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoApp(page)
  await openEnvManager(page)
  // auth.bearerAuth already exists in the e2e env → only auth.apiKeyAuth is suggested
  await expect(page.locator('env-manager').getByText('Suggested by the schema:')).toBeVisible()
  const suggestion = page.locator('env-manager').getByRole('button', { name: '+ auth.apiKeyAuth' })
  await suggestion.click()
  await expect(page.locator('env-manager input[placeholder="name"]').last()).toHaveValue(
    'auth.apiKeyAuth',
  )
  // created sensitive by default → password field
  const value = page.locator('env-manager label.input input').last()
  await expect(value).toHaveAttribute('type', 'password')
  await value.fill('key-789')
  await value.blur()
  await closeEnvManager(page)

  // the apiKey operation automatically injects the header named by the schema
  await gotoApp(page, '#/op/listOrders')
  await openTryItIfMobile(page)
  await expect(tryIt(page)).toContainText('API key')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].headers['x-api-key']).toBe('key-789')
})

test('an environment can be seeded from the schema servers (explicit button, not automatic)', async ({
  page,
}) => {
  await gotoApp(page)
  await openEnvManager(page)
  const seed = page.locator('env-manager fieldset', { hasText: 'Create from schema servers' })
  await expect(seed).toContainText('https://api.e2e.test/v1')
  await seed.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(activeEnvName(page)).toHaveText('https://api.e2e.test/v1')
  await expect(
    page.locator('env-manager input[placeholder="https://api.example.com/v1"]'),
  ).toHaveValue('https://api.e2e.test/v1')
})

test('duplicate and delete environments, delete asks for confirmation', async ({ page }) => {
  await gotoApp(page)
  await openEnvManager(page)
  await page.locator('env-manager').getByRole('button', { name: 'Duplicate' }).click()
  await expect(activeEnvName(page)).toHaveText('e2e (copy)')
  page.on('dialog', (d) => d.accept())
  await page.locator('env-manager').getByRole('button', { name: 'Delete' }).click()
  await expect(activeEnvName(page)).toHaveText('e2e')
  // The dropdown list lives behind the manager modal: close it
  // before opening it.
  await closeEnvManager(page)
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(1)
})

test('picking a color in the manager paints a gradient on the switcher, persisted across reload', async ({
  page,
}) => {
  await gotoApp(page)
  const switcher = envTrigger(page)
  await expect(switcher).not.toHaveClass(/from-red-500\/40/)

  await openEnvManager(page)
  await page.locator('env-manager').getByRole('button', { name: 'Red' }).click()
  // selected swatch = ring, and the header badge gets the gradient
  await expect(page.locator('env-manager').getByRole('button', { name: 'Red' })).toHaveClass(
    /ring-2/,
  )
  await expect(switcher).toHaveClass(/bg-linear-to-r/)
  await expect(switcher).toHaveClass(/from-red-500\/40/)

  // "no color" removes the gradient
  await page.locator('env-manager').getByRole('button', { name: 'No color' }).click()
  await expect(switcher).not.toHaveClass(/from-red-500\/40/)

  await page.locator('env-manager').getByRole('button', { name: 'Blue' }).click()
  await closeEnvManager(page)
  await page.reload()
  await expect(switcher).toHaveClass(/from-blue-500\/40/)
})

test('a very long name or base URL stays inside the switcher dropdown', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'apidoc:environments',
      JSON.stringify([
        {
          id: 'long',
          name: 'preproduction cluster eu-west-3 with an interminable name',
          baseUrl:
            'https://api-gateway-preproduction-cluster-eu-west-3.internal.corp.example.com/v2/public/openapi-backend',
          variables: [],
          defaultHeaders: [],
        },
      ]),
    )
  })
  await gotoApp(page)
  await openEnvSwitcher(page)

  // The daisyUI menu is a flex `column wrap`: without a defined width on the
  // items, an unbreakable URL widens the line and overflows text and
  // highlight outside the menu background.
  const menuBox = await page.locator('env-switcher .dropdown-content').boundingBox()
  for (const option of await page.locator('env-switcher .dropdown-content li > *').all()) {
    const box = await option.boundingBox()
    expect(box.width).toBeLessThanOrEqual(menuBox.width)
    expect(box.x + box.width).toBeLessThanOrEqual(menuBox.x + menuBox.width + 1)
  }
  // The trigger stays bounded (max-w caps), the header does not stretch.
  expect((await envTrigger(page).boundingBox()).width).toBeLessThanOrEqual(360)
})
