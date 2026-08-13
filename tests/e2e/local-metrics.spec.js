import { expect, test } from '@playwright/test'
import { API_BASE, closeMobilePanels, gotoApp, mockApi, send, tryIt } from './helpers.js'

// Local metrics surfaces (docs/architecture.md §5.6): what the browser's own
// history says about this reader's use of the API — the recent-calls strip on
// the endpoint, the most-used card on the overview. Both are read-only views
// over `apidoc-history`, and both state whose calls they are counting.

// Written straight into IndexedDB rather than sent: the ranking needs a
// history several calls deep, and the surfaces read the store, not the wire.
async function seedHistory(page, entries) {
  await page.evaluate(async (rows) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('apidoc-history', 2)
      // The app creates the database on its first write, which a seeded test
      // has not done: without this the open succeeds on an empty database and
      // the transaction below fails on a store nobody created.
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('entries', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('timestamp', 'timestamp')
        store.createIndex('specId', 'specId')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const store = tx.objectStore('entries')
      for (const row of rows) store.add(row)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  }, entries)
}

const historyModal = (page) => page.locator('request-history-list .modal-box')

const entry = (opId, over = {}) => ({
  specId: 'default',
  opId,
  method: 'get',
  path: '/pets',
  envName: 'e2e',
  timestamp: 1_750_000_000_000,
  durationMs: 42,
  request: { method: 'get', url: `${API_BASE}/v1/pets`, headers: {}, body: null },
  response: { status: 200, statusText: 'OK', headers: [], body: '[]' },
  ...over,
})

test('an endpoint with no local history shows no strip', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await expect(page.locator('main')).not.toContainText('Recent calls')
})

test('the strip lists this browser’s calls and opens them in the history', async ({ page }) => {
  await gotoApp(page)
  await seedHistory(page, [
    entry('listPets', { timestamp: 1_750_000_100_000, durationMs: 128 }),
    entry('listPets', {
      timestamp: 1_750_000_050_000,
      response: { status: 401, statusText: 'Unauthorized', headers: [], body: '{}' },
    }),
    entry('getPet', { timestamp: 1_750_000_080_000, durationMs: 999 }),
  ])
  // A hash-only goto is a same-document navigation: the app would keep the
  // history it read before the seed. The reload is what makes it look again.
  await page.reload()
  await gotoApp(page, '#/op/listPets')

  const strip = page.locator('main section#recent')
  await expect(strip).toBeVisible()
  // The local scope is the claim, so it is asserted like one.
  await expect(strip).toContainText('from this browser')
  await expect(strip.locator('li')).toHaveCount(2)
  await expect(strip).toContainText('128 ms')
  await expect(strip).toContainText('401')
  // The other endpoint's call, seeded between the two above, is not this
  // endpoint's business — and it is the only one timed at 999 ms.
  await expect(strip).not.toContainText('999 ms')

  // The op deep link opened the sheet below lg, and its scrim covers the strip:
  // reading it works through the scrim, clicking it does not.
  await closeMobilePanels(page)
  await strip.getByRole('button', { name: 'Open in history' }).click()
  await expect(historyModal(page)).toBeVisible()
  await expect(historyModal(page).locator('.collapse')).toHaveCount(2)
})

test('a send appears in the strip without leaving the page', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page, '#/op/listPets')
  await expect(page.locator('main section#recent')).toHaveCount(0)
  await send(page)
  await expect(tryIt(page)).toContainText('200')
  await expect(page.locator('main section#recent').locator('li')).toHaveCount(1)
})

test('the overview ranks the endpoints this browser used most', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('main')).not.toContainText('Your most-used endpoints')

  await seedHistory(page, [
    entry('getPet', { timestamp: 1 }),
    entry('listPets', { timestamp: 2 }),
    entry('listPets', { timestamp: 3 }),
    entry('listPets', { timestamp: 4 }),
    entry('getPet', { timestamp: 5 }),
  ])
  await page.reload()

  const card = page.locator('main').filter({ hasText: 'Your most-used endpoints' }).last()
  await expect(card).toContainText("from this browser's history")
  const rows = page.locator('main [data-most-used]')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveAttribute('data-most-used', 'listPets')
  await expect(rows.first()).toContainText('3 calls')
  await expect(rows.nth(1)).toHaveAttribute('data-most-used', 'getPet')

  await rows.first().click()
  await expect(page).toHaveURL(/#\/op\/listPets$/)
})
