// Rule 5 has no exceptions: every scrap of HTML coming from outside the app
// goes through DOMPurify. Until this file existed, exactly one hostile payload
// was ever asserted (`bootstrap.spec.js`, on the schema's own descriptions) —
// the other doors were tested with benign text, which proves rendering, not
// sanitizing.
//
// Every test here replays the same payload down a different path and demands
// the same three things: the script never ran, no live attribute survived, and
// the legitimate Markdown around it still rendered. That last one matters:
// a path that escapes everything into plain text would pass the first two and
// have quietly broken the feature.
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { clickNavOp, gotoApp, gotoFixture } from './helpers.js'

const PAYLOAD = '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> **legit**'

const schemaFixture = () =>
  JSON.parse(readFileSync(new URL('./fixtures/e2e-api.json', import.meta.url), 'utf8'))

// Serves a mutated copy of the e2e schema in place of the real one.
async function serveSchema(page, mutate) {
  const schema = schemaFixture()
  mutate(schema)
  await page.route('**/tests/e2e/fixtures/e2e-api.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(schema) }),
  )
}

// The three assertions every path owes. `scope` is where the payload landed.
async function expectInert(page, scope) {
  await expect(scope.locator('strong', { hasText: 'legit' }).first()).toBeVisible()
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  expect(await page.locator('[onerror]').count()).toBe(0)
  expect(await page.locator('main script, [data-scenario-view] script').count()).toBe(0)
}

test('a remote Markdown page is sanitized', async ({ page }) => {
  await page.route('**/fixtures/getting-started.md', (r) =>
    r.fulfill({ status: 200, contentType: 'text/markdown', body: `# Guide\n\n${PAYLOAD}\n` }),
  )
  await gotoApp(page, '#/page/getting-started')
  // The anchor decoration appends a ¶ to every heading.
  await expect(page.locator('main h1')).toContainText('Guide')
  await expectInert(page, page.locator('main'))
})

test('an imported scenario description and step note are sanitized', async ({ page }) => {
  await page.route('**/tests/e2e/fixtures/e2e-scenario.json', async (r) => {
    const doc = JSON.parse(
      readFileSync(new URL('./fixtures/e2e-scenario.json', import.meta.url), 'utf8'),
    )
    doc.scenario.description = PAYLOAD
    doc.scenario.steps[0].note = PAYLOAD
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(doc) })
  })
  await gotoApp(page, '#/scenario/onboarding')
  const view = page.locator('api-scenario-view')
  await expect(view.getByRole('heading', { name: 'Onboarding' })).toBeVisible()
  // Two payloads, two rendering paths (description block and step note): the
  // `strong` count is what proves both were rendered rather than one of them
  // stripped wholesale.
  await expect(view.locator('strong', { hasText: 'legit' })).toHaveCount(2)
  await expectInert(page, view)
})

// Example values are the one external content NOT rendered as Markdown: the
// value goes in as a text node and highlight.js escapes what it re-reads, so
// this path is safe twice over and survives even a neutered `sanitize()`.
// What this test is here to notice is the day the value stops being a text
// node — the cheap refactor that would turn a safe path into a live one.
test('a schema example value is printed, never executed', async ({ page }) => {
  await serveSchema(page, (schema) => {
    const content = schema.paths['/pets'].get.responses['200'].content['application/json']
    content.examples = { hostile: { summary: 'Hostile', value: [{ name: PAYLOAD }] } }
  })
  await gotoApp(page, '#/op/listPets')
  await expect(page.locator('main h1')).toHaveText('List all pets')
  await expect(page.locator('main pre')).toContainText('onerror')
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  expect(await page.locator('main [onerror], main img, main script').count()).toBe(0)
})

// The deepest description path: a property nested inside a body schema, which
// `schema-view.js` renders through its own `markdownInline` call — a different
// call site from the operation description `bootstrap.spec.js` covers.
test('a nested schema property description is sanitized', async ({ page }) => {
  await serveSchema(page, (schema) => {
    schema.components.schemas.Pet.properties.name.description = PAYLOAD
  })
  await gotoApp(page, '#/op/createPet')
  await expect(page.locator('main h1')).toBeVisible()
  await expectInert(page, page.locator('main'))
})

// The audit page reads the raw document, not the normalized model, and shows
// schema-derived strings back to the user. It renders them as text nodes by
// design — this asserts that stays true, because the day one of them becomes
// Markdown, the payload arrives with it.
test('the audit page shows schema-derived text without ever building HTML from it', async ({
  page,
}) => {
  await serveSchema(page, (schema) => {
    schema.info.description = PAYLOAD
    schema.paths['/pets'].get.summary = PAYLOAD
  })
  await gotoApp(page, '#/audit')
  await expect(page.locator('audit-report h1')).toBeVisible()
  expect(await page.evaluate(() => window.__xss)).toBeUndefined()
  expect(await page.locator('audit-report [onerror], audit-report script').count()).toBe(0)
})

// The request body's own description: a distinct `markdownInline` call site
// from both the operation description and the schema property one.
test('a request body description is sanitized', async ({ page }) => {
  await serveSchema(page, (schema) => {
    schema.paths['/pets'].post.requestBody.description = PAYLOAD
  })
  await gotoFixture(page, '/tests/e2e/fixtures/app.html')
  await clickNavOp(page, 'createPet')
  await expectInert(page, page.locator('main'))
})
