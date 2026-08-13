// Request bodies that are not JSON text: a raw file, a multipart form, and
// urlencoded fields. Before the body-kind pass, all three landed in the same
// textarea — the file endpoints simply could not be exercised at all.
import { expect, test } from '@playwright/test'
import {
  canSeeFileBytes,
  clickNavOp,
  closeMobilePanels,
  expectResponded,
  gotoOp,
  mockApi,
  openHistory,
  openTryItIfMobile,
  send,
  tryIt,
} from './helpers.js'

const PAGE = '/tests/e2e/fixtures/app-bodies.html'

const FILE = { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hello e2e') }

function panelFile(page) {
  return tryIt(page).locator('input[type=file]')
}

test('a binary body offers a picker, and sends the bytes', async ({ page, browserName }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')

  await expect(tryIt(page)).toContainText('No file selected')
  await panelFile(page).setInputFiles(FILE)
  // Identity of what will be sent, not a promise that something was picked.
  await expect(tryIt(page)).toContainText('@note.txt (9 B, text/plain)')
  // The preview switches to --data-binary: --data would corrupt real bytes.
  await expect(tryIt(page)).toContainText("--data-binary '@note.txt'")

  await send(page)
  await expectResponded(page)
  expect(calls).toHaveLength(1)
  expect(calls[0].method).toBe('POST')
  expect(calls[0].url).toBe('https://api.e2e.test/v3/pets/7/avatar')
  expect(calls[0].headers['content-type']).toBe('application/octet-stream')
  if (canSeeFileBytes(browserName)) expect(calls[0].body).toBe('hello e2e')
})

test('a required file body blocks the send until one is picked', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')

  await send(page)
  await expect(tryIt(page)).toContainText('expects a file as its body')
  expect(calls).toHaveLength(0)
})

// An octet-stream sometimes takes a hand-typed payload: the picker is the
// default, not the only option.
test('the Text toggle still sends a raw typed body', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')

  await tryIt(page).getByRole('button', { name: 'Text', exact: true }).click()
  await expect(panelFile(page)).toHaveCount(0)
  await tryIt(page).locator('textarea').fill('typed-by-hand')

  await send(page)
  await expectResponded(page)
  expect(calls[0].body).toBe('typed-by-hand')
})

test('the multipart variant sends one part per field', async ({ page, browserName }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')

  await tryIt(page)
    .locator('select[aria-label="Media type"]')
    .selectOption({ label: 'multipart/form-data' })
  await panelFile(page).setInputFiles(FILE)
  await tryIt(page).getByLabel('caption', { exact: true }).fill('a cat')

  await send(page)
  await expectResponded(page)
  // The boundary is the browser's: we never set the Content-Type ourselves.
  expect(calls[0].headers['content-type']).toContain('multipart/form-data; boundary=')
  expect(calls[0].body).toContain('name="caption"')
  expect(calls[0].body).toContain('a cat')
  expect(calls[0].body).toContain('filename="note.txt"')
  if (canSeeFileBytes(browserName)) expect(calls[0].body).toContain('hello e2e')
})

test('an urlencoded body is edited as fields and sent as a query string', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'createPetForm')

  // Fields, not a textarea to hand-write `a=b&c=d` into.
  await expect(tryIt(page).locator('textarea')).toHaveCount(0)
  await tryIt(page).getByLabel('name', { exact: true }).fill('Rex the dog')
  await tryIt(page).getByLabel('status', { exact: true }).selectOption('available')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers['content-type']).toBe('application/x-www-form-urlencoded')
  expect(calls[0].body).toBe('name=Rex+the+dog&status=available')
})

test('a required urlencoded field blocks the send', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'createPetForm')
  await tryIt(page).getByLabel('status', { exact: true }).selectOption('sold')

  await send(page)
  await expect(tryIt(page)).toContainText('missing required field “name”')
  expect(calls).toHaveLength(0)
})

// The media type decides which editor BOTH columns show. Left free to drift,
// the doc kept documenting octet-stream while the panel edited a multipart
// form — and the doc's file field then pushed a whole-body file into a body
// made of parts, where the builder drops it without a word.
test('the media type is one choice, shared by both columns', async ({ page, browserName }) => {
  const calls = await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')
  const doc = page.locator('main #body')

  await tryIt(page)
    .locator('select[aria-label="Media type"]')
    .selectOption({ label: 'multipart/form-data' })
  // The doc followed: it documents the parts, not the raw byte stream.
  await expect(doc).toContainText('caption')
  await expect(doc.locator('select')).toHaveValue('1')

  // A file picked in the doc reaches the panel, and reaches it as a PART.
  await doc.locator('input[type=file]').setInputFiles(FILE)
  await expect(tryIt(page)).toContainText('@note.txt (9 B, text/plain)')

  await send(page)
  await expectResponded(page)
  expect(calls[0].headers['content-type']).toContain('multipart/form-data; boundary=')
  expect(calls[0].body).toContain('filename="note.txt"')
  if (canSeeFileBytes(browserName)) expect(calls[0].body).toContain('hello e2e')
})

test('switching media type from the doc drives the panel too', async ({ page }) => {
  await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  const doc = page.locator('main #body')

  await doc.locator('select').selectOption({ label: 'multipart/form-data' })
  await expect(tryIt(page).locator('select[aria-label="Media type"]')).toHaveValue('1')
  // The panel swapped editors: parts, no whole-body picker and no File/Text.
  await expect(tryIt(page).getByLabel('caption', { exact: true })).toBeVisible()
  await expect(tryIt(page).getByRole('button', { name: 'Text', exact: true })).toHaveCount(0)
})

// The history keeps the file's identity, never its bytes — so the one action
// that would need them is the one that must not pretend to work.
test('a file upload is logged by name and cannot be replayed blind', async ({ page }) => {
  await mockApi(page)
  await gotoOp(page, PAGE, 'uploadAvatar')
  await tryIt(page).getByLabel('petId', { exact: true }).fill('7')
  await panelFile(page).setInputFiles(FILE)
  await send(page)
  await expectResponded(page)

  await openHistory(page)
  const modal = page.locator('request-history-list .modal-box')
  await expect(modal).toBeVisible()
  const entry = modal.locator('.collapse').first()
  await entry.locator('input[type="checkbox"]').first().check()
  await expect(entry).toContainText('@note.txt (9 B, text/plain)')
  await expect(modal.getByRole('button', { name: 'Replay' })).toBeDisabled()
  await expect(modal.getByRole('button', { name: 'Load in try-it' })).toBeEnabled()
})

test('the central doc edits the same body, whatever its shape', async ({ page }) => {
  await gotoOp(page, PAGE, 'createPetForm')
  const docField = page.locator('main #body').getByLabel('Try-it value for name')
  // Editing the doc means leaving the sheet, below lg.
  await closeMobilePanels(page)
  await docField.fill('Mittens')
  // The panel is the source of truth: the doc pushes into it, it echoes back.
  await openTryItIfMobile(page)
  await expect(tryIt(page).getByLabel('name', { exact: true })).toHaveValue('Mittens')

  await clickNavOp(page, 'uploadAvatar')
  await expect(page.locator('main h1')).toBeVisible()
  // A binary body gets its picker in the doc too — it used to get nothing.
  await closeMobilePanels(page)
  await page.locator('main #body input[type=file]').setInputFiles(FILE)
  await openTryItIfMobile(page)
  await expect(tryIt(page)).toContainText('@note.txt (9 B, text/plain)')
})
