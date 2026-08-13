import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  clickNavOp,
  clipboardText,
  closeMobilePanels,
  expectResponded,
  gotoApp,
  mockApi,
  openDrawerIfMobile,
  openEnvManager,
  openHistory,
  openTryItIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'

const nav = (page) => page.locator('api-nav')
// The panel offers "Add to a scenario" in two places (header and
// export bar): the tests drive the header one.
const openCapture = (page) =>
  tryIt(page).locator('[data-scenario-capture]').first().locator('summary').click()
const view = (page) => page.locator('api-scenario-view')
const step = (page, index) => view(page).locator('li[data-step-id]').nth(index)
// Section header, not the start entry: getByText('Scenarios')
// would match both (Playwright compares case-insensitively).
const scenarioTitle = (page) => nav(page).locator('li.menu-title').filter({ hasText: 'Scenarios' })
// A local scenario's name is an editable field, not a title.
const nameField = (page) => view(page).getByLabel('Scenario name')

test('the nav always offers the Scenarios section, config scenarios first', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await expect(scenarioTitle(page)).toBeVisible()
  await expect(nav(page).locator('a[data-scenario-id="onboarding"]')).toHaveText('Onboarding')
  await expect(nav(page).getByRole('button', { name: '+ New scenario' })).toBeVisible()
  // Scenarios already exist: no start entry.
  await expect(nav(page).locator('[data-scenario-start]')).toHaveCount(0)
})

// No scenario at all (neither config nor local): the whole section shrinks to a
// single entry, which creates one and takes you to it. The inline doc declares none.
test('with no scenario at all, the nav shows a single entry that creates one', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/app-inline.html')
  await openDrawerIfMobile(page)
  await expect(nav(page).locator('a[data-op-id]').first()).toBeAttached()

  const start = nav(page).locator('[data-scenario-start]')
  await expect(start).toHaveText('Scenarios')
  // Neither a section header, nor utility items: a single line.
  await expect(scenarioTitle(page)).toHaveCount(0)
  await openDrawerIfMobile(page)
  await expect(nav(page).getByRole('button', { name: '+ New scenario' })).toHaveCount(0)

  await start.click()
  // Created and displayed, ready to be renamed.
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(nameField(page)).toHaveValue('New scenario')
  // A scenario exists: the full section takes the entry's place.
  await openDrawerIfMobile(page)
  await expect(nav(page).locator('[data-scenario-start]')).toHaveCount(0)
  await expect(scenarioTitle(page)).toBeVisible()
  await openDrawerIfMobile(page)
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(1)
  await openDrawerIfMobile(page)
  await expect(nav(page).getByRole('button', { name: '+ New scenario' })).toBeVisible()
})

test('a pinned scenario is surfaced on the home page', async ({ page }) => {
  await gotoApp(page)
  const card = page.locator('main [data-pinned-card="onboarding"]')
  await expect(card).toContainText('Onboarding')
  await expect(card).toContainText('3 step(s)')
  await expect(card).toContainText('Create a pet, then read it back.')
  // Steps announce their real endpoint, not their opId.
  await expect(card).toContainText('/pets/{petId}')
  await page.locator('main [data-pinned-scenario="onboarding"]').click()
  await expect(page).toHaveURL(/#\/scenario\/onboarding$/)
})

test('a scenario declared in the config renders its steps, chips and orphan step', async ({
  page,
}) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await nav(page).locator('a[data-scenario-id="onboarding"]').click()
  await expect(page).toHaveURL(/#\/scenario\/onboarding$/)

  await expect(view(page).getByRole('heading', { name: 'Onboarding' })).toBeVisible()
  await expect(view(page)).toContainText('provided')
  await expect(view(page)).toContainText('3 step(s)')
  await expect(view(page)).toContainText('Create a pet, then read it back.')
  // Step's Markdown note.
  await expect(view(page)).toContainText('First we create the pet.')
  // Chaining and success criterion, readable without running anything:
  // step 1 says what it produces, step 2 where what it
  // consumes comes from.
  await expect(view(page)).toContainText('{{petId}} ← id')
  await expect(step(page, 1).locator('[data-uses-variable="petId"]')).toHaveText(
    '{{petId}} ⇠ step 1',
  )
  await expect(view(page)).toContainText('201')
  // The step whose operation has vanished from the schema says so here.
  await expect(view(page)).toContainText('operation not found')
  // Every known step is a link to its operation's doc.
  await expect(view(page).locator('a[href="#/op/getPet"]')).toBeVisible()

  // The rail: one numbered marker per step, and the
  // request line anchoring each row — templates left visible, since the
  // chaining is what the reader follows. The orphan step has no operation to
  // build a line from, so it has none.
  await expect(view(page).locator('[data-step-marker]')).toHaveCount(3)
  await expect(step(page, 0).locator('[data-step-marker]')).toHaveText('1')
  await expect(step(page, 0).locator('[data-step-request]')).toHaveText('POST /pets')
  await expect(step(page, 1).locator('[data-step-request]')).toHaveText('GET /pets/{{petId}}')
  await expect(step(page, 2).locator('[data-step-request]')).toHaveCount(0)

  // The scenario is highlighted in the nav, and the try-it has nothing to do here.
  await expect(nav(page).locator('a[data-scenario-id="onboarding"]')).toHaveClass(/menu-active/)
  await expect(page.locator('api-try-it-panel')).not.toBeVisible()
})

test('a local scenario is created from the nav and survives a reload', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await nav(page).getByRole('button', { name: '+ New scenario' }).click()
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(nameField(page)).toHaveValue('New scenario')
  await expect(view(page)).toContainText('local')
  await expect(view(page)).toContainText('no steps yet')

  const hash = new URL(page.url()).hash
  await page.reload()
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(2)
  await expect(nameField(page)).toHaveValue('New scenario')
  // The deep-link holds after a reload, even on a local scenario
  // still being read from IndexedDB at the moment of routing.
  expect(new URL(page.url()).hash).toBe(hash)
})

