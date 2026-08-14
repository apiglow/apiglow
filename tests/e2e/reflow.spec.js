import { expect, test } from '@playwright/test'
import {
  clickNavOp,
  expectResponded,
  gotoApp,
  gotoFixture,
  mockApi,
  openDrawerIfMobile,
  openEnvManager,
  openHistory,
  openSettings,
  openTryItIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'
import { encodeSetupLink } from '../../src/env/setup-link.js'

// The two WCAG 2.1 AA criteria no scanner answers, because neither is a
// question about the DOM as authored: axe judges the page it is handed, and
// 1.4.10 and 1.4.12 both ask what happens to that page under a constraint
// nobody designed it for — a 320 px viewport, and a reader's own stylesheet.
//
// Its own file rather than more cases in `a11y.spec.js`, for one mechanical
// reason: the reflow half is stated as a viewport, `test.use()` applies per
// file or per describe, and the axe sweep exists to measure the layouts the
// five projects render. Dragging it to 320 px would stop it doing that.

// --- the shared measurement -------------------------------------------------

// A box that clips its own text loses whatever it cut: no scrollbar, no
// ellipsis worth reading, nothing past the edge. Both criteria forbid that in
// the same words ("without loss of information or functionality"), so the floor
// below is the one budget they share — on the horizontal axis, where the app
// truncates on purpose and the question is how much is left.
//
// Half. Under it the ellipsis is most of what is shown and the string stops
// being identifiable, and it is the ratio that separated the two real defects
// from the two deliberate truncations. Found: the footer credit at 15 % of
// "Powered by apiglow v0.1.0" and a step editor preview at 36 % of
// `: "available" | "pending" | "sold"` — both fixed, in `views.js` and
// `scenario-step-editor.js`. Kept: the doc's base-URL reminder at 74 %, which
// shrinks first by design so the path beside it never does, and the send
// meter's `aria-hidden` telemetry at 90 %, whose figures are spelled out in the
// response header next to it.
const MIN_SHOWN = 0.5

// Losing a pixel is rounding, not clipping: a `border` on a percentage-sized
// box lands between device pixels and `scrollWidth` rounds up where
// `clientWidth` rounds down.
const ROUNDING_PX = 1

// What 1.4.10 exempts: "content requiring two-dimensional layout for usage or
// meaning". That set is named here rather than guessed — it is exactly what
// `scrollBlock()` marks, `.api-scrollport` (§12): code blocks, header dumps,
// request and response bodies, the setup dialog's variable table. The previous
// a11y work is what makes the exemption honest: those blocks carry a declared
// tab stop, so what sits past their edge is reachable without a pointer.
//
// The exemption is about the block's own overflow and never its container's. A
// scrollport whose box is wider than the column holding it still pushes the
// page sideways, and the assertion below still sees it, because it is measured
// on the ancestor.
const SCROLLPORT = '.api-scrollport'

// Nothing is measured mid-transition. daisyUI opens a collapse by animating
// `grid-template-rows` from 0, so a row caught in flight reports 5 % of its
// content clipped away and says so on a different run every time. The deadline
// is not a formality — a looping animation never resolves, and neither does one
// the compositor never started.
const SETTLE_MS = 800

function settle(page) {
  return page.evaluate(async (deadline) => {
    const running = document.getAnimations().map((a) => a.finished.catch(() => {}))
    await Promise.race([
      Promise.all(running),
      new Promise((resolve) => setTimeout(resolve, deadline)),
    ])
  }, SETTLE_MS)
}

// Measured on every element that clips, in one page call. `x` and `y` are the
// fraction of the content that survives on each axis; 1 means nothing was cut.
// Kept apart rather than reduced to a worst case, because the two axes are not
// the same event: horizontal clipping is what a deliberate `truncate` does for
// a living, vertical clipping is a box that ran out of the height someone
// assumed for it.
function clipReport(page) {
  return page.evaluate(() => {
    const report = []
    for (const node of document.querySelectorAll('body *')) {
      // A form field is not a clipping box: its value scrolls with the caret,
      // and the whole of it is one selection away.
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) continue
      // `sr-only` IS a 1 px clipping box — that is the technique. Measuring it
      // would report the whole visually-hidden layer as lost content.
      if (node.closest('.sr-only')) continue
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      if (!node.textContent?.trim()) continue
      const clipsX = /hidden|clip/.test(style.overflowX)
      const clipsY = /hidden|clip/.test(style.overflowY)
      const lostX = clipsX ? node.scrollWidth - node.clientWidth : 0
      const lostY = clipsY ? node.scrollHeight - node.clientHeight : 0
      if (lostX <= 1 && lostY <= 1) continue
      if (node.clientWidth <= 0 || node.clientHeight <= 0) continue
      const ratio = (clips, client, scroll) =>
        clips && scroll ? Math.round((100 * client) / scroll) / 100 : 1
      report.push({
        // Identity across a restyle: the classes and the text, never the
        // measurements — those are what the second pass compares.
        id: `${node.tagName.toLowerCase()}.${node.className.toString().split(' ').slice(0, 3).join('.')} :: ${node.textContent.trim().slice(0, 40).replace(/\s+/g, ' ')}`,
        x: ratio(clipsX, node.clientWidth, node.scrollWidth),
        y: ratio(clipsY, node.clientHeight, node.scrollHeight),
      })
    }
    return report
  })
}

