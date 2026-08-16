# Changelog

What changed in each released version, written for the people installing it.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html) —
before 1.0.0, a minor bump may break an installation.

Entries are written as the change lands, under `Unreleased`; `npm run release`
promotes that section into a numbered one ([`docs/release.md`](docs/release.md)).

## [Unreleased]

### Changed

- The header holds one line at every screen size, phones included, where it
  used to take up to three. Theme, language, settings and About moved into one
  preferences menu at the end of the bar; the environment selector, the
  history and the request importer stay in reach.
- Search is now in the header at every width — an icon on a phone, a field
  from a tablet up. It used to appear only on wide screens, and reaching it on
  a phone meant opening the navigation drawer first.
- On a phone the "Try it" button steps out of the way while you scroll down —
  it no longer sits on top of the line you are reading — and comes back as soon
  as you scroll up.
- Keyboard shortcuts are advertised only on devices that have a keyboard: the
  search field's shortcut chip and the palette's key legend are withheld from a
  touch-only device.

### Fixed

- Phone layout: the spec selector's list no longer runs off the screen and
  gives the page a sideways scroll, dialogs no longer sit flush against the top
  and bottom edges (and stay reachable under a browser toolbar), an
  environment named for a real deployment no longer pushes the authentication
  badge out of its card, and the environment editor shows the whole of a
  variable's name.
- Selected rows in the spec, environment and search menus: the second line (a
  spec's id, an environment's base URL, a result's path) was dark ink on the
  dark fill.
- Menu separators were drawn as two segments with a notch in the middle.
- Escape closes the search palette on the first press when a query has been
  typed, as its own legend says.
- The external-documentation and warning symbols came out of the colour-emoji
  font on Android.

## [0.1.0] — 2026-08-15

### Added

- Interactive API documentation generated in the reader's browser from an
  OpenAPI schema: one `<script>` tag, one config block, no backend.
- **Specifications** — OpenAPI 3.0.x, 3.1.x and 3.2.x rendered from a single
  normalized model, Swagger 2.0 converted at load with every approximation
  reported, OpenAPI Overlay 1.1 applied at load with anything it could not
  express listed rather than dropped.
- **Try-it panel** — real requests sent from the browser, environments and
  `{{variable}}` interpolation, every authentication scheme fillable, cookies,
  in-browser OAuth2, and an optional proxy for APIs that refuse the docs'
  origin.
- **Scenarios** — named, replayable request sequences, fully declarative:
  response values chained into later steps, assertions, a run report and a
  step-by-step tutorial mode. Arazzo 1.1 imports and exports.
- **Schema audit** — 38 rules across five categories, a score per category, a
  letter grade and a Markdown report, computed in the browser.
- **Imports and exports** — history entries out as cURL, Postman 2.1, HAR 1.2
  and Markdown, sensitive values redacted by default; the same formats paste
  back into a pre-filled try-it. Live request snippets in ten languages.
- **Docs pages** — Markdown and HTML prose woven into the reference navigation,
  with groups, per-page table of contents, callouts, tabbed snippets, links
  resolving to an operation, and pages carried by the host document itself.
- **AI surface** — `llms.txt`, `llms-full.txt`, per-operation Markdown copy and
  an MCP configuration block wiring an OpenAPI→MCP bridge, all generated
  in-browser with placeholder credentials.
- **Theming** — every standard daisyUI theme shipped in the CSS, plus custom
  themes declared in the configuration and generated at boot.
- **English and French** interfaces, both shipped and selectable at runtime.
- **`apiglow bake`** — a CLI that writes a crawlable static snapshot of the
  documentation for search engines.
- **Local storage with stated limits** — history, scenarios and snapshots in
  IndexedDB, environments and preferences in localStorage, each dataset with a
  documented retention policy.
- Keyboard-operable interface throughout, with focus management, live regions
  and an automated accessibility sweep in continuous integration.

[Unreleased]: https://github.com/apiglow/apiglow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/apiglow/apiglow/releases/tag/v0.1.0