test('scenarios are searchable from the palette', async ({ page }) => {
  await gotoApp(page)
  await page.keyboard.press('Control+k')
  await page.locator('search-palette input[type="search"]').fill('onboarding')
  const hit = page.locator('search-palette a[data-result-id="onboarding"]')
  await expect(hit).toBeVisible()
  await hit.click()
  await expect(page).toHaveURL(/#\/scenario\/onboarding$/)
  await expect(view(page).getByRole('heading', { name: 'Onboarding' })).toBeVisible()
})

test('an unknown scenario id is a plain not-found, not a broken page', async ({ page }) => {
  await gotoApp(page, '#/scenario/nope')
  await expect(page.locator('main')).toContainText('This scenario does not exist.')
})

// The empty list used to render a literal "null" (the falsy separator went
// straight into replaceChildren, which does not filter like `el`).
test('with no local scenario, the capture dropdown offers only the creation entry', async ({
  page,
}) => {
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await openCapture(page)

  const menu = tryIt(page).locator('[data-scenario-capture]').first().locator('.dropdown-content')
  await expect(menu.locator('li')).toHaveCount(1)
  await expect(menu).toHaveText('+ New scenario')
})

test('a request is captured from the try-it panel into a new scenario, then reordered', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await panelField(page, 'limit').fill('5')

  // Capture 1: new scenario. The capture takes you straight to the
  // scenario page, the added step expanded.
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  await expect(page.locator('.toast')).toContainText('Step added')
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  // Capture 2: the same operation, in the scenario that just came into being.
  await clickNavOp(page, 'listPets')
  await openCapture(page)
  await tryIt(page)
    .locator('[data-scenario-target]:not([data-scenario-target="new"])')
    .first()
    .click()
  // The last one added is the only one expanded.
  await expect(editor(page, 1)).toHaveAttribute('open', '')
  await expect(editor(page, 0)).not.toHaveAttribute('open', '')

  // Second step, on another endpoint, so we can verify the order.
  await clickNavOp(page, 'createPet')
  await openCapture(page)
  await tryIt(page)
    .locator('[data-scenario-target]:not([data-scenario-target="new"])')
    .first()
    .click()

  await expect(view(page)).toContainText('3 step(s)')
  await expect(step(page, 0)).toContainText('get')
  await expect(step(page, 2)).toContainText('post')

  // Reordering: the last step moves up one slot, and it persists.
  await step(page, 2).getByLabel('Move step up').click()
  await expect(step(page, 1)).toContainText('post')
  await page.reload()
  await expect(step(page, 1)).toContainText('post')
})

test('a history entry is pinned into a scenario without leaking the token', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('42')
  await send(page)
  await expectResponded(page)

  const modal = page.locator('request-history-list .modal-box')
  await openHistory(page)
  await expect(modal).toBeVisible()
  const entry = modal.locator('.collapse').first()
  await entry.locator('input[type="checkbox"]').first().check()
  await entry.getByText('Add to a scenario').click()
  await entry.locator('[data-scenario-target="new"]').click()
  // The popin closes itself: the rest of the work happens on the scenario.
  await expect(modal).toBeHidden()
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(1)
  // The environment's bearer went back out as a template, not in plain text.
  await expect(view(page)).not.toContainText('e2e-bearer-token')
})

test('a config scenario is duplicated into an editable local copy', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await view(page).getByRole('button', { name: 'Duplicate' }).click()
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(view(page)).toContainText('local')
  await expect(view(page).getByLabel('Scenario name')).toHaveValue('Copy of Onboarding')

  // The copy is editable: inline renaming, persistent.
  await view(page).getByLabel('Scenario name').fill('Mon parcours')
  await view(page).getByLabel('Scenario name').blur()
  await expect(nav(page).locator('a[data-scenario-id]').nth(1)).toHaveText('Mon parcours')
  await page.reload()
  await expect(view(page).getByLabel('Scenario name')).toHaveValue('Mon parcours')
})

test('a local scenario and its steps can be deleted', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await view(page).getByRole('button', { name: 'Duplicate' }).click()
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)

  await step(page, 0).getByLabel('Step actions').click()
  await step(page, 0).getByText('Remove this step').click()
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(2)

  page.on('dialog', (dialog) => dialog.accept())
  await view(page).getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(1)
})

test('a step is edited through the real try-it panel', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page, '#/scenario/onboarding')
  await view(page).getByRole('button', { name: 'Duplicate' }).click()

  // "Update" without having opened the step: refused, and stated as such.
  await step(page, 1).getByLabel('Update from the try-it panel').click()
  await expect(page.locator('.toast')).toContainText('Open the step in the try-it panel first')

  // Opening loads the step's request into the panel…
  await step(page, 1).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(page).toHaveURL(/#\/op\/getPet$/)
  await expect(panelField(page, 'petId')).toHaveValue('{{petId}}')

  // …we edit it, come back, update it.
  await panelField(page, 'petId').fill('{{otherId}}')
  await page.goBack()
  await step(page, 1).getByLabel('Update from the try-it panel').click()
  await expect(page.locator('.toast')).toContainText('Step updated')

  await step(page, 1).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(panelField(page, 'petId')).toHaveValue('{{otherId}}')
})

// Chaining: the POST yields an id, the following GET must carry it in its URL.
const chainMock = (page) =>
  mockApi(page, (req) =>
    req.method() === 'POST' ? { status: 201, body: { id: 42, name: 'Rex' } } : { status: 200 },
  )

// Local copy of the config scenario, without its orphan step.
async function localCopyOfOnboarding(page) {
  await gotoApp(page, '#/scenario/onboarding')
  await view(page).getByRole('button', { name: 'Duplicate' }).click()
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)
  await step(page, 2).getByLabel('Step actions').click()
  await step(page, 2).getByText('Remove this step').click()
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(2)
}

test('running a scenario chains the extracted value into the next step', async ({ page }) => {
  const calls = await chainMock(page)
  await localCopyOfOnboarding(page)

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')

  // The id extracted from the POST response went out in the GET's URL.
  expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
    'POST /v1/pets',
    'GET /v1/pets/42',
  ])
  await expect(step(page, 0)).toHaveAttribute('data-step-status', 'ok')
  await expect(step(page, 0)).toContainText('201')
  await expect(step(page, 0)).toContainText('petId = 42')
  await expect(step(page, 1)).toHaveAttribute('data-step-status', 'ok')
  // The rail's position: the run ended on the last step, and it says so.
  await expect(step(page, 1)).toHaveAttribute('data-step-active', '')
  await expect(step(page, 0)).not.toHaveAttribute('data-step-active', /.*/)

  // Every step sent left its trace in the history, tagged with the run.
  await openHistory(page)
  const modal = page.locator('request-history-list .modal-box')
  await expect(modal.locator('.collapse')).toHaveCount(2)
  await expect(modal.locator('.collapse').first().locator('[data-scenario-badge]')).toBeVisible()
})

test('a failing step stops the run and greys out the rest', async ({ page }) => {
  const calls = await mockApi(page, { status: 500, body: { error: 'boom' } })
  await localCopyOfOnboarding(page)

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('0/2 steps succeeded')
  await expect(step(page, 0)).toHaveAttribute('data-step-status', 'failed')
  await expect(step(page, 0)).toContainText('expected 201, got 500')
  await expect(step(page, 1)).toHaveAttribute('data-step-status', 'skipped')
  await expect(step(page, 1)).toContainText('a previous step stopped the run')
  // The second step was never sent.
  expect(calls).toHaveLength(1)
})

