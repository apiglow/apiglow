import { expect, test } from '@playwright/test'
import {
  clipboardText,
  gotoFixture,
  openAppMenu,
  openDrawerIfMobile,
  selectEnv,
} from './helpers.js'

// docs/docs-pages.md — the prose side of the documentation, against the packed
// bundle. The fixture host page declares every entry kind at once, which is
// also the point: the three kinds share one ordered array.
const DOCS_PAGE = '/tests/e2e/fixtures/app-docs.html'
const MANIFEST_PAGE = '/tests/e2e/fixtures/app-docs-manifest.html'
const MISSING_MANIFEST_PAGE = '/tests/e2e/fixtures/app-docs-missing.html'
const INLINE_PAGE = '/tests/e2e/fixtures/app-docs-inline.html'

test.describe('docs nav (§2.1)', () => {
  test('renders pages, groups and external links in declaration order', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    // Documentation section first, API reference below (two-zone layout). The
    // first li is the section title, the entries follow in config order.
    const sections = page.locator('api-nav li.menu-title')
    await expect(sections.first()).toHaveText('Documentation')
    await expect(sections.nth(1)).toHaveText('API Reference')
    const items = page.locator('api-nav > div > ul > li')
    await expect(items.nth(1)).toContainText('Introduction')
    await expect(items.nth(2)).toContainText('Guides')
    await expect(items.nth(3)).toContainText('Closed by default')
    await expect(items.nth(4)).toContainText('Localized guide')
    await expect(items.nth(5)).toContainText('GitHub')
  })

  test('a group holds its own pages and links, one level deep', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const group = page.locator('api-nav details[data-docs-group="guides"]')
    await expect(group.locator('a[data-page-slug="pagination"]')).toBeVisible()
    await expect(group.locator('a[data-page-slug="errors"]')).toBeVisible()
    await expect(group.locator('a[href="https://status.e2e.test"]')).toBeVisible()
  })

  test('collapsed: true starts closed and opens on click, keyboard included', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const closed = page.locator('api-nav details[data-docs-group="closed"]')
    await expect(closed).not.toHaveAttribute('open', /.*/)
    await expect(closed.locator('a[data-page-slug="hidden-guide"]')).toBeHidden()
    // <summary> is focusable and toggles on Enter — the same disclosure
    // primitive as the reference tag sections.
    await closed.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(closed.locator('a[data-page-slug="hidden-guide"]')).toBeVisible()
  })

  test('the collapse-all button closes docs groups too', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const guides = page.locator('api-nav details[data-docs-group="guides"]')
    await expect(guides.locator('a[data-page-slug="pagination"]')).toBeVisible()
    await page.locator('api-nav [data-collapse-groups]').click()
    await expect(guides.locator('a[data-page-slug="pagination"]')).toBeHidden()
  })

  test('an external link opens in a new tab and says so to assistive tech', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const link = page.locator('api-nav a[href="https://github.e2e.test/acme"]')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link.locator('svg')).toHaveCount(1)
    await expect(link).toHaveAccessibleName(/GitHub.*opens in a new tab/)
  })

  test('a page opens on its route and highlights its nav entry', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    await page
      .locator('api-nav details[data-docs-group="guides"] a[data-page-slug="errors"]')
      .click()
    await expect(page.locator('md-page h1')).toContainText('Errors')
    await expect(page).toHaveURL(/#\/page\/errors$/)
    await expect(page.locator('api-nav a[data-page-slug="errors"]')).toHaveClass(/menu-active/)
  })

  // §2.7: `nav: 'bottom'` moves a top-level entry below the whole reference,
  // where the divider alone separates it — the zone deliberately has no
  // heading of its own.
  test('nav: bottom closes the nav below the reference', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const items = page.locator('api-nav > div > ul > li')
    // The two zones bracket everything else: the top one still ends on GitHub
    // above the reference, the bottom one closes the list after the webhooks.
    await expect(items.nth(5)).toContainText('GitHub')
    const count = await items.count()
    await expect(items.nth(count - 2)).toContainText('Support')
    await expect(items.nth(count - 1)).toContainText('Legal')
    // No second "Documentation" heading: Documentation, API Reference,
    // Webhooks — the trailing zone is titleless by design.
    await expect(page.locator('api-nav li.menu-title')).toHaveCount(3)
    // Groups and external links travel whole, and the group keeps its own
    // collapse behaviour down there.
    const legal = page.locator('api-nav details[data-docs-group="legal"]')
    await expect(legal.locator('a[data-page-slug="terms"]')).toBeVisible()
    await expect(legal.locator('a[href="https://trust.e2e.test"]')).toBeVisible()
  })

  test('a deep link into a collapsed group opens that group', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/hidden-guide`)
    await expect(page.locator('api-nav details[data-docs-group="closed"]')).toHaveAttribute(
      'open',
      /.*/,
    )
    await expect(page.locator('api-nav a[data-page-slug="hidden-guide"]')).toHaveClass(
      /menu-active/,
    )
  })
})

test.describe('home takeover (§2.4)', () => {
  test('the claiming page renders at #/, not the welcome view', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await expect(page.locator('md-page h1')).toContainText('Introduction')
    await expect(page.locator('main .stat')).toHaveCount(0)
    await expect(page.locator('api-nav a[data-page-slug="intro"]')).toHaveClass(/menu-active/)
  })

  test('its nav entry points at #/ — one landing URL, not two', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await expect(page.locator('api-nav a[data-page-slug="intro"]')).toHaveAttribute('href', '#/')
    // The slug route still resolves: a deep link written before the takeover
    // is not a dead link.
    await page.goto(`${DOCS_PAGE}#/page/intro`)
    await expect(page.locator('md-page h1')).toContainText('Introduction')
  })

  test('#/overview shows the welcome view and gets its own entry', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await openDrawerIfMobile(page)
    const entry = page.locator('api-nav a[data-overview]')
    await expect(entry).toHaveText('API overview')
    // Without a glyph the row reads as a second section title and the reader
    // slides past it — it is the one reference entry with no count or method
    // badge to anchor it.
    await expect(entry.locator('svg')).toHaveCount(1)
    await entry.click()
    await expect(page).toHaveURL(/#\/overview$/)
    await expect(page.locator('main .stat').first()).toBeVisible()
    await expect(entry).toHaveClass(/menu-active/)
    await expect(page.locator('api-nav a[data-page-slug="intro"]')).not.toHaveClass(/menu-active/)
  })

  test('without a takeover #/ stays the welcome view and no entry appears', async ({ page }) => {
    await gotoFixture(page, MANIFEST_PAGE)
    await expect(page.locator('main .stat').first()).toBeVisible()
    await expect(page.locator('api-nav a[data-overview]')).toHaveCount(0)
    // The route exists all the same, showing the very same view.
    await page.goto(`${MANIFEST_PAGE}#/overview`)
    await expect(page.locator('main .stat').first()).toBeVisible()
  })
})

