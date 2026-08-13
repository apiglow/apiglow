// Schema audit page (docs/audit.md §6/§7). What the suite pins is the product
// decision as much as the rendering: the feature is on by default but reachable
// only from the settings panel, it never links to an operation the reader cannot
// open, and `features.audit: false` removes it entirely — route included.
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { clipboardText, gotoApp, gotoFixture, openSettings } from './helpers.js'

const NO_AUDIT_PAGE = '/tests/e2e/fixtures/app-no-audit.html'
const HIDDEN_OPS_PAGE = '/tests/e2e/fixtures/app-hidden-ops.html'
const CLEAN_PAGE = '/tests/e2e/fixtures/app-clean.html'

const report = (page) => page.locator('audit-report')

test('the settings panel is the only entry point, and it routes to #/audit', async ({ page }) => {
  await gotoApp(page)
  // No nav entry, by design: the audit addresses the API's author, not the
  // reader of its docs.
  await expect(page.locator('api-nav')).not.toContainText('Schema audit')
  await expect(report(page)).toHaveCount(0)

  await openSettings(page)
  await page.locator('settings-panel [data-audit-open]').click()
  await expect(page.locator('settings-panel .modal-box')).not.toBeVisible()
  expect(new URL(page.url()).hash).toBe('#/audit')
  await expect(report(page).locator('h1')).toHaveText('Schema audit')
})

test('the report grades the schema and scores each category', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const header = report(page).locator('[data-audit-summary]')
  await expect(header).toContainText('B')
  await expect(header).toContainText('85 / 100')
  await expect(header).toContainText('12 warning(s)')
  await expect(header).toContainText('31 note(s)')
  // One bar per scored category, including the one with no finding: a 100 % is
  // exactly what the author wants to see.
  await expect(header).toContainText('Correctness')
  await expect(header).toContainText('100 %')
  await expect(header).toContainText('Docs readiness')
  await expect(header).toContainText('79 %')
  // Score bars are not left to color alone.
  await expect(header.locator('progress').first()).toHaveAttribute(
    'aria-label',
    'Correctness: 100 %',
  )

  // A category with no finding gets no section: only its bar above. Here
  // correctness, deprecation and consistency are clean, so two sections remain,
  // in the report's own category order.
  const sections = report(page).locator('section h2')
  await expect(sections).toHaveCount(3)
  await expect(sections.nth(1)).toContainText('Documentation')
  await expect(sections.last()).toContainText('Docs readiness')
})

// A report read out of context — a pasted screenshot, a tab left open — has to
// say which API and which revision it graded, and the file it graded has to be
// one click away, as on the home page.
test('the report names the API it graded and offers its schema', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const identity = report(page).locator('[data-audit-identity]')
  await expect(identity.locator('h2')).toHaveText('E2E Test API')
  await expect(identity).toContainText('Version 1.0.0')
  await expect(identity).toContainText('OpenAPI 3.1.0')
  // The document in figures, same units as the home page's stats plus the
  // schemas. The perimeter is the audit's, not the navigation's: this fixture
  // hides no operation, but the counts span the hidden ones when it does.
  const stats = identity.locator('.stat')
  await expect(stats).toHaveCount(5)
  await expect(stats.filter({ hasText: 'Operations' })).toContainText('6')
  await expect(stats.filter({ hasText: 'Groups' })).toContainText('2')
  await expect(stats.filter({ hasText: 'Webhooks' })).toContainText('2')
  await expect(stats.filter({ hasText: 'Security schemes' })).toContainText('4')
  await expect(stats.filter({ hasText: 'Schemas' })).toBeVisible()
  // This fixture declares neither contact nor license — which is precisely what
  // info-metadata reports below, so the identity card shows nothing there.
  await expect(identity).not.toContainText('Contact')

  const download = page.waitForEvent('download')
  await identity.getByRole('button', { name: 'Download the OpenAPI file' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.json$/)
})

// The summary is the report's index: on a long report, reaching a category
// otherwise means scrolling past every category above it.
test('a summary score bar jumps to the section it scores', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const summary = report(page).locator('[data-audit-summary]')
  // Correctness is clean here: no section to jump to, so no offer to jump.
  await expect(summary.locator('[data-audit-jump="correctness"]')).toHaveCount(0)
  // A bar that jumps sits next to bars that don't, so it says so without being
  // pointed at: link color, underline, and an arrow for where the click goes.
  const jump = summary.locator('[data-audit-jump="readiness"]')
  await expect(jump).toHaveClass(/link-primary/)
  await expect(jump.locator('svg')).toHaveCount(1)
  expect(await jump.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('underline')

  await summary.locator('[data-audit-jump="readiness"]').click()
  const section = report(page).locator('[data-audit-category="readiness"]')
  await expect(section).toBeInViewport()
  // Focus follows the jump, otherwise a keyboard user stays where they were.
  await expect(section.locator('h2')).toBeFocused()
  // A jump is not a navigation: the hash-routed URL is untouched.
  expect(new URL(page.url()).hash).toBe('#/audit')
})