test('a missing variable is announced before the run, and blocks it', async ({ page }) => {
  const calls = await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('{{unknownVar}}')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  // The prerequisites panel says so before the run is even started.
  await expect(view(page)).toContainText('Prerequisites')
  await expect(view(page)).toContainText('Missing in this environment: unknownVar')

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('0/1 steps succeeded')
  await expect(step(page, 0)).toHaveAttribute('data-step-status', 'blocked')
  await expect(step(page, 0)).toContainText('missing variable')
  // Rule 11: the literal {{unknownVar}} never went out.
  expect(calls).toHaveLength(0)
})

// --- sharing and interop (docs/scenarios.md §8) --------------------------------

// The export menu is a daisyUI <details>: its trigger is a <summary>,
// not a button in the ARIA sense.
const openExportMenu = (page) => view(page).locator('[data-scenario-export-menu] > summary').click()

test('a scenario travels by link: preview, explicit import, nothing before', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await openExportMenu(page)
  await view(page).getByText('Copy a share link').click()
  await expect(page.locator('.toast')).toContainText('Share link copied')

  const link = await clipboardText(page)
  expect(link).toContain('#/scenario-import?d=')
  // No environment value in the link: the scenario is a template.
  expect(link).not.toContain('e2e-bearer-token')

  // Opening on the recipient's side: a preview, nothing else.
  await page.goto(link)
  await expect(view(page)).toContainText('Import this scenario?')
  await expect(view(page).getByRole('heading', { name: 'Onboarding' })).toBeVisible()
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)
  // Neither running nor writing: the nav only knows the config scenario.
  await expect(view(page).getByRole('button', { name: 'Run all' })).toHaveCount(0)
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(1)

  await view(page).locator('[data-import-accept]').click()
  await expect(page).toHaveURL(/#\/scenario\/[0-9a-f-]{36}$/)
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(2)
  // Imported = local, hence editable.
  await expect(nameField(page)).toHaveValue('Onboarding')
  await page.reload()
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(2)
})

test('a damaged share link is a plain message, never a broken page', async ({ page }) => {
  await gotoApp(page, '#/scenario-import?d=not-base64')
  await expect(page.locator('main')).toContainText('could not be read')
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(1)
})

test('the scenario file round-trips through download and import', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await openExportMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await view(page).getByText('Download the scenario file').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('onboarding.json')

  const path = await download.path()
  const file = JSON.parse(await readFile(path, 'utf8'))
  expect(file).toMatchObject({ format: 'apiglow-scenario', v: 1 })
  expect(file.scenario.steps).toHaveLength(3)

  // Re-import via the scenario page's Export menu: the exported file is
  // directly shareable, it's the format declared in config.
  await openExportMenu(page)
  await view(page).locator('[data-scenario-import]').click()
  await page.locator('input[type="file"]').setInputFiles(path)
  await expect(page.locator('.toast')).toContainText('imported')
  await expect(nav(page).locator('a[data-scenario-id]')).toHaveCount(2)
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)
})

// The gap left by the nav's empty state: on a fresh install, a
// received file must still be importable — the "Scenarios" entry creates one, and the page thus
// opened carries the import in plain sight, not only under its Export menu.
test('a received file is importable on a fresh install, from the empty scenario page', async ({
  page,
}) => {
  await gotoApp(page, '#/scenario/onboarding')
  // Scenario already populated: the import stays tucked away in the menu, the
  // action row does not clutter itself with a button whose moment has passed.
  await expect(view(page).locator('[data-scenario-import-button]')).toHaveCount(0)
  await openExportMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await view(page).getByText('Download the scenario file').click()
  const path = await (await downloadPromise).path()

  // Installation with no scenario at all: the nav never carries the import,
  // the scenario page is the only entry point.
  await page.goto('/tests/e2e/fixtures/app-inline.html')
  await expect(nav(page).locator('a[data-op-id]').first()).toBeAttached()
  await openDrawerIfMobile(page)
  await expect(nav(page).locator('[data-scenario-import]')).toHaveCount(0)

  await nav(page).locator('[data-scenario-start]').click()
  // The import button is in the page, not the nav: the drawer has to go.
  await closeMobilePanels(page)
  await view(page).locator('[data-scenario-import-button]').click()
  await page.locator('input[type="file"]').setInputFiles(path)
  await expect(page.locator('.toast')).toContainText('imported')
  await expect(view(page).locator('li[data-step-id]')).toHaveCount(3)
})

test('the Arazzo export is downloadable and structurally valid', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')
  await openExportMenu(page)
  const downloadPromise = page.waitForEvent('download')
  await view(page).getByText('Export as Arazzo 1.1').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('onboarding.arazzo.json')

  const doc = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(doc.arazzo).toBe('1.1.0')
  expect(doc.sourceDescriptions[0].url).toContain('/tests/e2e/fixtures/e2e-api.json')
  const [workflow] = doc.workflows
  expect(workflow.steps.map((s) => s.stepId)).toEqual(['createPet', 'getPet', 'removedFromSchema'])
  expect(workflow.steps[0].outputs.petId).toBe('$response.body#/id')
  expect(workflow.steps[1].parameters).toContainEqual({
    name: 'petId',
    in: 'path',
    value: '$steps.createPet.outputs.petId',
  })
})

// The CI hand-off (docs/scenario-handoff.md §4): scheduling is impossible in a
// front-end product, so the page hands the reader a job for the CI they already
// have. What the job must be given travels as a name wired to their secret
// store — the environment's value never leaves the browser (rule 12).
test('the CI job names the variables it needs and carries none of their values', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'getPet')
  // The environment holds `token` = tok-123: the step references the variable,
  // and the scenario is a template — here as everywhere else it travels.
  await panelField(page, 'petId').fill('{{token}}')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  const panel = view(page).locator('[data-ci-panel]')
  await panel.locator('summary').click()
  await expect(panel.locator('[data-ci-secrets]')).toContainText('TOKEN')
  const job = await panel.locator('pre').innerText()
  expect(job).toContain('npx @redocly/cli@latest respect')
  expect(job).toContain('--input token="$TOKEN"')
  expect(job).toContain(`TOKEN: \${{ secrets.TOKEN }}`)
  expect(job).not.toContain('tok-123')

  // The other platform, and the runner the panel names next to it: same job,
  // the shapes those two projects take it in.
  await panel.getByLabel('CI platform').selectOption('gitlab')
  await expect(panel.locator('pre')).toContainText('.gitlab-ci.yml')
  await panel.getByLabel('Arazzo runner').selectOption('arazzo-runner')
  await expect(panel.locator('pre')).toContainText('arazzo-runner execute-workflow')
  expect(await panel.locator('pre').innerText()).not.toContain('tok-123')

  // What the selected runner would not run, named rather than left to fail on
  // the first pipeline: this one states no Arazzo revision at all.
  await expect(panel).toContainText('states no Arazzo revision')
})

// --- one-click chaining (docs/scenarios.md §5.4) -----------------------------

const editor = (page, index) => step(page, index).locator('[data-step-editor]')

