// Importing a request: a pasted cURL command, a picked Postman collection, and
// the two answers that are not "here is your operation" — no match at all, and
// a credential that has to go somewhere other than a header row.
import { expect, test } from '@playwright/test'
import { expectResponded, gotoApp, mockApi, send, tryIt } from './helpers.js'

const dialog = (page) => page.locator('import-dialog')

async function openImport(page) {
  await page.getByRole('button', { name: 'Import a request' }).click()
  await expect(dialog(page).locator('.modal-box')).toBeVisible()
}

async function paste(page, command) {
  await openImport(page)
  await dialog(page).locator('textarea').fill(command)
}

test('a pasted cURL lands in the try-it of its operation, pre-filled', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page)
  await paste(
    page,
    `curl -X POST 'https://api.e2e.test/v1/pets' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Imported","status":"pending"}'`,
  )

  // One candidate, named by its route: the reader sees what they are about to
  // open before opening it.
  await expect(dialog(page)).toContainText('/pets')
  await dialog(page).getByRole('button', { name: 'Open in the try-it' }).click()

  await expect(page.locator('main h1')).toHaveText('Create a pet')
  await expect(tryIt(page).locator('textarea')).toHaveValue(
    '{"name":"Imported","status":"pending"}',
  )

  await send(page)
  await expectResponded(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe('https://api.e2e.test/v1/pets')
  expect(calls[0].body).toBe('{"name":"Imported","status":"pending"}')
})

test('path and query values are read back out of the URL', async ({ page }) => {
  await gotoApp(page)
  await paste(page, `curl 'https://api.e2e.test/v1/pets/42'`)
  await dialog(page).getByRole('button', { name: 'Open in the try-it' }).click()

  await expect(page.locator('main h1')).toHaveText('Get a pet by id')
  await expect(tryIt(page).getByLabel('petId', { exact: true })).toHaveValue('42')
})

// The point of the whole feature: the pasted token must be the one that leaves,
// and it must not sit in a header row where it would look like a plain value.
test('an imported bearer token becomes the credential of its scheme', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page)
  await paste(page, `curl 'https://api.e2e.test/v1/pets' -H 'Authorization: Bearer imported-token'`)
  await dialog(page).getByRole('button', { name: 'Open in the try-it' }).click()

  await expect(page.locator('main h1')).toHaveText('List all pets')
  // Through the scheme, not as an editable header row: the token is the value of
  // `{{auth.bearerAuth}}` for this tab, and the injection summary is what shows
  // it. The environment's own value is overridden without being overwritten.
  await expect(tryIt(page).getByLabel('Header value')).toHaveCount(0)
  await expect(tryIt(page)).toContainText('{{auth.bearerAuth}}')
  await expect(tryIt(page)).toContainText('Authorization: Bearer imported-token')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers.authorization).toBe('Bearer imported-token')
})

test('a URL matching nothing says so instead of guessing', async ({ page }) => {
  await gotoApp(page)
  await paste(page, `curl 'https://api.e2e.test/v1/unicorns/1'`)
  await expect(dialog(page)).toContainText('No operation of this API matches')
  await expect(dialog(page).getByRole('button', { name: 'Open in the try-it' })).toHaveCount(0)
})

test('a Postman collection picked as a file offers its requests', async ({ page }) => {
  await gotoApp(page)
  await openImport(page)
  await dialog(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'collection.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          info: {
            name: 'E2E',
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
          },
          variable: [{ key: 'baseUrl', value: 'https://api.e2e.test/v1' }],
          item: [
            { name: 'List pets', request: { method: 'GET', url: '{{baseUrl}}/pets' } },
            {
              name: 'Read pet',
              request: {
                method: 'GET',
                url: { raw: '{{baseUrl}}/pets/:petId', variable: [{ key: 'petId', value: '9' }] },
              },
            },
          ],
        }),
      ),
    })

  await expect(dialog(page)).toContainText('2 requests in this file')
  // Collection variables are not silently turned into an environment.
  await expect(dialog(page)).toContainText('Collection variable baseUrl not imported')

  await dialog(page).locator('select').selectOption('1')
  await dialog(page).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(page.locator('main h1')).toHaveText('Get a pet by id')
  await expect(tryIt(page).getByLabel('petId', { exact: true })).toHaveValue('9')
})
