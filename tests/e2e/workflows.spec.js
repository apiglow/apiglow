// Session 7 of docs/openapi-coverage.md: what edits the schema before it is
// read (OpenAPI Overlay 1.0), and what comes back in from the workflow format
// (Arazzo 1.1). Both are load-time or import-time transforms — nothing here is
// visible unless the app actually applied them, which is what these assert.
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { gotoApp, gotoFixture } from './helpers.js'

const OVERLAY_PAGE = '/tests/e2e/fixtures/app-overlay.html'
const ARAZZO_PAGE = '/tests/e2e/fixtures/app-arazzo.html'

const nav = (page) => page.locator('api-nav')
const view = (page) => page.locator('api-scenario-view')
const openExportMenu = (page) => view(page).locator('[data-scenario-export-menu] > summary').click()

test('overlays are applied before the schema is read', async ({ page }) => {
  await gotoFixture(page, OVERLAY_PAGE)

  // Retitled by the YAML overlay fetched by URL: the nav shows the overlay's
  // summary, never the schema's own.
  const link = nav(page).locator('a[data-op-id="listThings"]')
  await expect(link).toHaveText(/List widgets/)
  await expect(nav(page)).not.toContainText('List things')
  // Removed by the same overlay: gone from the model, hence from the nav.
  await expect(nav(page).locator('a[data-op-id="deleteThing"]')).toHaveCount(0)
  // Added by the inline overlay of the config.
  await expect(page.locator('main')).toContainText('Described by an overlay.')

  await page.goto(`${OVERLAY_PAGE}#/op/listThings`)
  await expect(page.locator('main h1')).toHaveText('List widgets')
})

test('the settings panel accounts for the overlays, applied and failed alike', async ({ page }) => {
  await gotoFixture(page, OVERLAY_PAGE)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const panel = page.locator('settings-panel .modal-box')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Overlays')
  await expect(panel).toContainText('3 action(s) from 2 overlay(s)')
  // The one that matched nothing: an overlay silently changing nothing is
  // exactly what this line exists for.
  await expect(panel).toContainText("$.paths['/orders'].get matches nothing")
})

// Every hand-off points at the published file while the page shows the overlaid
// document. Each says so in its own terms, and none of them behind a control
// the reader has to open first.
test('the hand-offs say the file they give out is not the schema on screen', async ({ page }) => {
  await gotoFixture(page, OVERLAY_PAGE)

  // Home: next to the download button, not folded into its "?" explanation.
  await expect(page.locator('main')).toContainText(
    'What you read here is this file plus 2 OpenAPI overlay(s) this documentation applies on top',
  )

  // MCP: one of the two overlays is inline in the host page, so no bridge can
  // be pointed at it — including the one that reads overlays by URL.
  const card = page.locator('details', { hasText: 'Use this API from an AI agent' })
  await card.locator('summary').click()
  await expect(card.getByText('cannot be pointed at')).toBeVisible()

  // llms.txt: an agent following the Reference link fetches the published file.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms.txt' }).click()
  const content = await readFile(await (await downloadPromise).path(), 'utf8')
  expect(content).toContain(
    'the machine-readable contract as published — this documentation renders it through 2 overlay(s) the file does not carry',
  )

  // Audit: same file, and the grade above it was computed on the patched
  // document, which is the sharper end of the same gap.
  await page.goto(`${OVERLAY_PAGE}#/audit`)
  await expect(page.locator('audit-report')).toContainText(
    'This audit grades the schema with 2 OpenAPI overlay(s) this documentation applies',
  )
})

// The other direction, and the one nothing in the app produced: a workflow
// document written elsewhere, declared by a `scenarios[]` entry and rendered
// as the scenarios it holds (docs/scenarios.md §3).
test('a declared third-party Arazzo document becomes the scenarios it holds', async ({ page }) => {
  await gotoFixture(page, ARAZZO_PAGE)

  // One entry by `url`, two workflows: two nav entries, each under its own
  // workflowId and named by the document rather than by the entry.
  const links = nav(page).locator('a[data-scenario-id]')
  await expect(links).toHaveCount(3)
  await expect(nav(page).locator('a[data-scenario-id="create-then-read"]')).toHaveText(
    'Pet operations — Create a pet, then read it back',
  )
  await expect(nav(page).locator('a[data-scenario-id="list-pets"]')).toBeAttached()
  // The other carrier: the document sits in the config, nothing was fetched,
  // and the entry declaring a single workflow keeps its declared title.
  await expect(nav(page).locator('a[data-scenario-id="read-account"]')).toHaveText(
    'Carried in the config',
  )
  await expect(page.locator('main [data-pinned-card="read-account"]')).toContainText('1 step(s)')

  await page.goto(`${ARAZZO_PAGE}#/scenario/create-then-read`)
  await expect(
    view(page).getByRole('heading', { name: /Create a pet, then read it back/ }),
  ).toBeVisible()
  // Read-only, like every config scenario, whatever format declared it.
  await expect(view(page)).toContainText('provided')
  await expect(view(page).getByRole('button', { name: 'Duplicate' })).toBeVisible()
  // The steps this documentation can run: the operations resolve against the
  // schema it loaded, not against the production one the file names.
  await expect(view(page).locator('[data-step-request]')).toHaveText([
    'POST /pets',
    'GET /pets/{{petId}}',
  ])
  await expect(view(page)).toContainText('{{petId}} ← id')

  // Degraded, never discarded: the badge, and what is behind it named line by
  // line — the message step no browser has a transport for, and the sources
  // the file names next to the one that was actually loaded.
  await expect(view(page).getByText('partial support')).toBeVisible()
  const degraded = view(page).locator('[data-scenario-degraded]')
  await expect(degraded).toContainText('AsyncAPI message (receive on /pets/events)')
  await expect(degraded).toContainText('names the source "petstore"')
})

