# Custom themes

Status: **implemented**. This document is the functional source of truth
for the custom-theme feature, alongside
[`architecture.md`](architecture.md) §5.9 — which carries the summary, this
one the design record and the cascade traps.

## 1. What this is

A way for the host developer to brand the docs with their own daisyUI
theme — their colors, radii, and surface style — **without any build
step**, consistent with the CDN install model (§3 of architecture.md).

Two channels, by design:

1. **Config JSON** (primary DX): `theme.custom[]` entries next to
   `theme.default`/`theme.available`; the app generates and injects the
   corresponding CSS at boot.
2. **Host CSS** (escape hatch, zero app code): a `[data-theme="name"]`
   variable block in the host page's own CSS, plus the name listed in
   `theme.available`. This works mechanically; the feature work here is
   documentation and tests.

Both exist because a daisyUI 5 theme is *nothing but* a block of CSS
custom properties scoped to a `data-theme` selector — the entire feature
is runtime CSS generation, no rebuild, no new dependency.

## 2. Product decisions (settled)

Revisiting one means revisiting this section.

1. **Hybrid channel.** Config JSON is the documented main path; the
   host-CSS path is documented as the escape hatch since it costs nothing.
2. **`extends` supported.** A custom theme may inherit any **built-in**
   daisyUI theme and override only some tokens — the primary real-world
   use case ("dark, but in my brand colors"). Extending another custom
   theme is out of scope.
3. **Full daisyUI token surface.** Colors *and* radii, base sizes, border
   width, `depth`, `noise`, `color-scheme` — exactly the daisyUI 5 theme
   contract, nothing more. A custom theme is as expressive as an official
   one, and the [daisyUI theme generator](https://daisyui.com/theme-generator/)
   output pastes over directly.
4. **Verbatim CSS variable names as token keys** (`--color-primary`, not
   `primary`). Zero translation layer from any daisyUI doc or generator
   output, whitelist validation stays a flat list, and future daisyUI
   tokens are one whitelist entry away.
5. **Overriding a built-in theme in place is allowed.** A custom entry
   named `light` restyles the built-in `light` (partial override, rest
   inherited by cascade). This is the cheapest "keep light/dark, just
   brand the primary" path and costs nothing to support.
6. **Lenient validation, console warnings.** Unknown token → warned and
   skipped; invalid value → warned and skipped; custom name absent from
   `theme.available` → warned (likely a config mistake) but still
   injected. No hard failures for a styling concern. The same leniency
   settles the edge cases: a **duplicate** `name` is warned and skipped
   (first wins); an `extends` naming another custom theme is warned and
   the `extends` dropped (decision 2); an `extends` naming neither a
   built-in nor a custom theme is warned but **kept**, so a daisyUI bump
   that adds a theme costs a console line rather than a broken config
   (`BUILTIN_THEMES` in `src/theming/custom-themes.js` exists for that
   warning only; nothing behaves differently for an unknown base).
7. **Root-only config.** Theme remains global UI chrome; no per-spec
   custom themes in multi-spec installs. Concretely: `theme.custom` is
   read from the **root** config while `theme.available` comes from the
   effective one — a per-spec `theme` override narrows what is selectable
   without ever redefining a theme. A `theme.custom` declared on an
   `openapi.specs[]` entry is warned by name and **dropped**
   (`ROOT_ONLY_SUBKEYS` in `src/specs.js` — subkey-granular so the
   effective config never carries a key no consumer reads, and a future
   nested root-only key is one map entry away rather than a second silent
   case). `multi-spec.md` documents it as the second root-only case,
   root-only *inside* an otherwise overridable block, next to `history`.

## 3. Config shape

```json
"theme": {
  "default": "acme",
  "available": ["acme", "light", "dark"],
  "custom": [
    {
      "name": "acme",
      "extends": "dark",
      "colorScheme": "dark",
      "tokens": {
        "--color-primary": "#6d28d9",
        "--color-primary-content": "oklch(97% 0.014 308)",
        "--radius-box": "0.25rem"
      }
    }
  ]
}
```

- `name` — required, `^[a-z][a-z0-9-]*$` (CSS-identifier-safe, no
  escaping needed in selectors). May equal a built-in theme name
  (decision 5).
- `extends` — optional, name of a **built-in** daisyUI theme. When
  absent, missing tokens fall back to the build's default theme (`apiglow`,
  which daisyUI scopes under zero-specificity `:where(:root)` — see §5),
  so a complete definition is recommended when not extending; the theme
  generator emits all tokens anyway.
- `colorScheme` — optional `"light"` / `"dark"`, emitted as the
  `color-scheme` property (browser-provided UI: scrollbars, form
  controls). Inherited from `extends` when absent.
- `tokens` — map of daisyUI 5 theme variables. Whitelist: the 20
  `--color-*` names, `--radius-selector|field|box`,
  `--size-selector|field`, `--border`, `--depth`, `--noise`. Values pass
  through as-is (any CSS color format works) after a conservative
  break-out check (no `;`, `{`, `}`, control characters, nor `<`/`>` —
  worthless in a token value, and the sink is a `<style>`).

## 4. Architecture

- Core module **`src/theming/custom-themes.js`**, pure functions:
  validate definitions, merge override tokens onto resolved base values,
  render the final CSS text. No DOM, fully Vitest-able.
- **`app.js` is the only reader of `theme.custom`** (rule 10): the
  bootstrap validates, resolves `extends` (see below), calls the
  generator, and injects one `<style data-apidoc-custom-themes>` element.
  The core module receives plain data, never the host config.
