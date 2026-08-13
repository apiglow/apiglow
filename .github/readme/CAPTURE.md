# README asset capture recipe

Everything here is reproducible mechanically; re-shoot whenever the shown
surfaces change materially. None of this directory ships in the npm tarball
or the CDN bundle.

## Wordmarks

`apiglow-wordmark-{light,dark}.svg` — generated from the website identity's
variable font (Bricolage Grotesque, wght 700) converted to SVG paths, "Glow"
filled with the brand gradient (light: `#6d28d9→#be185d→#0e7490`, dark:
`#a78bfa→#f472b6→#22d3ee`, 55 % midpoint, `userSpaceOnUse`). No font loads
at render time.

## Screenshots

Captured with Playwright Chromium against the packed-tarball demo
(`npm run preview:cdn`, http://127.0.0.1:4173): viewport **1440×900**,
`deviceScaleFactor` 2. Theme via `localStorage['apidoc:theme']` before load —
`"apiglow"` and `"apiglow-dark"`, the signature pair a default install shows
(the demo's host-defined `daisybrand` is a custom-theme showcase, not what the
product looks like out of the box).

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
