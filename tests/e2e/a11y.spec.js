import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import {
  THEMES_PAGE,
  clickNavOp,
  credentialsCard,
  expectResponded,
  gotoApp,
  gotoFixture,
  isMobileLayout,
  mockApi,
  openDrawerIfMobile,
  openEnvManager,
  openHistory,
  openTryItIfMobile,
  panelField,
  send,
  tryIt,
} from './helpers.js'
import { encodeSetupLink } from '../../src/env/setup-link.js'

// WCAG 2.1 A + AA, which is the level `docs/architecture.md` states as the
// target. `best-practice` is deliberately out: it flags stylistic rules
// (landmark counts, heading order across a doc generated from someone else's
// schema) that are not the contract we sign up to.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// `color-contrast` IS gated here, and the scope of that promise is exactly the
// two themes we author: the fixtures run on the `apiglow` pair (§4.1), which
// is what the default install shows, and every ratio the design layer produces
// on them clears 4.5:1. It cannot be a promise about the whole theme list —
// the app ships every standard daisyUI theme (rule 3) and a ratio fixed
// against `apiglow` says nothing about `dracula`. `contrast: false` is
// therefore for surfaces painted with someone else's colors, and nothing else;
// `docs/architecture.md` §12 states the split.
const DOCS_PAGE = '/tests/e2e/fixtures/app-docs.html'

// The sweep runs on `apiglow`, whatever theme the fixture it lands on declares
// — several of them predate the pair and still ask for stock `light`. Stating
// it here rather than editing twelve fixtures keeps the promise readable: the
// gated ratios are the ones the design layer produces, and a fixture's theme
// choice is about the feature it tests, not about this contract. A stored
// theme a fixture does not offer is ignored by the switcher, so the
// custom-theme install below still renders its own.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('apidoc:theme', JSON.stringify('apiglow'))
  })
})

function scan(page, { exclude = [], contrast = true } = {}) {
  const builder = new AxeBuilder({ page })
    .withTags(TAGS)
    .disableRules(contrast ? [] : ['color-contrast'])
  for (const selector of exclude) builder.exclude(selector)
  return builder.analyze()
}

// The failure message a bare `toEqual([])` produces is a wall of axe JSON.
// This keeps the rule id, the impact, the offending selectors and the one line
// of the check that explains itself — a contrast failure without its measured
// ratio sends the reader back into the JSON it was meant to replace.
function violationSummary(results) {
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.map((n) => `${n.target.join(' ')} — ${n.any?.[0]?.message ?? ''}`),
  }))
}

// Every scan waits for the transitions to land first. A daisyUI modal fades in
// from `opacity: 0`, and a contrast measured mid-fade is measured against a
// blend of the backdrop — it reports ratios no reader will ever see, and a
// different one on every run. The deadline is not a formality: a looping
// animation never resolves, and neither does one the compositor never starts.
const SETTLE_MS = 800

async function settle(page) {
  await page.evaluate(async (deadline) => {
    const running = document.getAnimations().map((a) => a.finished.catch(() => {}))
    await Promise.race([
      Promise.all(running),
      new Promise((resolve) => setTimeout(resolve, deadline)),
    ])
  }, SETTLE_MS)
}

async function expectNoViolations(page, options) {
  await settle(page)
  expect(violationSummary(await scan(page, options))).toEqual([])
}

test('home view has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await expectNoViolations(page)
})

// An install with custom themes injects a <style> and offers extra entries in
// the switcher: the sweep runs on the fixture's stock default theme, since the
// contrast of host-invented colors is the host's own responsibility — the one
// place `color-contrast` is off, for that reason and no other.
test('a custom-theme install has no accessibility violations', async ({ page }) => {
  await gotoFixture(page, THEMES_PAGE)
  await page.locator('theme-switcher summary').click()
  await expectNoViolations(page, { contrast: false })
})

