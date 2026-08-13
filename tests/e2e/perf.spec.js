// Performance non-regression on load. Budget: the app must be
// USABLE within 1s — not just "displayed". Measured on the demo's GitHub REST
// schema (demo/schemas/github.json, ~12 MB, 1220 operations, ~970 schemas),
// the heaviest document the repo ships, served by the CDN simulation like for
// an end user. It is vendored, so the budget only moves when someone
// deliberately refreshes that file.
//
// This test exists because a non-memoized fingerprint computation (schema diff)
// froze the main thread for 2.9s on load, with no indicator at all: the page
// stayed blank and nothing responded. A global budget alone is not enough to
// catch it — hence the cap on the longest blocking task.
import { test, expect } from '@playwright/test'

const BUDGET_MS = 1000
// Beyond this, the interface is perceived as frozen (no frame, no click handled)
// even if the global budget is met. Raised from 400 with the move to a schema
// an order of magnitude heavier: the cap is now the one a real 12 MB document
// has to hold, and the measured worst task sits far enough below it that CI
// jitter is not what decides the verdict.
const MAX_BLOCKING_TASK_MS = 500

// Search and the try-it are the two interactions that walk the model *after*
// boot, so the load budget above says nothing about them. Both are measured
// from the user's first keystroke/click to the rendered result: ~65 ms each on
// the reference machine, budgeted at the same scale as the blocking cap so CI
// jitter on a 65 ms figure never decides the verdict.
// These constants may only ever go down: check-invariants.mjs records them
// (invariant "budgets tighten"), so raising one takes an edit there too.
// The search figure is the app's own work, timed in the page (see the test):
// ~50 ms for the seventeen keystrokes of the reference query on the reference
// machine, with no run-to-run spread to speak of. Tightened from 400 when the
// measurement stopped including the driver's round-trips, which were three
// quarters of the old number and all of its variance.
const SEARCH_BUDGET_MS = 200
const DEEP_BODY_BUDGET_MS = 400
// Opening a docs page is a fetch plus a markdown render, and the render is the
// half we own: callouts, tab groups, `apidoc:` resolution and heading anchors
// all walk the produced tree. Budgeted like the other post-boot interactions
// (docs/docs-pages.md §9).
const DOCS_PAGE_BUDGET_MS = 400

const HEAVY_PAGE = '/tests/e2e/fixtures/app-perf.html'
// The docs fixture: a takeover home, groups, and pages carrying every
// enrichment at once.
const DOCS_HOME_PAGE = '/tests/e2e/fixtures/app-docs.html'

async function watchLongTasks(page) {
  await page.addInitScript(() => {
    window.__longTasks = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__longTasks.push({
          start: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
        })
      }
    }).observe({ entryTypes: ['longtask'] })
  })
}

const longTasks = (page) => page.evaluate(() => window.__longTasks ?? [])