// --- 1.4.10 Reflow ----------------------------------------------------------

test.describe('reflow at 320 px', () => {
  // 320 CSS px is the criterion's own arithmetic: a 1280 px window at 400 %
  // zoom. The height is not part of it — 800 keeps the surfaces below within
  // one screenful of vertical scrolling, which is the direction the criterion
  // allows.
  test.use({ viewport: { width: 320, height: 800 } })

  // The sweeps land on the pair whatever theme the fixture declares: it is what
  // the default install shows, and a stock daisyUI theme paints its own
  // paddings for nothing.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('apidoc:theme', JSON.stringify('apiglow'))
    })
  })

  // `<main>` plus whatever panel or dialog is open: those are the scrollports a
  // reader is put inside at 320 px, and each has to hold its own width.
  // `<html>` is not one of them and asserting on it would be asserting nothing
  // — the shell is an `h-screen` column whose content scrolls inside it, so the
  // document itself never grows, and the off-canvas panels are `position:
  // fixed` on top of everything.
  const REGIONS = 'main, header, .modal-box, aside.api-offcanvas.is-open'

  // Every element whose right edge sits past the region's, minus the ones a
  // nested scroll container already owns — those scroll in one dimension inside
  // a box that does not, which is what the criterion asks for. Collected so a
  // failure names the offender instead of quoting a delta.
  async function overflowReport(page, selector) {
    return page.$$eval(
      selector,
      (roots, { exempt, rounding }) =>
        roots
          .filter((root) => root.getClientRects().length > 0)
          .map((root) => {
            const bounds = root.getBoundingClientRect()
            const offenders = []
            for (const node of root.querySelectorAll('*')) {
              const style = getComputedStyle(node)
              if (style.visibility === 'hidden' || style.display === 'none') continue
              const box = node.getBoundingClientRect()
              const past = box.right - bounds.right
              if (past <= 1 || box.width === 0) continue
              let owned = false
              for (let p = node.parentElement; p && p !== root && !owned; p = p.parentElement) {
                owned = /auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)
              }
              if (owned || node.closest(exempt)) continue
              const classes = node.className.toString().split(' ').slice(0, 3).join('.')
              offenders.push(`${node.tagName.toLowerCase()}.${classes} +${Math.round(past)}px`)
            }
            return {
              what: `${root.tagName.toLowerCase()}.${root.className.toString().split(' ')[0]}`,
              past: Math.max(0, root.scrollWidth - root.clientWidth - rounding),
              offenders: offenders.slice(0, 6),
            }
          }),
      { exempt: SCROLLPORT, rounding: ROUNDING_PX },
    )
  }

  // Both halves of the criterion at once: nothing scrolls sideways, and nothing
  // that fits did so by throwing its text away.
  async function expectReflows(page) {
    await settle(page)
    const regions = await overflowReport(page, REGIONS)
    expect(regions.length, `no region matched ${REGIONS}`).toBeGreaterThan(0)
    expect(regions.filter((r) => r.past > 0)).toEqual([])
    const clipped = await clipReport(page)
    expect(clipped.filter((c) => Math.min(c.x, c.y) < MIN_SHOWN)).toEqual([])
  }

  test('the home view and the navigation drawer hold 320 px', async ({ page }) => {
    await gotoApp(page)
    await expectReflows(page)
    await openDrawerIfMobile(page)
    await expectReflows(page)
  })

  test('an operation and its try-it hold 320 px, before and after a send', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page)
    await clickNavOp(page, 'listPets')
    await expectReflows(page)
    await openTryItIfMobile(page)
    await expectReflows(page)
    await send(page)
    await expectResponded(page)
    await expectReflows(page)
  })

  // The history with one entry open, not the empty dialog: what this criterion
  // is about there is the request line, the header dump and the body, which are
  // the widest text the app ever lays out.
  test('the history and settings dialogs hold 320 px', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page, '#/op/listPets')
    await send(page)
    await expectResponded(page)
    await openHistory(page)
    const entry = page.locator('request-history-list .collapse').first()
    // daisyUI's collapse is driven by a bare checkbox stretched over the row;
    // the title is not the control.
    await entry.locator('input[type="checkbox"]').first().check()
    await expect(entry.locator('.api-scrollport').first()).toBeVisible()
    await expectReflows(page)
    await page.keyboard.press('Escape')
    await openSettings(page)
    await expectReflows(page)
  })

  test('the search palette holds 320 px', async ({ page }) => {
    await gotoApp(page)
    // Not `openSearch()`: it reaches for the header's field, which only exists
    // from lg up — below, the drawer's trigger is the single opener.
    await openDrawerIfMobile(page)
    await page.getByRole('button', { name: /Search the docs/ }).click()
    const palette = page.locator('search-palette input[type="search"]')
    await palette.fill('pet')
    await expect(page.locator('search-palette a[data-index]').first()).toBeVisible()
    await expectReflows(page)
  })

  test('the environment manager holds 320 px', async ({ page }) => {
    await gotoApp(page)
    await openEnvManager(page)
    await expectReflows(page)
  })

  test('a scenario, its step editor and the webhook simulator hold 320 px', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page)
    await openDrawerIfMobile(page)
    await page.locator('api-nav a[data-scenario-id="onboarding"]').click()
    await expect(page.locator('api-scenario-view li[data-step-id]').first()).toBeVisible()
    await expectReflows(page)

    // The editor is offered on local scenarios only, so it is reached the way a
    // user reaches it: capture a request into a new one, which opens it.
    await clickNavOp(page, 'getPet')
    await openTryItIfMobile(page)
    await panelField(page, 'petId').fill('42')
    await tryIt(page).locator('[data-scenario-capture]').first().locator('summary').click()
    await tryIt(page).locator('[data-scenario-target="new"]').click()
    const editor = page.locator('api-scenario-view [data-step-editor]').first()
    await expect(editor.locator('[data-chain-pane]').first()).toBeVisible()
    await expectReflows(page)

    await openDrawerIfMobile(page)
    await page.locator('api-nav a[data-op-id^="webhook-"]').first().click()
    await openTryItIfMobile(page)
    await expect(page.locator('api-webhook-simulator')).toBeVisible()
    await expectReflows(page)
  })

  // The import dialog with a parsed command on screen, and the builder half of
  // the setup link — a form built by hand, i.e. the one place where a row can
  // be laid out wider than the box that holds it.
  test('the import dialog and the setup link builder hold 320 px', async ({ page }) => {
    await gotoApp(page)
    await page.getByRole('button', { name: 'Import a request' }).click()
    await page.locator('import-dialog textarea').fill(`curl 'https://api.e2e.test/v1/pets/7'`)
    await expect(page.locator('import-dialog')).toContainText('Open in the try-it')
    await expectReflows(page)
    await page.keyboard.press('Escape')

    await page.locator('[data-setup-builder-open]').click()
    await page.locator('env-setup-builder [data-setup-field="envName"]').fill('Team staging')
    await page.locator('env-setup-builder [data-setup-add-row="variable"]').click()
    await page.locator('env-setup-builder [data-setup-add-row="header"]').click()
    await expectReflows(page)
  })

  // The other half: the preview a stranger's link opens, whose variable table
  // is the one table the app lays out itself rather than receiving as Markdown.
  test('the setup link preview holds 320 px', async ({ page }) => {
    const encoded = encodeSetupLink({
      name: 'Staging',
      baseUrl: 'https://api.e2e.test/staging',
      color: 'amber',
      variables: [
        { name: 'auth.bearerAuth', value: 'a-token-long-enough-to-need-room', sensitive: true },
        { name: 'tenant', value: 'acme', sensitive: false },
      ],
      defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
    })
    await gotoApp(page, `#/?setup=${encoded}`)
    await expect(page.locator('env-setup-dialog .modal-box')).toBeVisible()
    await expectReflows(page)
  })

  test('the schema audit and a docs page hold 320 px', async ({ page }) => {
    await gotoApp(page, '#/audit')
    await expect(page.locator('audit-report h1')).toBeVisible()
    await expectReflows(page)

    await gotoFixture(page, '/tests/e2e/fixtures/app-docs.html#/docs/getting-started')
    await expect(page.locator('main h1')).toBeVisible()
    await expectReflows(page)
  })
})

