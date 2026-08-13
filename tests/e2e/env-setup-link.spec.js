// Environment setup link (docs/env-setup-link.md §4): landing on a link
// someone shared — the scrub, the preview, the write, and the three refusals.
//
// The links are built by the very encoder the app decodes with, imported from
// the sources: one codec on both ends is the property the feature rests on,
// and a hand-written fixture payload would let the two drift apart silently.
import { expect, test } from '@playwright/test'
import {
  decodeSetupLink,
  defaultSetupSelection,
  encodeSetupLink,
} from '../../src/env/setup-link.js'
import {
  APP_PAGE,
  activeEnvName,
  clickNavOp,
  clipboardText,
  envOptions,
  gotoFixture,
  mockApi,
  openEnvManager,
  openEnvSwitcher,
  openHistory,
  send,
  tryIt,
} from './helpers.js'

const MULTI_PAGE = '/tests/e2e/fixtures/app-multi.html'

// `secrets` opts every sensitive value in, the deliberate gesture §3.4 asks of
// the sender; without it the link is the default skeleton.
function link(env, { specId, secrets = false } = {}) {
  const selection = defaultSetupSelection(env)
  if (secrets) for (const name of Object.keys(selection.variables)) selection.variables[name] = true
  return encodeSetupLink(env, selection, { specId })
}

const setupUrl = (fixture, encoded, route = '#/') => `${fixture}${route}?setup=${encoded}`

const dialog = (page) => page.locator('env-setup-dialog .modal-box')
// A never-opened dialog still has its markup: what says "no preview" is the
// <dialog> not being open, not the box being absent.
const openDialogs = (page) => page.locator('env-setup-dialog dialog[open]')
const row = (page, name) => dialog(page).locator(`[data-setup-name="${name}"]`)

const storedEnvs = (page, key = 'apidoc:environments') =>
  page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? 'null'), key)

const STAGING = {
  name: 'Staging',
  baseUrl: 'https://api.e2e.test/staging',
  color: 'amber',
  variables: [
    { name: 'auth.bearerAuth', value: 'lead-dev-token', sensitive: true },
    { name: 'tenant', value: 'acme', sensitive: false },
  ],
  defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
}

test('the payload is off the URL before anything is rendered, and applying creates the environment', async ({
  page,
}) => {
  await gotoFixture(page, setupUrl(APP_PAGE, link(STAGING)))
  // Asserted first and before any gesture: this is the guarantee that cannot
  // be checked afterwards (decision 3).
  expect(page.url()).not.toContain('setup=')
  expect(page.url()).toContain('#/')

  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Creates the environment “Staging”')
  await expect(row(page, 'auth.bearerAuth')).toContainText('created')
  await expect(row(page, 'tenant')).toContainText('acme')
  await expect(row(page, 'X-Tenant')).toContainText('created')
  // Nothing is written by the preview itself.
  expect((await storedEnvs(page)).some((env) => env.name === 'Staging')).toBe(false)

  await dialog(page).locator('[data-setup-apply]').click()
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.toast')).toContainText('Staging')
  await expect(activeEnvName(page)).toHaveText('Staging')

  const stored = await storedEnvs(page)
  const created = stored.find((env) => env.name === 'Staging')
  expect(created.baseUrl).toBe('https://api.e2e.test/staging')
  expect(created.color).toBe('amber')
  expect(created.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }])
  // The skeleton: the sensitive variable exists, masked, and empty.
  expect(created.variables).toEqual([
    { name: 'auth.bearerAuth', value: '', sensitive: true },
    { name: 'tenant', value: 'acme', sensitive: false },
  ])
  // Survives a reload like any other environment.
  await page.reload()
  await expect(activeEnvName(page)).toHaveText('Staging')
})

test('cancelling writes nothing, and the URL stays clean', async ({ page }) => {
  await gotoFixture(page, setupUrl(APP_PAGE, link(STAGING)))
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).not.toBeVisible()

  expect(page.url()).not.toContain('setup=')
  expect((await storedEnvs(page)).some((env) => env.name === 'Staging')).toBe(false)
  await openEnvSwitcher(page)
  await expect(envOptions(page)).toHaveCount(1)
})

