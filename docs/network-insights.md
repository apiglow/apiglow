# Network insights

This document is the functional source of truth for
the network-insights feature set, alongside [`architecture.md`](architecture.md)
(which summarizes it in its §5). It covers three features that share one idea:
*the app explains what the network just did*, using only what the browser
already exposes — no new runtime dependency, no server cooperation
required, graceful degradation when the API doesn't opt in.

Scope: try-it panel and request history detail. The scenario runner records
the same data for free (shared send pipeline) but the scenario UI is
unchanged. A live offline banner and full timing waterfall are **excluded**
from this spec (§8).

Not to be confused with [`try-it-network.md`](try-it-network.md), which is the
other half of the same subject and reads the other way round: what the API
side must allow for a send to work at all (CORS, exposed headers, cookies,
OAuth2 redirect URIs). That one is written for whoever hosts the docs; this
one specifies what the app makes of the answer once it arrives.

## 1. What this is

Three additive features on the try-it send/response path:

- **Failure diagnosis (§3)** — when `fetch` rejects, turn the opaque
  `TypeError: Failed to fetch` into an actionable verdict: offline, mixed
  content, CORS-suspected, or server unreachable.
- **Response header intelligence (§4)** — recognize well-known response
  headers (rate limiting, `Retry-After`, `Deprecation`/`Sunset`,
  `Link` pagination, correlation ids, `ETag`) and surface them as
  insights, two of them actionable (follow next page, conditional replay).
- **Transfer insights (§5)** — read the Resource Timing entry the send
  pipeline already locates and surface compression ratio, cache hit, and
  HTTP protocol version.

All three are display/diagnosis features: none changes what is sent (the
two §4 actions send *new* requests through the existing pipeline).

## 2. Product decisions

1. **Facts first, interpretation second — always both.** The
   `#renderNetworkError` contract holds: the raw browser error string stays
   verbatim and prominent; the diagnosis verdict is a separate alert that
   never replaces or rewords it. Same spirit everywhere: an insight is a
   *reading* of observable data, shown next to the data, never instead.
2. **Silence over noise.** No header → no insight row. No
   `Timing-Allow-Origin` → no transfer badges. Never render "unknown",
   "unavailable" or an empty section: on a plain third-party API the
   response panel looks exactly as it would without the feature.
3. **Derived vs stored.** Anything recomputable from the stored history
   entry (header insights) is recomputed at render time — the stored
   headers stay the single source of truth. Anything transient (the
   failure-probe verdict, the Resource Timing snapshot) is captured at send
   time into the entry, mirroring the `headersMs` precedent.
   Entries lacking the fields render nothing.
4. **The probe is safe by construction.** One `GET`, `mode: 'no-cors'`, no
   headers, no body, aborted after a short timeout, fired only *after* a
   send has already failed without an HTTP response. GET is the HTTP-safe
   method; probing never re-runs the user's actual (possibly non-idempotent)
   request.
5. **Actions only where HTTP says it's safe.** Follow-link and conditional
   replay are offered for `GET` (and `HEAD`) requests only.
6. **Recognized headers live in one registry** (§4.1) — an explicit,
   documented list, one parser per family. Unrecognized headers are the
   headers tab's job, unchanged.
7. **No live connectivity UI.** `navigator.onLine` is consulted at failure
   time only; a permanent online/offline banner is out of scope.
8. **Countdowns are best-effort.** `Retry-After` / rate-limit reset render
   as target-relative text refreshed while visible; they don't survive the
   panel being re-rendered and don't try to (a countdown is a hint, not an
   alarm clock).

## 3. Failure diagnosis

Applies when `send()` catches before any HTTP response exists
(`result.error` set, `result.response` null) — with one exemption: an
abort or a deadline (`AbortError`/`TimeoutError`) never runs the probe.
Diagnosing the server for a deadline we set would be the wrong reading,
and a canceled send needs no verdict at all.

### 3.1 Decision table