// The pair, not just its light half: `apiglow-dark` is what a reader on a dark
// OS gets by default, and its ratios come from different tokens. One pass over
// the two surfaces that carry the most color — the nav's method badges and the
// doc — is enough to catch a token that only clears the floor on white.
test('the dark half of the pair holds the same contrast floor', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('apidoc:theme', JSON.stringify('apiglow-dark'))
  })
  await gotoApp(page)
  await expectNoViolations(page)
  await clickNavOp(page, 'listPets')
  await expect(page.locator('api-endpoint-doc h1')).toBeVisible()
  await expectNoViolations(page)
})

test('operation doc has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await expect(page.locator('api-endpoint-doc h1')).toBeVisible()
  await expectNoViolations(page)
})

test('try-it panel and its response have no accessibility violations', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await expect(tryIt(page).getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  await expectNoViolations(page)

  await send(page)
  await expectResponded(page)
  await expectNoViolations(page)
})

// Host-provided credentials add two surfaces to the cartouche (the "provided
// by the site" badge and the refresh button, docs/host-credentials.md §6), and
// they only exist on a page that registers a provider — the stock fixture
// would sweep right past them.
test('the host-credentials cartouche has no accessibility violations', async ({ page }) => {
  await gotoFixture(page, '/tests/e2e/fixtures/app-host-credentials.html')
  await clickNavOp(page, 'listPets')
  const card = credentialsCard(page)
  await expect(card).toContainText('Ready')
  await card.locator('summary').click()
  await expect(card.getByRole('button', { name: 'Refresh credentials' })).toBeVisible()
  await expectNoViolations(page)
})

test('history dialog has no accessibility violations', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expectResponded(page)
  await openHistory(page)
  await expect(page.locator('request-history-list .modal-box')).toBeVisible()
  await expectNoViolations(page)
})

test('settings panel has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('settings-panel .modal-box')).toBeVisible()
  await expectNoViolations(page)
})

// A patched schema (docs/user-overlay.md) adds two surfaces the stock fixture
// never renders: the header badge that discloses the patch, and the editor's
// dry-run report — which only exists once Check has run, so the scan waits for
// its results rather than sweeping an empty box.
test('the user-overlay badge and editor have no accessibility violations', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'apidoc:user-overlay',
      JSON.stringify({
        overlay: '1.1',
        info: { title: 'Local fixes', version: '1.0.0' },
        actions: [{ target: "$.paths['/pets'].get", update: { summary: 'Patched' } }],
      }),
    )
  })
  await gotoApp(page)
  await expectNoViolations(page)

  await page.getByRole('button', { name: 'Patched schema' }).click()
  await page.locator('settings-panel [data-user-overlay-check]').click()
  await expect(page.locator('settings-panel [data-user-overlay-report]')).toContainText('1 node(s)')
  await expectNoViolations(page)
})

// Scanned with results on screen, not empty: the candidates list is a
// radiogroup and the warnings a list, and neither exists before a paste.
test('import dialog has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await page.getByRole('button', { name: 'Import a request' }).click()
  await expect(page.locator('import-dialog .modal-box')).toBeVisible()
  await page.locator('import-dialog textarea').fill(`curl 'https://api.e2e.test/v1/pets/7'`)
  await expect(page.locator('import-dialog')).toContainText('Open in the try-it')
  await expectNoViolations(page)
})

// Scanned with the insight strip on screen: chips on the navy mockup are the
// one place in the panel whose colors sit outside the theme, and the countdown
// carries an aria-hidden twin of a static label.
test('the insight strip has no accessibility violations', async ({ page }) => {
  await mockApi(page, {
    headers: {
      'ratelimit-limit': '100',
      'ratelimit-remaining': '7',
      'ratelimit-reset': '30',
      etag: 'W/"pets-p1"',
      'x-request-id': 'req-42',
    },
  })
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(tryIt(page).locator('[data-insight-strip]')).toBeVisible()
  await expectNoViolations(page)
})

