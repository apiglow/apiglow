# README asset capture recipe

Everything here is reproducible mechanically; re-shoot whenever the shown
surfaces change materially. None of this directory ships in the npm tarball
or the CDN bundle. The logo and wordmarks the README opens with are not
captures: they live in `brand/`.

## Screenshots

Captured with Playwright Chromium against the packed-tarball demo
(`npm run preview:cdn`, http://127.0.0.1:4173): viewport **1440×900**,
`deviceScaleFactor` 2. Theme via `localStorage['apidoc:theme']` before load —
`"apiglow"` and `"apiglow-dark"`, the signature pair a default install shows
(the demo's host-defined `daisybrand` is a custom-theme showcase, not what the
product looks like out of the box).

Three things a shot gets wrong silently:

- Preferences are JSON-encoded, so the stored theme is `"apiglow-dark"` with
  its quotes. A bare string is unparseable and the app falls back to its
  default — a light screenshot named `-dark`.
- Pin the context `locale` to `en-US`. The UI follows `navigator.languages`
  by default, so a French machine shoots French screenshots.
- Let the animations finish before shooting (`document.getAnimations()`), or
  the response's arrival pulse is baked into a still meant to show the
  settled state.

- `hero-{light,dark}.png` — `#/s/petstore/op/findPetsByStatus`, select
  `status = available`, Send, wait for the response, shoot. Shows the
  three columns mid-try-it with the insight chips (rate limit, page links,
  request id) on a 200.
- `scenario-{light,dark}.png` — `#/s/petstore/scenario/order-a-pet`, click
  **Step by step**, Send, **Next step**, Send, scroll every scroller back to
  the top (the panel follows the response down, and the step card is the
  subject), shoot. Shows step 2/3 with the extracted `{{petId}}` in the body
  template and the passed verdict.
- `audit-{light,dark}.png` — `#/s/petstore/audit`, wait for the report.
  Grade, category bars, first findings folded by rule.

## GIF

`scenario-step-by-step.gif` — same scenario page, `apiglow-dark`, viewport
**1280×800** at 1×: open Step by step, then Send / Next step through the
three steps, one frame per stage (8 frames, 1.6–2.6 s each), assembled with
`gifenc` (256-color palette per frame, `sharp` for the raw pixels). Budget:
< 5 MB; it does not theme-switch (GIFs can't).
