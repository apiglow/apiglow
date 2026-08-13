// In-situ marking of the local changelog: nav badges (group +
// operation) and doc content badges (parameter, top-level
// property, response code). The diff itself is covered by tests/diff.test.js;
// here we verify the wiring through to the DOM.
import { expect, test } from '@playwright/test'
import { clickNavOp, gotoApp, openDrawerIfMobile } from './helpers.js'

const SCHEMA_URL = '/tests/e2e/fixtures/e2e-api.json'

// Tampers with the snapshot written on the first load to simulate a schema that
// has changed since: replaced fingerprints become "modified", removed
// ones become "new", and an operation absent from the snapshot is "new".
async function tamperSnapshot(page, mutate) {
  await page.evaluate(
    async ([url, source]) => {
      const db = await new Promise((res, rej) => {
        // No version: the app owns the schema (v2 = savedAt index for LRU
        // eviction), the test only piggybacks on the open connection.
        const r = indexedDB.open('apidoc-schema')
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
      })
      // The snapshot is computed and written on idle (outside the critical
      // load path): it may not be there on the first read.
      const read = () =>
        new Promise((res, rej) => {
          const g = db.transaction('snapshots').objectStore('snapshots').get(url)
          g.onsuccess = () => res(g.result)
          g.onerror = () => rej(g.error)
        })
      let snapshot = await read()
      for (let tries = 0; !snapshot && tries < 100; tries += 1) {
        await new Promise((res) => setTimeout(res, 50))
        snapshot = await read()
      }
      if (!snapshot) throw new Error('snapshot never written')
      // eslint-disable-next-line no-new-func
      new Function('snapshot', source)(snapshot)
      await new Promise((res, rej) => {
        const t = db.transaction('snapshots', 'readwrite')
        t.objectStore('snapshots').put(snapshot)
        t.oncomplete = res
        t.onerror = () => rej(t.error)
      })
    },
    [new URL(SCHEMA_URL, page.url()).href, `(${mutate.toString()})(snapshot)`],
  )
}

test('a changed schema is flagged where it changed: nav, header, parameter, response and body property', async ({
  page,
}) => {
  // First load: nothing to flag, the reference snapshot is written.
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav .status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Schema updated' })).toHaveCount(0)

  await tamperSnapshot(page, (snapshot) => {
    const listPets = snapshot.operations.find((op) => op.id === 'listPets')
    listPets.fingerprint = 'stale'
    delete listPets.fields['param:query:breed'] // absent from the snapshot → new
    listPets.fields['response:200'] = 'stale'
    listPets.fields['response:200:application/json:name'] = 'stale'
    const createPet = snapshot.operations.find((op) => op.id === 'createPet')
    createPet.fingerprint = 'stale'
    createPet.fields['body:application/json:name'] = 'stale'
    // getPet does not exist in the snapshot → new operation
    snapshot.operations = snapshot.operations.filter((op) => op.id !== 'getPet')
  })
  await gotoApp(page)

  await expect(page.getByRole('button', { name: 'Schema updated' })).toBeVisible()
  // Nav: badge per operation (the links live inside a collapsed <details>,
  // hence toBeAttached), and on the group that contains them.
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-op-id="listPets"] .status-warning')).toBeAttached()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-op-id="getPet"] .status-success')).toBeAttached()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav a[data-op-id="listOrders"] .status')).toHaveCount(0)
  const petsGroup = page.locator('api-nav details[data-group="Pets"] > summary .status-warning')
  await expect(petsGroup).toBeVisible()
  await expect(petsGroup).toHaveAttribute('title', '3 endpoint(s) added or modified')
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav details[data-group="Orders"] > summary .status')).toHaveCount(
    0,
  )

  await clickNavOp(page, 'listPets')
  await expect(page.locator('main header .badge-warning')).toHaveText('Modified')
  // Parameter absent from the snapshot: new. The others carry nothing.
  const paramRow = (name) =>
    page.locator('section#params-query .api-param-row').filter({ hasText: name })
  await expect(paramRow('breed').locator('.badge-success')).toHaveText('New')
  // Enum chips are also .badge elements: we target the marking colors.
  await expect(paramRow('status').locator('.badge-success, .badge-warning')).toHaveCount(0)
  // Status tab: badge dot, no text badge (the tab is narrow).
  await expect(
    page.locator('section#responses [role="tab"]', { hasText: '200' }).locator('.status-warning'),
  ).toBeVisible()
  await expect(
    page.locator('section#responses [role="tab"]', { hasText: '401' }).locator('.status'),
  ).toHaveCount(0)
  // Top-level property of the response body (array<Pet>: the items
  // are at the same conceptual level). A property's header row is the
  // div that carries its <code> as a direct child.
  const propBadge = (section, name) =>
    page.locator(`${section} div:has(> code:text-is("${name}")) > .badge`)
  await expect(propBadge('section#responses', 'name')).toHaveText('Modified')
  await expect(propBadge('section#responses', 'id')).toHaveCount(0)

  await clickNavOp(page, 'createPet')
  await expect(propBadge('section#body', 'name')).toHaveText('Modified')
  await expect(propBadge('section#body', 'status')).toHaveCount(0)

  // An entirely new operation is not detailed field by field.
  await clickNavOp(page, 'getPet')
  // .badge-xs distinguishes it from the method badge, also `soft` but not sized.
  await expect(page.locator('main header .badge-success.badge-soft.badge-xs')).toHaveText('New')
  await expect(page.locator('section#params-path .badge-success')).toHaveCount(0)
})