test.describe('i18n entries (§2.3)', () => {
  test('switching the UI language re-resolves the label and the file', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/guide`)
    await expect(page.locator('api-nav a[data-page-slug="guide"]')).toHaveText('Localized guide')
    await expect(page.locator('md-page h1')).toContainText('Localized guide')

    await openAppMenu(page)
    await page.locator('lang-switcher [data-lang-choice="fr"]').click()
    await expect(page.locator('api-nav a[data-page-slug="guide"]')).toHaveText('Guide localisé')
    await expect(page.locator('md-page h1')).toContainText('Guide localisé')
  })
})

test.describe('markdown enrichments (§4.1–4.3)', () => {
  test('a leading YAML block is stripped, not rendered', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    await expect(page.locator('md-page')).not.toContainText('draft: true')
    await expect(page.locator('md-page h1')).toContainText('Pagination')
  })

  test('GFM alerts become daisyUI callouts, one style per type', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/errors`)
    const callouts = page.locator('md-page .alert')
    await expect(callouts).toHaveCount(3)
    await expect(callouts.nth(0)).toHaveClass(/alert-success/)
    await expect(callouts.nth(0)).toContainText('Tip')
    await expect(callouts.nth(1)).toHaveClass(/alert-info/)
    await expect(callouts.nth(1)).toContainText('Important')
    await expect(callouts.nth(2)).toHaveClass(/alert-error/)
    await expect(callouts.nth(2)).toContainText('Caution')
    // Static prose, not a live region: no role that would interrupt a reader.
    await expect(page.locator('md-page .alert[role="alert"]')).toHaveCount(0)
    // The marker itself is consumed, the sentence after it kept.
    await expect(callouts.nth(0)).not.toContainText('[!TIP]')
    await expect(callouts.nth(0)).toContainText('Log the')
    // The left-accent treatment rides every callout, whatever its type.
    await expect(callouts.nth(0)).toHaveClass(/md-callout/)
  })

  test('a standalone fence gets a header: language token and copy button', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/changelog`)
    const header = page.locator('md-page .md-code-header')
    await expect(header).toHaveCount(1)
    await expect(header.locator('.md-code-lang')).toHaveText('bash')
    await expect(header.getByRole('button', { name: 'Copy code' })).toBeVisible()
    // A tab group already has a bar — its panels get no second one.
    await page.goto(`${DOCS_PAGE}#/page/pagination`)
    await expect(page.locator('md-page [data-code-tabs]')).toHaveCount(2)
    await expect(page.locator('md-page .md-code-header')).toHaveCount(0)
  })

  test('adjacent fences become one tab group, separated ones stay apart', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const groups = page.locator('md-page [data-code-tabs]')
    await expect(groups).toHaveCount(2)
    const first = groups.first()
    await expect(first.locator('[role="tab"]')).toHaveCount(3)
    await expect(first.locator('[role="tab"]').first()).toHaveText('cURL')
    // One panel visible at a time.
    await expect(first.locator('pre:visible')).toHaveCount(1)
    await expect(first.locator('pre:visible')).toContainText('curl https://')
  })

  test('the tablist is one tab stop, arrows moving inside it', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const group = page.locator('md-page [data-code-tabs]').first()
    await group.locator('[role="tab"]').first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(group.locator('pre:visible')).toContainText('await fetch(')
    await page.keyboard.press('End')
    await expect(group.locator('pre:visible')).toContainText('requests.get(')
  })

  test('the chosen language syncs across groups, pages and reloads', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const groups = page.locator('md-page [data-code-tabs]')
    await groups.first().locator('[role="tab"]', { hasText: 'Python' }).click()
    // Second group on the same page follows immediately.
    await expect(groups.nth(1).locator('pre:visible')).toContainText('requests.get(')

    // Another page. Its only group has no Python tab, so it stays on its
    // first one: showing the one snippet there is beats showing none.
    await openDrawerIfMobile(page)
    await page.locator('api-nav a[data-page-slug="errors"]').click()
    await expect(page.locator('md-page h1')).toContainText('Errors')
    const errorsGroup = page.locator('md-page [data-code-tabs]').first()
    await expect(errorsGroup.locator('pre:visible')).toContainText('curl --retry')

    await page.reload()
    await expect(page.locator('md-page h1')).toContainText('Errors')
    await expect(errorsGroup.locator('pre:visible')).toContainText('curl --retry')
    await openDrawerIfMobile(page)
    await page.locator('api-nav a[data-page-slug="pagination"]').click()
    await expect(page.locator('md-page h1')).toContainText('Pagination')
    await expect(groups.first().locator('pre:visible')).toContainText('requests.get(')
  })
})

