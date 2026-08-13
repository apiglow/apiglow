# Static docs pages — specification

Status: **implemented**. This document is the functional source of truth for
the prose-docs side of the app, alongside `docs/architecture.md` (which
summarizes it).

---

## 1. Purpose and positioning

The app renders two sides: the *reference* side (interactive OpenAPI) and the
*prose* side — guides, tutorials, changelogs — as a first-class docs product,
keeping the core promise: **one `<script>` from a CDN, zero build step,
markdown files hosted next to `index.html`** (or carried by it, §2.6).

### 1.1 Competitive landscape

Tools surveyed: Mintlify, ReadMe, GitBook, Stoplight (Elements + platform),
Redocly (Redoc + Realm), Scalar, Docusaurus (+ openapi plugins), Fern, Slate,
docsify, VitePress.

**Table stakes** (present essentially everywhere):

- Callouts/admonitions (4–7 semantic types).
- Tabbed multi-language code blocks; the most markdown-native syntax is
  ReadMe's *adjacent fences* (consecutive code blocks with no blank line
  between them become one tabbed block). Docusaurus/Slate add cross-page
  sync of the selected language, persisted.
- Left nav with groups, external links, icons, collapsed state. Explicit
  config dominates (`docs.json`, `docs.yml`, `sidebars.js`, `_sidebar.md`);
  pure file-convention is rare.
- Right-hand per-page ToC, prev/next links, prose page as customizable home.
- Unified search across prose + reference (docsify proves it works fully
  client-side with a lazily built index).

