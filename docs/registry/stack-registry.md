# Stack registry — the pinned platform, against what is published

Maintained by the `/upgrade-code` skill
(`.claude/skills/upgrade-code/SKILL.md`). The auditable extension of
CLAUDE.md's "Stack (pinned)" section: one row per dependency and per
platform dimension. Every `/upgrade-code` run reads this file first and
updates it last. `Latest known` is only ever written from a source fetched
during a run — `—` means never checked online yet — and each row's pin was
judged against the version that column records.

At these pins `npm outdated` returns **empty** — every dependency sits at
its latest published version, and every specifier is exact.

**Active plan**: none

## App scope — runtime deps shipped in the bundle (architecture.md §14.2: open for spec/format work)

Ritual common to every row: exact pin, `src/credits.js` updated, bundle-
size delta on `dist/app.js` measured and reported.

**The credits coupling has two guards, and only one is automatic**:
`tests/credits.test.js` compares `src/credits.js`
against `package.json`, so it goes green by itself once both move — but
`tests/e2e/about.spec.js:35-44` **hard-codes** every bundled version and
must be edited by hand. This applies to the daisyUI and Tailwind rows in
the build table below as much as to the four app rows, because both are
bundled credits.

| Dependency | Pinned | Latest known | Source of truth | Ritual specifics |
|---|---|---|---|---|
| @apidevtools/json-schema-ref-parser | 15.5.1 | 15.5.1 | npm + github.com/APIDevTools/json-schema-ref-parser/releases | `undici` stays external in `vite.config.js` (Node-only path) |
| dompurify | 3.4.13 | 3.4.13 | npm + github.com/cure53/DOMPurify/releases | sanitizer behavior is a product feature — read release notes for sanitization changes, re-run the XSS e2e. That e2e is **not a spec file**: the coverage is `tests/e2e/bootstrap.spec.js:54` |
| highlight.js | 11.11.1 | 11.11.1 | npm + github.com/highlightjs/highlight.js (CHANGES.md) | rendering snapshots may legitimately move — deliberate review |
| marked | 18.0.9 | 18.0.9 | npm + github.com/markedjs/marked/releases | ditto; DOMPurify downstream absorbs output changes but review anyway |

## Build scope — toolchain, Node, CI