test.describe('API references in prose (§4.4)', () => {
  test('an apidoc: link carries a method badge and navigates', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    const link = page.locator('md-page a.apidoc-op-link', { hasText: 'create a pet' })
    await expect(link.locator('.badge')).toHaveText('post')
    await link.click()
    await expect(page).toHaveURL(/#\/op\/createPet$/)
    await expect(page.locator('api-endpoint-doc h1')).toContainText('Create a pet')
  })

  test('the "METHOD /path" form resolves too', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await page.locator('md-page a.apidoc-op-link', { hasText: 'list them' }).click()
    await expect(page).toHaveURL(/#\/op\/listPets$/)
  })

  test('an unresolvable reference is shown broken, not shipped as a dead link', async ({
    page,
  }) => {
    await gotoFixture(page, DOCS_PAGE)
    const broken = page.locator('md-page .apidoc-op-broken')
    await expect(broken).toHaveText('visibly broken')
    await expect(broken).toHaveAttribute('title', /No operation matches "ghostOperation"/)
    await expect(broken).toHaveJSProperty('tagName', 'SPAN')
  })

  test('an operation card block links each reference and flags the bad one', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    const cards = page.locator('md-page .apidoc-op-cards > *')
    await expect(cards).toHaveCount(4)
    await expect(cards.nth(0)).toHaveAttribute('aria-label', 'GET /pets — List all pets')
    await expect(cards.nth(3)).toHaveClass(/apidoc-op-card-broken/)
    await expect(cards.nth(3)).toContainText('No operation matches')
    await cards.nth(1).click()
    await expect(page).toHaveURL(/#\/op\/createPet$/)
  })
})

