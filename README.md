<div align="center">

<a href="https://apiglow.dev/demo/"><picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apiglow/apiglow/main/brand/apiglow-mark-dark.svg">
<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/brand/apiglow-mark-light.svg" alt="" width="96">
</picture></a>

<a href="https://apiglow.dev/demo/"><picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apiglow/apiglow/main/brand/apiglow-wordmark-dark.svg">
<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/brand/apiglow-wordmark-light.svg" alt="ApiGlow" width="260">
</picture></a>

### API docs with a real API client inside — one script tag, no backend.

[![npm](https://img.shields.io/npm/v/apiglow?color=7c3aed)](https://www.npmjs.com/package/apiglow)
[![CI](https://img.shields.io/github/actions/workflow/status/apiglow/apiglow/ci.yml?branch=main&label=CI)](https://github.com/apiglow/apiglow/actions)
[![min+gzip](https://img.shields.io/bundlephobia/minzip/apiglow?color=7c3aed)](https://bundlephobia.com/package/apiglow)
[![license](https://img.shields.io/npm/l/apiglow?color=7c3aed)](LICENSE)

[Live demo](https://apiglow.dev/demo/) · [Docs](docs/) · [Quickstart](#quickstart) · [Contributing](CONTRIBUTING.md)

</div>

<a href="https://apiglow.dev/demo/"><picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/hero-dark.png">
<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/hero-light.png" alt="Three-column layout: navigation, operation doc, try-it panel showing a live 200 response" width="920">
</picture></a>

*The demo mid-try-it: a real `200`, response-header chips included.*

<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/scenario-step-by-step.gif" alt="A three-step scenario driven step by step inside the try-it panel" width="920">

*Docs that execute: a scenario replayed step by step in the real try-it.*

- **Try it for real** — native `fetch`, auth wired from `securitySchemes`,
  OAuth2 PKCE included ([on the wire](docs/try-it-network.md))
- **Environments that block mistakes** — a missing `{{var}}` blocks the
  send, the literal is never sent ([architecture §5.3](docs/architecture.md#53-environments))
- **Docs that execute** — declarative [scenarios](#scenarios--docs-that-execute)
  replay as a report, or step-by-step in the real try-it like a guided tutorial
- **Everything travels** — cURL, Postman 2.1 and HAR, out *and* back in;
  secrets redacted by default ([imports & exports](#imports--exports))
- **Fix schemas you don't own** — [OpenAPI Overlay 1.1](docs/openapi-coverage.md)
  applied at load, from the config, without forking the schema
- **Grade your schema** — a [38-rule audit](#schema-audit) with a letter grade, in the browser
- **Prose woven in** — Markdown guides in the same nav, search and AI
  exports as the reference ([docs pages](#docs-pages))
- **Say something to your readers** — a banner your ops team publishes by
  editing one file, that schedules and retires itself
  ([announcements](docs/architecture.md#517-operator-announcements))
- **Any OpenAPI since 2.0** — 3.0 / 3.1 / 3.2 rendered natively, Swagger 2.0
  converted at load ([spec support](#spec-support))
- **Local by construction** — no backend anywhere: history, environments and
  scenarios live in the reader's browser ([storage model](docs/architecture.md#6-storage-model))
- **Speaks agent** — `llms.txt`, `llms-full.txt` and an MCP config block,
  generated client-side ([AI surface](#ai-surface))
- **Findable, if you want it** — `apiglow bake` writes static HTML and
  Markdown mirrors, a sitemap and served `llms.txt` for the crawlers that
  run no JavaScript ([SEO](docs/seo.md))
- **One workflow, three readers** — declare the Arazzo file your CI already
  runs, and it renders as a tutorial, publishes as an agent recipe and comes
  back as a pipeline job ([hand-off](docs/scenario-handoff.md))

## Quickstart

One HTML page, one inline config, one script — the whole installation:

```html
<!doctype html>
<html>
  <head><title>My API docs</title></head>
  <body>
    <script id="api-doc-config" type="application/json">
    {
      "openapi": { "url": "https://example.com/openapi.json" },
      "theme": { "default": "light", "available": ["light", "dark", "corporate"] },
      "language": { "default": "en", "available": ["en", "fr"] }
    }
    </script>
    <script src="https://cdn.jsdelivr.net/npm/apiglow@0.1.0/dist/app.js" type="module"></script>
  </body>
</html>
```

Only `openapi.url` is required. No server at all: `openapi.spec` carries
the schema inline — no request, no CORS. Several APIs in one installation:
`openapi.specs` adds a selector, everything isolated per spec
([multi-spec](docs/multi-spec.md)). Every key, annotated:
[`config.example.js`](config.example.js). Serve over HTTP(S) — `file://`
can't host ES modules.

## Spec support

| Document | Versions | Support |
|---|---|---|
| OpenAPI | 3.0.x · 3.1.x · 3.2.x | Rendered natively — one normalized model, the newest version's semantics win |
| Swagger | 2.0 | Converted at load; every approximation reported by the audit |
| OpenAPI Overlay | 1.1 | Applied at load; what an overlay couldn't do is listed, never dropped |
| Arazzo | 1.1 | Scenario export **and** import |
| Postman Collection | 2.1 | Request export **and** import |
| HAR | 1.2 | Request export **and** import |
| cURL | — | Snippet export and paste-to-import |

An unsupported construct of a supported version is a defect, not a scope
choice — the construct-by-construct contract: [`docs/openapi-coverage.md`](docs/openapi-coverage.md).

## How it compares

| | Try-it | Environments | History | Scenarios | Request import/export | Multi-spec | UI languages | Zero backend | License |
|---|---|---|---|---|---|---|---|---|---|
| **ApiGlow** | ✅ | ✅ | ✅ | ✅ + Arazzo 1.1 | cURL · Postman · HAR, both ways | ✅ | en · fr | ✅ | MIT |
| Swagger UI | ✅ | ❌ | ❌ | ❌ | cURL out | ✅ | en only | ✅ | Apache-2.0 |
| Redoc CE | ❌ paid | ❌ | ❌ | ❌ | ❌ | ❌ paid | en only | ✅ | MIT |
| Scalar | ✅ | ✅ | ❌ | ❌ | Postman/cURL in, snippets out | ✅ | 7 locales | ✅ | MIT |
| Stoplight Elements | ✅ | ❌ | ❌ | ❌ | snippets out | ❌ paid | en only | ✅ | Apache-2.0 |
| RapiDoc | ✅ | ❌ | ❌ | ❌ | cURL out | ❌ | en only | ✅ | MIT |

Every cell is checkable against that tool's current docs — a ❌ means the
feature is absent from them. Ties conceded: Redoc CE reads large schemas
best, Scalar ships more UI locales. None of the five publishes an a11y
commitment; ApiGlow's is a tested contract ([architecture §12](docs/architecture.md#12-accessibility)).
What ApiGlow adds is the client layer the others keep for their paid tiers.

## Scenarios — docs that execute

A scenario is a named, replayable request sequence, 100 % declarative — no
scripting. Build it by clicking: send, "Add to a scenario", click a
response key to chain it into the next step or assert on it. "Run all"
renders a report; "Step by step" makes it an interactive tutorial. Sharing
never carries a sensitive value; Arazzo 1.1 round-trips in and out.

<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/scenario-dark.png">
<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/scenario-light.png" alt="Step 2 of 3 of a scenario in the try-it: extracted petId used by the order body" width="920">
</picture>

*Step 2/3: `{{petId}}`, extracted from step 1, sits in the order body.*

Full spec: [`docs/scenarios.md`](docs/scenarios.md).

## Schema audit

The docs already downloaded your schema, so they can also grade it: 38
rules across five categories, a score each, a letter grade, and a Markdown
report for the ticket. In the browser — nothing is sent anywhere.

<picture>
<source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/audit-dark.png">
<img src="https://raw.githubusercontent.com/apiglow/apiglow/main/.github/readme/audit-light.png" alt="The schema audit page: grade A, five category scores, findings folded by rule" width="920">
</picture>

*The demo schema's report card — grade, category scores, folded findings.*

Full spec and rule catalog: [`docs/audit.md`](docs/audit.md).

## Theming

All standard daisyUI themes ship in the CSS — listing one costs nothing,
no rebuild. Your own theme is a config block, generated at boot:

```json
"theme": { "default": "acme", "available": ["acme", "dark"], "custom": [
  { "name": "acme", "extends": "dark", "tokens": { "--color-primary": "#6d28d9" } }
] }
```

`extends` makes a brand theme a handful of tokens, and the
[theme generator](https://daisyui.com/theme-generator/)'s output pastes
straight in. Details: [`docs/custom-themes.md`](docs/custom-themes.md).

## Docs pages

Prose guides woven into the same nav as the reference: Markdown/HTML
pages, groups, per-page TOC, callouts, tabbed snippets, links that resolve
straight to an operation — any page can take over the landing view. A page
can even be carried by the host document itself: docs behind a login keep
the full feature set. Full spec: [`docs/docs-pages.md`](docs/docs-pages.md).

## Imports & exports

Each history entry exports to cURL, Postman 2.1, Markdown and HAR —
secrets redacted by default (Insomnia reads Postman 2.1 natively). The same
formats travel back: paste a cURL, drop a collection or a HAR, land in a
pre-filled try-it — ambiguity is presented, never guessed. The panel's live
snippets (cURL, fetch, Node, Python, PHP, Ruby, Java, C#, Go, HTTPie) reuse
the same generators —
pure, snapshot-tested ([architecture §5.7](docs/architecture.md#57-request-log-export)).

## AI surface

Any operation copies as Markdown; the home page generates `llms-full.txt`
(the whole doc as one Markdown), `llms.txt` (its
[llmstxt.org](https://llmstxt.org) index) and an MCP config block wiring an
OpenAPI→MCP bridge to this API — credentials as placeholders, never your
stored values. All in-browser: [architecture §5.14](docs/architecture.md#514-ai-surface).

## Try-it and CORS, in brief

Test requests are sent by the reader's browser, so the API under test must
allow the docs' origin — a real constraint, stated in the UI rather than
papered over. When the API can't cooperate, `tryIt.proxyUrl` routes sends
through a proxy you host (the app ships none). Cookies, invisible response
headers, in-browser OAuth2: [`docs/try-it-network.md`](docs/try-it-network.md).

## AI-friendly, by design

Built to be worked on by agents as much as by humans: the instructions and
registries live in the tree, and the docs assume no prior context.
AI-assisted and AI-authored PRs are welcome — same bar as any PR, and the
submitter answers for the change.

## Contributing · Security · License

Dev setup, rules and the feature→test map: [CONTRIBUTING.md](CONTRIBUTING.md).
What changed in each version: [CHANGELOG.md](CHANGELOG.md).
Vulnerabilities: [SECURITY.md](SECURITY.md). License: [MIT](LICENSE).