| Dependency / dimension | Pinned | Latest known | Source of truth | Ritual specifics |
|---|---|---|---|---|
| vite | 8.2.1 | 8.2.1 | npm + vite.dev/releases | verify single-file `dist/app.js`, `import.meta.url` asset resolution (rule 4), `undici` external; full e2e on the packed tarball |
| tailwindcss + @tailwindcss/vite | 4.3.3 | 4.3.3 | npm + github.com/tailwindlabs/tailwindcss/releases | diff the built CSS (purge behavior); full e2e; **also a bundled credit** — `src/credits.js` version moves with it |
| daisyui | 5.7.16 | 5.7.16 | npm + daisyui.com/docs/changelog | **the suites are the acceptance — see "The daisyUI ritual is test-first" below**; re-sync the pinned skill (`skills-lock.json` hash); rule 3 — **35** `[data-theme=…]` blocks in the built CSS, the number to re-check; **also a bundled credit** — `src/credits.js` version moves with it |
| @biomejs/biome | 2.5.7 | 2.5.7 | npm + biomejs.dev/blog | `npx biome ci`; newly-recommended rules fixed in the bump session |
| vitest + @vitest/coverage-v8 | 4.1.10 | 4.1.10 | npm + github.com/vitest-dev/vitest/releases | suites green |
| @playwright/test | 1.62.1 (exact) | 1.62.1 | npm + playwright.dev/docs/release-notes | e2e green; browser image bump may shift screenshots |
| @axe-core/playwright | 4.12.1 (exact) | 4.12.1 | npm + github.com/dequelabs/axe-core-npm/releases | new a11y findings triaged into the session, not silenced |
| fake-indexeddb | 6.2.5 (exact) | 6.2.5 | npm | store unit tests green |
| Node | 24 (`.nvmrc`) | 24.19.0, line is LTS | nodejs.org/en/about/previous-releases | `.nvmrc` pins the major only, so it floats on the line — no drift row unless the line leaves LTS. Local + CI move together (CI reads `.nvmrc`); e2e re-run |
| npm | 12.0.1 (local, unpinned) | 12.0.2 | github.com/npm/cli/releases | **held unpinned** — see Holds |
| CI actions | checkout@v7, setup-node@v7, upload-artifact@v7 | v7.0.1 / v7.0.0 / v7.0.1 | github.com/actions/*/releases | pinned at the major, so patch releases are not drift; CI green |
| daisyUI skill pin | `skills-lock.json` hash **af4e257f…** | matches upstream `master` | github.com/saadeghi/daisyui (skills/) | follows the daisyui row, never checked alone. The skill declares `version: 5.7.x`, so it spans the whole 5.7 line — a patch bump inside it needs no skill change. `computedHash` is a plain sha256 of the raw `SKILL.md` — `sha256sum .claude/skills/daisyui/SKILL.md` reproduces it exactly, so the lock is verifiable without the installer |

### The daisyUI ritual is test-first

**Green e2e and front-end suites are the acceptance for a daisyUI bump.**
Do not open the changelog to pre-justify every rule of the built-CSS
diff: that analysis is the *debugging* step, and it is owed only when
something actually fails.

- **Normal path** — bump, rebuild, run the suites, check rule 3's theme
  count. Green: the session is accepted, and the CSS diff needs no
  line-by-line account.
- **Failure path** — a red spec, a visibly wrong render, or a theme count
  that moved. *Then* diff the built CSS against the previous build and
  trace each chunk to a changelog entry.

Rationale: daisyUI patch releases are CSS-only bug-fix batches — an
exhaustive trace of one patch span (5.7.9 → 5.7.16) found every chunk to
be a published fix and every no-diff entry a purged utility. The suites
already cover what a user would notice, including the a11y sweep and the
perf budgets. Paying for a full changelog reconciliation on every patch
buys certainty the tests already give.

This is deliberately **narrower than the generic dep ritual**, which
still holds elsewhere: an unexplained diff blocks a `dompurify`, `marked`
or `vite` session. Reopens if a daisyUI bump ever ships a behavior change
the suites miss — that would mean the guard net, not the ritual, is what
needs work (route it to `app-health`).

## Platform scope — browser APIs, JS language, targets

| Dimension | Current | Latest known | Source of truth | Notes |
|---|---|---|---|---|
| Browser-support policy | **Baseline *Widely available*** — `docs/architecture.md` §14.15 | — | web-platform-dx Baseline | §14.15 is the arbiter: *newly available* is a watch state, not a green light; no polyfills; `es2022` moves only when code wants the syntax |
| JS build target | `es2022` (`vite.config.js:70`) | left at `es2022` | Baseline / caniuse per feature | raising it needs every target browser per the policy **and** syntax the code actually wants — no session needs ES2023+ today |
| Adoptable platform features | n/a (watch) | **0 adoptable** of the 17 that went *widely available* up to the June 2026 Baseline digest | Baseline monthly digests (web.dev/blog/baseline-digest-*) | `URL.canParse()` examined and rejected — all 7 `new URL()` try/catch sites consume the parsed object, so it would double-parse. Watch: `contrast-color()` (*newly* available as of the April 2026 digest) vs the `color-contrast` waiver, `docs/architecture.md:1190` |

## Recorded findings (unplanned — a run must plan or hold each)

*No unplanned findings.*

## Holds

Version gaps deliberately kept, with the user's validation and a
rationale; re-checked every run that the rationale still holds.

- **npm — unpinned**: the project takes whatever npm ships with the
  `.nvmrc` Node (24 → npm 12.x). No `engines`, no `packageManager`.
  Pinning a second toolchain version buys nothing for a library that
  consumers install rather than build, and it would add a drift row for
  every npm patch. Reopens if a build or `npm ci` ever breaks on an npm
  minor.

<!-- Template:
- **{row} — held at {version}**: {why not upgrading now beats upgrading;
  what event reopens the question}.
-->