test.describe('page chrome (§5)', () => {
  test('the ToC lists h2/h3 and jumps to the section', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const toc = page.locator('md-page nav[aria-label="On this page"]:visible')
    await expect(toc).toHaveCount(1)
    const links = toc.locator('a[data-toc-id]')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveText('Cursors')
    await links.nth(1).click()
    await expect(page).toHaveURL(/#\/page\/pagination\/page-size$/)
  })

  test('the ToC highlights the section being read', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const links = page.locator('md-page nav[aria-label="On this page"]:visible a[data-toc-id]')
    // A ToC click names the section outright — even one too close to the
    // bottom of the page for scrolling to ever bring it to the top.
    await links.nth(1).click()
    await expect(links.nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(links.nth(1)).toHaveClass(/md-toc-active/)
    await links.nth(0).click()
    await expect(links.nth(0)).toHaveAttribute('aria-current', 'true')
    await expect(links.nth(1)).not.toHaveAttribute('aria-current', /.*/)
  })

  test('below xl the ToC folds into a dropdown above the content', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const toc = page.locator('md-page nav[aria-label="On this page"]:visible')
    await expect(toc.locator('summary')).toHaveText('On this page')
    await expect(toc.locator('a[data-toc-id]').first()).toBeHidden()
    await toc.locator('summary').click()
    await expect(toc.locator('a[data-toc-id]').first()).toBeVisible()
  })

  test('prev/next follow the flattened nav order, groups included', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    const pager = page.locator('md-page nav[aria-label="Previous and next page"]')
    // intro → pagination → errors → hidden-guide → guide: a group flattens,
    // the external links in it are skipped.
    await expect(pager.locator('[data-pager-slug="intro"]')).toHaveText(/Introduction/)
    await expect(pager.locator('[data-pager-slug="errors"]')).toHaveText(/Errors/)
    await pager.locator('[data-pager-slug="errors"]').click()
    await expect(page.locator('md-page h1')).toContainText('Errors')
  })

  // One chain across both zones (§2.7): the pager reads the docs as one
  // document, in the order the reader sees them — so the last top-zone page
  // hands over to the first page below the reference.
  test('the chain crosses into the trailing zone', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/guide`)
    const pager = page.locator('md-page nav[aria-label="Previous and next page"]')
    await expect(pager.locator('[data-pager-slug="variables"]')).toHaveCount(1)
    await pager.locator('[data-pager-slug="support"]').click()
    await expect(page.locator('md-page h1')).toContainText('Support')
  })

  test('the last page has no next slot, the first no previous', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/terms`)
    const pager = page.locator('md-page nav[aria-label="Previous and next page"]')
    await expect(pager.locator('a')).toHaveCount(1)
    await expect(pager.locator('a')).toHaveAttribute('data-pager-slug', 'support')
  })

  test('a takeover home gets the same chrome as any other page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, DOCS_PAGE)
    await expect(page.locator('md-page nav[aria-label="On this page"]:visible')).toHaveCount(1)
    await expect(
      page.locator('md-page nav[aria-label="Previous and next page"] [data-pager-slug]'),
    ).toHaveCount(1)
  })
})

// The same hand-off menu as the endpoint doc (docs/architecture.md §5.14.1),
// over a prose page. The endpoint side is covered in history-export.spec.js —
// here the subject is what a *page* hands over.
test.describe('copy page (§5)', () => {
  const openCopyMenu = async (page) => {
    await page.locator('md-page details.dropdown > summary', { hasText: 'Copy page' }).click()
  }

  test('copies the page the reader is looking at, frontmatter dropped', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'Copy as Markdown' }).click()
    const md = await clipboardText(page)
    expect(md).toContain('# Pagination')
    expect(md).toContain('> [!NOTE]')
    // Authoring metadata the render already drops.
    expect(md).not.toContain('draft: true')
  })

  test('a variable in prose travels as its template, never as its value', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/variables`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'Copy as Markdown' }).click()
    const md = await clipboardText(page)
    expect(md).toContain('{{tenant}}')
    expect(md).not.toContain('e2e-secret-value')
  })

  test('view as Markdown shows the source and saves it under the page slug', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'View as Markdown' }).click()
    const dialog = page.locator('dialog[data-markdown-source]')
    await expect(dialog).toBeVisible()
    // Source, not rendered Markdown: the heading marks are part of what is shown.
    await expect(dialog.locator('pre')).toContainText('# Pagination')
    const downloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download the file' }).click()
    expect((await downloadPromise).suggestedFilename()).toBe('pagination.md')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('an .html page hands over its text, a .txt page its lines', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/notes`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'Copy as Markdown' }).click()
    const html = await clipboardText(page)
    expect(html).toContain('authored as HTML')
    expect(html).not.toContain('<p>')

    await gotoFixture(page, `${DOCS_PAGE}#/page/changes`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'Copy as Markdown' }).click()
    const txt = await clipboardText(page)
    // No heading of its own: the export names itself with the nav title.
    expect(txt).toContain('# Raw changelog')
    expect(txt).toContain('2026-07-15  First public release.')
  })

  test('the agent items register the API under the selected environment', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
    await openCopyMenu(page)
    await page.getByRole('button', { name: 'Copy MCP command' }).click()
    expect(await clipboardText(page)).toMatch(/^claude mcp add e2e-test-api /)
    // The page does not re-render on an environment change, so the menu has to
    // be rebuilt: an install link frozen on the first render would register a
    // base URL the reader has left behind.
    await page.keyboard.press('Escape')
    await selectEnv(page, 'other')
    await openCopyMenu(page)
    const cursor = await page.getByRole('link', { name: 'Add to Cursor' }).getAttribute('href')
    const config = new URL(cursor).searchParams.get('config')
    expect(JSON.parse(Buffer.from(config, 'base64').toString()).env.API_BASE_URL).toBe(
      'https://other.e2e.test/v1',
    )
  })
})