test('a skeleton link never overwrites a token a teammate already pasted', async ({ page }) => {
  // Same name as the fixture's config environment: matched, updated, and the
  // link carries no value for the credential it names.
  const skeleton = {
    name: 'e2e',
    baseUrl: '',
    variables: [
      { name: 'auth.bearerAuth', value: 'lead-dev-token', sensitive: true },
      { name: 'tenant', value: 'acme', sensitive: false },
    ],
    defaultHeaders: [],
  }
  await gotoFixture(page, setupUrl(APP_PAGE, link(skeleton)))
  await expect(dialog(page)).toContainText('Updates the environment “e2e”')
  await expect(row(page, 'auth.bearerAuth')).toContainText('kept')
  await expect(row(page, 'tenant')).toContainText('created')

  await dialog(page).locator('[data-setup-apply]').click()
  const stored = await storedEnvs(page)
  const env = stored.find((e) => e.name === 'e2e')
  const byName = Object.fromEntries(env.variables.map((v) => [v.name, v]))
  expect(byName['auth.bearerAuth'].value).toBe('e2e-bearer-token')
  expect(byName.tenant).toEqual({ name: 'tenant', value: 'acme', sensitive: false })
  // Variables the link never mentioned are untouched (decision 6).
  expect(byName.secret.value).toBe('sh-456-secret')
  // Only one environment named e2e: matched by name, never duplicated.
  expect(stored.filter((e) => e.name === 'e2e')).toHaveLength(1)
})

test('a shared secret is masked in the preview and never lands in the page', async ({ page }) => {
  const withSecret = {
    name: 'Shared',
    baseUrl: '',
    variables: [{ name: 'auth.bearerAuth', value: 'super-secret-token', sensitive: true }],
    defaultHeaders: [],
  }
  await gotoFixture(page, setupUrl(APP_PAGE, link(withSecret, { secrets: true })))
  await expect(row(page, 'auth.bearerAuth')).toContainText('••••')
  // Accepting a credential is not reading one: it is nowhere in the document.
  expect(await page.content()).not.toContain('super-secret-token')

  await dialog(page).locator('[data-setup-apply]').click()
  const created = (await storedEnvs(page)).find((env) => env.name === 'Shared')
  expect(created.variables).toEqual([
    { name: 'auth.bearerAuth', value: 'super-secret-token', sensitive: true },
  ])
})

test('an unreadable link is refused by a toast, and the route it rode on still renders', async ({
  page,
}) => {
  await gotoFixture(page, `${APP_PAGE}#/op/listPets?setup=not-a-real-payload`)
  await expect(page.locator('.toast')).toContainText('unreadable')
  await expect(openDialogs(page)).toHaveCount(0)
  // The link keeps its destination even when its payload is refused.
  await expect(page.locator('main h1')).toBeVisible()
  expect(page.url()).toContain('#/op/listPets')
  expect(page.url()).not.toContain('setup=')
})

test('a link meant for another spec is refused by name, and touches neither', async ({ page }) => {
  const encoded = link({ ...STAGING, name: 'Billing staging' }, { specId: 'billing' })
  await gotoFixture(page, setupUrl(MULTI_PAGE, encoded))
  const toast = page.locator('.toast')
  await expect(toast).toContainText('billing')
  await expect(toast).toContainText('pets')
  await expect(openDialogs(page)).toHaveCount(0)
  expect(await storedEnvs(page, 'apidoc:billing:environments')).toBeNull()
  const pets = await storedEnvs(page, 'apidoc:pets:environments')
  expect(pets.some((env) => env.name === 'Billing staging')).toBe(false)
})

test('the manager shares an environment as a link, secrets unchecked by default', async ({
  page,
}) => {
  await gotoFixture(page, APP_PAGE)
  await openEnvManager(page)
  await page.locator('env-manager [data-env-share]').click()

  const share = page.locator('env-share-dialog .modal-box')
  await expect(share).toContainText('Share “e2e” as a setup link')
  // The default is the skeleton: the two sensitive variables of the fixture
  // travel by name only, everything else is checked.
  await expect(share.locator('[data-setup-pick="auth.bearerAuth"]')).not.toBeChecked()
  await expect(share.locator('[data-setup-pick="secret"]')).not.toBeChecked()
  await expect(share.locator('[data-setup-pick="token"]')).toBeChecked()
  await expect(share.locator('[data-setup-secret-warning]')).toBeHidden()

  const link = share.locator('[data-setup-link]')
  const skeleton = await link.inputValue()
  expect(skeleton).not.toContain('e2e-bearer-token')
  // A fragment link, always: the payload never travels to a server (decision 2).
  expect(skeleton.indexOf('#')).toBeLessThan(skeleton.indexOf('?setup='))
  await expect(share).toContainText('characters.')

  // Opting a secret in is the deliberate gesture, and it is what reveals the
  // warning — in place, readable while deciding.
  await share.locator('[data-setup-pick="auth.bearerAuth"]').check()
  await expect(share.locator('[data-setup-secret-warning]')).toBeVisible()
  await expect(share.locator('[data-setup-secret-warning]')).toContainText('holds that credential')
  expect(await link.inputValue()).not.toBe(skeleton)
})

