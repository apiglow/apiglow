// Example configuration, annotated (docs/architecture.md §4).
//
// In production, prefer the inline JSON config in the host page:
//   <script id="api-doc-config" type="application/json">{ … }</script>
// (strict JSON, so no comments). This file shows the same config via the
// `window.API_DOC_CONFIG` fallback — handy for keeping comments around.
// Only `openapi.url` is required, everything else has a sensible default.

window.API_DOC_CONFIG = {
  openapi: {
    // URL of the OpenAPI 3.0.x / 3.1.x / 3.2.x schema, JSON or YAML. The
    // server hosting it must allow cross-origin reads (CORS).
    url: 'https://petstore3.swagger.io/api/v3/openapi.json',

    // — OR — the schema itself, carried by the page: JS object or JSON
    // string. No request, so no CORS to negotiate; in exchange the page
    // carries the weight of the schema and must be redeployed on every API
    // change. `spec` wins over `url`. The home page's download button then
    // serves this source (indented JSON).
    // spec: { openapi: '3.1.0', info: { … }, paths: { … } },

    // — OR — several schemas in the same installation (`specs` wins over
    // `url`): a selector in the header switches from one API to another, only
    // one is loaded at a time. Each spec has its own routes (#/s/{id}/…),
    // environments, header memory, and history, isolated from the others.
    // `id`: stable slug ([a-z0-9-]), unique — used as both a URL segment and
    // a storage prefix: changing it is equivalent to resetting the spec's
    // local data (environments, history). `title`: selector label (inactive
    // specs are never downloaded, their info.title is unknown). Each entry
    // accepts `spec` (inline schema) instead of `url`.
    //
    // PER-SPEC OVERRIDES — almost the entire config can be redeclared in an
    // entry, where it then takes priority over the root value. Three merge
    // rules:
    //   • settings objects (`tryIt`, `branding`, `theme`, `language`,
    //     `features`, `oauth`): merge KEY BY KEY, the spec wins. A key not
    //     redeclared keeps the root value; a declared key wins even at
    //     `null` (so a spec can disable the root proxy).
    //   • lists of named entities (`docsPages` by slug, `environments` by
    //     name, `scenarios`): merge by identifier, the spec wins.
    //   • `hide`, `overlays` and `announcements`: root + spec ACCUMULATE
    //     (hiding cannot be "unhidden"; overlays apply in that order, root
    //     first; announcements read in that order).
    //   • `environmentsLocked` and `userOverlay`: replaced if declared.
    // `scenarios` is the exception: in multi-spec, ONLY the entry's own
    // declarations count (a scenario references operations from one specific
    // spec) — root declarations are ignored and flagged.
    // NOT overridable: `history` (retention is a browser storage cap, applied
    // to all specs at once), `seo` (one page, one URL, whatever spec is
    // shown) and `theme.custom` (themes are global chrome, injected once at
    // boot from the root config) — the rest of the `theme` block still is.
    // Any other key set on an entry is ignored. Every one of these cases is
    // flagged by name in the console.
    // specs: [
    //   { id: 'payments', title: 'Payments API', url: 'https://…/payments.json',
    //     branding: { productName: 'Payments', logoUrl: '/logos/payments.svg' },
    //     theme: { default: 'corporate', available: ['corporate', 'dark'] } },
    //   { id: 'accounts', title: 'Accounts API', url: 'https://…/accounts.yaml',
    //     tryIt: { requestCredentials: 'include' },
    //     environmentsLocked: true,
    //     features: { scenarios: false } },
    // ],
    // Spec shown by default (first entry otherwise).
    // default: 'payments',

    // Hidden endpoints: they no longer exist in the model, so they're absent
    // from the nav, from search, and from exports (Markdown, llms-full).
    // Four pattern forms, `*` accepted as a wildcard:
    //   'tag:Internal'      every endpoint carrying this tag
    //   'DELETE /admin/*'   method + path
    //   '/admin/*'          path, all methods
    //   'resetDatabase'     operationId (or the fallback id `{method}-{slug}`)
    // Stacks with a `hide` declared on a `specs[]` entry.
    // If you control the schema, `"x-apiglow-hide": true` on an operation, a
    // Path Item, or a `tags` entry does the same thing, with no config.
    // ⚠️ Documentation-level hiding, not a security measure: the schema is
    // still downloaded in full by the browser.
    hide: [],

    // OpenAPI Overlay 1.1 documents applied to the schema AT LOAD, in the
    // order declared here — the way to fix or enrich a schema you do not own
    // (retitle an operation, add examples, drop an internal path) without
    // forking it. Each entry is a URL (JSON or YAML) or the overlay object
    // itself. Also declarable on a `specs[]` entry, where it stacks on top of
    // this list.
    //   { target: "$.paths['/pets'].get", update: { summary: 'List widgets' } }
    //   { target: "$.paths['/internal']", remove: true }
    // Supported targets: $, .child, ['child'], [0], .* / [*], $..descent and
    // [?(@.prop == 'value')]. Anything an overlay could not do — a target
    // matching nothing included — is listed in the settings panel's
    // diagnostics block and echoed to the console; it never breaks the load.
    overlays: [],

    // The STARTING PATCH offered to the reader, in the slot they own: same two
    // forms as an `overlays[]` entry (a URL, JSON or YAML, or the document
    // itself), but instead of being applied over their head it is written into
    // their own local overlay — the one the settings panel lets them edit,
    // dry-run, download and remove (docs/user-overlay.md). Use `overlays[]` for
    // a fix you impose, this for one you offer: a sandbox server, a relaxation
    // that only fits some tenants, or simply an editor whose starting point
    // targets this schema instead of a generic example.
    //   userOverlay: '/overlays/suggested.yaml',
    // Declarable on a `specs[]` entry too, where — unlike `overlays` — it
    // REPLACES this one rather than stacking (one document per spec); `null`
    // there refuses the installation-wide patch for that spec.
    // ⚠️ Handed over once, then theirs: a browser that already received THIS
    // document is left alone, edits and removal included. Publishing a
    // DIFFERENT document here re-seeds every browser and discards local edits
    // — that is the update path, and the reader's way out beforehand is the
    // editor's download button. What is never undone is a removal of the
    // document currently declared.
    userOverlay: null,
  },

  // Overridable per spec (see openapi.specs above).
  theme: {
    // Theme applied on first load (the user's choice, persisted in
    // localStorage, then takes priority). 'system' follows the OS
    // prefers-color-scheme within the first light/dark pair offered by
    // `available` (apiglow/apiglow-dark, or light/dark) — it is also the
    // built-in default, along with available: ['apiglow', 'apiglow-dark'].
    default: 'system',
    // Themes offered in the selector. 'apiglow' / 'apiglow-dark' are the
    // signature pair; all standard DaisyUI themes are bundled in the CSS too,
    // so this list is free to edit, no rebuild needed. A custom theme
    // must appear here too, otherwise it is injected but not selectable.
    available: ['apiglow', 'apiglow-dark', 'light', 'dark', 'corporate', 'dracula', 'acme'],
    // YOUR OWN THEMES, no build step: each entry becomes a DaisyUI theme
    // generated at boot (docs/custom-themes.md). ROOT-ONLY, unlike the two
    // keys above.
    //   name       — required, /^[a-z][a-z0-9-]*$/. May be an existing theme
    //                name, which then restyles it in place (the tokens you
    //                don't set are inherited from the built-in).
    //   extends    — optional, any BUILT-IN DaisyUI theme to inherit from
    //                ("dark, but in our colors"). Extending another custom
    //                theme is not supported. Without it, unset tokens fall
    //                back to the build's default theme.
    //   colorScheme— optional 'light' | 'dark', drives browser-provided UI
    //                (scrollbars, form controls). Inherited from `extends`.
    //   tokens     — DaisyUI 5 theme variables under their VERBATIM names, so
    //                the output of https://daisyui.com/theme-generator/ pastes
    //                straight in. Whitelist: the 20 --color-*,
    //                --radius-selector|field|box, --size-selector|field,
    //                --border, --depth, --noise. Anything else is skipped with
    //                a console warning — as is an invalid value or name.
    // Alternative with zero config: declare a `[data-theme="acme"] { … }` block
    // in your own page CSS and just list "acme" in `available` above.
    custom: [
      {
        name: 'acme',
        extends: 'dark',
        tokens: {
          '--color-primary': '#6d28d9',
          '--color-primary-content': '#f5f3ff',
          '--radius-box': '0.5rem',
        },
      },
    ],
  },

  // Overridable per spec.
  language: {
    // UI language on first load (user preference persisted afterward).
    // 'browser' — the built-in default — follows the browser's own ranked
    // preferences (navigator.languages) within `available`, matching on the
    // primary subtag (`fr-CA` → `fr`); the selector offers it back as
    // "Automatic", so a reader who once picked a language can return to it.
    // Naming a code here pins the first load instead.
    default: 'browser',
    // Languages offered. 'en' is bundled in the build; the others are
    // downloaded on demand from dist/i18n/{lang}.json.
    available: ['en', 'fr'],
  },

  // Environments pre-filled on first load (afterward, the user manages them
  // from the UI and localStorage is authoritative).
  environments: [
    {
      name: 'Sandbox',
      baseUrl: 'https://sandbox.example.com/v1',
      variables: {
        // A variable = { value, sensitive }. Sensitive variables are masked
        // on display and redacted in history/exports.
        'auth.bearerAuth': { value: '', sensitive: true },
        accountId: { value: 'acc_123', sensitive: false },
      },
      // Headers added to every try-it request for this env.
      defaultHeaders: { 'X-Client': 'api-docs' },
    },
  ],

  // true = the environments above are locked: no UI entry point to CRUD
  // (neither a manager nor seeding), only the selector remains.
  // Overridable per spec.
  environmentsLocked: false,

  // Prose documentation woven into the navigation, routed at #/page/{slug}.
  // The array order IS the nav order, and it holds three kinds of entry:
  //   • a page: `slug`, plus a body — see the three forms below. `home: true`
  //     on at most one page makes it the landing view; the technical welcome
  //     view then moves to #/overview and gets its own nav entry.
  //   • a group: one level, collapsible, `collapsed: true` to start closed.
  //     `id` is only used for multi-spec merge identity and defaults to the
  //     slugified title.
  //   • an external link: `href` instead of a body, rendered with an
  //     "external" icon and opened in a new tab.
  // `title` (every kind) and every body field of a page also accept a
  // per-language map: { en: 'Guide', fr: 'Guide' } — resolution is current
  // language → en → first declared key.
  //
  // A page's body comes from ONE of three keys, and what the page carries
  // wins over what it would have to fetch (as `openapi.spec` wins over
  // `openapi.url`):
  //   • `url`     — a file. `.md` by default; `.html` and `.txt` are
  //                 recognized by extension.
  //   • `content` — the text itself, straight in the config. For an
  //                 installation whose backend GENERATES this config: no file
  //                 to serve at all.
  //   • `contentId` — the id of an element of the host page holding the text,
  //                 to write the prose as prose:
  //                   <script type="text/markdown" id="doc-pagination">
  //                   # Pagination
  //                   …
  //                   </script>
  //                 The type must be there and must be non-executable (a bare
  //                 <script> runs its content as JavaScript), and a literal
  //                 </script> inside a code sample closes it early. The
  //                 indentation shared by every line is removed, so the block
  //                 can sit indented in the page like any other markup.
  // Together they make the whole prose side available to a doc that cannot
  // serve files next to index.html — behind a login, or served by one route.
  //
  // `format`: 'markdown' | 'html' | 'text'. Only needed when nothing else can
  // say it — a carried body has no extension. It wins over the extension and
  // over the element's type.
  //
  // `kind: 'changelog'` renders the page's h2 headings as a release timeline
  // (dot and line in the left gutter). Convention: one h2 per release, the
  // date in the heading text — `## 1.2.0 — 2026-05-01`.
  //
  // `docsPages` may instead be a string URL pointing at a JSON manifest of the
  // shape { "pages": [ …same entries… ] }. Relative urls inside it resolve
  // against the manifest itself, so a docs folder stays self-contained:
  //   docsPages: '/docs-pages/manifest.json',
  docsPages: [
    { slug: 'getting-started', title: 'Getting started', url: '/docs/getting-started.md' },
    {
      group: 'Guides',
      id: 'guides',
      collapsed: false,
      pages: [
        { slug: 'pagination', title: 'Pagination', url: '/docs/pagination.md' },
        // Same page, carried by the host document instead of fetched.
        { slug: 'errors', title: 'Errors', contentId: 'doc-errors' },
        { slug: 'legal', title: 'Legal', content: '# Legal\n\nAll rights reserved.\n' },
        { title: 'Status page', href: 'https://status.example.com' },
      ],
    },
    { slug: 'changelog', title: 'Changelog', url: '/docs/changelog.md', kind: 'changelog' },
    { title: 'GitHub', href: 'https://github.com/acme/api' },
    // `nav: 'bottom'` on a top-level entry of any kind (page, group, link)
    // sends it to the foot of the sidebar, below the whole API reference:
    // the appendix half of the docs stops pushing the endpoints down. That
    // zone has no title of its own, only a separator. Default: 'top'.
    // A group travels whole, so `nav` inside one is ignored.
    { slug: 'support', title: 'Support', url: '/docs/support.md', nav: 'bottom' },
    { title: 'Status page', href: 'https://status.example.com', nav: 'bottom' },
  ],

  // The strip across the top of the page: what YOU have to say, above what the
  // schema says — a maintenance window, a deprecation date, a version that just
  // shipped (docs/architecture.md §5.17). Overridable per spec, by accumulation.
  //
  // `text` is the message, as inline Markdown: bold, code and above all the
  // link to the incident page or the migration guide, sanitized like every
  // other external content. It also accepts a per-language map,
  // { en: '…', fr: '…' }, like a docs page title.
  // `level`   — 'info' (default) | 'success' | 'warning' | 'error'.
  // `dismissible` — false pins the notice: no close button, and it comes back
  //             for readers who had already closed it. Default true, and a
  //             dismissal is remembered.
  // `startsAt` / `endsAt` — ISO instants. THE POINT of declaring them: a
  //             maintenance window written a week ahead publishes and retires
  //             itself, so nobody has to take the banner down at 6am on a
  //             Sunday. Read at page load, in the reader's own clock.
  // `id`      — optional, and it decides what an edit does. Without one, the
  //             dismissal follows the text: change the message and every reader
  //             sees it again (usually what you want). With one, the message is
  //             free to change under a stable identity — fix a typo without
  //             re-opening the banner on everybody's screen.
  //
  // — OR — a string URL, and this is the form that makes it a news channel:
  //   announcements: '/news.json',
  // pointing at a file holding { "announcements": [ …same entries… ] }. Your
  // ops team publishes by editing that one file, with no redeploy of this page.
  // A file that fails to load costs the reader nothing: no strip, no error.
  announcements: [
    {
      id: 'v2-launch',
      text: '**v2 is live** — see the [migration guide](https://example.com/migrate).',
      level: 'info',
    },
    {
      text: 'Scheduled maintenance Sunday, 02:00–06:00 UTC.',
      level: 'warning',
      dismissible: false,
      startsAt: '2026-09-01T00:00:00Z',
      endsAt: '2026-09-07T06:00:00Z',
    },
  ],

  // "Was this page helpful?" on every docs page, posting the reader's verdict
  // to an endpoint of YOURS: `{ "page": "<slug>", "verdict": "up" | "down" }`
  // as JSON. No endpoint (the default) = no widget — the app itself never
  // phones anywhere.
  feedback: { url: null },

  // Scenarios shipped with the docs (replayable request sequences), routed at
  // #/scenario/{id} and listed in the "Scenarios" section of the nav. These
  // scenarios are read-only; "Duplicate" makes a local editable copy.
  // `id`: unique [a-z0-9-] slug; `title`: nav label.
  //
  // TWO FORMATS, and the document says which — nothing to declare:
  //   • the app's export format (the authoring loop: build the scenario in the
  //     UI, export it, commit it) — one file, one scenario;
  //   • an Arazzo 1.0/1.1 workflow document (JSON or YAML), the file your CI
  //     already runs. It carries `workflows[]`, so ONE entry declares as many
  //     scenarios as the document holds workflows, each routed under its own
  //     `workflowId`. Two documents claiming the same one: the second is
  //     prefixed by its entry id ({entry}.{workflowId}). `title` names a
  //     document holding a single workflow; several, and each takes its own
  //     summary. Operations resolve against the schema THIS documentation
  //     loaded, whatever the file's `sourceDescriptions` point at. What Arazzo
  //     says and this app cannot run (nested workflows, retry/goto actions,
  //     AsyncAPI steps…) does not discard the workflow: it renders with a
  //     "partial support" badge naming each of them, and the list also goes to
  //     the browser console.
  //
  // TWO CARRIERS:
  //   • `url` — a file to fetch, JSON or YAML;
  //   • `document` — the document itself, straight in the config. No fetch, so
  //     nothing to serve next to the page: for an installation behind a login,
  //     or one whose backend generates the config. Wins over `url` when both
  //     are there.
  //
  // `pinned: true` additionally features the scenario on the home page, in a
  // card showing its description and steps (typically: the auth flow you
  // want at hand right on arrival). Reserved for config: a local scenario
  // cannot be pinned. An Arazzo entry pins every workflow it declares.
  //
  // MULTI-SPEC: declare ONLY inside `openapi.specs[]` entries (a scenario
  // references operations from one specific spec) — unlike `docsPages`, there
  // is no merge with the root, and scenarios declared here would be ignored.
  // No cross-spec scenarios.
  scenarios: [
    { id: 'onboarding', title: 'Onboarding', url: '/scenarios/onboarding.json' },
    // The file your CI already runs, declared as it stands.
    { id: 'payments', url: '/workflows/payments.arazzo.yaml' },
  ],

  // Feature switches. Overridable per spec: one API can expose scenarios
  // while its neighbor doesn't.
  features: {
    // false = the scenarios feature disappears entirely: nav section
    // (including creation and import), "Add to a scenario" buttons in the
    // try-it and history, home page card, #/scenario/… and #/scenario-import
    // routes (a received link lands on "this scenario doesn't exist"), Cmd+K
    // palette index. The `scenarios` declared above are then ignored. Local
    // scenarios already in storage stay in the database, intact: once the
    // feature is re-enabled, they reappear.
    scenarios: true,

    // Schema audit (#/audit): an in-browser analysis of the OpenAPI schema
    // this documentation loads — findings by category (correctness,
    // documentation, deprecation, consistency, docs readiness), a score per
    // category and an aggregate letter grade, with a "copy as Markdown"
    // export. It addresses the API's author, not the reader: hence no nav
    // entry, its single entry point being a block at the bottom of the
    // settings drawer.
    // Nothing is computed until someone opens #/audit, and nothing is sent
    // anywhere — the analysis runs on the schema the page already downloaded.
    // false = the settings block, the #/audit route and every computation
    // disappear; the raw schema is not even kept in memory.
    audit: true,

    // "First call" (#/first-call): a generated onboarding page at the top of
    // the reference nav, for a reader who has never sent anything. It picks
    // the simplest read the schema declares — a GET, no body, nothing left to
    // type once the declared examples are pre-filled — and shows it under a
    // three-step preamble (pick a language, enter credentials, press Send).
    // The page holds no control of its own: the three steps happen in the
    // ordinary try-it rail, so the reader ends up where they will work.
    // Off by default, and absent anyway if the schema declares no such read.
    onboarding: false,

    // "Automate this scenario": a panel on every scenario page holding the CI
    // job that runs its Arazzo document on a schedule — GitHub Actions or
    // GitLab CI, through the Arazzo runner picked there. A front-end product
    // schedules nothing; this hands the work to the pipeline the reader
    // already has. The variables the job needs are listed as names wired to
    // the CI's secret store, never as values.
    // false = the panel disappears from every scenario page. Nothing else
    // moves: the Arazzo export stays in the scenario's Export menu, and the
    // recipes the AI surfaces publish (llms.txt, llms-full.txt, and the baked
    // `scenario/….arazzo.json`) are governed by what `scenarios` declares
    // above — never by this switch.
    ci: true,
  },

  // Header name and logo. In multi-spec, each `openapi.specs` entry can
  // redefine either one (see above); this block remains the fallback.
  branding: {
    productName: 'My API',
    logoUrl: null, // URL of a logo shown in the header (optional)
  },

  tryIt: {
    // Optional CORS proxy template: {{target}} = encoded target URL.
    // null = no proxy offered. The app bundles NO proxy: host your own if
    // the API under test doesn't allow the docs' origin.
    proxyUrl: null, // e.g. 'https://my-proxy.example.com/?url={{target}}'
    // `credentials` mode for the try-it's fetches: 'omit' | 'same-origin' | 'include'.
    // 'include' is necessary for session-cookie auth if the docs aren't
    // served from the API's origin — the server must then respond
    // Access-Control-Allow-Credentials: true with an explicit origin (not *),
    // and the cookie must be SameSite=None; Secure. An API that responds
    // Access-Control-Allow-Origin: * conversely rejects any preflight in
    // 'include' mode: in multi-spec, set the value on the relevant specs[]
    // entry rather than here.
    requestCredentials: 'same-origin',
  },

  // ⚠️ ONLY block NOT overridable per spec: purging applies to all specs at
  // once (it's a browser storage cap, not a business view). Two competing
  // values would make the effective retention depend on the last spec
  // visited.
  history: {
    maxEntries: 500, // purge beyond this (whichever threshold hits first)
    maxAgeDays: 30, //  or beyond this age
  },

  // Per OAuth2 scheme of the schema (key = name in securitySchemes): default
  // clientId for the flows run by the try-it (Authorization Code + PKCE,
  // client credentials), overridable by the auth.X.clientId env variable.
  // Never a clientSecret here: the host page is public — the client
  // credentials secret is entered in the UI and stays in the browser.
  // Overridable per spec, and that's the common case: a scheme name only
  // makes sense within the schema that declares it.
  oauth: {
    // monScheme: { clientId: 'mon-client-public' },
  },

  // ⚠️ Also NOT overridable per spec: one page is served at one URL, and a
  // crawler reads that HTML without ever choosing a spec.
  seo: {
    // false injects <meta name="robots" content="noindex"> before the first
    // paint — for docs that are publicly reachable but not meant to be found
    // (a staging deployment, a partner page nobody links to). It is a request
    // to well-behaved crawlers, NOT a protection: a documentation that must
    // not be read needs an auth wall or a private network, and this flag adds
    // nothing on top of one.
    //
    // Two things to know when deploying with it:
    //   • `X-Robots-Tag: noindex` as a response header is the server-side
    //     equivalent, and the only form that covers non-HTML files (the
    //     schema, the baked .md mirrors) — set it there if your host lets you.
    //   • do NOT also `Disallow` the page in robots.txt: a blocked URL is
    //     never fetched, so the noindex is never seen, and the URL can still
    //     be indexed from an external link pointing at it.
    index: true,
  },

  // No key here for host-provided credentials: that bridge is runtime-only, on
  // purpose. If your backend can mint a token for the reader's existing
  // session, register a provider on `window.apidoc` from the page instead —
  // the values stay in memory, never in this config and never in storage.
  // See docs/host-credentials.md.
}