test.describe('formats (§4.1)', () => {
  test('an .html page renders sanitized, with anchors and chrome', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, `${DOCS_PAGE}#/page/notes`)
    await expect(page.locator('md-page h1')).toContainText('Reference notes')
    // Same DOMPurify profile as everything else external (rule 5).
    await expect(page.locator('md-page script')).toHaveCount(0)
    await expect(page.locator('md-page img[onerror]')).toHaveCount(0)
    expect(await page.evaluate(() => window.__docsHtmlXss)).toBeUndefined()
    // Heading anchors and the ToC apply; markdown-only features do not.
    await expect(page.locator('md-page h2#sanitization')).toHaveCount(1)
    await expect(page.locator('md-page nav[aria-label="On this page"]:visible')).toHaveCount(1)
    await expect(page.locator('md-page .alert')).toHaveCount(0)
    await expect(page.locator('md-page blockquote')).toContainText('[!WARNING]')
    await expect(page.locator('md-page [data-code-tabs]')).toHaveCount(0)
    await expect(
      page.locator('md-page nav[aria-label="Previous and next page"] [data-pager-slug]'),
    ).toHaveCount(2)
  })

  test('a .txt page is escaped text in a <pre>, with no ToC', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, `${DOCS_PAGE}#/page/changes`)
    const pre = page.locator('md-page pre')
    await expect(pre).toHaveCount(1)
    await expect(pre).toContainText('<b>Not</b> HTML')
    await expect(page.locator('md-page b')).toHaveCount(0)
    await expect(page.locator('md-page nav[aria-label="On this page"]')).toHaveCount(0)
    // Prev/next still applies: it comes from the nav, not from the file.
    await expect(
      page.locator('md-page nav[aria-label="Previous and next page"] [data-pager-slug="notes"]'),
    ).toHaveCount(1)
  })
})

test.describe('changelog kind (§4.5)', () => {
  test('a kind: changelog page renders its releases as a timeline', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/changelog`)
    const content = page.locator('md-page .md-content.md-changelog')
    await expect(content).toHaveCount(1)
    // The structure the treatment styles: one h2 per release, prose and code
    // riding along — the snapshot is the contract of the convention.
    await expect(content).toMatchAriaSnapshot(`
      - heading "Changelog" [level=1]
      - heading "1.1.0 — 2026-06-01" [level=2]
      - button "Copy code"
      - heading "1.0.1 — 2026-05-10" [level=2]
      - heading "1.0.0 — 2026-05-01" [level=2]
    `)
    // The gutter: a continuous line on the container, a dot per release.
    const line = await content.evaluate((el) => getComputedStyle(el, '::before').width)
    expect(line).toBe('1px')
    const dot = await content
      .locator('h2')
      .first()
      .evaluate((el) => getComputedStyle(el, '::before').width)
    expect(dot).toBe('11px')
  })

  test('a page without the kind gets none of it', async ({ page }) => {
    await gotoFixture(page, `${DOCS_PAGE}#/page/errors`)
    await expect(page.locator('md-page .md-content')).toHaveCount(1)
    await expect(page.locator('md-page .md-changelog')).toHaveCount(0)
  })
})

