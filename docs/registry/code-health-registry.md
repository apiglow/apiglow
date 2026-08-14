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
path, and altitude findings enter plans as `structural`. Wasted work
currently reads empty (its one recorded instance left the code); altitude
read below bar until its recorded reopen condition fired — the proof the
rows earn their keep by holding instances the next run compares against.

Perimeter at these baselines: `src/` **214** `.js` files /
**40 903** lines; unit tests 94 files / **1642** tests green; e2e 45
specs; `biome check` 388 files, 0 diagnostics.

**Active plan**: `docs/upgrade/code.20260814-1631.md`

| Dimension | Detector | Baseline | Severity |
|---|---|---|---|
| Dead exports | `npm run health:exports` | **0 dead**, **13 module-private** (measured this run; session 1 of the active plan drops the keywords), **37 test-only** (accepted), of 629 exports | low — planned |
| Dead i18n keys | `npm run health:i18n` | **0** of 1100 keys; `en`/`fr` both 1100, 0 missing, 0 extra | none — hold it |
| Orphan files | `npm run health:orphans` | **0** — 214/214 of `src/` reachable from `src/app.js` + `scripts/bake.mjs` | none — hold it |
| Unused deps / scripts | manual | **0** — all 13 devDeps and 26 npm scripts referenced (re-verified this run: `es-check` → `check:syntax`, `browserslist-to-esbuild` + `@fontsource-variable/source-serif-4` → `vite.config.js`, `@vitest/coverage-v8` → `test:coverage`) | none — hold it |
| Duplication | `npm run health:svg` | **0** duplicate SVG bodies — 55 distinct icons in **1** file (`components/icons.js`). The 3 remaining near-pairs (`COPY_SVG`/`COPY_SVG_SM`, the 3 `CHECK_*`, `CHEVRON`/`CARET`) are the same path at different sizes/weights: a design choice, not debt. Modal-dismiss preambles, `downloadText`, e2e `goto`/`openSettings` and `fakeLocalStorage` all factored. The RFC 6901 escape hand-rolled beyond `scenarios/pointer.js` (re-verified this run at 9 sites in 8 files) is session 2 of the active plan — the collapse onto the existing module the row always called for | low — planned |
| Size / complexity | `npm run health:size` | files > 800 lines, **6** of 214: `app.js` **2066** (`appLayout()` ~1700 lines, app.js:186→~1890 — split planned, session 6 of the active plan, needs-go), `api-try-it-panel.js` **1707**, `model.js` **1220**, `api-endpoint-doc.js` **1211**, `api-scenario-view.js` **1096**, `settings-panel.js` **845** (all but app.js accepted, see Accepted thresholds). `src/` total **40 903** lines. Detector caveat: the longest-function pass mis-parses object-literal getters (`get source()` at app.js:323, 3 lines, reported as 656) — session 4 fixes it | medium — planned |
| Idiom drift | `npm run health:svg` (sizing arm) + manual sweep | **0 bypassed shared helpers** — the in-panel alert/label helpers all live in `try-it/view-bits.js`, call sites naming the colour as a static literal. **0** `h-4 w-4` sites (all `size-*`). **Text de-emphasis** (architecture.md §14.16 — a secondary level is a colour, never an opacity; the rule is what keeps the AA floor computable, and that floor is a documented waiver, so a reintroduced dimmer breaks contrast with no gate noticing): **0** text-bearing `opacity-*` sites — `grep -rn "opacity-\|text-[a-z-]*/[0-9]" src/ --include='*.js'` returns 4 `opacity-*`, all decoration (`icons.js:54,143,155` SVG glyphs, `api-nav.js:220` an icon-only ghost button), which the rule does not cover. **2** sites spell a token's own ratio inline instead of using it: `shell/views.js:369` and `api-nav.js:216` carry `text-base-content/70`, which *is* `text-subtle` — session 3 of the active plan. `api-endpoint-doc.js:551` `text-base-content/30` (below the floor on a hover-revealed glyph button) is a design/a11y decision, routed to the user via the plan's Routed findings, not a cleanup. *Not* debt: the `text-white/50…/80` scale in the fixed navy panel and the webhook simulator — that is §14.16's third level, and `text-quiet` mixes `currentColor` at one 75 % ratio, so it cannot express a graded scale. *Not* debt: 34 `console.error` (uniform `[api-doc]` prefix), 20 non-literal `t()` calls (legitimate dynamic keys) | low |
| Defensive / dead branches | manual sweep | **clean**: 0 TODO/FIXME/HACK/XXX in `src/` and `tests/`, 0 back-compat shims; only the two `DB_VERSION = 2` dev-profile constants (accepted below) | very low |
| Test code health | manual sweep | e2e `helpers.js` adopted by **42/45** specs (`inline-spec`, `perf` and `bake` abstain by design — `bake` drives the baked static fixtures, not the app); unit: one shared storage double, `fake-indexeddb/auto` hoisted into `vitest.config.js` `setupFiles` (0 per-file imports) | low |
| CSS | `npm run health:css` | **0 orphans** of 55 class selectors in `src/styles/app.css`; the 26 `hljs-*` are emitted by highlight.js at runtime and allowlisted in the detector | none — hold it |
| Wasted work | manual sweep | **0 instances.** The previously recorded one — the per-header `authNames` rebuild inside try-it `#refresh()` — is gone from the code (no `authNames` in `src/`; the one `security.schemes.find()` left is a memoized getter at `api-try-it-panel.js:448`). Clean: `api-nav.js:70` `set route` calls `#highlight()`, never `#renderList()`; **0** `JSON.parse(JSON.stringify())` in `src/`; the `structuredClone` sites are load-path and each is required (ref-parser mutates its input) | none — hold it |
| Altitude / special-casing | manual sweep | **Reopened, as the row predicted** ("reopens at a fifth site"): hand-rolled `alert alert-*` construction now at ~20 sites outside `view-bits.js:73` `alertBox` — the helper bakes in `text-xs py-2`, a span-wrapped message and `role="alert"`, so every site needing another size, `alert-soft`, extra layout classes or non-span children dodges it (site list in the active plan, session 5, needs-go). Still cleared: `openModal` (0 raw `showModal()`), `announce`, `request-history-list.js` `responseBody` (a different affordance, correctly separate) | medium — planned |

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