- **`extends` resolution via a computed-style probe.** The base theme's
  values live only in the built CSS (reading `cssRules` of the
  cross-origin CDN stylesheet would throw), so the bootstrap appends a
  hidden `<div>` carrying `data-theme="<base>"`, reads the ~29
  whitelisted properties with `getComputedStyle`, and removes the probe.
  `display:none` doesn't stop custom properties from resolving, and the
  probe never reaches the layout. Requires `app.css` to be loaded — see
  the timing note in §5.
- **No storage, no i18n impact.** The persisted theme choice mechanism is
  untouched: custom names flow through `theme.available`, so
  `resolveInitialTheme()` and the switcher work unchanged (a stored name
  whose definition disappeared is already filtered by the
  `available.includes` guard). No switcher change was needed: the preview
  swatches repaint off their own local `data-theme`, which picks up the
  injected global rule. Theme names are displayed verbatim.
- **Rule 3 unchanged**: the built CSS keeps shipping every standard
  daisyUI theme; custom themes are additive.

## 5. The two cascade subtleties (implementation contract)

These are the traps this spec exists to record; both were verified against
`dist/app.css` and in the browser.

1. **Selector specificity.** daisyUI 5 does *not* scope themes under bare
   `[data-theme=x]`: the default theme sits under `:where(:root)`
   (specificity 0,0,0) and every other built-in under
   `:is(:root:has(input.theme-controller[value=x]:checked), [data-theme=x])`
   (specificity ≈ 0,4,1 — `:is()` takes the max of its arguments). A bare
   `[data-theme=acme]` block therefore beats the *default* fallback but
   **loses against a built-in non-default theme rule** on specificity
   alone. Consequence: the injected CSS mirrors daisyUI's own selector
   shape,
   `:is(:root:has(input.theme-controller[value=NAME]:checked), [data-theme=NAME])`,
   so that in-place overrides of built-ins (decision 5) win by document
   order at equal specificity. The `name` pattern of §3 guarantees the
   interpolation is selector-safe. (Layering settles the same question on
   its own today — see §6 — but the mirror is what makes the config channel
   independent of daisyUI's layer choices, and it costs nothing.)
2. **Cascade position and load timing.** The `<style>` element is
   inserted **synchronously right after the injected `app.css` link**, so
   its document-order position (and thus tie-breaking) is guaranteed
   regardless of network timing. When some definition uses `extends`, the
   element is inserted empty and its text is filled once the link fires
   `load` (the probe needs the stylesheet applied); themes without
   `extends` are filled immediately. Until `app.css` loads nothing is
   styled anyway, so this adds no visible FOUC beyond the CSS load
   itself.

## 6. Host-CSS escape hatch (documentation contract)

What the docs owe the host, because subtlety 1 above applies to it too —
carried by architecture.md §5.9, the README theming section and
`config.example.js`:

- For a **new** theme name, a plain block in the host page works:

  ```css
  [data-theme="acme"] {
    color-scheme: dark;
    --color-base-100: oklch(25% 0.02 280);
    /* … remaining daisyUI theme variables … */
  }
  ```

  plus `"acme"` in `theme.available`. It beats the zero-specificity
  default even though `app.css` is injected later. Tokens left undefined
  fall back to the default theme's values.
- **Overriding a built-in theme name** from host CSS works too, and the
  same plain block does it: daisyUI ships its themes inside `@layer base`,
  and an unlayered rule beats a layered one whatever its selector — the
  specificity analysis of subtlety 1 never gets a say. Verified in the
  browser. The docs say so *and* say it rests on daisyUI's layering,
  recommending the config path for that case since it mirrors the
  `:is(…)` selector and survives a layering change.
- The daisyUI theme generator is linked as the recommended way to author
  values in both channels.
- `tests/e2e/fixtures/app-themes.html` is the executable version of this
  section: both blocks above live there and `custom-themes.spec.js` asserts
  they win, so a cascade regression fails the suite rather than the docs.

## 7. Testing

- **Vitest** (`src/theming/`): token whitelist filtering and warnings;
  value break-out rejection; name pattern rejection; merge precedence
  (override beats base, base fills gaps); `colorScheme` inheritance;
  exact CSS text output including the mirrored `:is(...)` selector.
- **Playwright** (`tests/e2e/custom-themes.spec.js`, fixture config with
  an `extends`-based theme, a full standalone theme, and an in-place
  `light` override):
  - custom themes appear in the switcher with working preview swatches
    (the swatch repaints via its local `data-theme`, which picks up the
    injected global rule — no switcher change);
  - selecting the custom theme changes `--color-primary` on the root to
    the configured value;
  - the `extends` theme inherits a non-overridden token from its base;
  - the in-place `light` override beats the built-in rule;
  - the choice persists across reload;
  - a host-CSS theme declared in the fixture page applies (guards the
    escape hatch against a future cascade regression), including a host
    `[data-theme="dark"]` block overriding a built-in (pins the layering
    fact of §6);
  - axe sweep stays green on the fixture — with `color-contrast` off, the
    one place it is: the colors on screen are the host's, and so is their
    contrast (architecture.md §12).
- **Perf**: budgets unchanged; the injection is synchronous string work
  at boot plus at most one probe read after CSS load.

## 8. Demo showcase

Both demo pages (the root `index.html` and `demo/cdn-install.html`, which
must stay in sync) ship a custom theme, `daisybrand`: it extends `dark`
and overrides six colors plus two radii — the `extends` use case the
feature exists for. `theme.default` stays `light`: the demo is also the
reference for what a stock install looks like, and the theme is one
switcher entry away, listed first.