test('a link generated by the manager opens and applies in another browser', async ({
  page,
  context,
}) => {
  await gotoFixture(page, APP_PAGE)
  await openEnvManager(page)
  await page.locator('env-manager [data-env-share]').click()
  const share = page.locator('env-share-dialog .modal-box')
  // Rename nothing, share everything: this test is about the codec closing on
  // itself, so the secret travels too.
  await share.locator('[data-setup-pick="auth.bearerAuth"]').check()
  await share.locator('[data-setup-copy]').click()
  const copied = await clipboardText(page)
  expect(copied).toContain('?setup=')

  // The recipient: another browser context, so nothing of this session's
  // storage is shared.
  const other = await context.browser().newContext()
  const fresh = await other.newPage()
  await gotoFixture(fresh, new URL(copied).hash ? copied.replace(/^https?:\/\/[^/]+/, '') : copied)
  await expect(fresh.locator('env-setup-dialog .modal-box')).toBeVisible()
  await fresh.locator('env-setup-dialog [data-setup-apply]').click()

  const stored = await storedEnvs(fresh)
  const env = stored.find((e) => e.name === 'e2e')
  const byName = Object.fromEntries(env.variables.map((v) => [v.name, v]))
  expect(env.baseUrl).toBe('https://api.e2e.test/v1')
  expect(byName['auth.bearerAuth']).toEqual({
    name: 'auth.bearerAuth',
    value: 'e2e-bearer-token',
    sensitive: true,
  })
  expect(byName.token.value).toBe('tok-123')
  // `secret` stayed unchecked, so the link carries its name and an empty
  // value — which, over a value the recipient's own config already fills, is
  // a `keep` and not a wipe (decision 5).
  const payload = decodeSetupLink(new URL(copied).hash.split('?setup=')[1])
  expect(payload.env.variables.find((v) => v.name === 'secret').value).toBe('')
  expect(byName.secret.value).toBe('sh-456-secret')
  await other.close()
})

// --- the builder (§3.5) -------------------------------------------------
//
// A pure generator: the tests below check the link it produces and, above all,
// that nothing of it is ever written — the whole point of a from-scratch form
// is that the lead's own browser stays as it was.

const builder = (page) => page.locator('env-setup-builder .modal-box')

// The form of the §3.5 example: an environment the lead does not own.
async function fillBuilder(page, { carrySecret = false } = {}) {
  const field = (name) => builder(page).locator(`[data-setup-field="${name}"]`)
  await field('envName').fill('Team staging')
  await field('baseUrl').fill('https://api.e2e.test/staging')
  await builder(page).locator('[data-setup-add-row="variable"]').click()
  const variable = builder(page).locator('[data-setup-row="variable"]').first()
  await variable.locator('[data-setup-field="name"]').fill('auth.bearerAuth')
  // Sensitive first: the flag is what decides whether the value travels, and
  // checking it after the value would silently withdraw it.
  await variable.locator('[data-setup-sensitive]').check()
  await variable.locator('[data-setup-field="value"]').fill('lead-dev-token')
  if (carrySecret) await variable.locator('[data-setup-carry]').check()
  await builder(page).locator('[data-setup-add-row="header"]').click()
  const header = builder(page).locator('[data-setup-row="header"]').first()
  await header.locator('[data-setup-field="name"]').fill('X-Tenant')
  await header.locator('[data-setup-field="value"]').fill('acme')
}