Checks run in order; the first verdict wins. `target` is the URL actually
fetched — the proxied URL when the proxy is on (if that fetch failed, the
proxy is what's unreachable, and the verdict must say so).

| # | Check | Verdict | Actionable hint |
|---|---|---|---|
| 1 | `navigator.onLine === false` | `offline` | Check your connection; nothing is wrong with the API. |
| 2 | Page is `https:` and `target` is `http:` | `mixed-content` | The browser blocks insecure requests from a secure page — use an `https` server URL or the proxy. |
| 3 | Probe `fetch(target, { mode: 'no-cors' })` resolves | `cors` | The server is reachable but doesn't allow this origin — enable the proxy (when configured) or add CORS headers server-side. |
| 4 | Probe rejects or times out | `unreachable` | DNS, TLS or the server itself — the URL may be wrong or the server down. |

Notes:

- Check 2 is decidable *before* sending, but it lives in the failure path:
  the browser fails the fetch instantly anyway, and a pre-send blocker
  would be a new validation concept for a case the diagnosis already
  explains.
- The probe result is a heuristic, and the wording must say "most likely",
  never assert. An opaque `no-cors` response proves reachability only; a
  rejection can also be an aggressive extension or a captive portal.
- Probe timeout: 5 s via `AbortController` — long enough for a cold TLS
  handshake, short enough that the verdict arrives while the user is still
  looking at the error.
- When the proxy failed (verdict on the proxied URL), the `cors` verdict is
  re-worded: a proxy that answers without CORS headers is a proxy
  misconfiguration, not an API one.

### 3.2 Data & rendering

- `send()` carries a `diagnosis` field on its result (`null` on success or
  HTTP-level errors); `historyEntry`/`applyResult` thread it into the
  entry. Stored because the probe cannot be faithfully re-run later
  (decision 3). `diagnose` is injectable like `fetchImpl` — a test that
  forgets to inject it would hit the network.
- `send()` **awaits** the diagnosis: the failure block appears once the
  probe has settled, up to the 5 s timeout on a host that black-holes the
  connection. Accepted rather than split into a two-phase render:
  `meter.fail()` has already turned the rail red before the probe starts
  (the immediate signal is intact), a refusal or a DNS failure rejects in
  milliseconds, and the full timeout is reserved for the one case where
  waiting is the only way to learn anything. The scenario runner shares
  the pipeline and so pays the same wait per failed step, multiplied on a
  `continueOnFailure` chain against a dead server: kept on purpose,
  because §8 promises its entries carry the data for a later rendering,
  and a per-caller opt-in would empty that promise.
- `#renderNetworkError` renders the verdict as one `alert-info` block
  after the facts box, **in place of** the generic
  `networkFailHelp` (the
  generic "possible causes" text is exactly what the verdict supersedes).
  The proxy suggestion belongs to the `cors` verdict's hint alone (when
  the proxy is configured but off) — an unreachable server does not
  suggest the proxy.
- The verdict renders in the try-it response view, fresh and archived runs
  alike; archived entries render the stored verdict without re-probing.
- The failure announcement carries the verdict label, not only "request
  failed": the alert is a container inserted whole, which no screen reader
  reliably reads, so the shared live region is what actually speaks
  (rule 15). The view owns that wording — it is the same reading its alert
  renders.
- The diagnosis runs after `meter.fail()` — the meter contract is
  untouched.

## 4. Response header intelligence

### 4.1 Header registry

One module in the core lists the recognized families. Matching is
case-insensitive on stored header names.

| Family | Headers | Parsed into | Insight shown |
|---|---|---|---|
| Rate limit | `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` (IETF draft), `X-RateLimit-*` legacy variants | `{ limit, remaining, resetSeconds }` (fields optional) | "Rate limit: 57/100 left · resets in 32 s". Warning tone when `remaining / limit ≤ 0.1` (or `remaining === 0` when no limit). |
| Retry-After | `Retry-After` (delta-seconds or HTTP-date), on status 429/503 only | `{ seconds }` | "Retry after 30 s" with a live countdown. |
| Deprecation | `Deprecation` (RFC 9745; boolean, `@unix-ts` or HTTP-date), `Sunset` (RFC 8594, HTTP-date) | `{ deprecated, deprecatedDate, sunsetDate }` | "Deprecated by the server" badge, plus the sunset date when present — and a lone `Sunset` with no `Deprecation` gets its own "sunset announced" label. Distinct from the schema-level `deprecated` flag: this is the *live* server saying so. |
| Pagination | `Link` (RFC 8288), rels `next` / `prev` (IANA `previous` aliased onto it) / `first` / `last` | `[{ rel, url }]` | Follow buttons (§4.2). |
| Correlation | First match among `traceparent`, `x-request-id`, `x-correlation-id`, `x-amzn-requestid`, `cf-ray` | `{ name, value }` | The id with a copy button — what a user pastes into a support ticket. |
| Validators | `ETag` (with `Last-Modified` as fallback) | `{ etag }` or `{ lastModified }` | Conditional-replay button (§4.2). |