test.describe('feedback row (§5)', () => {
  test('posts the verdict for the open page and thanks once', async ({ page }) => {
    const posts = []
    await page.route('**/feedback', async (route) => {
      posts.push(JSON.parse(route.request().postData()))
      await route.fulfill({ status: 204, body: '' })
    })
    await gotoFixture(page, `${DOCS_PAGE}#/page/errors`)
    const row = page.locator('md-page [data-feedback]')
    await expect(row).toContainText('Was this page helpful?')
    await row.locator('[data-feedback-verdict="up"]').click()
    await expect(row).toContainText('Thanks for the feedback!')
    // One verdict per page view: nothing left to click.
    await expect(row.locator('button')).toHaveCount(0)
    expect(posts).toEqual([{ page: 'errors', verdict: 'up' }])
  })

  test('a failed post says so and leaves the buttons armed', async ({ page }) => {
    await page.route('**/feedback', (route) => route.fulfill({ status: 500, body: '' }))
    await gotoFixture(page, `${DOCS_PAGE}#/page/errors`)
    const row = page.locator('md-page [data-feedback]')
    await row.locator('[data-feedback-verdict="down"]').click()
    await expect(row).toContainText('Could not send your feedback')
    await expect(row.locator('[data-feedback-verdict="down"]')).toBeEnabled()
  })

  test('absent config, absent widget', async ({ page }) => {
    await gotoFixture(page, `${INLINE_PAGE}#/page/guide`)
    await expect(page.locator('md-page h1')).toContainText('Carried guide')
    await expect(page.locator('md-page [data-feedback]')).toHaveCount(0)
  })
})

test.describe('full-text search (§6)', () => {
  test('a body-text query deep-links to the right section anchor', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await page.keyboard.press('Control+k')
    // "opaque" appears only in a paragraph of the pagination guide.
    await page.locator('search-palette input[type="search"]').fill('opaque')
    const result = page.locator('search-palette a[data-index="0"]')
    await expect(result).toContainText('Cursors')
    await expect(result).toContainText('Pagination')
    await result.click()
    await expect(page).toHaveURL(/#\/page\/pagination\/cursors$/)
    await expect(page.locator('md-page h2#cursors')).toBeVisible()
  })

  test('a heading match outranks a body match', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await page.keyboard.press('Control+k')
    await page.locator('search-palette input[type="search"]').fill('retrying')
    await expect(page.locator('search-palette a[data-index="0"]')).toContainText('Retrying')
  })

  test('indexes .txt pages whole and skips external links', async ({ page }) => {
    await gotoFixture(page, DOCS_PAGE)
    await page.keyboard.press('Control+k')
    await page.locator('search-palette input[type="search"]').fill('First public release')
    await expect(page.locator('search-palette a[data-index="0"]')).toContainText('Raw changelog')
    await page.locator('search-palette input[type="search"]').fill('status.e2e.test')
    await expect(page.locator('search-palette')).toContainText('No results.')
  })
})

test.describe('manifest form (§2.2)', () => {
  test('a manifest URL drives the nav, relative urls resolving against it', async ({ page }) => {
    await gotoFixture(page, MANIFEST_PAGE)
    await openDrawerIfMobile(page)
    await expect(page.locator('api-nav a[data-page-slug="intro"]')).toBeVisible()
    await expect(page.locator('api-nav details[data-docs-group="guides"]')).toBeVisible()
    await page.locator('api-nav a[data-page-slug="pagination"]').click()
    // The manifest declares "pagination.md", resolved next to the manifest.
    await expect(page.locator('md-page h1')).toContainText('Pagination')
  })

  test('a manifest that fails to load says so and leaves the reference nav intact', async ({
    page,
  }) => {
    await gotoFixture(page, MISSING_MANIFEST_PAGE)
    await expect(page.locator('api-nav .alert-error')).toContainText('could not be loaded')
    await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  })
})