test('the builder produces a fragment link from a form, without an environment', async ({
  page,
}) => {
  await gotoFixture(page, APP_PAGE)
  const before = await storedEnvs(page)
  await page.locator('[data-setup-builder-open]').click()
  await expect(builder(page)).toBeVisible()
  // Nothing to copy until the form names an environment: a nameless link is one
  // the landing refuses.
  await expect(builder(page).locator('[data-setup-builder-errors]')).toBeVisible()
  await expect(builder(page).locator('[data-setup-link]')).toHaveValue('')

  await fillBuilder(page)
  await expect(builder(page).locator('[data-setup-builder-errors]')).toBeHidden()
  const value = await builder(page).locator('[data-setup-link]').inputValue()
  // A fragment link, always: the payload never travels to a server (decision 2).
  expect(value.indexOf('#')).toBeLessThan(value.indexOf('?setup='))
  // The skeleton is the default here too: the sensitive value stays home.
  expect(value).not.toContain('lead-dev-token')
  await expect(builder(page).locator('[data-setup-secret-warning]')).toBeHidden()
  await expect(builder(page)).toContainText('characters.')

  // Carrying the secret is a deliberate gesture, and it is what reveals the
  // warning — in place, readable while deciding.
  await builder(page).locator('[data-setup-carry]').check()
  await expect(builder(page).locator('[data-setup-secret-warning]')).toBeVisible()
  expect(await builder(page).locator('[data-setup-link]').inputValue()).not.toBe(value)

  // Decision 1: no write path at all, not even a non-silent one.
  expect(await storedEnvs(page)).toEqual(before)
})

test('the builder refuses a form the landing would refuse, and says which bound', async ({
  page,
}) => {
  await gotoFixture(page, APP_PAGE)
  await page.locator('[data-setup-builder-open]').click()
  await fillBuilder(page)
  await builder(page).locator('[data-setup-add-row="variable"]').click()
  const second = builder(page).locator('[data-setup-row="variable"]').nth(1)
  await second.locator('[data-setup-field="name"]').fill('auth.bearerAuth')

  const errors = builder(page).locator('[data-setup-builder-errors]')
  await expect(errors).toContainText('appears twice')
  await expect(builder(page).locator('[data-setup-link]')).toHaveValue('')
  await expect(builder(page).locator('[data-setup-preview]')).toBeDisabled()

  // Fixed in place: the link comes back without reopening anything.
  await second.locator('[data-setup-field="name"]').fill('tenant')
  await expect(errors).toBeHidden()
  await expect(builder(page).locator('[data-setup-link]')).not.toHaveValue('')
})

test('previewing as recipient opens the landing dialog, on a URL already scrubbed', async ({
  page,
}) => {
  await gotoFixture(page, APP_PAGE)
  await page.locator('[data-setup-builder-open]').click()
  await fillBuilder(page, { carrySecret: true })
  await builder(page).locator('[data-setup-preview]').click()

  // It IS the recipient's dialog, not a rendering of it — same plan, same
  // masking, same scrub (§4.1).
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('Creates the environment “Team staging”')
  await expect(row(page, 'auth.bearerAuth')).toContainText('••••')
  expect(page.url()).not.toContain('setup=')
  expect(await page.content()).not.toContain('lead-dev-token')

  // And Apply is a real apply, which is what the builder says next to it.
  await dialog(page).locator('[data-setup-apply]').click()
  await expect(activeEnvName(page)).toHaveText('Team staging')
  const created = (await storedEnvs(page)).find((env) => env.name === 'Team staging')
  expect(created.baseUrl).toBe('https://api.e2e.test/staging')
  expect(created.defaultHeaders).toEqual([{ name: 'X-Tenant', value: 'acme' }])
  expect(created.variables).toEqual([
    { name: 'auth.bearerAuth', value: 'lead-dev-token', sensitive: true },
  ])
})

test('cancelling a previewed build leaves storage byte-identical', async ({ page }) => {
  await gotoFixture(page, APP_PAGE)
  const before = await page.evaluate(() => window.localStorage.getItem('apidoc:environments'))
  await page.locator('[data-setup-builder-open]').click()
  await fillBuilder(page)
  await builder(page).locator('[data-setup-preview]').click()
  await dialog(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog(page)).not.toBeVisible()

  expect(await page.evaluate(() => window.localStorage.getItem('apidoc:environments'))).toBe(before)
  expect(page.url()).not.toContain('setup=')
})