test('a heavy schema is loaded, rendered and interactive within the budget', async ({
  page,
}, testInfo) => {
  await watchLongTasks(page)

  await page.goto(HEAVY_PAGE)
  // Usable = the nav lists the endpoints, the doc is rendered, AND a click is
  // actually handled (a blocked thread fails here, not before). Timed in the
  // page from the navigation's own origin, for the same reason the search
  // budget is (see below): driven over the wire, each of these five steps is
  // CDP round-trips and rAF-paced actionability checks — on the CI runner
  // that harness alone is a third of the budget, and a budget decided by the
  // harness is not a budget. The click is a real one (`link.click()` walks
  // the full listener path and the router behind it), and the waits are
  // frame-paced, so a frozen thread still fails here, exactly as before.
  const usableMs = await page.evaluate(async () => {
    const ready = (check) =>
      new Promise((resolve) => {
        const tick = () => {
          const value = check()
          if (value) resolve(value)
          else requestAnimationFrame(tick)
        }
        tick()
      })
    await ready(() => document.querySelector('api-nav a[data-op-id]'))
    const h1 = await ready(() => {
      const el = document.querySelector('main h1')
      return el?.textContent ? el : null
    })
    const firstTitle = h1.textContent
    const link = document.querySelector('api-nav a[data-op-id]')
    // The nav groups are <details>: the link's group opens first when the
    // landing did not already unfold it.
    const group = link.closest('details')
    if (group && !group.open) group.querySelector('summary').click()
    link.click()
    await ready(() => document.querySelector('main h1')?.textContent !== firstTitle)
    // performance.now() is relative to the navigation start: this is the full
    // wall-clock from asking for the page to the click having taken effect.
    return Math.round(performance.now())
  })
  // The same landmarks, re-asserted through real locators: the measurement
  // above says how fast, these say the page truly holds what it timed.
  await expect(page.locator('api-nav a[data-op-id]').first()).toBeAttached()
  await expect(page.locator('main h1').first()).toBeVisible()

  // The schema audit is on by default and walks the whole raw document: it must
  // stay off the boot path (docs/audit.md §7). Its page is only ever in the DOM
  // once computed, and the budgets above are what would catch it if it slipped
  // into boot anyway.
  await expect(page.locator('audit-report')).toHaveCount(0)

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  const detail = `usable=${usableMs}ms worstLongTask=${worst}ms tasks=${JSON.stringify(tasks)}`
  testInfo.annotations.push({ type: 'perf', description: detail })

  expect(usableMs, detail).toBeLessThan(BUDGET_MS)
  expect(worst, detail).toBeLessThan(MAX_BLOCKING_TASK_MS)
})

test('the schema diff never freezes the page, whenever it runs', async ({ page }, testInfo) => {
  // The diff runs deferred (idle): bounding only the "load" window
  // would miss it. So we watch the whole lifetime of the page, including the
  // second load — the one where a snapshot exists and the diff happens.
  await page.goto(HEAVY_PAGE)
  await page.locator('api-nav a[data-op-id]').first().waitFor({ state: 'attached' })
  await page.waitForTimeout(1500) // lets the reference snapshot get written

  await watchLongTasks(page)
  const startedAt = Date.now()
  await page.reload()
  await page.locator('api-nav a[data-op-id]').first().waitFor({ state: 'attached' })
  await expect(page.locator('main h1').first()).toBeVisible()
  const usableMs = Date.now() - startedAt
  // Observation window: the deferred computation must fit within it, without freezing.
  await page.waitForTimeout(3000)

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  const detail = `usable=${usableMs}ms worstLongTask=${worst}ms tasks=${JSON.stringify(tasks)}`
  testInfo.annotations.push({ type: 'perf', description: detail })

  expect(usableMs, detail).toBeLessThan(BUDGET_MS)
  expect(worst, detail).toBeLessThan(MAX_BLOCKING_TASK_MS)
})

