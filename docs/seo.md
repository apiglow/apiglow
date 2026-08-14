# SEO and indexability

How a public ApiGlow install becomes visible to search engines and AI
crawlers, and how a private install stays out of them — without giving up
the single-script CDN contract (`architecture.md` §3).

## 1. The problem

The app is 100 % client-rendered into a `<div>` that does not exist in the
served HTML, and every route lives in the URL fragment (`#/op/…`), which
never reaches a server. Consequences, in decreasing order of severity:

- **AI crawlers see nothing.** GPTBot, ClaudeBot, PerplexityBot fetch HTML
  but do not execute JavaScript. A client-rendered doc is invisible to
  ChatGPT/Claude/Perplexity retrieval.
- **Google sees one page.** Googlebot renders JavaScript, but treats hash
  fragments as one URL: it can index the home view, never `#/op/…` as
  distinct pages.
- **The machine-readable artifacts are unreachable.** `llms.txt`,
  `llms-full.txt` and the per-page Markdown exist as pure generators in
  `src/export/`, but only as in-browser downloads — nothing is ever served
  at a URL.

The hosted competition (ReadMe, Redocly, Mintlify, GitBook) has converged
on the same answer: static or server-rendered HTML per page, a
`sitemap.xml`, a **Markdown mirror of every page**, and `llms.txt`. The
purely client-side players either accept the gap or sell an SSR escape
hatch. ApiGlow ships no server, and ships the static half of that answer
as an optional companion step instead — its export generators are already
pure functions over the normalized model.

## 2. Doctrine: public vs private

- **Private (VPN, login, intranet).** The auth wall is the protection; a
  crawler cannot pass a login and we do not pretend to add security on
  top. For the in-between case — a publicly reachable URL that is not
  meant to be found — the host sets `seo: { index: false }` and the app
  injects `<meta name="robots" content="noindex">`. `config.example.js`
  carries the deployment half of the doctrine, where an integrator reads
  the key: `X-Robots-Tag: noindex` as the response-header equivalent — the
  only form that also covers the non-HTML files (the schema, the baked
  Markdown mirrors) — and the warning against combining a `robots.txt`
  `Disallow` with `noindex`, since a blocked URL is never fetched, so the
  `noindex` is never seen, and a robots-blocked URL can still be indexed
  from external links.
- **Public.** Two independent layers, each optional:
  1. **Runtime head management** — the app maintains `document.title`, a
     meta description and JSON-LD per route. Costs nothing, improves
     bookmarks, tabs, history and link sharing for humans, and gives the
     JS-rendering crawlers correct per-view metadata.
  2. **The bake** — a companion CLI run by the docs author (never by the
     reader) that emits static files to deposit next to the host page:
     `sitemap.xml`, `llms.txt`/`llms-full.txt` actually served, a `.md`
     mirror and an `.html` snapshot per page. This is the layer that makes
     the docs visible to non-JS crawlers and AI agents.

The CDN install contract is untouched: one script, no build step, no
server. The bake is an author-side extra for installs that want to be
found.

## 3. Runtime head management

`src/shell/head.js` owns everything the app writes into `<head>` per route.
`src/app.js` wires it to the router; the module receives the normalized
model and the docs pages, never the host config (rule 10).

- **Title.** `"{route title} — {model.info.title}"`: operation summary (or
  `{METHOD} {path}`) for `#/op/…`, page title for `#/page/…`, the workflow's
  own name for `#/scenario/…` once its document is loaded, i18n'd view names
  for audit/overview/first-call/scenario-import, bare `model.info.title` on
  home. The pure derivation function is unit-tested; the host's
  original title is never restored — once booted, the app owns the title.
- **Meta description.** One `<meta name="description">` managed by the
  app (created if the host has none, updated in place otherwise):
  operation summary/description first sentence for endpoints, page
  description or first paragraph for docs pages, `model.info.description`
  first sentence elsewhere. Plain text only — Markdown stripped, length
  capped (~160 chars).