// --- 1.4.12 Text spacing ----------------------------------------------------

// The criterion's four values, verbatim, and in the form the WCAG working
// group's own bookmarklet applies them: a user stylesheet is a blunt
// instrument, so it lands on `*` rather than on the elements we would have
// chosen. Not run at 320 px — the criterion says nothing about width, and
// stacking both constraints would measure a case neither of them describes.
const TEXT_SPACING = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p { margin-bottom: 2em !important; }
`

test.describe('text spacing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('apidoc:theme', JSON.stringify('apiglow'))
    })
  })

  // Measured as a difference, which is what the criterion actually asks: not
  // "does anything clip" — plenty does, on purpose — but "does overriding the
  // spacing cost the reader something it did not cost before". And measured per
  // axis, because the two say different things.
  //
  // **Vertically, any new clipping fails.** That is the criterion's own subject:
  // `line-height` and the paragraph margin push text down, and a box sized for
  // the height someone assumed swallows the difference silently. Every
  // height-capped cartouche in the app pairs its `max-h-*` with an
  // `overflow-auto` — the history bodies, the step editor's key list, the
  // palette results, the response panes — so the answer is "it scrolls", and
  // this is what holds the next one to it.
  //
  // **Horizontally, only a fall under the floor fails.** `letter-spacing` and
  // `word-spacing` widen every line by a few per cent, and a box that truncates
  // on purpose absorbs exactly that: the doc's base-URL reminder goes from whole
  // to 86 % on the widest mobile project, by the `shrink-[9999]` rule that keeps
  // the path intact beside it. Failing on that would be failing a design for
  // doing its job.
  async function expectSpacingSurvives(page) {
    await settle(page)
    const before = new Map((await clipReport(page)).map((c) => [c.id, c]))
    await page.addStyleTag({ content: TEXT_SPACING })
    // The override changes no layout the app animates itself; one frame is all
    // the engine needs to have reflowed.
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const lost = (await clipReport(page))
      .filter((c) => {
        const was = before.get(c.id)
        if (c.y < 1 && !(was?.y < 1)) return true
        return c.x < MIN_SHOWN && !(was?.x < MIN_SHOWN)
      })
      .map((c) => {
        const was = before.get(c.id)
        const pct = (r) => `${Math.round(r.x * 100)}%×${Math.round(r.y * 100)}%`
        return `${c.id} — ${pct(c)} shown, was ${was ? pct(was) : 'whole'}`
      })
    expect(lost).toEqual([])
  }

  test('the home view and an operation survive the reader stylesheet', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page)
    await expectSpacingSurvives(page)
    await gotoApp(page, '#/op/listPets')
    await send(page)
    await expectResponded(page)
    await expectSpacingSurvives(page)
  })

  // The height-constrained cartouches, which are where a line-height override
  // lands hardest: the history's request and response bodies (`max-h-60`) and
  // the step editor's key list (`max-h-72`). Both pair their cap with
  // `overflow-auto`, which is what makes the answer "it scrolls" rather than
  // "it is cut" — and that is the property this asserts.
  test('the history bodies survive the reader stylesheet', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page, '#/op/listPets')
    await send(page)
    await expectResponded(page)
    await openHistory(page)
    const entry = page.locator('request-history-list .collapse').first()
    await entry.locator('input[type="checkbox"]').first().check()
    await expect(entry.locator('.api-scrollport').first()).toBeVisible()
    await expectSpacingSurvives(page)
  })

  test('the scenario step editor survives the reader stylesheet', async ({ page }) => {
    await mockApi(page)
    await gotoApp(page)
    await clickNavOp(page, 'getPet')
    await openTryItIfMobile(page)
    await panelField(page, 'petId').fill('42')
    await tryIt(page).locator('[data-scenario-capture]').first().locator('summary').click()
    await tryIt(page).locator('[data-scenario-target="new"]').click()
    const editor = page.locator('api-scenario-view [data-step-editor]').first()
    await expect(editor.locator('[data-chain-pane]').first()).toBeVisible()
    await expectSpacingSurvives(page)
  })

  // Prose is the criterion's own subject: paragraphs, lists, headings, tables
  // and fences, all of them laid out by the Markdown renderer rather than by a
  // component that knew its content.
  test('a docs page survives the reader stylesheet', async ({ page }) => {
    await gotoFixture(page, '/tests/e2e/fixtures/app-docs.html#/docs/getting-started')
    await expect(page.locator('main h1')).toBeVisible()
    await expectSpacingSurvives(page)
  })

  test('the settings panel and the environment manager survive it', async ({ page }) => {
    await gotoApp(page)
    await openSettings(page)
    await expectSpacingSurvives(page)
    await page.keyboard.press('Escape')
    await openEnvManager(page)
    await expectSpacingSurvives(page)
  })
})