- **37 test-only exports** (accepted, user-validated at 37 — was 31; of
  629 total exports): exports whose only consumers are unit tests are the
  sanctioned way to test the pure core without a build-time test-api
  layer. The six newcomers track the recent feature waves (user-overlay
  ×2, docs/pages, site-layout, maintenance inventory, docs/operations) —
  the same pattern, not production code losing its last consumer. Tracked
  so the count stays deliberate.
- **Two `DB_VERSION = 2` dev-profile constants** (`storage/history.js:12`,
  `storage/schema-snapshot.js:12`): resetting them to 1 raises
  `VersionError` on any browser profile that already holds a v2 database —
  the dev profile does. Both sites already document exactly this at the
  constant. The rename plan keeps the `apidoc` DB prefix (architecture.md
  §14.11), so no rename will clear it either. Reopens if either store's
  schema actually changes — the version bumps then anyway.
- **`model.js` (1220 l) and `api-scenario-view.js` (1096 l) over the
  800-line mark** (accepted): both were read and judged **coherent** —
  one concern each, no extractable seam that would not just move lines
  behind an import. They stay in the `health:size` output as information,
  not as a target. Both grew with their own concern since the judgment;
  reopens if either gains a second one.

- **`api-try-it-panel.js` (1707 l), `api-endpoint-doc.js` (1211 l) and
  `settings-panel.js` (845 l) over the 800-line mark** (accepted,
  user-validated this run — the same run that planned the `app.js` split
  and chose not to split these): the panel is the canonical structural
  case and stays one component on purpose (rule 20 makes it the single
  source of truth the doc mirrors); the doc and settings panels grew with
  the features they render (user-overlay editor at
  `settings-panel.js` `#userOverlaySection`). Reopens if any of the three
  crosses 2000 lines, or gains a concern that is not its own rendering.

<!-- Template:
- **{dimension} — {debt}**: {why living with it beats fixing it; what
  would reopen the question}.
-->