Registry contract: `analyzeResponseHeaders(headers, { status, method, url,
now }) → insight[]`, a pure function over the stored `[name, value]` pairs —
usable identically on a fresh response and an archived entry (decision 3).
The two context fields beyond status/method are ones the analysis can't do
without: `url` is the base `Link` targets resolve against, and `now` is the
instant deltas are relative to — passing an archived entry's `timestamp` as
`now` is what reads a stored response as of when it arrived (§4.3), instead
of teaching the renderer to re-derive the deltas.

Each insight is `{ kind, ...parsed }`; insights carry the decisions this
spec makes, never the wording: `low` on rate limit (the threshold above),
`followable` / `replayable` (decision 5). Rendering owns every string
(rule 9).

Parsing is lenient: a malformed value yields no insight, never a broken
one. `Link` URLs resolve against the request URL and only `http(s):`
results are kept. A reset value can be a Unix timestamp (the legacy
`X-RateLimit-*` habit of most large APIs) or delta-seconds (what the IETF
draft says); the magnitude tells them apart, whichever spelling carried
the value (no real delta is decades long) — a reading of the wild, not of
a spec.

CORS caveat (stated reader-side in `try-it-network.md` §2): cross-origin, only
safelisted response headers are visible unless the API sends
`Access-Control-Expose-Headers`. The registry doesn't know or care —
absent header, no insight (decision 2). Through the proxy, everything the
proxy forwards is visible; the demo service worker is same-origin so the
demo shows the full set.

### 4.2 Actions

Both actions build on the entry's stored request and go through the normal
`send()` + history pipeline — they create ordinary history entries and
re-render the response panel exactly like a manual send. Offered only for
`GET`/`HEAD` (decision 5) — simplest honest
rule: the action replays **the stored request**, on an archived run as on
a fresh one, whatever the panel's current draft says, and the buttons say
so in their tooltip.

- **Follow link** — one button per relevant rel (`next` first, then
  `prev`; `first`/`last` only in the insight tooltip to avoid a button
  row): replays the stored method and headers against the linked URL. The
  followed URL is literal — no `{{var}}` re-resolution (the server built
  it, not the user; re-interpolating would corrupt opaque cursors). The
  new entry's `path` keeps the operation's path so history grouping is
  stable.
- **Conditional replay** — replays the stored request plus
  `If-None-Match: ⟨etag⟩` (or `If-Modified-Since` when only
  `Last-Modified` exists). The expected outcome is a `304` with an empty
  body; the point is pedagogical (show HTTP caching working) and
  practical (verify the API honors validators). No special-casing of the
  304 rendering: the status pill already handles it.

The two actions live in the try-it panel only. The history detail shows
the same chips with no pipeline behind them — an action "re-renders the
response panel exactly like a manual send", and the history list has no
response panel to re-render (its own Replay button, which predates this
feature and doesn't go through `send()`, is a separate mechanism).

### 4.3 Rendering

A single **insight strip** under the response mockup's header bar (above
the body panel), present only when at least one insight exists: a
wrapping row of compact chips, each chip an icon-free label + value,
actions as `btn-xs` buttons at the end of the row. Static class maps for
tones (rule 2): neutral, warning (rate limit low, retry-after), accent
(deprecation).

One renderer, `src/components/insight-strip.js`, two **surfaces**: the
try-it mockup is a navy panel outside the theme (fixed colors, like the
rest of `view-bits.js`), the history detail is the ordinary page (daisyUI
badges). Two static skins (rule 2), chosen by a `surface` option — the
"same pure renderer" holds for everything except the background.

The strip carries `data-insight-strip`: the decision-2 regression guard
asserts an *absence*, and an absence is only assertable against a name.