- **JSON-LD.** One `<script type="application/ld+json">` on each route
  that maps to a schema.org type:
  `schema.org/APIReference` for endpoints, `TechArticle` for docs pages and
  workflows (a sequence of calls with a goal reads as a tutorial), `WebSite`
  on home. The remaining views (audit, first-call, scenario import) emit
  none — no type fits them, and a wrong type is worse than silence.
  Semantically correct, speculative payoff, near-zero
  cost; the same objects are reused by the baked snapshots.
- **noindex.** `seo: { index: false }` in the host config injects
  `<meta name="robots" content="noindex">` before first paint — before the
  schema is even requested, so the error views are covered like the app
  itself. Default is `true` (inject nothing). This is the only `seo` config
  key; `app.js` is the only reader, and the key is root-only in multi-spec
  (one served URL, whatever spec is shown).
- **No runtime canonical.** Under hash routing every route shares one
  server URL; a per-route canonical is meaningless (fragments are
  stripped) and a static one is the host page's business. Canonicals live
  in the baked snapshots only.

## 4. The bake

`apiglow bake` — a Node CLI shipped in the npm package (`bin` →
`dist/bake.js`, built from `scripts/bake.mjs` by its own Vite config, so it
never weighs on the app bundle or its size budget). It reads the host config
through `src/config.js` — the same module the app reads it with — loads the
schema through `src/openapi/loader.js` (ref-parser is Node-compatible), and
writes out the pure, snapshot-tested generators of `src/export/` (rule 12).
The packaged binary takes the command name (`apiglow bake …`) and the repo
form drops it (`node scripts/bake.mjs …`); both reach the same run, and
`--help` prints the usage.

### Invocation

```
apiglow bake --config apidoc.config.json --site-url https://docs.example.com/ --out public/
```

- `--config` — the same JSON object the host page inlines in
  `#api-doc-config` (single- and multi-spec). The bake resolves
  `openapi.url|spec|specs`, `overlays`, `hide`, `docsPages` exactly like
  the app, so the baked mirror matches what the reader sees.
- `--site-url` — absolute URL of the deployed docs page. Required: every
  emitted URL derives from it.
- `--out` — output directory, to be served at the site root next to the
  host page.
- `--language` — `en` (default) or any code whose catalog file exists
  (`i18n/{code}.json` — `fr` is the one shipped); selects the i18n bundle
  for the snapshots' chrome text. A code with no catalog is a hard error.

One declaration, two resolutions, and they are not the same address. What the
config names is **read** from disk under the config file's own directory — a
leading `/` included, since the config sits where the site is assembled and
that is what the reader's server root will be; only a URL carrying a scheme is
fetched. That is what lets the bake run in CI before anything is deployed.
Every URL a generated file **points at** is resolved against `--site-url`
instead, exactly as a browser resolves it against the host page.

### Output layout

```
out/
  sitemap.xml
  llms.txt
  llms-full.txt
  op/{operationId}.html        op/{operationId}.md
  page/{slug}.html             page/{slug}.md
  scenario/{scenarioId}.html   scenario/{scenarioId}.md
  scenario/{scenarioId}.arazzo.json
  overview.html
```

A workflow gets a third file the other routes have no equivalent of: the
recipe an agent or a CI runner executes, copied from the document its author
declared or generated from our envelope
([`scenario-handoff.md`](scenario-handoff.md) §3.4).

Multi-spec installs nest everything but the root files under
`s/{specId}/…`, mirroring the route prefix; the root `sitemap.xml`,
`llms.txt` and `llms-full.txt` cover all specs — one sitemap, and one map per
file where each spec contributes the document it would have alone.

`src/export/site-layout.js` owns that layout — the sitemap lists it, the
llms exports link it and the bake writes it, and a layout decided twice is a
sitemap pointing at files nobody wrote. It is also where a file name is made
one: `operationId` and a page `slug` are strings their author chose freely,
and one holding a path separator would name a file outside the tree it
belongs to. A declared workflow gets a page like any other route because
`llms.txt` publishes it as one; a webhook shares the `op/` directory because
it shares the `#/op/…` route.

### Content rules