test('About dialog has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await page.locator('footer').getByRole('button', { name: 'About' }).click()
  await expect(page.locator('about-dialog .modal-box')).toBeVisible()
  await expectNoViolations(page)
})

test('schema audit page has no accessibility violations', async ({ page }) => {
  await gotoApp(page, '#/audit')
  await expect(page.locator('audit-report h1')).toBeVisible()
  await expectNoViolations(page)
})

// The two local-metrics surfaces at once: the endpoint strip and the overview
// card, both rendered from a history the send below puts there.
test('the local-metrics surfaces have no accessibility violations', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  await send(page)
  await expect(page.locator('main section#recent')).toBeVisible()
  await expectNoViolations(page)
  // The send refreshed the shared list, so the overview has its card as soon
  // as the route renders.
  await gotoApp(page, '#/overview')
  await expect(page.locator('main [data-most-used]').first()).toBeVisible()
  await expectNoViolations(page)
})

// The generated onboarding page: a preamble above an ordinary operation view,
// so what it adds on top of the sweep above is its own numbered steps.
test('the generated first-call page has no accessibility violations', async ({ page }) => {
  await gotoFixture(page, '/tests/e2e/fixtures/app-onboarding.html#/first-call')
  await expect(page.locator('main ol')).toBeVisible()
  await expectNoViolations(page)
})

test('scenario view has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.locator('api-nav a[data-scenario-id="onboarding"]').click()
  await expect(page.locator('api-scenario-view li[data-step-id]').first()).toBeVisible()
  await expectNoViolations(page)
})

test('webhook simulator has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.locator('api-nav a[data-op-id^="webhook-"]').first().click()
  // The simulator is the right-hand column, i.e. the sheet below lg.
  await openTryItIfMobile(page)
  await expect(page.locator('api-webhook-simulator')).toBeVisible()
  await expectNoViolations(page)
})

// The summary bar is rebuilt with its text already in place, which no screen
// reader announces: the shared region is what actually speaks.
test('a scenario run announces its verdict', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.locator('api-nav a[data-scenario-id="onboarding"]').click()
  await page.locator('api-scenario-view').getByRole('button', { name: 'Run all' }).click()
  await expect(page.locator('[data-live-region]')).toContainText(/steps succeeded/)
})

// The verdict alert arrives inside a container inserted whole, which is not
// reliably read: what the failure means has to reach the shared region too.
test('a failed send announces the diagnosis, not just the failure', async ({ page }) => {
  await gotoApp(page, '#/op/listPets')
  await send(page)
  await expect(page.locator('[data-live-region]')).toContainText(
    'Request failed at network level — no HTTP response was received. Most likely: the server is unreachable.',
  )
  // Scanned here rather than in a sweep of its own: the failure alerts are the
  // one surface where secondary text sits on a container that paints its own
  // ink (`text-quiet`), and they exist only after a send has gone wrong.
  await expectNoViolations(page)
})

test('the search palette is reachable by keyboard and returns focus on close', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  const opener = page.getByRole('button', { name: /Search the docs/ })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.locator('search-palette dialog')
  await expect(dialog).toBeVisible()
  await expectNoViolations(page)
  // The palette's own input takes focus, not the modal's first button.
  await expect(page.locator('search-palette input[type="search"]')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  // "Focus goes back to the opener" is only a question where the opener is
  // still on screen. Below lg it lives in the drawer, which the same Escape
  // closed, and re-opening the drawer would move focus itself — so the claim
  // is asserted on the desktop projects, which is where it can be true.
  if (!isMobileLayout(page)) await expect(opener).toBeFocused()
})