A deadline is anchored on the **response**, not on the render. Both
reset-header forms reduce to `entry.timestamp + resetSeconds` once the
analyzer has read them against the entry's own clock — which is why `now`
is always the entry's timestamp (§4.1) and `live` only decides between a
ticking countdown and the clock time. Anchoring on render time would
restart the countdown every time the panel switched to the example and
back. The history detail renders minus live countdowns: an archived reset
time renders as the absolute time, not a countdown to a past instant.

Accessibility: the strip is plain content (no live region — it arrives
with the response, which is already announced); action buttons carry
i18n'd labels; countdown text updates are `aria-hidden` duplicates of a
static accessible label, so a screen reader isn't spammed every second
(same pattern as the send-meter's scrolling numbers).

## 5. Transfer insights

### 5.1 Capture

`send()` already locates the Resource Timing entry to extract server
timing. The same lookup also snapshots, when the entry is present:

```js
transfer: {
  protocol,          // nextHopProtocol: 'http/1.1' | 'h2' | 'h3' | '' 
  transferSize,      // bytes on the wire incl. headers, 0 = cache or opaque
  encodedBodySize,   // body bytes before decompression
  decodedBodySize,   // body bytes after decompression
  fromCache,         // deliveryType === 'cache' when supported,
                     // else transferSize === 0 && encodedBodySize > 0
}
```

Stored on the history entry (decision 3: the RT buffer is transient and
capped — default 250 entries — and the app must not resize the host
page's buffer; reading immediately after completion, as today, is the
whole strategy). Cross-origin without `Timing-Allow-Origin` all sizes read
0: the capture stores `transfer: null` when `encodedBodySize === 0 &&
transferSize === 0` — indistinguishable from "no data", so treated as no
data (decision 2). `nextHopProtocol` alone survives some TAO-less cases;
if it is the only non-empty field, store just it.

Known limit, accepted: `getEntriesByName(url)` takes the last entry, so
two concurrent sends to the same URL can mis-attribute the snapshot. This
is the existing behavior for `serverMs`; not worse, not fixed here.

### 5.2 Display

Three facts, appended to the insight strip (§4.3) — transfer and header
insights share one row:

- **Protocol badge** — `HTTP/1.0`, `HTTP/1.1`, `HTTP/2`, `HTTP/3` from a
  static map
  of known `nextHopProtocol` values (`http/1.0`, `http/1.1`, `h2`, `h2c`,
  `h3`); unknown value → no badge.
- **Compression** — when `decodedBodySize > encodedBodySize > 0`:
  "12.4 kB on the wire → 85.2 kB (×6.9)" — "on the wire" sits next to
  the number it describes. No chip when not compressed (decision 2 —
  uncompressed is the unremarkable default, not a finding).
- **Cache** — "from cache" chip when `fromCache`. The duration shown next
  to it is then the browser's, not the network's; the chip's tooltip says
  so.

Byte formatting: the chip uses the same `formatBytes` (`view-bits.js`) as
the send meter above it, so the two speak the same units. The settings
panel keeps its own formatter: it floors at 1 KB, which is right for a
storage inventory and wrong for a payload.

### 5.3 HAR export

The HAR generator maps the stored snapshot onto standard fields:
`response.bodySize` = `encodedBodySize`, `response.content.size` =
`decodedBodySize` (falling back to the stored body's length when the
snapshot has no decoded size), `response.content.compression` =
`decodedBodySize -
encodedBodySize`, `_transferSize` = `transferSize` (the underscore field
is the de-facto Chrome extension; emitted only when the snapshot saw
encoded bytes, so a protocol-only snapshot adds nothing to the HAR).
Those four mappings, and only those:
`httpVersion` still says `HTTP/1.1` by default even though the snapshot
may know better — a deliberate non-change. Entries without a snapshot
keep the
pre-snapshot values (snapshot tests cover both).

## 6. Architecture

- **`src/openapi/insights.js`** (core, pure, no DOM): header registry +
  `analyzeResponseHeaders`, `diagnoseFailure(context) → verdict` decision
  logic (probe injected as a function, like `fetchImpl` in `send()`),
  transfer-snapshot extraction. Vitest-covered (rule 16). `insights.js`
  reads what the network did; the two functions that *write* a request
  from a stored entry — `followRequest` / `conditionalRequest` — live in
  `src/openapi/request-builder.js`, the module that owns the `built`
  shape they emit.
- **`src/openapi/send.js`**: calls the probe on catch, snapshots transfer
  on success, threads both into the result; `historyEntry`/`applyResult`
  carry the two fields. The meter contract is untouched.
- **Components**: insight strip renderer shared by the try-it panel and
  the history detail; verdict block in `#renderNetworkError`; action
  buttons wired to the panel's send path — the panel's `#dispatch(built)`
  is everything a send does once the request exists; its callers are the
  Send button, the strip's actions, and the host-credentials
  expired-token retry (`host-credentials.md` §5). Request
  shaping never leaks into a component.
- **Storage impact** (rule 8, rule 13): two nullable fields on history
  entries (`diagnosis`, `transfer`), covered by the existing history
  TTL/cap policy — no new dataset, no policy change. Entries predating
  the feature simply lack the fields.
- **Core vs shell** (rule 10): nothing here reads host config; the proxy
  URL already flows through the existing send options.
- **Security** (rule 5): header values and link URLs are rendered as text
  nodes (the codebase's `el`/`text` helpers), never HTML; `Link` URLs are
  scheme-filtered before becoming actions.
- **i18n** (rule 9): all strings under `tryit.insights.*` and
  `tryit.diag.*`, en + fr.
- Known cost, accepted: the history list builds every row's collapsed
  content eagerly, so the strip's header parsing runs for every entry on
  every keystroke in the filter. The row already highlights its whole
  JSON body through highlight.js on the same path — the strip is a
  rounding error next to it, and making the collapsed content lazy is a
  change to that component's own design, not to this feature.

## 7. Testing

Vitest (core):

- Diagnosis decision table: each verdict, probe injected (resolve /
  reject / timeout), proxied-URL wording flag, `onLine` false.
- Header registry: standard and legacy rate-limit shapes, delta vs
  HTTP-date `Retry-After`, `Retry-After` ignored outside 429/503,
  `Deprecation` boolean and timestamp forms, `Link` multi-rel parsing +
  relative URL resolution + scheme filtering, correlation-id precedence,
  malformed values yielding no insight.
- Transfer extraction: TAO-less all-zeros → `null`, cache detection with
  and without `deliveryType`, protocol passthrough.
- HAR mapping with and without a snapshot (snapshot tests).
- `followRequest` / `conditionalRequest` (with `request-builder.js`).

Playwright (packed bundle, e2e fixtures — the fixture server sets the
showcase headers; same-origin so everything is exposed):

- A failed send against an unreachable port shows the raw error *and* an
  `unreachable` verdict.
- The `cors` verdict: a real CORS block can't be staged under Playwright
  (a fulfilled response bypasses the browser's CORS check), so the
  fixture stages what the app *observes* — everything it really sends
  fails, only the opaque probe is answered.
- A response carrying rate-limit + `Link` + `ETag` headers shows the
  insight strip; "next" follows and renders the second page as a new
  history entry; conditional replay yields a 304 (skipped on WebKit —
  `cross-browser.md` §4.5).
- A response with none of the recognized headers shows no strip
  (decision 2 regression guard, asserted via `data-insight-strip`).
- Transfer chips: no e2e stages a real compression — Playwright's
  fulfilled responses make Chromium report the same size for the encoded
  and the decoded body, and `nextHopProtocol` comes back empty. The guard
  decorates an entry the app itself wrote with the snapshot a real
  h2 + gzip exchange leaves, and asserts the reading; the capture side is
  Vitest-covered.
- axe sweep stays green with the strip visible (rule 15).

Demo: `demo/mock-sw.js` carries showcase headers (rate limit with a
decrementing counter, `Link` pagination on a list endpoint, `ETag` on a
stable resource, one deprecated endpoint sending `Deprecation` +
`Sunset`) so the feature is visible in both demo pages without any real
backend. The demo paginates one pet per page: the playground holds four,
and any larger page would leave `Link` with nothing to point at.

## 8. Out of scope (recorded so they aren't re-litigated)

- Live online/offline banner and pre-send blocking on mixed content.
- Full DNS/TCP/TLS waterfall (needs `Timing-Allow-Origin`, which only a
  proxy could grant).
- Full `Server-Timing` table (the meter's single-number split stays).
- Console logging of sends, error capture for diagnostics — separate
  ideas, out of scope here.
- Scenario UI surfacing of insights (the entries already carry the data —
  only the rendering is out of scope).