**The differentiator** the market competes on: **operation embeds in prose**,
in escalating forms — stable links (Redoc's `#operation/{id}` anchors),
spec-derived snippet embeds (Fern `<EndpointRequestSnippet>`, Redocly
`{% openapi-code-sample %}`), full interactive embeds (GitBook
`{% openapi %}`, Stoplight's `json http` request maker). Addressing has
converged on **`"METHOD /path"` strings** over operationIds or file paths.

**Precedents for our runtime model**: docsify (markdown fetched and rendered
in the browser, no build) proves the core; Stoplight Elements DevPortal
proves "prose + OpenAPI reference in one client-side embed" — but its prose
is bound to their platform, which is exactly the gap we fill. Crucially,
operation embeds are *easier* for us than for build-time tools: the
normalized model is already in memory at render time.

### 1.2 Decisions

| Topic | Decision |
|---|---|
| Nav structure | Collapsible named groups, **one level** deep; docs zone above the API reference zone, plus a trailing zone below it for the appendix (`nav`, §2.7) — no Scalar-style unified tree |
| Config | Inline `docsPages` array **or** a URL string pointing to a fetched manifest |
| Home | A doc page can take over `#/`; the technical welcome view moves to `#/overview` with an auto nav entry |
| Content | GFM callouts, code tabs (adjacent fences, synced choice), per-page ToC, prev/next, full-text search |
| API integration | Enriched links + inline operation cards; **no** try-it embedded in prose |
| Formats | `.md` (default), `.html` (DOMPurify), `.txt` (`<pre>`) |
| i18n | `url`/`title` accept a per-language map with fallback |
| Mermaid | Future track only — diagram rendering is not spec/format work, so the spec/format exception to the closed-runtime-dependencies rule does not open the door for it, and that rule's reasoning (platform-first, no UI/utility deps) applies unchanged |
| External links | First-class nav entries with a distinguishing icon |

---

## 2. Configuration

### 2.1 Entry kinds

`docsPages` is an ordered array (order **is** the nav order — there is no
`position` field). Three entry kinds, discriminated by keys:

```js
docsPages: [
  // A page: `slug`, plus a body — `url`, `content` or `contentId` (§2.6).
  { slug: 'getting-started', title: 'Getting started',
    url: '/docs-pages/getting-started.md', home: true },

  // A group (one level, collapsible). `id` optional — used for multi-spec
  // merge identity; defaults to the slugified resolved title.
  { group: 'Guides', id: 'guides', collapsed: false, pages: [
    { slug: 'pagination', title: 'Pagination', url: '/docs-pages/pagination.md' },
    { title: 'Status page', href: 'https://status.example.com' },
  ]},

  // An external link: `href` instead of `url`/`slug`. Rendered with a
  // distinguishing "external" icon, opens in a new tab
  // (rel="noopener noreferrer").
  { title: 'GitHub', href: 'https://github.com/acme/api' },
]
```

- A page names its body exactly once, in one of three ways (§2.6).
- A page may declare `kind: 'changelog'`, which opts it into the timeline
  treatment (§4.5). An unknown `kind` is dropped with a warning, the same
  stance as `format`.
- A top-level entry of any kind may declare `nav: 'top' | 'bottom'` — which
  side of the API reference it sits on (§2.7). Default `top`.
- Groups may contain pages and external links, **not** other groups.
- `collapsed: true` renders the group closed initially. Collapse behavior
  reuses the same primitive as the reference tag sections in `api-nav.js` —
  same keyboard operability, no persisted state.
- Invalid entries (page without `slug` or without a body, group without
  `pages`, link without `href`) are dropped with a console warning.

### 2.2 Manifest file

`docsPages` may instead be a **string URL** pointing to a JSON manifest:

```js
docsPages: '/docs-pages/manifest.json'
```

```json
{ "pages": [ ...same entry shapes as the inline array... ] }
```

The top-level object (rather than a bare array) leaves room for future
fields. **Relative `url`s inside the manifest resolve against the manifest's
own URL**, so a docs folder is fully self-contained: the host page names one
file, and the folder can be versioned, moved, or generated independently of
`index.html`. Inline entries resolve against the host page.

The manifest form makes `docsPages` the one config value that can require
the network, so the shell resolves a string URL to a plain array *before*
the config merge — the merge itself stays pure and in `src/specs.js`, where
the other named-list merges live.

A manifest that fails to load or parse surfaces a visible nav-level error
(not a silent empty section) and leaves the reference nav intact.

### 2.3 i18n

`title` (all entry kinds) and every body field of a page — `url`, `content`,
`contentId` (§2.6) — accept either a string or a per-language map:

```js
{ slug: 'guide', title: { en: 'Guide', fr: 'Guide' },
  url: { en: '/docs-pages/guide.en.md', fr: '/docs-pages/guide.fr.md' } }
```

Resolution: current UI language → `en` → first declared key. Switching the
UI language re-resolves and re-renders the open page and the nav labels.
A plain string means "same in every language" — the common monolingual case
stays zero-ceremony.

### 2.4 Home takeover

`home: true` on **at most one** page of the effective config. More than one:
the first wins, console warning. Effects:

- `#/` renders that page (full page chrome: ToC, prev/next) instead of the
  technical welcome view.
- The welcome view (llms exports, MCP card, pinned scenarios, stats) moves to
  **`#/overview`**, and an auto-generated nav entry labeled
  `t('nav.overview')` (en "API overview" / fr "Schéma OpenAPI") appears at
  the top of the reference zone. The route `#/overview` always exists;
  without a takeover it simply duplicates `#/` and gets no nav entry.
- The home page's own nav entry stays in the docs zone and is `#/`-active.

### 2.5 Multi-spec merge

Root and per-spec configs merge in `src/specs.js`, with the same philosophy
as every other named-list merge — the effective config is resolved once,
downstream code never knows where a value came from:

- Top-level entries merge by identity: **slug** for pages, **id** for groups,
  **href** for external links. A spec entry matching a root entry replaces it
  *in place* (root position kept); unmatched spec entries append after.
- Inside a matched group, the same rule applies to its pages (one level).
- `home` is resolved on the merged result, per spec — two specs can have
  different homes, or one a takeover and the other the classic welcome.

Scenarios' restriction (declare only inside `openapi.specs[]`) does **not**
apply here: root-level docs pages shared across specs are a feature.

### 2.6 Bodies carried by the host page

Everything above assumes the docs folder can be served next to `index.html`.
Some installations cannot: an API doc behind a login, where a static `.md`
would be public unless it goes behind the same session; an application
framework serving **one** route and no static tree; a doc packaged in a
binary, an extension, or an `srcdoc` sandbox. For those, the prose side
would otherwise be unavailable — while `openapi.spec`, `overlays` and
`theme.custom` are all declarable inline. Carried bodies close that
asymmetry.

A page names its body in one of three ways, and the loader takes the first
one declared:

| Key | Body | For |
|---|---|---|
| `content` | the text itself | a generator: the backend that emits the config emits the prose with it |
| `contentId` | the `id` of an element of the host page holding the text | hand-authored prose, written as prose |
| `url` | a file to fetch | the default |

The precedence is the one `openapi.spec` already sets against `openapi.url`:
what the page **carries** beats what it would have to fetch.

```html
<script type="text/markdown" id="doc-pagination">
  # Pagination

  Collection endpoints return a page at a time. Start with
  [create a pet](apidoc:createPet).
</script>

<script id="api-doc-config" type="application/json">
{ "docsPages": [
    { "slug": "pagination", "title": "Pagination", "contentId": "doc-pagination" },
    { "slug": "legal", "title": "Legal", "content": "# Legal\n\n…" }
] }
</script>
```

**Why two keys and not one.** The recommended config channel is a
`<script type="application/json">`, and markdown inside JSON is `"# Title\n\n…"`
— writable by a generator, unwritable by a human (the `window.API_DOC_CONFIG`
form is no better: a template literal fights every backtick of a fenced code
block). So `content` alone would restrict the feature to generated
installations, and `contentId` alone would force a generator to inject a
second element instead of one config. The two together cover both, and they
divide cleanly: **the config always holds the structure — order, groups,
`home`, i18n, multi-spec merge — the element only ever holds text.** Which is
also why a `<script>` does *not* declare a page by itself: a second config
surface, weaker than `docsPages`, would have to re-invent all of the above.

**The vessel.** A `<script>` of a non-executable type is the only element
whose content the HTML parser leaves strictly alone; a `<template>` parses its
content as markup and eats every tag in the markdown. Two consequences worth
knowing: the type must be present and non-executable (a bare `<script>` runs
its content as JavaScript, long before the app reads it), and a literal
`</script>` inside a code sample closes it early — that page belongs in a
file, or in `content`.

**Format** (§4.1 has no extension to read here): the page's `format` key
(`markdown` | `html` | `text`) wins; otherwise the element's `type`
(`text/markdown`, `text/x-markdown` → markdown, `text/html` → html,
`text/plain` → text); otherwise markdown. A `format` naming a pipeline that
does not exist is dropped with a warning rather than silently honoured.

**One loader for every consumer.** Three consumers need a page's body and
format: the page component, the `llms-full.txt` export, and the search
index. A carried body has no URL to deduce a format from, so one shared
loader answers both halves at once — `{ text, format }` — for all three.
Internally, "what is currently rendered" is keyed on where the body came
from (URL, element id, or slug), never on the URL alone, which is `null`
for every carried page.

**Indentation.** A carried body arrives indented by the markup around it, and
four leading spaces are a markdown code block — the whole page would render as
one grey rectangle. The loader removes the **common** indentation of the body,
so the indentation the author meant (nested lists, fenced blocks) survives
untouched. It applies to `content` too: a JSON string has none to remove, so
the operation is a no-op exactly where it should be.

**Everything else is unchanged**, which is the point: same markdown
enrichments, same DOMPurify pass, same heading anchors, same ToC and pager,
same `llms.txt`/`llms-full.txt` entries (the exports link pages by their
route, never by their file), same full-text search — carried pages simply cost
no fetch to index. A `contentId` pointing at nothing fails like an unreachable
file: a visible error naming the id, never a blank page.

**Not covered**: the schema (already `openapi.spec`) and scenario files
(`scenarios[].url`, still fetch-only) — see §11.

### 2.7 Which side of the reference

Not all prose is a guide. Support, legal, a changelog, a status link: an
appendix that belongs in the nav but not at the top of it, where §1.2's single
docs zone puts everything and pushes the reference — the reason most readers
came — further down with every page added. So a **top-level** entry, of any
kind, declares which side of the API reference it sits on:

```js
docsPages: [
  { slug: 'getting-started', title: 'Getting started', url: '/docs/start.md' },
  { slug: 'support', title: 'Support', url: '/docs/support.md', nav: 'bottom' },
  { group: 'Legal', nav: 'bottom', pages: [ … ] },
  { title: 'Status', href: 'https://status.example.com', nav: 'bottom' },
]
```

`nav: 'top'` (the default, and the whole behavior before this section) is the
docs zone of §1.2. `nav: 'bottom'` is a **trailing zone closing the nav** —
after the reference groups *and* after the webhooks: "the top of the sidebar"
and "the bottom of the sidebar" is a rule a reader can state, where "below the
endpoints but above the webhooks" is one they would have to be told.

The trailing zone carries **no section heading**. The separator already
detaches it, and a second "Documentation" title would name the same thing
twice — a heading says what a group of entries *is*, and these are only the
ones their author sent to the back. The consequence is deliberate: a page put
down there is discreet, which is what "appendix" means.

**Top-level only.** A group travels whole — placement is one of the things
belonging to a group means. `nav` inside a group is dropped with a warning,
the same stance as an unknown `format` or `kind`; an unknown value likewise
falls back to `top`. Multi-spec: an override replaces the root entry whole
(§2.5), zone included, so one spec can push a shared page down without moving
it anywhere else.

**One order, arranged once.** `resolveDocsOutline` returns the top zone first
and the trailing zone after, stable within each, so *the outline is the nav
order* stays literally true for every consumer: a page declared first but
placed below the reference is the last one the pager reaches (§5), the last
the exports list (§7), and the nav simply renders the two halves in the two
places. The reader never meets a "previous page" they have not seen yet.

---

## 3. Routing

`#/page/{slug}[/{anchor}]`; the multi-spec prefix travels via the router as
everywhere else. `#/overview` hosts the technical welcome view (§2.4). The
`#/` fallback behavior (unknown routes) is the app-wide one.

---

## 4. Rendering pipeline

### 4.1 Formats

Selected by URL extension (static hosts don't guarantee content-type), or by
the `format` key and the element type for a carried body (§2.6):

| Format | Ext | Pipeline |
|---|---|---|
| `markdown` | `.md` (and anything else) | frontmatter strip → marked (with extensions §4.2–4.4) → DOMPurify → heading anchors → hljs |
| `html` | `.html` | DOMPurify (same profile) → heading anchors → hljs. Markdown-only features (callouts, code tabs, operation cards) do not apply. |
| `text` | `.txt` | escaped text in a `<pre>`; no ToC, no anchors |

Frontmatter: a leading YAML block is **stripped and ignored** — files
authored for other tools render cleanly; using its fields is a future track.

### 4.2 Callouts

GFM alert syntax (`> [!NOTE]` on the first line of a blockquote) → daisyUI
alerts, via a static map (rule 2):

```js
{ NOTE: 'alert-info', TIP: 'alert-success', IMPORTANT: 'alert-info',
  WARNING: 'alert-warning', CAUTION: 'alert-error' }
```

(IMPORTANT gets a distinct icon from NOTE.) Chosen over `:::` containers
because it degrades to a plain blockquote in any renderer and is what GitHub
itself renders. No `role="alert"` — static content, not a live region.

### 4.3 Code tabs

Adjacent fenced code blocks (no blank line between them) render as **one
tabbed block**; the tab label is the fence's meta string (` ```js Node.js `)
or the language name. The selected language is remembered in localStorage
(`apidoc:code-lang`, rule 8 prefix) and applied to every tab group on every
page that has a tab for it — the Slate/Docusaurus synced-tabs behavior.
Blocks separated by a blank line stay independent, so the feature is strictly
opt-in by adjacency and degrades to sequential blocks on GitHub.

A **standalone** fence gets a header instead: the fence's language token and
a copy button. A tab group's bar is its tablist — its panels get no second
header. Like the other decorations here, this is a markdown-only enrichment:
an `.html` page keeps the markup its author wrote.

### 4.4 API deep integration

Both features address operations by **`operationId`** first, then
**`"METHOD /path"`** matched against the normalized model (rule 6) of the
active spec. No cross-spec references (same stance as scenarios).

**Enriched links** — a markdown link with the `apidoc:` scheme:

```markdown
See [create a pet](apidoc:createPet) or [list pets](apidoc:GET /pets).
```

`apidoc:GET /pets` is not a legal CommonMark link destination (a space in an
unbracketed destination), so the pipeline rewrites it into
`](<apidoc:GET /pets>)` before parsing — authors write the documented form
and the parser gets a legal one.

Resolved at render time (before sanitization) into a real link to the
operation's hash route — built through the router, so the multi-spec prefix
travels — with a small method badge (static color map, rule 2) prepended.
An unresolvable reference renders as visibly broken (struck-through span +
i18n'd tooltip), never as a dead link — the rule 11 philosophy: a mistake is
signaled, not silently shipped.

**Operation cards** — a fenced block, one reference per line:

````markdown
```apidoc:operation
GET /pets/{petId}
createPet
```
````

Each line renders a compact card: method badge, path, summary, deprecated
badge when applicable, the whole card linking to the operation's page. An
unresolvable line renders an inline error card. In a plain renderer the
block degrades to a legible code fence listing the references (the Stoplight
SMD philosophy: useful when rendered, harmless when not). **No try-it in
prose** — the card is a link, not an editable surface, so rule 20 (the
doc↔panel mirror) is not in play.

### 4.5 Changelog pages

A page whose entry declares `kind: 'changelog'` renders with a **timeline
treatment**: each `h2` is a release — a dot in the left gutter, one
continuous line joining them — with the release date carried in the heading
text by convention (`## 1.2.0 — 2026-05-01`). A convention plus CSS,
deliberately: no date parsing, no i18n, and the page degrades to a plain
markdown changelog in any other renderer. The class rides the rendered
content, so it applies to `.md` and `.html` pages alike; a `.txt` has no
`h2` to style and gets nothing.

---

## 5. Page chrome

- **ToC**: per-page table of contents derived from `h2`/`h3`, shown as a
  right-hand column on `xl` and a dropdown above the content below that.
  A `<nav>` landmark with an i18n'd `aria-label`. Applies to `.md` and
  `.html` pages. The entry whose section is being read is highlighted
  (`aria-current`), tracked with an IntersectionObserver; a ToC click or a
  deep link names the section outright — the observer alone could never
  reach a heading too close to the bottom of a short page. A named section
  stays named until the reader moves (wheel, touch, key): the observer's
  next delivery is a consequence of the scroll the app just made, and
  letting it answer would take the highlight straight back off the entry
  that was clicked.
- **"Copy page"**: the same hand-off menu as an endpoint's doc
  (`docs/architecture.md` §5.14.1), at the top of the content column — a
  prose page has no header of its own to hang it off, its `h1` comes from the
  body. It hands over this page as Markdown (copy, raw view, download as
  `{slug}.md`), this page to an assistant, and the whole API to an agent.
  What travels is the page as authored, `{{var}}` included as a template
  rather than as its resolved value (§5.14.2 of the architecture).
- **Prev/next**: bottom-of-page links derived from the flattened nav order
  (pages only — groups flatten, external links skip). One chain across both
  zones (§2.7): the docs are one document, read in the order they are shown.
  A `<nav>` landmark.
- **Feedback row** — only when the host config declares `feedback.url`: a
  "was this page helpful?" row between the content and the pager, POSTing
  `{ page: <slug>, verdict: 'up' | 'down' }` as JSON to that endpoint. The
  outcome (thanks, or a retryable error) is announced through the shared
  live region. Absent config, absent widget: the app itself never phones
  anywhere (the same telemetry stance as everything else). The shell
  resolves the config and hands the page component the one value (rule 10).
- All of the above apply to every docs page including a takeover home. A
  `.txt` page has no ToC (§4.1) but keeps its pager, its feedback row and its
  "Copy page" menu — all three come from the nav and the config, not from the
  file.

---

## 6. Search

The Cmd+K palette indexes docs page **content**, not just titles:

- The index is built lazily on the first palette open (docsify's pattern):
  every page is loaded through the shared cached loader, markdown/HTML
  stripped to text, split into sections by heading.
- Entries are section-level: `{ slug, anchor, heading, text }`; a result
  opens `#/page/{slug}/{anchor}`. Body matches rank below title/heading
  matches (existing field-weight mechanism in `src/search/index.js`).
- The section splitter works on the **source** (it indexes pages nobody has
  opened), so its anchors could drift from the ids the renderer assigns —
  the heading-id assignment is one shared function used by both, which is
  what keeps a search result's deep link landing.
- In-memory only, rebuilt per session and per language — no persistence, so
  rule 13 (bounded storage) is satisfied by construction. `.txt` pages index
  as a single section; external links are not indexed.

---

## 7. Exports (AI surface)

`llms.txt` and `llms-full.txt` follow the docs structure:

- `llms.txt` lists pages under their group titles, in nav order; external
  links join the `## Optional` section. Sections are keyed by title, so an
  ungrouped page and a group both called "Guides" share one heading — a map
  that prints the same heading twice reads as a duplicate, not as an order.
- The two zones (§2.7) bracket the reference here as they do in the nav: the
  top zone's sections before the operations, the trailing zone's after the
  webhooks. Its ungrouped pages go under `## Resources` rather than `##
  Guides`, for the same no-duplicate-heading reason — the nav can drop a title
  the separator already implies, a machine-read map cannot.
- `llms-full.txt` inlines `.md` and `.txt` content as-is and `.html` pages
  as sanitized text. The i18n-resolved URL follows the current UI language.
- `tests/export-completeness.test.js` covers every entry kind.

---

## 8. Accessibility

- Nav groups: same keyboard-operable collapse primitive as reference tags.
- Code tabs: real tablist semantics with arrow-key navigation, via
  `src/components/a11y.js` primitives.
- Operation cards: links with accessible names (`METHOD path — summary`).
- ToC and prev/next: `<nav>` landmarks, i18n'd labels.
- External links: the "external" icon is decorative (`aria-hidden`), the
  new-tab behavior announced via an i18n'd suffix in the accessible name.
- The `¶` heading anchors are `aria-hidden` **and** out of the tab order —
  an `aria-hidden` element that stays focusable is an axe violation, on
  every page that renders one.
- The axe sweep (`tests/e2e/a11y.spec.js`) covers a docs page exercising
  every feature; it stays green (rule 15).

---

## 9. Performance and storage

- Budgets are a contract (rule 14). A takeover home adds exactly one text
  fetch on landing; the perf suite carries a budget entry for "open a docs
  page" and the landing budget holds with a takeover home configured.
- The search index costs nothing until the palette opens; its build fetches
  each page once (shared cache).
- Persisted data: **one** localStorage preference, `apidoc:code-lang`
  (rule 8 mechanism and prefix; single key, no growth — policy: hard cap of
  one value). Nothing else persists.

---

## 10. Testing (rule 16)

Vitest (pure core):

- Config normalization: entry-kind discrimination, invalid-entry dropping,
  i18n resolution and fallback chain, manifest URL resolution (relative
  bases), multi-spec merge by slug/id/href, `home` uniqueness, the
  `changelog` kind (and the unknown-kind warning).
- Nav zone (§2.7): the default, the split by kind, the top-first ordering of
  the outline and of the flattened pages, the two warnings (unknown value,
  declared inside a group), and the zone an override carries.
- Marked extensions: callout mapping, adjacent-fence grouping, `apidoc:`
  link resolution (both addressings, unresolvable case), frontmatter strip.
- Operation reference resolver against the normalized model.
- Section splitter + index builder for full-text search.
- Export snapshots (`llms.txt`, `llms-full.txt`) regenerated deliberately.

Playwright (packed bundle):

- Nav: groups render/collapse/keyboard, external link icon + `target`,
  manifest-driven config, manifest failure surfaces an error.
- `nav: 'bottom'`: the entry closes the nav below the webhooks, the zone
  carries no heading, a group travels whole, and the pager chain crosses from
  one zone into the other.
- Home takeover: `#/` renders the page, `#/overview` renders the welcome
  view, the auto entry appears and navigates.
- One page per format (`.md`, `.html`, `.txt`); carried bodies (`content`,
  `contentId`) against a host page that declares them.
- Operation card navigates to the endpoint; enriched link shows the badge;
  broken reference shows the visible failure.
- Code tabs: selection syncs across groups and survives reload; a standalone
  fence shows its header (language token, copy button), a grouped one none.
- ToC active tracking: a ToC click marks its own entry `aria-current`.
- Changelog kind: the timeline treatment applies (aria snapshot of the
  release structure + the gutter's computed styles), and only to pages that
  opted in.
- Feedback row: the verdict POST carries `{ page, verdict }`; a failed POST
  is retryable; no `feedback.url`, no row.
- Cmd+K: a body-text query deep-links to the right section anchor.
- Language switch re-renders a bilingual page.
- a11y sweep on a docs page exercising every feature (§8).

`doc-panel-sync.spec.js` is unaffected: this spec adds no editable surface.

---

## 11. Future tracks (explicitly out of scope)

- **Mermaid diagrams** — requires a runtime dependency (~500 kB, would be
  lazy-loaded only when a page contains a ```` ```mermaid ```` fence).
  Diagram rendering is outside the closed-runtime-dependencies rule's
  spec/format exception, so shipping it needs its own recorded decision
  first. Until then, diagrams are images.
- **Unified nav tree** (Scalar model: the reference as a positionable node
  between prose groups) — revisit if the two-zone layout proves limiting.
- **Try-it embedded in prose** — would make prose an editable surface and
  pull rule 20 into scope; deliberately excluded.
- **Frontmatter fields** (title/description overrides, per-page ToC opt-out).
- **Scenario files carried by the host page** — the symmetric of §2.6 for
  `scenarios[].url`, and the last file a single-page installation still has to
  serve. Same shape (`scenario: { … }`, the object instead of the URL, as
  `openapi.spec` does), but it belongs to the scenarios spec, not to this one.
- **Versioned doc trees**; **breadcrumbs**; **nav collapse-state
  persistence**.

---

## 12. Variable interpolation

`{{var}}` in a docs page resolves from the same composition the try-it
reads — host credential overlay < selected environment
(`src/env/variables.js`) — so a guide's
`curl -H 'X-Tenant: {{tenant}}' {{baseUrl}}/pets` renders with the
reader's own values. The ReadMe "personalized docs" gesture, minus the
server. Run scope does not participate: prose is not an execution.

### 12.1 Semantics

Rule 11 does not transpose literally — "missing = send blocked" has no
send to block in prose — so its two halves are restated for a page:

- **A resolved, non-sensitive variable** renders as its value, plain
  text — no chip, no decoration: the snippet has to read as the snippet.
  The copy button of a fence copies the interpolated text — it must paste
  runnable, that is the feature.
- **A sensitive variable never renders its value.** It renders a masked
  chip (name + `••••`, i18n'd accessible name); the value enters neither
  the DOM, nor the clipboard, nor the search index, nor any export.
  Rule 12 by construction, not by redaction: there is nothing to redact
  because nothing was emitted. This covers host-credential values too —
  every entry of that overlay is `sensitive: true` by definition
  (`host-credentials.md`).
- **A missing variable** renders a warning chip carrying the name — the
  rule 11 spirit: signaled, never the literal silently. The chip is a
  button opening the environment manager, because "define it" is the only
  next step and the manager is where it happens. Under
  `environmentsLocked` there is no manager: the chip stays, the offer
  goes.
- **A chip copies as `{{name}}`**, the template it stands for: the bare
  name would paste as if it had resolved. An empty value is missing, the
  same rule the try-it applies.
- **Escape**: a backslash immediately before `{{` in the *rendered* text
  escapes the token — the walker emits `{{name}}` and drops the
  backslash. In a fence or code span, type `\{{name}}` (backslashes are
  literal there); in prose, `\\{{name}}` (markdown eats one). A page
  documenting this very feature is the use case.

### 12.2 Mechanics

Interpolation is a **post-sanitize DOM walk** over text nodes of the
rendered page (headings, prose, code spans, fences alike — §4 pipeline
order: … → DOMPurify → anchors → hljs → *interpolate*). Values are
inserted as text nodes and chips as app-built elements, so a value can
never introduce markup or shift the markdown structure (a base URL full
of underscores must not become emphasis — which is why interpolating the
source before `marked` is the wrong layer).

Two halves, split where the app splits everywhere else: `src/docs/vars.js`
decides — text in, segments out, pure and unit-tested, both the grammar
and the resolution rule borrowed from `src/env/interpolate.js`
(`splitVariables`, `resolveVariable`) so prose and try-it can never read a
different `{{…}}` nor disagree on what resolves;
`src/components/docs-content.js` walks the tree and builds the chips.

A chip declares the text it **stands for** in `data-copy-text`, because
its own `textContent` stands for nothing — a mask holds dots, a missing
one the bare name. Every surface that quotes rendered page text reads it
through `plainText()` rather than `textContent`: the fence copy button and
the ToC labels today, any future one that quotes the page as well.

The walk returns its **undo**. A re-walk — environment switch, variable
edit, host `setCredentials` push — restores the pristine text nodes first
and starts over from them, never from its own output: idempotence is not
left to luck, and the tab groups and copy buttons wired into the page keep
their listeners, which re-rendering from a clone would lose.

Anchors and ToC: heading ids are assigned before the walk (source-derived,
stable — a deep link cannot depend on the reader's environment); ToC
labels reflect the interpolated heading text, refreshed with it.

### 12.3 What stays uninterpolated

- **`.html` and `.txt` pages** — the walk is a markdown enrichment like
  callouts and code tabs (§4.1's own rule), and an HTML author owns their
  markup.
- **The search index** (§6) — it is built from the source, once per
  session, and the environment can change after; a secret must never be
  indexed, and indexing values would make results env-dependent. A search
  for the literal name finds the page, which is honest.
- **`llms.txt` / `llms-full.txt`** (§7) — machine exports of the
  published docs, not of one reader's session.

### 12.4 Accessibility and rules

Chips carry i18n'd accessible names ("variable {name}, value hidden" /
"variable {name} is not set — open the environments"); the missing chip is
a real button, the masked one a `role="img"` — `aria-label` on a bare
`<span>` is a violation in its own right. The sweep page (§8) gains all
three states. Rule 20 is not in play: a chip displays or navigates, it
never edits. Strings under `page.vars.*`, `en` + `fr` (rule 9).

### 12.5 Testing

Vitest (`docs-vars.test.js`), on the segmenter rather than on a rendered
fragment — the unit suite is the pure core and installs no DOM: resolved,
sensitive (the value provably never leaves), missing, empty-is-missing,
escaped in both spellings, a value carrying markup punctuation, a value
that itself looks like a reference.

Playwright (`docs-pages.spec.js`): a fixture page exercising all three
states — interpolated text in prose, heading, ToC and fence; the sensitive
value absent from the rendered page; the missing chip opens the manager;
fence copy copies the interpolated snippet with the secret still a
template; an environment switch re-walks and leaves nothing of the
previous one; Cmd+K finds the page by the literal name; a11y sweep green.