// The search index is built at boot and queried on every keystroke, over the
// whole model (1220 operations here). Boot's budget covers the
// build; nothing covered the query, which is the half the user feels — a
// palette that takes half a second per character is unusable long before it
// trips any load budget.
test('the search palette answers within the budget on a heavy schema', async ({
  page,
}, testInfo) => {
  await watchLongTasks(page)
  await page.goto(HEAVY_PAGE)
  await page.locator('api-nav a[data-op-id]').first().waitFor({ state: 'attached' })

  await page.keyboard.press('Control+k')
  const input = page.locator('search-palette input[type="search"]')
  await expect(input).toBeFocused()

  // One `input` event per character — `fill` sets the value in one shot, and it
  // is the per-keystroke cost that a non-indexed scan shows up in. Timed inside
  // the page, and summing only the handlers: driving the keys over the wire
  // measured the driver instead, ~200 ms of CDP round-trips around the ~50 ms
  // the app actually spends, swinging by more than 100 ms between runs of the
  // same build — a budget decided by the harness is not a budget.
  const answeredMs = await page.evaluate(async () => {
    const field = document.querySelector('search-palette input[type="search"]')
    const query = 'branch protection'
    let total = 0
    for (let i = 1; i <= query.length; i += 1) {
      field.value = query.slice(0, i)
      const startedAt = performance.now()
      field.dispatchEvent(new InputEvent('input', { bubbles: true }))
      total += performance.now() - startedAt
      // One task per keystroke, as the browser gives it: the blocking cap below
      // is about a single keystroke, not about the sum of seventeen.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return Math.round(total)
  })
  await expect(page.locator('search-palette a[data-result-id]').first()).toBeVisible()

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  const detail = `answered=${answeredMs}ms worstLongTask=${worst}ms`
  testInfo.annotations.push({ type: 'perf', description: detail })

  expect(answeredMs, detail).toBeLessThan(SEARCH_BUDGET_MS)
  expect(worst, detail).toBeLessThan(MAX_BLOCKING_TASK_MS)
})

// Opening an operation builds the try-it's body editors from the normalized
// schema, expanding it node by node. That work is off the boot path entirely
// (no operation is open on load), so the load budget never sees it: a change
// that makes expansion quadratic shows up here first.
test('a deep request body renders its editors within the budget', async ({ page }, testInfo) => {
  await watchLongTasks(page)
  await page.goto(HEAVY_PAGE)
  await page.locator('api-nav a[data-op-id]').first().waitFor({ state: 'attached' })

  const startedAt = Date.now()
  // Direct hash navigation rather than a nav click: what is measured is the
  // doc + panel render, not the cost of unfolding a <details> group.
  await page.goto(`${HEAVY_PAGE}#/op/${encodeURIComponent('repos/update')}`)
  await expect(page.locator('main h1')).toBeVisible()
  // `repos/update` is the schema's widest body — 27 top-level properties, some
  // of them objects of objects. The nested field is the proof the expansion ran
  // to the bottom: the top-level ones are already there while the tree is still
  // unfolding.
  const doc = page.locator('main')
  await expect(
    doc.getByLabel('Try-it value for security_and_analysis.advanced_security.status'),
  ).toBeVisible()
  const renderedMs = Date.now() - startedAt

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  const detail = `rendered=${renderedMs}ms worstLongTask=${worst}ms`
  testInfo.annotations.push({ type: 'perf', description: detail })

  expect(renderedMs, detail).toBeLessThan(DEEP_BODY_BUDGET_MS)
  expect(worst, detail).toBeLessThan(MAX_BLOCKING_TASK_MS)
})

// The budget above measures a fresh `page.goto(#/op/…)`, where the doc is not
// yet connected and renders exactly once. In-session navigation — the common
// case — used to render it three times: `operation` and `security` each
// triggered one, and re-mounting the same element into `main` re-ran
// connectedCallback for a third. Counted rather than timed: the waste is
// structural, and a second wall-clock assertion is a second thing for CI jitter
// to decide.
test('an in-session navigation renders the endpoint doc once', async ({ page }, testInfo) => {
  await page.goto(`${HEAVY_PAGE}#/op/${encodeURIComponent('repos/get')}`)
  await expect(page.locator('main api-endpoint-doc h1')).toBeVisible()

  await page.evaluate(() => {
    const doc = document.querySelector('api-endpoint-doc')
    window.__counts = { docRenders: 0, mainSwaps: 0 }
    // #render() replaces the doc's children wholesale: one record per render.
    // The doc's own subtree is not watched — the try-it sync mutates it.
    new MutationObserver((records) => {
      window.__counts.docRenders += records.length
    }).observe(doc, { childList: true })
    // And the doc must stay the node it already is: re-mounting it re-renders it.
    new MutationObserver((records) => {
      window.__counts.mainSwaps += records.length
    }).observe(doc.parentElement, { childList: true })
  })

  await page.evaluate(() => {
    window.location.hash = `#/op/${encodeURIComponent('repos/update')}`
  })
  // The nested field is the proof the new operation rendered to the bottom.
  await expect(
    page
      .locator('main')
      .getByLabel('Try-it value for security_and_analysis.advanced_security.status'),
  ).toBeVisible()
  // Lets any straggling render land rather than pass by arriving first.
  await page.waitForTimeout(300)

  const counts = await page.evaluate(() => window.__counts)
  testInfo.annotations.push({ type: 'perf', description: JSON.stringify(counts) })
  expect(counts.docRenders, JSON.stringify(counts)).toBe(1)
  expect(counts.mainSwaps, JSON.stringify(counts)).toBe(0)
})

// The audit of that same schema produces tens of thousands of findings — 28k
// from a single rule. Rendering one row each is what made the page unreadable and,
// past a point, unscrollable: the report folds by rule, and only the rule rows
// plus one page of occurrences are ever in the DOM.
test('the audit of a heavy schema renders as rules, not as thousands of rows', async ({
  page,
}, testInfo) => {
  await watchLongTasks(page)
  const startedAt = Date.now()
  await page.goto(`${HEAVY_PAGE}#/audit`)
  const report = page.locator('audit-report')
  await expect(report.locator('h1')).toBeVisible()
  const renderedMs = Date.now() - startedAt

  const rows = await report.locator('li[data-rule-id]').count()
  const findings = await report.locator('[data-audit-finding]').count()
  const detail = `rendered=${renderedMs}ms rows=${rows} findings=${findings}`
  testInfo.annotations.push({ type: 'perf', description: detail })

  // One row per rule that fired, and nothing unfolded until asked — so the
  // findings in the DOM are only the rules that fired exactly once, whose row
  // is the finding itself.
  expect(rows, detail).toBeGreaterThan(0)
  expect(rows, detail).toBeLessThan(40)
  expect(findings, detail).toBeLessThanOrEqual(rows)

  // Expanding the largest group pays for one page of occurrences, not for the
  // whole group.
  const largest = report.locator('li[data-rule-id="property-described"]')
  await largest.locator('summary').click()
  expect(await largest.locator('[data-audit-finding]').count()).toBeLessThanOrEqual(50)
  // What is folded is still counted: nothing is dropped without saying so.
  await expect(largest.locator('[data-audit-more]')).toBeVisible()

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  expect(worst, `${detail} worstLongTask=${worst}ms`).toBeLessThan(MAX_BLOCKING_TASK_MS)
})

// A takeover home turns the landing view into a text fetch plus a markdown
// render, on the boot path this time — so the load budget above has to hold
// with one configured, and the render itself has to stay in the same class as
// the other post-boot interactions (docs/docs-pages.md §9).
test('a docs page opens within the budget, a takeover home included', async ({
  page,
}, testInfo) => {
  await watchLongTasks(page)

  const landedAt = Date.now()
  await page.goto(DOCS_HOME_PAGE)
  // The takeover page IS the landing view: usable means its prose is rendered
  // and the reference nav is there to leave by.
  await expect(page.locator('md-page h1')).toBeVisible()
  await page.locator('api-nav a[data-op-id]').first().waitFor({ state: 'attached' })
  const landingMs = Date.now() - landedAt

  const startedAt = Date.now()
  await page.locator('api-nav a[data-page-slug="pagination"]').click()
  // The tab group is the last thing built on this page: it proves the whole
  // decoration pass ran, not just the markdown parse.
  await expect(page.locator('md-page [data-code-tabs] [role="tab"]').first()).toBeVisible()
  const openedMs = Date.now() - startedAt

  const tasks = await longTasks(page)
  const worst = tasks.reduce((max, task) => Math.max(max, task.duration), 0)
  const detail = `landing=${landingMs}ms opened=${openedMs}ms worstLongTask=${worst}ms`
  testInfo.annotations.push({ type: 'perf', description: detail })

  expect(landingMs, detail).toBeLessThan(BUDGET_MS)
  expect(openedMs, detail).toBeLessThan(DOCS_PAGE_BUDGET_MS)
  expect(worst, detail).toBeLessThan(MAX_BLOCKING_TASK_MS)
})
