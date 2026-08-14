# Code health registry — debt dimensions and their baselines

Maintained by the `/code-health` skill (`.claude/skills/code-health/SKILL.md`).
One row per debt dimension. Every `/code-health` run re-measures each row
and compares to `Baseline`; above baseline = new debt = a plan session.
Baselines only tighten through actual cleanup — never loosen silently
(an accepted threshold carries the user's validation and a rationale).

Deliberate design choice: **no detector gates CI** — debt is
measured at `/code-health` runs only. Every dimension a script can judge
is wired as a `health:*` npm script; `npm run health` runs all six in
one pass. The six rows still reading `manual` are the ones no cheap
script judges honestly (idiom drift, dead defensive branches, test-code
health, unused deps, wasted work, altitude) — they stay a reading sweep.

The wasted-work and altitude rows exist to close a coverage gap against
`/simplify`: its efficiency and altitude angles have their recurring
counterpart here, so those defects are findable by the audit, not only
while reviewing a diff. Their bar is deliberately narrow (see the skill's
**The bar**): wasted work counts only on a hot, startup, or budget-covered
path, and altitude findings enter plans as `structural`. Both rows read
below bar but not empty — the instances are recorded in their rows so the
next run compares against something real.

Perimeter at these baselines: `src/` **172** `.js` files /
**29 322** lines; unit tests 67 files / **1002** tests green; e2e 34
specs; `biome check` 302 files, 0 diagnostics.

**Active plan**: none

| Dimension | Detector | Baseline | Severity |
|---|---|---|---|
| Dead exports | `npm run health:exports` | **0 dead**, **0 module-private**, **31 test-only** (accepted), of 437 exports | none — hold it |
| Dead i18n keys | `npm run health:i18n` | **0** of 804 keys; `en`/`fr` both 804, 0 missing, 0 extra | none — hold it |
| Orphan files | `npm run health:orphans` | **0** — 172/172 of `src/` reachable from `src/app.js` | none — hold it |
| Unused deps / scripts | manual | **0** — all 10 devDeps and 16 npm scripts referenced | none — hold it |
| Duplication | `npm run health:svg` | **0** duplicate SVG bodies — 46 distinct icons in **1** file (`components/icons.js`). The 3 remaining near-pairs (`COPY_SVG`/`COPY_SVG_SM`, the 3 `CHECK_*`, `CHEVRON`/`CARET`) are the same path at different sizes/weights: a design choice, not debt. Modal-dismiss preambles, `downloadText`, e2e `goto`/`openSettings` and `fakeLocalStorage` all factored. **Open** (a spec-code inventory consequence, `docs/openapi-coverage.md` §6): the RFC 6901 escape (`~1` before `~0`, order-sensitive) is hand-rolled in **8** files — `scenarios/pointer.js`, `audit/pointer.js`, `audit/rules/discriminator-mapping.js`, `import/arazzo.js` (`unescapeToken`), `scenarios/inspect.js`, plus the decode side in `openapi/model.js` (×2), `openapi/swagger2.js` and `openapi/deref.js` — where `scenarios/pointer.js` already exports `pointerFrom`/`resolvePointer`. Not a dependency question (the inventory keeps the in-house pointer): a collapse onto the existing module | low |
| Size / complexity | `npm run health:size` | files > 800 lines, **5** of 172: `api-try-it-panel.js` **1478**, `app.js` **1404**, `api-endpoint-doc.js` **1158**, `model.js` **1085**, `api-scenario-view.js` **951**. The worst nesting is gone — `appLayout()` at **1112** lines, **19** nested declarations. `src/` total **29 322** lines | medium |
| Idiom drift | `npm run health:svg` (sizing arm) + manual sweep | **0 bypassed shared helpers** — the in-panel alert/label helpers all live in `try-it/view-bits.js`, call sites naming the colour as a static literal. **0** `h-4 w-4` sites (all `size-*`). **Text de-emphasis** (architecture.md §14.16 — a secondary level is a colour, never an opacity; the rule is what keeps the AA floor computable, and that floor is a documented waiver, so a reintroduced dimmer breaks contrast with no gate noticing): **0** text-bearing `opacity-*` sites — `grep -rn "opacity-\|text-[a-z-]*/[0-9]" src/ --include='*.js'` returns 4 `opacity-*`, all decoration (`icons.js:54,143,155` SVG glyphs, `api-nav.js:220` an icon-only ghost button), which the rule does not cover. **3** sites spell a token's own ratio inline instead of using it: `shell/views.js:369` and `api-nav.js:216` carry `text-base-content/70`, which *is* `text-subtle`, and `api-endpoint-doc.js:551` `text-base-content/30` sits below the floor on a hover-revealed glyph button. *Not* debt: the `text-white/50…/80` scale in the fixed navy panel and the webhook simulator — that is §14.16's third level, and `text-quiet` mixes `currentColor` at one 75 % ratio, so it cannot express a graded scale. *Not* debt: 34 `console.error` (uniform `[api-doc]` prefix), 20 non-literal `t()` calls (legitimate dynamic keys) | low |
| Defensive / dead branches | manual sweep | **clean**: 0 TODO/FIXME/HACK/XXX in `src/` and `tests/`, 0 back-compat shims; only the two `DB_VERSION = 2` dev-profile constants (accepted below) | very low |
| Test code health | manual sweep | e2e `helpers.js` adopted by **30/32** specs (`inline-spec` and `perf` abstain by design), **39** local helpers left, all spec-specific; unit: one shared storage double, `fake-indexeddb/auto` hoisted into `vitest.config.js` `setupFiles` (0 per-file imports) | low |
| CSS | `npm run health:css` | **0 orphans** of 55 class selectors in `src/styles/app.css`; the 26 `hljs-*` are emitted by highlight.js at runtime and allowlisted in the detector | none — hold it |
| Wasted work | manual sweep | **1 instance, 0 above bar.** Swept the hot paths no perf budget watches (budget-covered ones route to `app-health`): try-it `#refresh()` — 21 call sites, runs per keystroke — recomputes a loop-invariant inside a per-header `filter` at `api-try-it-panel.js:1354-1358` (`security.schemes.find()` + the `authNames` array rebuilt for every header). Real, but ≤20 headers × ≤5 schemes is not felt: recorded, not planned. Clean: `api-nav.js:70` `set route` calls `#highlight()`, never `#renderList()`; **0** `JSON.parse(JSON.stringify())` in `src/`; the 7 `structuredClone` sites are load-path and each is required (ref-parser mutates its input) | low |
| Altitude / special-casing | manual sweep | **1 instance, 0 above bar.** Four page-level alerts hand-roll the `el('div','alert alert-X',…)` + `role="alert"` incantation around `view-bits.js:73` (`shell/views.js:26,241`, `md-page.js:55`, `api-scenario-view.js:150`) — the shared helper bakes in `text-xs py-2`, so it cannot serve them without changing how they render, and two add a layout wrapper. Too narrow a parameterization, but 4 sites with genuinely different output is not yet debt. Reopens at a fifth site, or if the alert sizing is ever unified. Cleared: `openModal` (7 uniform sites, 0 raw `showModal()`), `announce` (17 uniform sites), `request-history-list.js:560` `responseBody` (a different affordance — collapse/expand, `prettyJson` re-indent — correctly kept separate from `view-bits.js:89`). The webhook simulator's alert needs are served by the shared helper, which already takes the colour — see the Idiom drift row | low |

## Positive baselines (don't regress)

Dimensions found clean whose discipline is worth naming, because drift
here is what the sweep step watches for:

- **Shared helpers with full adoption**: `icons.js` (15 importers, one
  home for all 46 inline SVGs), `dom.js` `el`/`text` (46 importers),
  `detailsDropdown` (10), `openModal` (8, and **0** raw `showModal()`
  anywhere), `modalDismiss` (7), `announce`/`wireTablist` (12).
- **Storage discipline**: every `localStorage` access via
  `storage/prefs.js`; the two exceptions (`maintenance.js` erase and
  inventory paths, `oauth-flow.js` sessionStorage) document themselves at
  both ends. Every other mention in `src/` is a comment.
- **Single sanitize path**: DOMPurify only via `markdown.js`; no
  hand-rolled `escapeHtml` anywhere.
- **No pre-prod fallbacks**: the no-users rule holds in the code
  (`history.js:11` even states it).
- **i18n discipline**: 804 keys, `en`/`fr` in exact sync, zero dead keys,
  zero call sites passing a non-key.
- **Uniform log prefix**: all 34 `console.error` calls carry `[api-doc]`.
- **One-way module layering**: `schema-view.js` → `schema-editors.js`,
  never the reverse; `tryit-edit` is emitted only from the editor side
  (rule 20). The same shape holds for `src/shell/` and
  `src/components/try-it/`.
- **A split publishes only what crosses it**: the extracted modules
  (`shell/panels.js`, `shell/views.js`, `try-it/body-state.js`,
  `schema-editors.js`) export exactly the symbols their importers name,
  nothing more. Publishing more than the importers name is the failure
  mode `health:exports` exists to catch.
- **`view-bits.js` is the one home for the in-panel alert**: 3 importers
  (`api-try-it-panel.js`, `try-it/response-view.js`,
  `api-webhook-simulator.js`), 0 private copies anywhere.

**An extraction must sweep the siblings.** A session that moves helpers
into a shared module must also ask "who else already had this?" — a
pre-existing private copy outside the diff is invisible to every detector
(`health:exports` counts dead exports, not live duplicates of a live one)
and to any diff-scoped `/simplify`, which never reads the third file. Only
the recurring sweep finds it, which is the argument for the sweep step
existing at all. When a structural session extracts a helper, its
acceptance should include a grep for the helper's name across `src/`.

## Accepted thresholds

Debt the user has explicitly accepted, with rationale; re-checked each
run that the rationale still holds.

- **31 test-only exports** (accepted; of 437 total exports): exports whose
  only consumers are unit tests are the sanctioned way to test the pure
  core without a build-time test-api layer. Tracked so the count stays
  deliberate — a jump means production code stopped using something, not
  that testing got better.
- **Two `DB_VERSION = 2` dev-profile constants** (`storage/history.js:12`,
  `storage/schema-snapshot.js:12`): resetting them to 1 raises
  `VersionError` on any browser profile that already holds a v2 database —
  the dev profile does. Both sites already document exactly this at the
  constant. The rename plan keeps the `apidoc` DB prefix (architecture.md
  §14.11), so no rename will clear it either. Reopens if either store's
  schema actually changes — the version bumps then anyway.
- **`model.js` (1085 l) and `api-scenario-view.js` (951 l) over the
  800-line mark** (accepted): both were read and judged **coherent** —
  one concern each, no extractable seam that would not just move lines
  behind an import. They stay in the `health:size` output as information,
  not as a target. Reopens if either grows a second concern.

<!-- Template:
- **{dimension} — {debt}**: {why living with it beats fixing it; what
  would reopen the question}.
-->