// A grade and five category names mean nothing on their own, and spelling them
// out permanently would bury the findings.
test('the report explains its own grades, severities and categories', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const help = report(page).locator('[data-audit-help]')
  await expect(help).toContainText('How to read this report')
  const body = help.locator('.collapse-content')
  await expect(body).toBeHidden()

  await help.locator('summary').click()
  // The bands come from the engine's own thresholds, not from a second list.
  await expect(body).toContainText('≥ 90')
  await expect(body).toContainText('< 50')
  await expect(body).toContainText('an error weighs three times a note')
  // One line per severity and per category, including the ones with no finding.
  await expect(body).toContainText('Deprecation')
  await expect(body).toContainText('Docs readiness')
})

// One row per rule, not per finding: the same omission repeated across a schema
// is one decision to make, and a report that lists it a thousand times is a
// report nobody scrolls to the end of.
test('findings of the same rule fold into one counted row', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const group = report(page).locator('[data-rule-id="operation-examples"]')
  await expect(group).toHaveCount(1)
  await expect(group).toContainText('Note')
  await expect(group).toContainText('Operation without any example')
  // A chevron says the row opens at all — the native marker is suppressed.
  const chevron = group.locator('summary svg')
  await expect(chevron).toHaveCount(1)
  // The counter says how much is folded — nothing is dropped silently.
  const count = Number(await group.locator('.badge-ghost').innerText())
  expect(count).toBeGreaterThan(1)
  await expect(group).not.toContainText('carries no example')

  await group.locator('summary').click()
  // Expanded: the rationale once, then every occurrence with its own message.
  await expect(group).toContainText('generated from the schema')
  await expect(group.getByText('carries no example')).toHaveCount(count)
  // The chevron turns with the state rather than being swapped by a listener.
  // Tailwind 4 rotates through the standalone `rotate` property, not `transform`,
  // and the row transitions into it — hence the poll rather than a single read.
  await expect.poll(() => chevron.evaluate((el) => getComputedStyle(el).rotate)).toBe('90deg')
})

// The summary card counts the whole report; a section that a reader jumped to
// has to answer the same question about itself without scrolling back up.
test('each category section carries its own counts', async ({ page }) => {
  await gotoApp(page, '#/audit')
  const heading = report(page).locator('[data-audit-category="readiness"] h2')
  await expect(heading).toContainText('Docs readiness')
  await expect(heading).toContainText('79 %')
  await expect(heading).toContainText('2 warning(s)')
  await expect(heading).toContainText('7 note(s)')
  // A severity with nothing in it is left out: "0 error(s)" reads as a finding.
  await expect(heading).not.toContainText('error(s)')
})

test('a finding names its rule, its rationale and where it applies', async ({ page }) => {
  await gotoApp(page, '#/audit')
  // A rule that fired once has nothing to fold: its own message is shown, and
  // the rationale stays one click away as on every other row.
  const finding = report(page).locator('[data-rule-id="error-responses-documented"]')
  await expect(finding).toContainText('Warning')
  await expect(finding).toContainText('documents no error response')
  const why = finding.locator('details')
  await expect(why.locator('p')).toBeHidden()
  await why.locator('summary').click()
  await expect(why.locator('p')).toContainText('validation, conflict and permission errors')

  // A finding outside any operation is located by its pointer into the document.
  const scheme = report(page).locator('[data-rule-id="security-scheme-described"]')
  await scheme.locator('summary').click()
  await expect(scheme).toContainText('components.securitySchemes.')
  await expect(scheme).toContainText('/components/securitySchemes/')
})

test('a finding on a routable operation deep-links to it', async ({ page }) => {
  await gotoApp(page, '#/audit')
  await report(page).locator('[data-rule-id="operation-examples"] summary').click()
  const link = report(page).locator('a[data-audit-link="getAccount"]').first()
  await expect(link).toHaveText('GET /account')
  await link.click()
  await expect(page.locator('api-endpoint-doc h1')).toHaveText('Account details')
  expect(new URL(page.url()).hash).toBe('#/op/getAccount')
})