- **Markdown mirrors** come from the existing `toEndpointMarkdown` /
  `toDocsPageMarkdown`, uninterpolated (`{{var}}` stays literal, as in
  the in-app exports — `architecture.md` §5.8).
- **`llms.txt` links the served `.md` mirrors**, not hash routes
  (llmstxt.org convention: agents get fetchable Markdown).
  `toLlmsText`/`toLlmsFullText` take a URL-mapper option; the in-app
  download keeps hash links, since without a bake there is
  nothing else to point at. In `llms-full.txt` the same mapper adds a
  `Source:` line under each section's heading — an agent answering out of
  that file holds the whole documentation and, unbaked, not one address to
  cite for it.
- **HTML snapshots** wrap the Markdown mirror rendered through `marked`
  in a minimal static template: `<title>`, meta description, JSON-LD,
  `rel=canonical` pointing at the snapshot itself, a
  `rel=alternate type="text/markdown"` link to the `.md` mirror, a
  `rel=describedby` link to the root `llms.txt` covering the page
  (llmstxt.org v2 discovery — the specification's other lane, an HTTP
  `Link` header, is not a static tree's to set),
  `<html lang>`, a small inline `<style>` for legibility, and a
  prominent link into the interactive doc (`{site-url}#/op/{id}`). No
  script, no redirect — the snapshot is honest static content, not a
  cloaking trampoline. Raw HTML tokens inside Markdown are escaped at
  bake time: DOMPurify needs a DOM, jsdom is not a spec/format dependency
  we are willing to take (dependency rule, `architecture.md` §14.2), and
  a build-time mirror may degrade where the runtime view stays rich. This
  is the documented fallback. The same absence costs one more guard:
  marked does not filter link destinations (it assumes a sanitizer runs
  after it), so the template drops any scheme that could execute —
  `[click](javascript:…)` in a schema description must not ship as a live
  link on a page we generated. The template takes its own chrome text as
  strings rather than reading the i18n runtime, so `--language` is
  resolved once by the CLI and the generator stays pure.
- **`sitemap.xml`** lists every emitted `.html` page (snapshots are the
  indexable form; the `.md` mirrors are for agents and are reachable via
  `llms.txt`). Pure generator: `src/export/sitemap.js`.
- **`overview.html`** is `llms.txt` through the `.html` mapper: the same map,
  linking the pages a human opens. It is the only snapshot with no `.md` mirror
  — an agent reads the served `llms.txt` — and it exists so that a crawler
  landing on the site finds a link to every snapshot rather than a sitemap and
  nothing else.
- **What the bake cannot read is not emitted, and not linked either.** A docs
  page carried by an element of the host page (`contentId`) lives in HTML no
  Node process sees; an unreachable file is a file. Both are named in the run's
  warnings and dropped from the map, the sitemap and the tree — an entry
  pointing at a file nobody wrote is worse than one entry fewer. A schema that
  does not load is the end of the run instead: everything else derives from it.
- The bake refuses to run when the config says `seo: { index: false }` —
  baking a noindex site is a contradiction worth a hard error.

### What the bake is not

Not a prerender of the app (no DOM, no web components in Node), not a
second rendering engine — it is the export layer, written to disk. If the
snapshot and the app ever disagree, the generator is the thing to fix,
and the in-app "Copy page" output disagrees identically, which is how the
drift gets caught by existing snapshot tests.

## 5. Out of scope (recorded decisions)

- **History API routing (`routing: 'history'`).** Would make the SPA's
  own URLs indexable by Google without a bake, at the cost of requiring
  host-side rewrite rules — exactly what hash routing exists to avoid.
  The baked snapshots already give every endpoint an indexable URL that
  also works for non-JS crawlers, which History routing does not. Nothing
  in this design blocks it.
- **SSR / dynamic rendering.** No server by charter (`architecture.md`
  §1); Google deprecated bot-sniffing dynamic rendering.
- **Serving `llms.txt` from the app.** A `<script>` cannot create server
  files; the runtime download stays, the bake is the served path.
- **Content negotiation (`.md` on the same URL à la Mintlify).** Requires
  server logic; the sibling-file convention is the static-host equivalent.