// The design layer's motion is a taste; `prefers-reduced-motion` is an answer
// to it. The palette is the check worth having: its movement is daisyUI's own
// (the modal box slides and scales in, guarded by nothing), so a regression
// here would come from the library, silently, on the dialog opened most.
test('a reader who asked for less motion gets the state without the movement', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.getByRole('button', { name: /Search the docs/ }).click()
  const box = page.locator('search-palette dialog .modal-box')
  await expect(box).toBeVisible()
  const motion = await box.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      properties: style.transitionProperty,
      translate: style.translate,
      scale: style.scale,
    }
  })
  // The fade survives — it is what says "this arrived". The two others are
  // pinned at their neutral value, which is what the box animates away from
  // when the guard is off ('none' would mean daisyUI stopped setting them).
  expect(motion.properties).toBe('opacity')
  expect(motion.translate).toBe('0px')
  expect(motion.scale).toBe('1')

  // Both sides of the guard, on the same page: without the second half, a
  // selector that matched nothing would pass this test by accident.
  const rail = page.locator('api-nav .menu li > a').first()
  const railMotion = () => rail.evaluate((el) => getComputedStyle(el).transitionProperty)
  expect(await railMotion()).toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await railMotion()).toContain('box-shadow')
})

// Roving tabindex: the response tab bar is a single Tab stop, arrows move
// inside it. Ten declared status codes must not cost ten Tab presses.
test('response tabs answer to arrow keys', async ({ page }) => {
  await gotoApp(page)
  await clickNavOp(page, 'listPets')
  const tabs = page.locator('api-endpoint-doc [role="tablist"] [role="tab"]')
  // `count()` does not retry: the doc renders after the nav click.
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  const count = await tabs.count()
  expect(count).toBeGreaterThan(1)
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1')

  await tabs.first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.first()).toHaveAttribute('tabindex', '-1')
  // Wraps around, as the APG pattern prescribes.
  await page.keyboard.press('End')
  await expect(tabs.nth(count - 1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tabs.first()).toBeFocused()
})

// A blocked send is announced and lands the user on the field that blocked it,
// instead of leaving them at the bottom of the panel with a red box.
test('a blocked send announces the reason and focuses the offending field', async ({ page }) => {
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'getPet')
  const idField = panelField(page, 'petId')
  await idField.fill('{{nope}}')
  await send(page)
  await expect(tryIt(page).locator('.alert-error')).toContainText('nope')
  await expect(idField).toBeFocused()
  await expect(page.locator('[data-live-region]')).toContainText('nope')
})

// Three interactive surfaces the sweep above never opens. Their absence was
// structural — axe only sees what is on the page when it runs — not the
// documented color-contrast waiver.

test('the environment manager has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await openEnvManager(page)
  await expectNoViolations(page)
})

// Both halves of the setup link (docs/env-setup-link.md): the dialog that
// builds one, and the preview that lands one. The preview is the only
// surface of the app a stranger's URL can open, which is a reason to hold it
// to the sweep rather than to trust it.
test('sharing an environment as a link has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await openEnvManager(page)
  await page.locator('env-manager [data-env-share]').click()
  await page.locator('env-share-dialog [data-setup-pick="auth.bearerAuth"]').check()
  await expectNoViolations(page)
})

// The third surface of the feature (§3.5): a form, which is where labelling
// gaps hide — every field of it is built by hand.
test('the setup link builder has no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await page.locator('[data-setup-builder-open]').click()
  await page.locator('env-setup-builder [data-setup-field="envName"]').fill('Team staging')
  // With a row of each kind: the empty form carries none of the controls that
  // matter here (the sensitive toggle, the reveal button, the remove button).
  await page.locator('env-setup-builder [data-setup-add-row="variable"]').click()
  await page.locator('env-setup-builder [data-setup-add-row="header"]').click()
  await page.locator('env-setup-builder [data-setup-sensitive]').check()
  await expectNoViolations(page)
})