// Every edit of a scenario is a round trip through IndexedDB, after which the
// whole timeline re-renders. A test types faster than that: the next `fill`
// would land in a field about to be replaced, and take the value with it —
// which is the flake that hit a slower engine and not Chromium. Usually the
// step's own summary line is the proof the write landed; where the edit is
// half of a row that shows nothing until it is complete, this is. Marked
// BEFORE the action, awaited after: the mark is gone once the render that
// replaced the node has happened, and a round trip faster than the marking
// call cannot be missed.
async function marked(locator) {
  await locator.evaluate((node) => node.setAttribute('data-settling', ''))
  return () => expect(locator).not.toHaveAttribute('data-settling', '')
}
// Both tabs expose the same key attributes: each test states
// which one it drives.
const pane = (page, index, kind) => editor(page, index).locator(`[data-chain-pane="${kind}"]`)

test('a chained variable is created by clicking a key of the real response', async ({ page }) => {
  const calls = await mockApi(page, (req) =>
    req.method() === 'POST'
      ? // `category` is here for the nesting: the row actions must stay on one
        // vertical line whatever the depth of the key they belong to.
        { status: 201, body: { id: 42, access_token: 'tok', category: { name: 'dogs' } } }
      : { status: 200 },
  )
  await gotoApp(page)

  // A request sent then captured: its response feeds the editor.
  await clickNavOp(page, 'createPet')
  await send(page)
  await expectResponded(page)
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('{{petId}}')
  await openCapture(page)
  await tryIt(page)
    .locator('[data-scenario-target]:not([data-scenario-target="new"])')
    .first()
    .click()

  // The capture left step 2 expanded: it's step 1 we're here to edit.
  await editor(page, 0).locator('summary').click()
  await expect(editor(page, 0)).toContainText('Last known response')

  // Icon-only buttons: what names them is the accessible name and the tooltip,
  // and both state which key they act on. A column of bare glyphs is what the
  // user could not read, so this is contract, not decoration.
  const extract = pane(page, 0, 'response').locator('[data-extract-pointer="/id"]')
  const check = pane(page, 0, 'response').locator('[data-assert-pointer="/access_token"]')
  await expect(extract).toHaveAccessibleName('Extract id into a variable')
  await expect(extract.locator('xpath=..')).toHaveAttribute(
    'data-tip',
    'Extract id into a variable',
  )
  await expect(check).toHaveAccessibleName('Check the value of access_token')

  // The pair opens every row at the same x, whatever the depth: that alignment
  // is the point of moving them left, so a nested key's buttons must sit
  // exactly where a root key's do.
  const boxOf = async (pointer) =>
    pane(page, 0, 'response').locator(`[data-extract-pointer="${pointer}"]`).boundingBox()
  expect((await boxOf('/id')).x).toBe((await boxOf('/category/name')).x)

  // A container has nothing worth checking, so its check button is gone rather
  // than greyed — and the slot it leaves is exactly what keeps the alignment
  // above true for the rows under it.
  await expect(pane(page, 0, 'response').locator('[data-assert-pointer="/category"]')).toHaveCount(
    0,
  )

  // Clicking the key creates the extraction, named after it.
  await extract.click()
  await expect(step(page, 0)).toContainText('{{id}} ← id')
  // Inline renaming to match the next step's template.
  const name = editor(page, 0).locator('[data-extract-row="0"] input').first()
  await name.fill('petId')
  await name.blur()
  await expect(step(page, 0)).toContainText('{{petId}} ← id')

  // The check button creates an assertion pre-filled with the observed value.
  await check.click()
  await expect(step(page, 0)).toContainText('access_token = tok')

  // The editor stays open between two writes, and all of this persists.
  await expect(editor(page, 0)).toHaveAttribute('open', '')
  await page.reload()
  await expect(step(page, 0)).toContainText('{{petId}} ← id')

  // And it really chains: the auto run passes the extracted id to step 2.
  calls.length = 0
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/pets', '/v1/pets/42'])
})