// The single-source case the publication aims at (docs/scenario-handoff.md
// §3.2): the file the author owns is the file the agent fetches, with no bake
// and no copy in between. The other carrier has no such address, and the map
// says one link fewer rather than inventing one.
test('the map links the Arazzo file the host already serves', async ({ page }) => {
  await gotoFixture(page, ARAZZO_PAGE)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms.txt' }).click()
  const content = await readFile(await (await downloadPromise).path(), 'utf8')

  expect(content).toContain('## Workflows')
  expect(content).toContain(
    '[Arazzo recipe](/tests/e2e/fixtures/e2e-third-party.arazzo.yaml) runs it unchanged in CI',
  )
  // Carried in the config: nothing is published to point at until the bake
  // emits it, so its line stops at the counts.
  expect(content).toMatch(/- \[Carried in the config]\([^)]+#\/scenario\/read-account\): 1 step, /)
})

// The same single source, on the other hand-off (docs/scenario-handoff.md §4):
// the CI job fetches the address the config states — the author's own file —
// instead of asking for an export to be committed next to it.
test('the CI job runs the very file the config declares', async ({ page }) => {
  await gotoFixture(page, ARAZZO_PAGE)
  await page.goto(`${ARAZZO_PAGE}#/scenario/create-then-read`)
  const panel = view(page).locator('[data-ci-panel]')
  await panel.locator('summary').click()

  await expect(panel).toContainText('your site already serves')
  const job = await panel.locator('pre').innerText()
  expect(job).toContain('curl -fsSL')
  expect(job).toContain('/tests/e2e/fixtures/e2e-third-party.arazzo.yaml')
  // Nothing of the repository is read, so nothing is checked out; the document
  // holds two workflows, and the job names the one this page is showing.
  expect(job).not.toContain('actions/checkout')
  expect(job).toContain('--workflow create-then-read')
  // Published as it stands: a file we did not write may say more than this
  // documentation runs, and more than the runner does.
  await expect(panel).toContainText("This document is its author's own")

  // Carried in the config, there is no served address: the job reads the file
  // the panel asks for at a path it names, and the download provides it. The
  // panel stays open across the navigation — a reader wiring a pipeline is
  // wiring several.
  await page.goto(`${ARAZZO_PAGE}#/scenario/read-account`)
  await expect(panel.locator('[data-ci-download]')).toBeVisible()
  await expect(panel).toContainText('arazzo/read-the-account.arazzo.json')
  const downloadPromise = page.waitForEvent('download')
  await panel.locator('[data-ci-download]').click()
  const recipe = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'))
  // The authored document, whole — not a recipe made from our reading of it.
  expect(recipe.workflows[0].workflowId).toBe('read-account')
  expect(recipe.sourceDescriptions[0].url).toBe('https://api.production.test/openapi.json')
})

test('an Arazzo document exported by the app comes back in as a scenario', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await openExportMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await view(page).getByText('Export as Arazzo 1.1').click()
  const path = await (await downloadPromise).path()
  const document = JSON.parse(await readFile(path, 'utf8'))
  expect(document.arazzo).toBe('1.1.0')

  await openExportMenu(page)
  await view(page).locator('[data-scenario-import]').click()
  await page.locator('input[type="file"]').setInputFiles(path)

  await expect(page.locator('.toast')).toContainText('1 Arazzo workflow(s) imported')
  // The fixture's third step points at an operation the schema does not
  // declare: it survives the round trip, and the loss is announced.
  await expect(page.locator('.toast')).toContainText('could not be converted')
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(2)
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)
  // Imported as a local scenario: its name is an editable field, and it is the
  // workflow's summary — which the export made of the scenario's own name.
  await expect(view(page).getByLabel('Scenario name')).toHaveValue('Onboarding')
})