test('the setup link preview has no accessibility violations', async ({ page }) => {
  const encoded = encodeSetupLink({
    name: 'Staging',
    baseUrl: 'https://api.e2e.test/staging',
    color: 'amber',
    variables: [
      { name: 'auth.bearerAuth', value: 'a-token', sensitive: true },
      { name: 'tenant', value: 'acme', sensitive: false },
    ],
    defaultHeaders: [{ name: 'X-Tenant', value: 'acme' }],
  })
  await gotoApp(page, `#/?setup=${encoded}`)
  await expect(page.locator('env-setup-dialog .modal-box')).toBeVisible()
  await expectNoViolations(page)
})

test('the scenario step editor has no accessibility violations', async ({ page }) => {
  // Chaining and checks are edited on LOCAL scenarios only, so the surface has
  // to be reached the way a user reaches it: capture a request into a new one.
  await mockApi(page)
  await gotoApp(page)
  await clickNavOp(page, 'getPet')
  await panelField(page, 'petId').fill('42')
  await tryIt(page).locator('[data-scenario-capture]').first().locator('summary').click()
  await tryIt(page).locator('[data-scenario-target="new"]').click()
  // A freshly captured step opens its editor by itself — that is the state a
  // user meets it in.
  const editor = page.locator('api-scenario-view [data-step-editor]').first()
  await expect(editor).toHaveAttribute('open', '')
  await expect(editor.locator('[data-chain-pane]').first()).toBeVisible()
  await expectNoViolations(page)
})

test('the search palette results have no accessibility violations', async ({ page }) => {
  await gotoApp(page)
  await openDrawerIfMobile(page)
  await page.getByRole('button', { name: /Search the docs/ }).click()
  await page.locator('search-palette input[type="search"]').fill('pet')
  // The empty palette is already swept above; what matters here is the list it
  // builds from the query — options, active descendant, and the keyboard
  // contract that goes with them.
  await expect(page.locator('search-palette [data-result-id]').first()).toBeVisible()
  await expectNoViolations(page)
})

// Docs pages (docs/docs-pages.md §8) bring their own surfaces: collapsible nav
// groups, external links, a code tablist, operation cards, and two <nav>
// landmarks per page. One fixture page exercises all of them at once, so the
// sweep grows with the feature rather than beside it.
test('a docs page exercising every feature has no accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoFixture(page, DOCS_PAGE)
  // The takeover home: enriched links, operation cards, ToC, prev/next.
  await expectNoViolations(page)

  // A page carrying callouts and a code tab group. The fixture also declares
  // `feedback.url`, so the verdict row rides every one of these sweeps.
  await page.locator('api-nav a[data-page-slug="pagination"]').click()
  await expect(page.locator('md-page [data-code-tabs] [role="tab"]').first()).toBeVisible()
  await expectNoViolations(page)

  // The changelog timeline, with its code header and its ToC tracking.
  await page.goto(`${DOCS_PAGE}#/page/changelog`)
  await expect(page.locator('md-page .md-changelog h2').first()).toBeVisible()
  await expectNoViolations(page)

  // The three variable states at once (docs-pages §12.4): a resolved value is
  // plain text, a masked chip names itself through role="img", a missing one
  // is a real button.
  await page.goto(`${DOCS_PAGE}#/page/variables`)
  await expect(page.locator('md-page [data-var-missing]').first()).toBeVisible()
  await expectNoViolations(page)

  // Groups open and closed are two different trees.
  await page.goto(DOCS_PAGE)
  await page.locator('api-nav [data-collapse-groups]').click()
  await expectNoViolations(page)
})

test('the code tablist is one tab stop, arrows moving within it', async ({ page }) => {
  await gotoFixture(page, `${DOCS_PAGE}#/page/pagination`)
  const tabs = page.locator('md-page [data-code-tabs]').first().locator('[role="tab"]')
  await tabs.first().focus()
  // Roving tabindex: only the selected tab is reachable by Tab.
  await expect(tabs.first()).toHaveAttribute('tabindex', '0')
  await expect(tabs.nth(1)).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(1)).toBeFocused()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'false')
})
