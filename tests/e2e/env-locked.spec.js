// Environments locked by config (environmentsLocked): selector
// available but no entry point to the CRUD, colors coming from the
// config, stored environments outside the config ignored.
import { test, expect } from '@playwright/test'
import {
  clickNavOp,
  envOptions,
  envTrigger,
  gotoFixture,
  mockApi,
  openEnvSwitcher,
  openHistory,
  selectEnv,
  send,
  tryIt,
} from './helpers.js'
import { encodeSetupLink } from '../../src/env/setup-link.js'

const LOCKED_PAGE = '/tests/e2e/fixtures/app-locked.html'

async function gotoLocked(page) {
  await page.goto(LOCKED_PAGE)
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
}

test('config environments are selectable but there is no management UI at all', async ({
  page,
}) => {
  await gotoLocked(page)
  await openEnvSwitcher(page)
  const options = envOptions(page)
  await expect(options).toHaveCount(2)
  await expect(options.nth(0)).toContainText('staging')
  await expect(options.nth(1)).toContainText('prod')
  // no "Environments" item in the list, nor manager mounted
  await expect(
    page.locator('env-switcher').getByRole('button', { name: 'Environments' }),
  ).toHaveCount(0)
  await expect(page.locator('env-manager')).toHaveCount(0)
  // nor a "manage" button in the try-it panel either
  await clickNavOp(page, 'listPets')
  await expect(tryIt(page).getByRole('button', { name: 'Environments' })).toHaveCount(0)
})

test('the switcher wears the gradient of the selected environment color from config', async ({
  page,
}) => {
  await gotoLocked(page)
  const switcher = envTrigger(page)
  await expect(switcher).toHaveClass(/from-blue-500\/40/)
  await selectEnv(page, 'prod')
  await expect(switcher).toHaveClass(/from-red-500\/40/)
  await expect(switcher).not.toHaveClass(/from-blue-500\/40/)
  // selection persisted after reload, gradient included
  await page.reload()
  await expect(switcher).toHaveClass(/from-red-500\/40/)
})

test('stored environments not present in the locked config are ignored', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'apidoc:environments',
      JSON.stringify([
        {
          id: 'stray',
          name: 'perso',
          baseUrl: 'http://localhost:9999',
          variables: [],
          defaultHeaders: [],
        },
      ]),
    )
  })
  await gotoLocked(page)
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(2)
  await expect(envOptions(page).filter({ hasText: 'perso' })).toHaveCount(0)
})

test('call listings badge the environment with its own color', async ({ page }) => {
  await mockApi(page)
  await gotoLocked(page)
  await clickNavOp(page, 'listPets')
  await send(page)

  // The run selector of the response panel, by its own attribute: the panel
  // holds another `dropdown-end` — "Add to a scenario" — and which of the two
  // a class selector lands on is a question of render order, not of intent.
  const runs = tryIt(page).locator('[data-run-selector]')
  await runs.locator('summary').click()
  await expect(runs.locator('.dropdown-content .badge', { hasText: 'staging' })).toHaveClass(
    /bg-blue-500\/20/,
  )
  await page.keyboard.press('Escape')

  await openHistory(page)
  const entry = page.locator('request-history-list .collapse')
  await expect(entry.locator('.badge', { hasText: 'staging' })).toHaveClass(/bg-blue-500\/20/)
})

test('locked environments still drive real try-it requests (base URL + auth variable)', async ({
  page,
}) => {
  const calls = await mockApi(page)
  await gotoLocked(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].url).toBe('https://api.e2e.test/staging/pets')
  expect(calls[0].headers.authorization).toBe('Bearer staging-token')
})

test('a setup link is refused outright: locked config is the only authority', async ({ page }) => {
  // A link a lead dev could plausibly have sent before the site was locked.
  const encoded = encodeSetupLink({
    name: 'staging',
    baseUrl: 'https://evil.e2e.test/',
    variables: [{ name: 'auth.bearerAuth', value: 'someone-elses-token', sensitive: true }],
    defaultHeaders: [],
  })
  await gotoFixture(page, `${LOCKED_PAGE}#/?setup=${encoded}`)

  await expect(page.locator('.toast')).toContainText("this site's configuration")
  await expect(page.locator('env-setup-dialog dialog[open]')).toHaveCount(0)
  // The payload is scrubbed all the same: refusing it is not a reason to leave
  // a credential in the address bar.
  expect(page.url()).not.toContain('setup=')

  const stored = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('apidoc:environments') ?? 'null'),
  )
  const staging = stored.find((env) => env.name === 'staging')
  expect(staging.baseUrl).toBe('https://api.e2e.test/staging')
  expect(staging.variables).toEqual([
    { name: 'auth.bearerAuth', value: 'staging-token', sensitive: true },
  ])
})

// The builder's own check (docs/env-setup-link.md §3.5, decision 3): the
// manager's action is covered by the manager not existing, and the overview card
// is covered by nothing at all unless the shell checks for itself.
test('there is no way to build a setup link either', async ({ page }) => {
  await gotoLocked(page)
  await expect(page.locator('[data-setup-builder-open]')).toHaveCount(0)
  await expect(page.locator('env-setup-builder')).toHaveCount(0)
  await expect(page.locator('env-manager [data-env-build]')).toHaveCount(0)
  // The §3.4 generator is gated the same way, by the same non-instantiation:
  // its only entry point is the manager's band.
  await expect(page.locator('env-share-dialog')).toHaveCount(0)
})
