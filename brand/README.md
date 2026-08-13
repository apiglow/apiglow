# Brand assets

The ApiGlow identity: a gradient star — the "glow" — on a soft halo. Nothing
here ships in the npm tarball or the CDN bundle (`package.json` `files` is
`dist` only); these are the sources for the README, the GitHub org and repo
avatars, and anywhere else the project shows its face.

| File | Use |
| --- | --- |
| `apiglow-mark-light.svg` | The mark alone, for light backgrounds |
| `apiglow-mark-dark.svg` | The mark alone, for dark backgrounds |
| `apiglow-wordmark-light.svg` | "ApiGlow" set as paths, for light backgrounds |
| `apiglow-wordmark-dark.svg` | "ApiGlow" set as paths, for dark backgrounds |
| `apiglow-avatar.svg` | The mark on the `#1c1917` plate, for square avatar slots |
| `apiglow-avatar-512.png` | The same at 512×512, for uploads that refuse SVG (GitHub org avatar, npm, social profiles) |
| `apiglow-social-1280x640.png` | The GitHub repository social preview — the card link unfurlers show |

The tab favicon is not here: it lives at its serving path, `demo/favicon.svg`.

## Marks

Star and halo drawn as plain paths, filled by a five-stop linear gradient
(`#fb7185 → #fbbf24 → #a3e635 → #22d3ee → #a78bfa`). The star is *stroked* in
that same gradient so its points thicken and round rather than needle; the
white highlight ellipse and the small amber sparkle sit on top. Light and dark
differ only in the halo tint (`#be185d` vs `#f472b6`) and the highlight white,
so a mark never carries its own background — pick the variant matching the
surface.

Gradient `id`s are unique per file: the marks are meant to be inlined, and two
`id="glow"` in one document would make the second one silently borrow the
first's colors.

## Social preview

1280×640 at 1×, the size GitHub crops to: the dark mark and wordmark centered
on the `#1c1917` plate over a wide pink-to-violet radial halo, the README
pitch line under them in `#d6d3d1`. The lockup stays well inside the middle
of the frame: unfurlers crop this card, some of them to a square.

## Wordmarks

Generated from the website identity's variable font (Bricolage Grotesque,
wght 700) converted to SVG paths, "Glow" filled with the brand gradient
(light: `#6d28d9→#be185d→#0e7490`, dark: `#a78bfa→#f472b6→#22d3ee`, 55 %
midpoint, `userSpaceOnUse`). No font loads at render time.
