import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import {
  clickNavOp,
  expectFeatureUnreachable,
  expectResponded,
  gotoFixture,
  mockApi,
  openDrawerIfMobile,
  openHistory,
  panelField,
  send,
} from './helpers.js'

// `features.scenarios: false`: the feature is not just hidden in the
// nav, it has no entry point left at all — including ones a user
// could reach without the nav (deep-link, received share link).
const PAGE = '/tests/e2e/fixtures/app-no-scenarios.html'

const open = (page, hash = '') => gotoFixture(page, PAGE + hash)

// The capture entry point sits behind a real send: the history card only
// offers it once an entry exists.
async function reachHistoryCard(page) {
  await mockApi(page)
  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('42')
  await send(page)
  await expectResponded(page)
  await openHistory(page)
  const entry = page.locator('request-history-list .modal-box .collapse').first()
  await entry.locator('input[type="checkbox"]').first().check()
}

test('features.scenarios false leaves no entry point at all', async ({ page }) => {
  await expectFeatureUnreachable(page, {
    open,
    nav: ['SCENARIOS'],
    inPage: [
      // The scenario declared in the config is ignored, not just hidden.
      { selector: 'api-nav a[data-scenario-id]' },
      { selector: 'api-nav [data-scenario-import]' },
      { selector: 'api-nav button:has-text("+ New scenario")' },
      { selector: 'main [data-pinned-card]' },
      {
        selector: 'api-try-it-panel [data-scenario-capture]',
        reach: async (p) => {
          await mockApi(p)
          await clickNavOp(p, 'getPet')
        },
      },
      { selector: 'request-history-list [data-scenario-capture]', reach: reachHistoryCard },
    ],
    routes: [
      { hash: '#/scenario/onboarding', text: 'This scenario does not exist.' },
      { hash: '#/scenario-import?d=whatever', text: 'This scenario does not exist.' },
    ],
    search: ['Onboarding'],
    exports: [{ selector: '[data-scenario-export-menu]' }],
    elements: ['api-scenario-view'],
  })
})

// `features.ci: false` (docs/scenario-handoff.md §4): the narrower switch, on
// one surface. What it must NOT touch is the other half of the hand-off — the
// recipes an agent reads are governed by what the config declares, and no key
// hides them (§2).
test('features.ci false removes the panel, and nothing else', async ({ page }) => {
  const view = page.locator('api-scenario-view')
  await gotoFixture(page, '/tests/e2e/fixtures/app-no-ci.html#/scenario/onboarding')
  await expect(view.getByRole('heading', { name: 'Onboarding' })).toBeVisible()
  await expect(view.locator('[data-ci-panel]')).toHaveCount(0)

  // The scenario is still exportable as Arazzo by hand: the switch removes the
  // job, not the format.
  await view.locator('[data-scenario-export-menu] > summary').click()
  await expect(view.getByText('Export as Arazzo 1.1')).toBeVisible()

  // And the map still lists the workflow for the agents that read it.
  await page.goto('/tests/e2e/fixtures/app-no-ci.html')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms.txt' }).click()
  const content = await readFile(await (await downloadPromise).path(), 'utf8')
  expect(content).toContain('## Workflows')
  expect(content).toContain('[Onboarding]')
})

test('the nav and the history card keep everything else', async ({ page }) => {
  await open(page)
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav').getByText('API REFERENCE')).toBeVisible()
  await openDrawerIfMobile(page)
  await expect(page.locator('api-nav').getByText('DOCUMENTATION')).toBeVisible()
  await expect(page.locator('main')).toContainText('E2E Test API')

  await reachHistoryCard(page)
  const entry = page.locator('request-history-list .modal-box .collapse').first()
  await expect(entry.getByRole('button', { name: 'Replay' })).toBeVisible()
})