// §2.6 — the installation that can serve no file next to index.html: the whole
// prose side travels in the host page. What the suite really guards is that
// this is the SAME feature and not a reduced one: the markdown pipeline, the
// sanitizer, the chrome and the search index all behave as they do on a
// fetched page.
test.describe('bodies carried by the host page (§2.6)', () => {
  test('renders the docs zone without fetching a single docs file', async ({ page }) => {
    const requested = []
    page.on('request', (request) => requested.push(request.url()))
    await gotoFixture(page, INLINE_PAGE)
    await openDrawerIfMobile(page)
    await expect(page.locator('api-nav a[data-page-slug="guide"]')).toBeVisible()
    await expect(page.locator('api-nav details[data-docs-group="carried"]')).toBeAttached()
    // A carried page takes `#/` over like any other (§2.4).
    await expect(page.locator('md-page h1')).toContainText('Carried guide')
    expect(requested.filter((url) => /\/fixtures\/docs\//.test(url))).toEqual([])
    // A body read from the DOM has no URL: a loader falling back to `page.url`
    // would fetch the string "undefined" against the host page.
    expect(requested.filter((url) => /(undefined|null)$/.test(url))).toEqual([])
  })

  test('runs the full markdown pipeline on a body indented by its own markup', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoFixture(page, `${INLINE_PAGE}#/page/guide`)
    // The indentation of the <script> in the page is common to every line, so
    // it goes: what survives is the markdown, not one big code block.
    await expect(page.locator('md-page h1')).toContainText('Carried guide')
    await expect(page.locator('md-page > div > div > pre').first()).toHaveCount(0)
    await expect(page.locator('md-page .alert')).toContainText('Callouts, code tabs')
    await expect(page.locator('md-page [data-code-tabs] [role="tab"]')).toHaveCount(2)
    // Relative indentation is untouched, so a nested list is still nested.
    await expect(page.locator('md-page li ul li')).toContainText('kept relative')
    // API references resolve against the model exactly as in a fetched page.
    const link = page.locator('md-page a.apidoc-op-link', { hasText: 'create a pet' })
    await expect(link.locator('.badge')).toHaveText('post')
    // Chrome applies: headings are anchored, the ToC and the pager are there.
    await expect(page.locator('md-page h2#sending-a-request')).toHaveCount(1)
    await expect(page.locator('md-page nav[aria-label="On this page"]:visible')).toHaveCount(1)
    await expect(
      page.locator('md-page nav[aria-label="Previous and next page"] [data-pager-slug]'),
    ).toHaveCount(1)
  })

  test('takes the format from the script type, sanitizing the html one', async ({ page }) => {
    await gotoFixture(page, `${INLINE_PAGE}#/page/notes`)
    await expect(page.locator('md-page h1')).toContainText('Carried notes')
    // `type="text/html"` alone chose this pipeline — no `format` in the config.
    await expect(page.locator('md-page h2#sanitization')).toHaveCount(1)
    await expect(page.locator('md-page img[onerror]')).toHaveCount(0)
    expect(await page.evaluate(() => window.__inlineHtmlXss)).toBeUndefined()
  })

  test('a text/plain body stays escaped text in a <pre>', async ({ page }) => {
    await gotoFixture(page, `${INLINE_PAGE}#/page/raw`)
    const pre = page.locator('md-page pre')
    await expect(pre).toHaveCount(1)
    await expect(pre).toContainText('<b>Not</b> HTML')
    await expect(page.locator('md-page b')).toHaveCount(0)
    await expect(page.locator('md-page nav[aria-label="On this page"]')).toHaveCount(0)
  })

  test('a body written straight into the config renders, format included', async ({ page }) => {
    await gotoFixture(page, `${INLINE_PAGE}#/page/from-config`)
    await expect(page.locator('md-page h1')).toContainText('Written in the config')
    await expect(page.locator('md-page h2#no-file-involved')).toHaveCount(1)
    // `format` is the only thing that can say "html" when there is no
    // extension and no element to read a type from.
    await page.goto(`${INLINE_PAGE}#/page/config-html`)
    await expect(page.locator('md-page h1')).toContainText('HTML in the config')
    await expect(page.locator('md-page code')).toContainText('format')
  })

  test('a contentId nobody declared fails visibly, naming the id', async ({ page }) => {
    await gotoFixture(page, `${INLINE_PAGE}#/page/missing`)
    await expect(page.locator('md-page .alert-error')).toContainText('#nope')
  })

  test('the search index reads carried bodies like any other', async ({ page }) => {
    await gotoFixture(page, INLINE_PAGE)
    await page.keyboard.press('Control+k')
    await page.locator('search-palette input[type="search"]').fill('never left the host')
    const result = page.locator('search-palette a[data-index="0"]')
    await expect(result).toContainText('Carried guide')
    await result.click()
    await expect(page).toHaveURL(/#\/page\/guide/)
  })
})

// §12 — the guide reads with the reader's own values. The fixture page holds
// the three states at once: `baseUrl`/`tenant` resolve, `token` is sensitive,
// `unknownVar` resolves to nothing.
const VARS_PAGE = `${DOCS_PAGE}#/page/variables`
const mdPage = (page) => page.locator('md-page')

test.describe('variable interpolation (§12)', () => {
  test('resolves a value as plain text, in prose, headings and fences', async ({ page }) => {
    await gotoFixture(page, VARS_PAGE)
    await expect(mdPage(page).locator('h1')).toContainText('Personalized guide')
    await expect(mdPage(page).locator('.md-content > p').first()).toContainText(
      'against https://api.e2e.test/v1, as tenant acme',
    )
    // A heading is walked like any other text — but its id was assigned
    // BEFORE, from the source: a deep link cannot depend on the environment.
    const heading = mdPage(page).locator('h2#calling-as-tenant')
    await expect(heading).toContainText('Calling as acme')
    await expect(mdPage(page).locator('pre code')).toContainText('X-Tenant: acme')
    // The ToC quotes the heading, so it quotes the resolved one.
    await expect(mdPage(page).locator('a[data-toc-id="calling-as-tenant"]').first()).toContainText(
      'Calling as acme',
    )
  })

  test('masks a sensitive value instead of rendering it anywhere', async ({ page }) => {
    await gotoFixture(page, VARS_PAGE)
    const chip = mdPage(page).locator('[data-var-name="token"]')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('token')
    await expect(chip).toHaveAttribute('aria-label', /value hidden/)
    // Scoped to the page and not to `page.content()`, which would also read
    // the fixture's own config block: what is asserted is that the walk never
    // put the value in the DOM.
    expect(await mdPage(page).innerHTML()).not.toContain('e2e-secret-value')
  })

  test('a name nothing resolves opens the environment manager', async ({ page }) => {
    await gotoFixture(page, VARS_PAGE)
    const chip = mdPage(page).locator('[data-var-missing]')
    await expect(chip).toContainText('unknownVar')
    await expect(chip).toHaveAttribute('aria-label', /not set/)
    await chip.click()
    await expect(page.locator('env-manager [data-env-editor]')).toBeVisible()
  })

  test('copying a fence yields the interpolated snippet, secrets excepted', async ({ page }) => {
    await gotoFixture(page, VARS_PAGE)
    await mdPage(page).locator('.md-code-header button').first().click()
    const copied = await clipboardText(page)
    // Runnable: the reader's own base URL and tenant. The secret pastes as the
    // template it stands for — it was never in the DOM to copy.
    expect(copied).toContain("-H 'X-Tenant: acme'")
    expect(copied).toContain('https://api.e2e.test/v1/pets')
    expect(copied).toContain('Bearer {{token}}')
    expect(copied).not.toContain('e2e-secret-value')
  })

  test('switching environment re-walks the page from its pristine render', async ({ page }) => {
    await gotoFixture(page, VARS_PAGE)
    await expect(mdPage(page).locator('h2#calling-as-tenant')).toContainText('acme')
    await selectEnv(page, 'other')
    // The second environment resolves `tenant` differently and declares no
    // `token` at all: a value becomes another value, a mask becomes a warning.
    await expect(mdPage(page).locator('h2#calling-as-tenant')).toContainText('globex')
    await expect(mdPage(page).locator('.md-content > p').first()).toContainText(
      'against https://other.e2e.test/v1, as tenant globex',
    )
    await expect(mdPage(page).locator('[data-var-name="token"]')).toHaveAttribute(
      'data-var-missing',
      '',
    )
    // Idempotence: the walk runs on the restored render, never on its own
    // output, so no value is left over from the previous environment.
    expect(await mdPage(page).innerText()).not.toContain('acme')
    await expect(mdPage(page).locator('a[data-toc-id="calling-as-tenant"]').first()).toContainText(
      'Calling as globex',
    )
  })

  test('a backslash names the reference instead of resolving it', async ({ page }) => {
    await gotoFixture(page, `${VARS_PAGE}`)
    const section = mdPage(page).locator('h2#escaping + p')
    await expect(section).toContainText('{{tenant}} in prose')
    await expect(section.locator('code')).toHaveText('{{tenant}}')
    // The backslash itself is consumed, in both spellings.
    await expect(section).not.toContainText('\\')
  })

  test('the search index stays uninterpolated: the literal name finds the page', async ({
    page,
  }) => {
    await gotoFixture(page, DOCS_PAGE)
    await page.keyboard.press('Control+k')
    await page.locator('search-palette input[type="search"]').fill('{{baseUrl}}')
    await expect(page.locator('search-palette a[data-index="0"]')).toContainText('Personalized')
  })
})
