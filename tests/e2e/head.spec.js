// The <head> the app maintains per route (docs/seo.md §3): the title follows
// the navigation, the description and the JSON-LD follow with it. The
// derivation itself is unit-tested (tests/head.test.js); what is checked here
// is that the document actually carries the result — including for a docs page,
// whose description only exists once its body has been fetched.
import { expect, test } from '@playwright/test'
import { clickNavOp, gotoApp } from './helpers.js'

const description = (page) => page.locator('head meta[name="description"]')
const robots = (page) => page.locator('head meta[name="robots"]')
// `textContent`, not `innerText`: the script is in <head> and renders nothing.
const jsonLd = async (page) =>
  JSON.parse(await page.locator('head script#apidoc-jsonld').textContent())

test('the title follows the navigation', async ({ page }) => {
  await gotoApp(page)
  // The host page's own <title> is gone: once booted, the app owns it.
  await expect(page).toHaveTitle('E2E Test API')

  await clickNavOp(page, 'listPets')
  await expect(page).toHaveTitle('List all pets — E2E Test API')

  await clickNavOp(page, 'createPet')
  await expect(page).toHaveTitle('Create a pet — E2E Test API')

  await page.goBack()
  await expect(page).toHaveTitle('List all pets — E2E Test API')
})

test('the app-only views are named, the document ones describe themselves', async ({ page }) => {
  await gotoApp(page, '#/audit')
  await expect(page).toHaveTitle('Schema audit — E2E Test API')
  // A tool view claims no schema.org type: it is not indexable content.
  await expect(page.locator('head script#apidoc-jsonld')).toHaveCount(0)

  await gotoApp(page, '#/overview')
  await expect(page).toHaveTitle('API overview — E2E Test API')
  expect(await jsonLd(page)).toMatchObject({ '@type': 'WebSite', name: 'E2E Test API' })
})

test('an endpoint carries its own description and JSON-LD', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')

  await expect(description(page)).toHaveAttribute(
    'content',
    'Returns the pets, optionally filtered by status.',
  )
  expect(await jsonLd(page)).toMatchObject({
    '@type': 'APIReference',
    name: 'List all pets',
    identifier: 'listPets',
    isPartOf: { '@type': 'WebAPI', name: 'E2E Test API' },
  })
})

test('a docs page describes itself once its body has landed', async ({ page }) => {
  await gotoApp(page, '#/page/getting-started')

  await expect(page).toHaveTitle('Getting started — E2E Test API')
  // The frontmatter and the title heading are skipped; the prose underneath is
  // what describes the page.
  await expect(description(page)).toHaveAttribute('content', /^Welcome to the Petstore API guide\./)
  expect(await jsonLd(page)).toMatchObject({
    '@type': 'TechArticle',
    headline: 'Getting started',
  })
})

test('a workflow names itself once its document has landed', async ({ page }) => {
  await gotoApp(page, '#/scenario/onboarding')

  // The declared title, which is also what the nav lists it under — the section
  // name is what the route says only while the document is still in flight.
  await expect(page).toHaveTitle('Onboarding — E2E Test API')
  expect(await jsonLd(page)).toMatchObject({ '@type': 'TechArticle', headline: 'Onboarding' })
})

test('an installation asking not to be indexed says so before it renders', async ({ page }) => {
  // Not `gotoFixture`: that one waits for the nav, and what is asserted here is
  // that the tag is already there while the schema is still in flight — a
  // crawler that gives up before the app has anything to show still reads it.
  await page.goto('/tests/e2e/fixtures/app-noindex.html')
  await expect(robots(page)).toHaveAttribute('content', 'noindex')
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  await expect(robots(page)).toHaveCount(1)

  // And nothing is claimed on an ordinary install: the absence of the tag is
  // the default, not an empty one.
  await gotoApp(page)
  await expect(robots(page)).toHaveCount(0)
})