// Chaining is a series of clicks in the same list, and each of them re-renders
// the whole timeline: without the place being kept, the second key is picked
// from a list that has jumped back to its first row, and the keyboard is left
// on <body>.
test('picking a key deep in the list leaves the reader — and the focus — where they were', async ({
  page,
}) => {
  // Long enough that the box (max-h-72) really scrolls, on a phone viewport too.
  const body = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field${i}`, i]))
  await mockApi(page, { status: 201, body })
  await gotoApp(page)
  await clickNavOp(page, 'createPet')
  await send(page)
  await expectResponded(page)
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  const list = pane(page, 0, 'response').locator('[data-keep-scroll]')
  await expect(list).toBeVisible()
  const key = pane(page, 0, 'response').locator('[data-extract-pointer="/field39"]')
  // Driven from the keyboard: clicking a button does not focus it in every
  // engine, and it is the keyboard that has nowhere to go back to.
  await key.focus()
  await key.scrollIntoViewIfNeeded()
  const scrolled = await list.evaluate((node) => node.scrollTop)
  expect(scrolled).toBeGreaterThan(0)

  await page.keyboard.press('Enter')
  await expect(step(page, 0)).toContainText('{{field39}}')
  // The list is a new node after the re-render: the locator resolves it again.
  expect(await list.evaluate((node) => node.scrollTop)).toBe(scrolled)
  await expect(key).toBeFocused()

  // And the next key down is one keystroke away, not one hunt away.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(step(page, 0)).toContainText('field39 = 39')
})

test('an expected status and a manual pointer are editable without any JSON file', async ({
  page,
}) => {
  await mockApi(page, { status: 200, body: [{ id: 1 }] })
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  // The capture already lands there, the step's editor open.
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  // No known response, and a pointer the schema does not show: manual
  // entry remains the last resort, always there.
  await editor(page, 0).locator('[data-add-extract]').click()
  const row = editor(page, 0).locator('[data-extract-row="0"] input')
  await row.first().fill('firstId')
  await row.first().blur()
  // Each commit is a round trip through IndexedDB, after which the whole view
  // re-renders — the summary is what says the first edit landed. Typing into
  // the next field before that is a race the user cannot even lose (they see
  // the row) but a test can, and does, on a slower engine.
  await expect(step(page, 0)).toContainText('{{firstId}}')
  await row.nth(1).fill('0.id')
  await row.nth(1).blur()
  await expect(step(page, 0)).toContainText('{{firstId}} ← 0.id')
  // A JSON pointer pasted from a file is still accepted, and reads back in
  // dot notation like the rest.
  await row.nth(1).fill('/0/id')
  await row.nth(1).blur()
  await expect(row.nth(1)).toHaveValue('0.id')

  // Exact: the row actions name the key they act on ("Extract status into a
  // variable"), so a substring match would pull them in too.
  const status = editor(page, 0).getByLabel('Status', { exact: true })
  await status.fill('201')
  await status.blur()
  await page.reload()
  await expect(step(page, 0)).toContainText('201')

  // Wrong expected status: the run says so, without making anything up.
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(step(page, 0)).toContainText('expected 201, got 200')
  await expect(step(page, 0)).toContainText('firstId = 1')
})

// A query extraction, end to end: written in the editor, run against the
// fixture API, and chained into the next step like a pointer extraction.
test('a query extraction produces its variable and chains', async ({ page }) => {
  const calls = await mockApi(page, (req) =>
    req.method() === 'POST' ? { status: 201, body: { pets: [{ id: 42 }, { id: 99 }] } } : {},
  )
  await gotoApp(page)
  await clickNavOp(page, 'createPet')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('{{petId}}')
  await openCapture(page)
  await tryIt(page)
    .locator('[data-scenario-target]:not([data-scenario-target="new"])')
    .first()
    .click()

  await editor(page, 0).locator('summary').click()
  await editor(page, 0).locator('[data-add-extract]').click()
  const row = () => editor(page, 0).locator('[data-extract-row="0"]')
  const name = () => row().locator('input').first()
  await name().fill('petId')
  await name().blur()

  // The third answer to "where and how is the value read".
  await row().getByLabel('Value source').selectOption('query')
  const query = () => row().getByLabel('JSONPath ($.data[*])')
  await query().fill('$.pets[*].id')
  await query().blur()

  calls.length = 0
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  // First node wins: 42, not 99.
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/pets', '/v1/pets/42'])
})

// Arazzo's step timeout, end to end: the field is editable, the deadline is
// applied, and the failure is attributed to us rather than to the API.
test('a step timeout fails the step on its own terms, not as a network error', async ({ page }) => {
  await mockApi(page, { status: 200, body: [{ id: 1 }], delayMs: 1500 })
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  const timeout = () => editor(page, 0).getByLabel('Timeout (ms)', { exact: true })
  await timeout().fill('300')
  await timeout().blur()
  // It survives the reload like any other step field — the editor comes back
  // collapsed, so the field only exists again once it is reopened.
  await page.reload()
  await editor(page, 0).locator('summary').click()
  await expect(editor(page, 0).getByLabel('Timeout (ms)', { exact: true })).toHaveValue('300')

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(step(page, 0)).toContainText('the step exceeded its timeout')
  // Never "the request never reached the API": the server was never given the
  // time to answer, and blaming it would be the wrong reading.
  await expect(step(page, 0)).not.toContainText('never reached the API')
})

// Arazzo's `regex` criterion, from the reader's end: same two fields as
// `equals`, only the comparison changes — so what the test has to prove is
// that the pattern is read as one, not as a literal.
test('a regex check compares the pointed-at value against a pattern', async ({ page }) => {
  await mockApi(page, { status: 200, body: [{ id: 1, name: 'Rex' }] })
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  let settled = await marked(step(page, 0))
  await editor(page, 0).locator('[data-add-assertion]').click()
  await settled()

  const row = () => editor(page, 0).locator('[data-assertion-row="0"]')
  settled = await marked(step(page, 0))
  await row().getByLabel('Comparison').selectOption('regex')
  await settled()

  // A half-written regex row shows no chip — the empty pattern is filtered out
  // rather than run as a check that passes on everything — so these two writes
  // are waited on for themselves, before the next field is typed into.
  const path = () => row().getByLabel('Path (data.id)')
  settled = await marked(step(page, 0))
  await path().fill('0.name')
  await path().blur()
  await settled()
  // The pattern field replaces "Expected value": same slot, different meaning.
  const pattern = () => row().getByLabel('Pattern (^ab.*)')
  await pattern().fill('^R')
  await pattern().blur()
  await expect(step(page, 0)).toContainText('0.name ~ /^R/')

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('1/1 steps succeeded')

  // A pattern, not a literal: "ex$" matches inside "Rex" where an equals never
  // would, and the failure line shows the pattern next to the value it saw.
  await pattern().fill('ex$')
  await pattern().blur()
  await expect(step(page, 0)).toContainText('0.name ~ /ex$/')
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('1/1 steps succeeded')

  await pattern().fill('^ex')
  await pattern().blur()
  await expect(step(page, 0)).toContainText('0.name ~ /^ex/')
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(step(page, 0)).toContainText('0.name: expected to match /^ex/, got Rex')
})

// Arazzo 1.1's `jsonpath` criterion, from the only end a reader has: the
// check is written as a query, and the picker that fills a path is gone
// while it is — two languages, never the same field.
test('a jsonpath check is written as a query, runs, and names an empty nodelist', async ({
  page,
}) => {
  await mockApi(page, { status: 200, body: [{ id: 1 }] })
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  await editor(page, 0).locator('[data-add-assertion]').click()
  const row = () => editor(page, 0).locator('[data-assertion-row="0"]')
  await expect(row().getByLabel('Path (data.id)')).toBeVisible()
  await row().getByLabel('Comparison').selectOption('matches')
  // The path field is replaced, not left inert alongside the query.
  await expect(row().getByLabel('Path (data.id)')).toHaveCount(0)

  const query = () => row().getByLabel('JSONPath ($.data[*])')
  await query().fill('$[?@.id > 0]')
  await query().blur()
  await expect(step(page, 0)).toContainText('$[?@.id > 0] ?')

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('1/1 steps succeeded')

  // A query that selects nothing fails, and the report says which query and why.
  await query().fill('$[?@.id > 99]')
  await query().blur()
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('0/1')
  await expect(step(page, 0)).toContainText('$[?@.id > 99] — no node matches this query')
})

// A response's keys are known in advance — it's the schema that
// declares them. Nothing requires sending a request to click them.
test('the declared schema makes the keys clickable before anything is ever sent', async ({
  page,
}) => {
  await mockApi(page, { status: 201, body: { id: 42, name: 'Rex' } })
  await gotoApp(page)
  await clickNavOp(page, 'createPet')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  await expect(editor(page, 0)).toHaveAttribute('open', '')

  // No send: a single tab, the schema one, on the declared 201.
  await expect(editor(page, 0).locator('[data-chain-tab]')).toHaveCount(0)
  await expect(pane(page, 0, 'schema')).toContainText('Declared response')
  await expect(pane(page, 0, 'schema')).toContainText('201')
  // The type, never an example value: nothing must pass for observed.
  await expect(pane(page, 0, 'schema')).toContainText('id: integer')
  await expect(pane(page, 0, 'schema')).toContainText('status?: "available" | "pending" | "sold"')

  await pane(page, 0, 'schema').locator('[data-extract-pointer="/id"]').click()
  await expect(step(page, 0)).toContainText('{{id}} ← id')

  // Without an observed value, the check can only be an "exists" — a
  // '= "string"' would be an assertion nobody asked for.
  await pane(page, 0, 'schema').locator('[data-assert-pointer="/name"]').click()
  await expect(step(page, 0)).toContainText('name ?')

  // Another response's schema can be consulted without the step's expected
  // status being changed.
  await pane(page, 0, 'schema').locator('[data-chain-schema-status]').selectOption('400')
  await expect(pane(page, 0, 'schema')).toContainText('message: string')
  await expect(step(page, 0).locator('.badge', { hasText: '400' })).toHaveCount(0)

  // Once the request is sent, the real response takes the default tab,
  // and the schema stays accessible alongside — it shows what the response doesn't say.
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('1/1 steps succeeded')
  await expect(editor(page, 0).locator('[data-chain-tab="response"]')).toHaveClass(/tab-active/)
  await editor(page, 0).locator('[data-chain-tab="schema"]').click()
  // Both the tab AND the chosen status survive the re-render that every
  // write triggers — otherwise every click would send the user back to the start.
  await expect(pane(page, 0, 'schema').locator('[data-chain-schema-status]')).toHaveValue('400')
  await pane(page, 0, 'schema').locator('[data-extract-pointer="/message"]').click()
  await expect(pane(page, 0, 'schema')).toBeVisible()
  await expect(step(page, 0)).toContainText('{{message}} ← message')
})

// The reverse of the extraction gesture: we start from the gap, not from what we think
// needs extracting.
test('an unprovided variable offers where to take it from, from the schema alone', async ({
  page,
}) => {
  await mockApi(page)
  await gotoApp(page)

  await clickNavOp(page, 'createPet')
  await openCapture(page)
  await tryIt(page).locator('[data-scenario-target="new"]').click()

  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('{{petId}}')
  await openCapture(page)
  await tryIt(page)
    .locator('[data-scenario-target]:not([data-scenario-target="new"])')
    .first()
    .click()

  // Nobody supplies {{petId}}: the red badge is the entry point.
  const chip = step(page, 1).locator('[data-uses-variable="petId"]')
  await expect(chip).toContainText('not provided')
  await chip.click()

  // `Pet` + `id` = `petId`: the suggestion comes out of step 1's schema, without
  // any request having been sent.
  const suggestion = step(page, 1).locator('[data-suggest-pointer="/id"]')
  await expect(suggestion).toContainText('declared')
  await suggestion.click()

  // The extraction is written into the step that PRODUCES the value, under the name
  // the next step expects: the chain closes.
  await expect(step(page, 0)).toContainText('{{petId}} ← id')
  await expect(step(page, 1).locator('[data-uses-variable="petId"]')).toContainText('step 1')

  const calls = await mockApi(page, (req) =>
    req.method() === 'POST' ? { status: 201, body: { id: 42 } } : { status: 200 },
  )
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/pets', '/v1/pets/42'])
})

// --- guided step-by-step (docs/scenarios.md §5.3) ---------------------------------

const stepper = (page) => page.locator('scenario-stepper')
const stepAction = (page, kind) => stepper(page).locator(`[data-step-action="${kind}"]`)

test('the guided run walks the real try-it panel, step by step', async ({ page }) => {
  const calls = await chainMock(page)
  await localCopyOfOnboarding(page)
  const scenarioHash = new URL(page.url()).hash

  await view(page).getByRole('button', { name: 'Step by step' }).click()

  // The app navigates to the step's operation and loads its request, but
  // sends nothing: it's the user who sends.
  await expect(page).toHaveURL(/#\/op\/createPet$/)
  await expect(stepper(page)).toContainText('Step 1/2')
  await expect(stepper(page)).toContainText('First we create the pet.')
  expect(calls).toHaveLength(0)
  // The panel is in the scenario's hands: the banner names it, and offering
  // to add the operation to ANOTHER scenario no longer makes sense here.
  await expect(tryIt(page).locator('[data-scenario-capture]').first()).toBeHidden()

  await send(page)
  await expectResponded(page)
  await expect(stepper(page)).toContainText('passed')
  await expect(stepper(page)).toContainText('petId = 42')
  await stepAction(page, 'next').click()

  // Step 2: the extracted value lives in the run scope — the field keeps its
  // template, and the send does go out to /pets/42.
  await expect(page).toHaveURL(/#\/op\/getPet$/)
  await expect(stepper(page)).toContainText('Step 2/2')
  await expect(panelField(page, 'petId')).toHaveValue('{{petId}}')
  await send(page)
  await expectResponded(page)
  expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
    'POST /v1/pets',
    'GET /v1/pets/42',
  ])

  // Finishing brings you back to the scenario, with the report and pending persistence.
  await stepAction(page, 'next').click()
  expect(new URL(page.url()).hash).toBe(scenarioHash)
  await expect(stepper(page)).toBeHidden()
  // Run finished: the panel becomes a free try again, capture included.
  await clickNavOp(page, 'listPets')
  await expect(tryIt(page).locator('[data-scenario-capture]').first()).toBeVisible()
  await page.goBack()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  await expect(step(page, 1)).toHaveAttribute('data-step-status', 'ok')
  await expect(view(page).getByRole('button', { name: /Save 1 variable/ })).toBeVisible()

  // Step-by-step sends are traced in the history just like the auto run's.
  await openHistory(page)
  const badge = page
    .locator('request-history-list .modal-box .collapse')
    .first()
    .locator('[data-scenario-badge]')
  await expect(badge).toBeVisible()
  // The badge says WHICH scenario it is — on hover, since the row is
  // already full.
  await expect(badge).toHaveAttribute('title', 'Copy of Onboarding')
})

test('a failing step offers retry, and the retry replays only that step', async ({ page }) => {
  let broken = true
  const calls = await mockApi(page, (req) => {
    if (req.method() !== 'POST') return { status: 200 }
    return broken
      ? { status: 500, body: { error: 'boom' } }
      : { status: 201, body: { id: 42, name: 'Rex' } }
  })
  await localCopyOfOnboarding(page)
  await view(page).getByRole('button', { name: 'Step by step' }).click()

  await send(page)
  await expect(stepper(page)).toContainText('failed')
  await expect(stepper(page)).toContainText('expected 201, got 500')
  // No automatic advance after a failure: three explicit outcomes.
  await expect(stepAction(page, 'next')).toHaveCount(0)
  await expect(stepAction(page, 'continue')).toBeVisible()

  broken = false
  await stepAction(page, 'retry').click()
  await expect(stepper(page)).toContainText('Step 1/2')
  await send(page)
  await expect(stepper(page)).toContainText('passed')
  await stepAction(page, 'next').click()
  await expect(page).toHaveURL(/#\/op\/getPet$/)

  // Quitting mid-way hands back control, with the report of what ran.
  await stepAction(page, 'quit').click()
  await expect(stepper(page)).toBeHidden()
  await expect(step(page, 0)).toHaveAttribute('data-step-status', 'ok')
  await expect(view(page).getByRole('status')).toContainText('1/1 steps succeeded')
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
})

test('a send on another endpoint during a guided run is not the step’s answer', async ({
  page,
}) => {
  const calls = await chainMock(page)
  await localCopyOfOnboarding(page)
  await view(page).getByRole('button', { name: 'Step by step' }).click()
  await expect(page).toHaveURL(/#\/op\/createPet$/)

  // The user goes off to explore another endpoint and sends: that does not belong
  // to the scenario — the step is still waiting.
  await expect(page.locator('main h1')).toHaveText('Create a pet')
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)
  await expect(stepper(page)).toContainText('Step 1/2')
  await expect(stepper(page)).toContainText('Review the request')
  await expect(stepper(page)).not.toContainText('passed')

  // This send is not tagged with the scenario, unlike the step's own.
  await openHistory(page)
  const firstEntry = page.locator('request-history-list .modal-box .collapse').first()
  await expect(firstEntry.locator('[data-scenario-badge]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // Back to the step via the banner, then send: the run resumes its course.
  // The stepper rides above the form, i.e. inside the sheet below lg.
  await openTryItIfMobile(page)
  await stepAction(page, 'resume').click()
  await expect(page).toHaveURL(/#\/op\/createPet$/)
  await send(page)
  await expect(stepper(page)).toContainText('passed')
  expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
})

test('the draft left in the try-it panel comes back after a guided run', async ({ page }) => {
  await chainMock(page)
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await clickNavOp(page, 'getPet')
  await openTryItIfMobile(page)
  await panelField(page, 'petId').fill('draft-123')

  // Internal navigation (no reload): the draft is in memory.
  await openDrawerIfMobile(page)
  await nav(page).locator('a[data-scenario-id="onboarding"]').click()
  await view(page).getByRole('button', { name: 'Duplicate' }).click()
  await view(page).getByRole('button', { name: 'Step by step' }).click()
  await expect(page).toHaveURL(/#\/op\/createPet$/)
  await stepAction(page, 'quit').click()

  await clickNavOp(page, 'getPet')
  await openTryItIfMobile(page)
  await expect(panelField(page, 'petId')).toHaveValue('draft-123')
})

test('an extracted value can be saved into the environment after the run', async ({ page }) => {
  await chainMock(page)
  await localCopyOfOnboarding(page)

  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  // Sensitive extraction (it persists into auth.*): masked in the report.
  await expect(step(page, 0)).toContainText('auth.session = \u2022\u2022\u2022\u2022')
  await expect(step(page, 0)).not.toContainText('auth.session = Rex')

  await view(page)
    .getByRole('button', { name: /Save 1 variable/ })
    .click()
  await expect(page.locator('.toast')).toContainText('1 variable(s) saved in "e2e"')
  // The button only offers itself once: the value is in the environment.
  await expect(view(page).getByRole('button', { name: /Save 1 variable/ })).toHaveCount(0)

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('apidoc:environments')))
  const variable = stored[0].variables.find((v) => v.name === 'auth.session')
  expect(variable).toMatchObject({ value: 'Rex', sensitive: true })
})

test('a skipped step offers to type the missing variable instead of a dead end', async ({
  page,
}) => {
  const calls = await chainMock(page)
  await localCopyOfOnboarding(page)
  await view(page).getByRole('button', { name: 'Step by step' }).click()

  // Step 1 passed: step 2 waits on a {{petId}} that nobody produces.
  await stepAction(page, 'skip').click()
  await expect(stepper(page)).toContainText('Missing variables')
  // The "define them in the environment" message gives way to the field.
  await expect(stepper(page)).not.toContainText('Define them in the selected environment')

  await stepper(page).locator('[data-missing-var="petId"]').fill('77')
  await stepper(page).locator('[data-missing-persist]').check()
  await stepAction(page, 'provide').click()

  // The step continues with the entered value, and the send does target /pets/77.
  await expect(stepper(page)).toContainText('Step 2/2')
  await expect(stepper(page)).toContainText('Review the request')
  await expect(stepper(page).locator('[data-run-variable="petId"]')).toContainText('{{petId}} = 77')
  await send(page)
  await expectResponded(page)
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v1/pets/77'])

  // Checked, the box also wrote the variable into the selected environment.
  await stepAction(page, 'quit').click()
  await openEnvManager(page)
  await expect(page.locator('env-manager .modal-box input[placeholder="name"]').last()).toHaveValue(
    'petId',
  )
})

test('replaying a step updates the run variables instead of keeping the first ones', async ({
  page,
}) => {
  let petId = 42
  await mockApi(page, (req) =>
    req.method() === 'POST' ? { status: 201, body: { id: petId, name: 'Rex' } } : { status: 200 },
  )
  await localCopyOfOnboarding(page)
  await view(page).getByRole('button', { name: 'Step by step' }).click()

  await send(page)
  await expect(stepper(page)).toContainText('petId = 42')

  // Re-sending the same step, with no decision made in between: the verdict and the
  // variables follow the latest response.
  petId = 99
  await send(page)
  await expect(stepper(page)).toContainText('petId = 99')
  await expect(stepper(page)).not.toContainText('petId = 42')

  await stepAction(page, 'next').click()
  await expect(stepper(page).locator('[data-run-variable="petId"]')).toContainText('{{petId}} = 99')
})

test('“see in history” frames the whole scenario, that step’s entry unfolded', async ({ page }) => {
  await chainMock(page)
  await localCopyOfOnboarding(page)

  // A free try on step 2's endpoint: outside the scenario, it has no business
  // being in its trace — it's the one the per-endpoint filter used to
  // surface instead.
  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('7')
  await send(page)
  await expectResponded(page)
  await page.goBack()

  // Two runs: precisely what we're here to compare.
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')
  await view(page).getByRole('button', { name: 'Run all' }).click()
  await expect(view(page).getByRole('status')).toContainText('2/2 steps succeeded')

  await step(page, 1).getByRole('button', { name: 'See in history' }).click()
  const entries = page.locator('request-history-list .modal-box .collapse')
  // The four calls from the two runs, and only them.
  await expect(entries).toHaveCount(4)
  // The framing is readable, and is named.
  await expect(page.locator('[data-scenario-filter] option:checked')).toHaveText(
    'Copy of Onboarding',
  )
  // The clicked step's entry stays expanded: the most recent one carrying it.
  await expect(entries.first().locator('input[type="checkbox"]').first()).toBeChecked()
  await expect(entries.first()).toContainText('/v1/pets/42')

  // Clearable in place: the full history comes back, free try included.
  await page.locator('[data-scenario-filter]').selectOption('')
  await expect(entries).toHaveCount(5)

  // And it does not survive being closed: reopening from the header shows everything again.
  await page.keyboard.press('Escape')
  await openHistory(page)
  await expect(page.locator('request-history-list .modal-box .collapse')).toHaveCount(5)
})

const editBar = (page) => page.locator('scenario-edit-bar')

test('editing a step is an explicit mode in the panel, with its chainable variables', async ({
  page,
}) => {
  await chainMock(page)
  await localCopyOfOnboarding(page)

  await step(page, 1).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(page).toHaveURL(/#\/op\/getPet$/)

  // The panel states what it's editing, and what's writable as {{…}} HERE:
  // the extractions from earlier steps, then the environment variables.
  await expect(editBar(page)).toContainText('Step 2/2')
  await expect(editBar(page)).toContainText('Copy of Onboarding')
  // Same reason as in step-by-step: the edited step already belongs to a scenario.
  await expect(tryIt(page).locator('[data-scenario-capture]').first()).toBeHidden()
  await expect(editBar(page).locator('[data-insert-variable="petId"]')).toBeVisible()
  await expect(editBar(page).locator('[data-insert-variable="auth.session"]')).toBeVisible()
  await expect(editBar(page).locator('[data-insert-variable="token"]')).toBeVisible()
  // Nothing for what no step produces and the env does not carry.
  await expect(editBar(page).locator('[data-insert-variable="orderId"]')).toHaveCount(0)

  // Saving from the panel, without going back through the view's menu.
  await panelField(page, 'petId').fill('{{auth.session}}')
  await editBar(page).locator('[data-edit-action="save"]').click()
  await expect(page.locator('.toast')).toContainText('Step updated')

  // Leaving with unsaved input asks for confirmation, and discarding it
  // does bring the step back exactly as it was saved.
  await panelField(page, 'petId').fill('{{nope}}')
  page.once('dialog', (dialog) => dialog.accept())
  await editBar(page).locator('[data-edit-action="close"]').click()
  await expect(page).toHaveURL(/#\/scenario\//)
  await expect(editBar(page)).toBeHidden()
  await expect(step(page, 1).locator('[data-uses-variable="auth.session"]')).toHaveText(
    '{{auth.session}} ⇠ step 1',
  )
  await expect(step(page, 1).locator('[data-uses-variable="nope"]')).toHaveCount(0)
})

test('a guided run takes the panel back from step editing', async ({ page }) => {
  await chainMock(page)
  await localCopyOfOnboarding(page)
  await step(page, 1).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(editBar(page)).toContainText('Step 2/2')

  // Back to the scenario: leaving the edited operation exits editing.
  await page.goBack()
  await expect(editBar(page)).toBeHidden()

  await view(page).getByRole('button', { name: 'Step by step' }).click()
  await expect(stepper(page)).toContainText('Step 1/2')
  await expect(editBar(page)).toBeHidden()
})

const completion = (page) => page.locator('ul[id^="api-var-complete"]')

test('typing {{ completes the variables resolvable at that point of the scenario', async ({
  page,
}) => {
  await chainMock(page)
  await localCopyOfOnboarding(page)
  await step(page, 1).getByRole('button', { name: 'Open in the try-it' }).click()
  await expect(editBar(page)).toContainText('Step 2/2')

  const field = panelField(page, 'petId')
  await field.fill('')
  await field.pressSequentially('{{')
  // Step 1's extraction and environment variables, each one placed.
  await expect(completion(page)).toContainText('{{petId}}')
  await expect(completion(page)).toContainText('step 1')
  await expect(completion(page)).toContainText('{{token}}')

  // Filtering as you type, then Enter inserts the full template.
  await field.pressSequentially('pet')
  await expect(completion(page).getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('{{petId}}')
  await expect(completion(page)).toBeHidden()

  // And the inserted value is indeed the one the send will resolve.
  await editBar(page).locator('[data-edit-action="save"]').click()
  await expect(page.locator('.toast')).toContainText('Step updated')
})

test('the completion does not double the braces already typed, and Escape dismisses it', async ({
  page,
}) => {
  await chainMock(page)
  await gotoApp(page, '#/op/getPet')

  // Outside a scenario, only environment variables are offered.
  const field = panelField(page, 'petId')
  await field.fill('')
  await field.pressSequentially('{{}}')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await field.pressSequentially('tok')
  await expect(completion(page)).toContainText('{{token}}')
  await page.keyboard.press('Enter')
  await expect(field).toHaveValue('{{token}}')

  await field.fill('')
  await field.pressSequentially('{{')
  await expect(completion(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(completion(page)).toBeHidden()
  // Escape did not close the panel that hosts the field.
  await expect(tryIt(page)).toBeVisible()
})

test('the completion works in the request body too, where ids are usually chained', async ({
  page,
}) => {
  const calls = await chainMock(page)
  await gotoApp(page, '#/op/createPet')
  const body = tryIt(page).locator('textarea')

  await body.fill('{"name": "')
  await body.pressSequentially('{{tok')
  await expect(completion(page)).toContainText('{{token}}')
  await page.keyboard.press('Enter')
  await body.pressSequentially('"}')
  await expect(body).toHaveValue('{"name": "{{token}}"}')

  // The inserted template is indeed resolved at send time, not sent literally.
  await send(page)
  await expectResponded(page)
  expect(JSON.parse(calls[0].body)).toEqual({ name: 'tok-123' })
})

// Rule 13's hard cap, from the only side the user ever sees it. The store's
// refusal is unit-tested (`scenario-store.test.js`); what was untested is
// that the refusal becomes an actionable message instead of a silent no-op —
// a button that does nothing is how a cap looks like a bug.
// Seeded straight into IndexedDB: the count is what the store refuses on, and
// clicking "New scenario" 200 times would test Playwright, not the cap.
test('the scenario cap refuses in a way the user can act on', async ({ page }) => {
  await page.addInitScript((limit) => {
    const seeded = new Promise((resolve, reject) => {
      const open = indexedDB.open('apidoc-scenarios', 1)
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore('scenarios', { keyPath: 'id' })
        store.createIndex('specId', 'specId')
        store.createIndex('createdAt', 'createdAt')
      }
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const tx = open.result.transaction('scenarios', 'readwrite')
        const store = tx.objectStore('scenarios')
        for (let i = 0; i < limit; i++) {
          store.add({
            id: `seed-${i}`,
            name: `Seeded ${i}`,
            steps: [],
            source: 'local',
            specId: 'default',
            createdAt: i,
            updatedAt: i,
          })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
    })
    // Awaited from the test before the click: the store only counts at write
    // time, so the seeding just has to be done by then.
    window.__seeded = seeded
  }, 200)
  await gotoApp(page)
  await page.evaluate(() => window.__seeded)

  await openDrawerIfMobile(page)
  await nav(page).getByRole('button', { name: '+ New scenario' }).click()
  await expect(page.locator('.toast')).toContainText('Limit of 200 scenarios reached')
  // Refused, not half-created: no scenario route was entered.
  expect(new URL(page.url()).hash).not.toMatch(/#\/scenario\//)
})