// Writes `count` foreign snapshots straight into the store, all older than the
// one the app just wrote. The LRU keeps the twenty most recent, so what this
// sets up is the eviction the user never sees happen.
async function floodSnapshots(page, count) {
  return page.evaluate(async (n) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('apidoc-schema')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    await new Promise((res, rej) => {
      const t = db.transaction('snapshots', 'readwrite')
      const store = t.objectStore('snapshots')
      for (let i = 0; i < n; i += 1) {
        store.put({
          url: `https://other.test/api-${i}.json`,
          savedAt: 1000 + i,
          version: '1.0.0',
          operations: [],
        })
      }
      t.oncomplete = res
      t.onerror = () => rej(t.error)
    })
    return new Promise((res, rej) => {
      const c = db.transaction('snapshots').objectStore('snapshots').count()
      c.onsuccess = () => res(c.result)
      c.onerror = () => rej(c.error)
    })
  }, count)
}

function changelog(page) {
  return page.locator('schema-changelog .modal-box')
}

async function openChangelog(page) {
  await page.getByRole('button', { name: 'Schema updated' }).click()
  await expect(changelog(page)).toBeVisible()
}

test('an operation the schema no longer has is reported as removed, without a link', async ({
  page,
}) => {
  await gotoApp(page)
  await tamperSnapshot(page, (snapshot) => {
    // Present in the baseline, absent from the document served now.
    snapshot.operations.push({
      id: 'retiredEndpoint',
      method: 'delete',
      path: '/pets/{petId}/legacy',
      summary: 'Retire a pet the old way',
      fingerprint: 'gone',
      fields: {},
    })
  })
  await gotoApp(page)

  await openChangelog(page)
  await expect(changelog(page)).toContainText('Removed')
  await expect(changelog(page)).toContainText('Retire a pet the old way')
  // No route to offer: the operation is not in the document any more.
  await expect(changelog(page).getByRole('link', { name: /Retire a pet/ })).toHaveCount(0)
  // And nothing in the nav claims it either.
  await expect(page.locator('api-nav a[data-op-id="retiredEndpoint"]')).toHaveCount(0)
})

test('a second visit to an unchanged schema flags nothing at all', async ({ page }) => {
  await gotoApp(page)
  // The snapshot is written on idle; the reload below has to find it there,
  // which the tamper helper's own wait guarantees.
  await tamperSnapshot(page, () => {})
  await gotoApp(page)

  await expect(page.getByRole('button', { name: 'Schema updated' })).toHaveCount(0)
  await expect(page.locator('api-nav .status')).toHaveCount(0)
  await clickNavOp(page, 'listPets')
  await expect(page.locator('main header .badge-warning')).toHaveCount(0)
  await expect(page.locator('main header .badge-success.badge-soft.badge-xs')).toHaveCount(0)
})

test('a version bump with no operation change says so instead of showing empty lists', async ({
  page,
}) => {
  await gotoApp(page)
  await tamperSnapshot(page, (snapshot) => {
    snapshot.version = '0.0.1-old'
  })
  await gotoApp(page)

  await openChangelog(page)
  await expect(changelog(page)).toContainText('0.0.1-old → 1.0.0')
  await expect(changelog(page)).toContainText('no operation was added, removed or modified')
})

test('the snapshot LRU never evicts the document being read', async ({ page }) => {
  await gotoApp(page)
  await tamperSnapshot(page, (snapshot) => {
    snapshot.operations.find((op) => op.id === 'listPets').fingerprint = 'stale'
  })
  // Twenty-five foreign snapshots, all older: the cap has to bite on them.
  expect(await floodSnapshots(page, 25)).toBeGreaterThan(20)
  await gotoApp(page)

  // Still compared against its own baseline — the changelog is exactly what
  // silently disappears when eviction takes the wrong record.
  await expect(page.getByRole('button', { name: 'Schema updated' })).toBeVisible()
  await expect(page.locator('api-nav a[data-op-id="listPets"] .status-warning')).toBeAttached()

  // The baseline is only replaced once the changes have been acknowledged
  // (`onFirstOpen`), and the eviction rides in that same write — so the cap is
  // observable from the moment the modal is opened, not before.
  await openChangelog(page)
  const snapshotUrls = () =>
    page.evaluate(
      () =>
        new Promise((res, rej) => {
          const r = indexedDB.open('apidoc-schema')
          r.onsuccess = () => {
            const keys = r.result.transaction('snapshots').objectStore('snapshots').getAllKeys()
            keys.onsuccess = () => res(keys.result)
            keys.onerror = () => rej(keys.error)
          }
          r.onerror = () => rej(r.error)
        }),
    )
  await expect.poll(async () => (await snapshotUrls()).length).toBeLessThanOrEqual(20)
  expect((await snapshotUrls()).some((url) => url.endsWith('/e2e-api.json'))).toBe(true)
})