// The audit sees the full schema on purpose, hidden operations included — but a
// link to one would land on a not-found page.
test('a finding on a hidden operation gets a badge, not a dead link', async ({ page }) => {
  await gotoFixture(page, `${HIDDEN_OPS_PAGE}#/audit`)
  // The run is sliced over frames: `all()` resolves at once, so the rows have
  // to be there before it is asked for them.
  await report(page).locator('li summary').first().waitFor()
  for (const summary of await report(page).locator('li summary').all()) await summary.click()
  const hidden = report(page)
    .locator('[data-audit-finding]')
    .filter({ hasText: 'GET /account' })
    .first()
  await expect(hidden).toContainText('Hidden operation')
  await expect(hidden.locator('a')).toHaveCount(0)
  await expect(report(page).locator('a[data-audit-link="getAccount"]')).toHaveCount(0)
})

// Hiding runs the gap the other way from an overlay: the file handed out
// declares MORE than the page shows. Every surface built on that file says so,
// except the audit — which spans hidden operations itself, so there the grade
// and the download cover the same perimeter and there is nothing to warn about.
test('the hand-offs say the file declares the operations this page hides', async ({ page }) => {
  await gotoFixture(page, HIDDEN_OPS_PAGE)
  await expect(page.locator('main')).toContainText(
    'This file also declares 1 operation(s) this documentation does not show',
  )

  const card = page.locator('details', { hasText: 'Use this API from an AI agent' })
  await card.locator('summary').click()
  await expect(card.getByText('will expose them as tools')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download llms.txt' }).click()
  const content = await readFile(await (await downloadPromise).path(), 'utf8')
  expect(content).toContain('it declares 1 operation(s) this documentation does not list')

  await page.goto(`${HIDDEN_OPS_PAGE}#/audit`)
  await expect(report(page)).not.toContainText('this documentation does not show')
})

// The perfect state is a designed screen, not an empty list (docs/audit.md §6),
// and this fixture is also what guarantees it stays reachable: a rule no
// document can ever pass would fail here first.
test('a schema with nothing to report gets the empty state, not an empty page', async ({
  page,
}) => {
  await gotoFixture(page, `${CLEAN_PAGE}#/audit`)
  const header = report(page).locator('[data-audit-summary]')
  await expect(header).toContainText('A')
  await expect(header).toContainText('100 / 100')
  await expect(header).toContainText('No finding')
  // A document that passes info-metadata is one whose contact and license the
  // identity card can show.
  const identity = report(page).locator('[data-audit-identity]')
  await expect(identity.getByRole('link', { name: 'API team' })).toHaveAttribute(
    'href',
    'mailto:api@e2e.test',
  )
  await expect(identity).toContainText('MIT')
  // No category section: the identity card's title is the only h2 left.
  await expect(report(page).locator('section h2')).toHaveCount(1)
  const empty = report(page).locator('.alert')
  await expect(empty).toContainText('No findings.')
  await expect(empty).toContainText('Every applicable check passes')
})

test('the report is copied as Markdown, findings and rationales included', async ({ page }) => {
  await gotoApp(page, '#/audit')
  await report(page).locator('[data-audit-copy]').click()
  const markdown = await clipboardText(page)
  expect(markdown).toContain('# Schema audit — E2E Test API')
  expect(markdown).toContain('**Grade B** — 85 / 100 · Version 1.0.0 · OpenAPI 3.1.0')
  // Stamped to the second: a report pasted into a ticket has to say when it was
  // taken, or a reader cannot tell whether it still describes the schema.
  expect(markdown).toMatch(/Generated on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/)
  // The whole perimeter travels with it, same units as the page's stats.
  expect(markdown).toContain('Operations: 6 · Groups: 2 · Webhooks: 2 · Security schemes: 4')
  // Counts per category, not only for the report as a whole.
  expect(markdown).toContain('- Docs readiness: 79 % — 2 warning(s) · 7 note(s)')
  expect(markdown).toContain('## Docs readiness — 79 % · 2 warning(s) · 7 note(s)')
  // A finding travels with where it applies and why it matters.
  expect(markdown).toContain('**Note** — This operation carries no example, anywhere.')
  expect(markdown).toContain('*Why it matters*:')
  // The button confirms, and the outcome reaches the announcement channel.
  await expect(report(page).locator('[data-audit-copy]')).toHaveText('Copied!')
  await expect(page.locator('[data-live-region]')).toHaveText('Report copied to the clipboard.')
})

test('features.audit false removes the block and the route alike', async ({ page }) => {
  await gotoFixture(page, NO_AUDIT_PAGE)
  await openSettings(page)
  await expect(page.locator('settings-panel [data-audit-open]')).toHaveCount(0)
  await expect(page.locator('settings-panel .modal-box')).not.toContainText('Schema audit')

  await gotoFixture(page, `${NO_AUDIT_PAGE}#/audit`)
  await expect(page.locator('main')).toContainText('audit is disabled')
  await expect(report(page)).toHaveCount(0)
})