test('the manager opens the same builder, beside no particular environment', async ({ page }) => {
  await gotoFixture(page, APP_PAGE)
  await openEnvManager(page)
  await page.locator('env-manager [data-env-build]').click()
  await expect(builder(page)).toBeVisible()
  await fillBuilder(page)
  const value = await builder(page).locator('[data-setup-link]').inputValue()
  expect(value).toContain('?setup=')
  // The environment the manager was editing is not what the form describes, and
  // the form is not what the manager writes.
  expect((await storedEnvs(page)).some((env) => env.name === 'Team staging')).toBe(false)
})

// The two claims docs/env-setup-link.md §5 makes about the rest of the app,
// checked rather than deduced: a setup link introduces no storage of its own, and a
// variable it created is sensitive from birth for every export path.
test('applying a link introduces no storage key the inventory does not know', async ({ page }) => {
  const apidocKeys = () =>
    page.evaluate(() =>
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('apidoc'))
        .sort(),
    )
  await gotoFixture(page, APP_PAGE)
  const before = await apidocKeys()
  // Away first: a hash-only change would navigate the same document, and this
  // test is about what a real boot writes.
  await page.goto('about:blank')
  await gotoFixture(page, setupUrl(APP_PAGE, link(STAGING)))
  await dialog(page).locator('[data-setup-apply]').click()
  await expect(activeEnvName(page)).toHaveText('Staging')
  // The one key that appears is the selection, which `storageInventory()`
  // already declares in its `environments` group — no new dataset, so nothing
  // that could survive a purge the settings panel claims to have done.
  const added = (await apidocKeys()).filter((key) => !before.includes(key))
  expect(added).toEqual(['apidoc:environment.selected'])
})

test('a variable created by a link is redacted in the history like any other secret', async ({
  page,
}) => {
  const calls = await mockApi(page)
  const shared = {
    name: 'e2e',
    baseUrl: '',
    variables: [{ name: 'tenantKey', value: 'link-born-secret', sensitive: true }],
    defaultHeaders: [],
  }
  await gotoFixture(page, setupUrl(APP_PAGE, link(shared, { secrets: true })))
  await dialog(page).locator('[data-setup-apply]').click()

  await clickNavOp(page, 'listPets')
  await tryIt(page).getByRole('button', { name: 'Add header' }).click()
  await tryIt(page).locator('input[aria-label="Header name"]').last().fill('X-Tenant-Key')
  await tryIt(page).locator('input[aria-label="Header name"]').last().press('Tab')
  await tryIt(page)
    .locator('input[aria-label="Header name"]')
    .last()
    .locator('xpath=following-sibling::input[1]')
    .fill('{{tenantKey}}')
  await send(page)
  await expect.poll(() => calls.length).toBe(1)
  expect(calls[0].headers['x-tenant-key']).toBe('link-born-secret')

  await openHistory(page)
  const entry = page.locator('request-history-list .collapse').first()
  await entry.locator('input[type="checkbox"]').first().check()
  await expect(entry).toContainText('••••')
  await expect(entry).not.toContainText('link-born-secret')
})

// The scrub happens whether or not anything is painted, so the preview must
// too: opened in a background tab, an occluded window or a prerender, the
// document gets no frame, and a preview waiting for one would drop a payload
// that is already off the URL — no dialog, no toast, no console line.
test('the preview does not wait for a paint the document may never get', async ({ page }) => {
  // What a never-painted document does to rAF: callbacks queue and never run.
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0
  })
  await gotoFixture(page, setupUrl(APP_PAGE, link(STAGING)))
  await expect(dialog(page)).toBeVisible()
  await dialog(page).locator('[data-setup-apply]').click()
  await expect(activeEnvName(page)).toHaveText('Staging')
})

test('a link pasted into an already-open tab is scrubbed and previewed too', async ({ page }) => {
  await gotoFixture(page, APP_PAGE)
  // No reload: changing only the hash navigates the same document, so `boot()`
  // never runs again — and the payload would otherwise sit in the address bar
  // of a page that ignored it.
  await page.goto(setupUrl(APP_PAGE, link(STAGING), '#/op/listPets'))
  await expect(dialog(page)).toBeVisible()
  expect(page.url()).not.toContain('setup=')
  expect(page.url()).toContain('#/op/listPets')
  await dialog(page).locator('[data-setup-apply]').click()
  await expect(activeEnvName(page)).toHaveText('Staging')
})
