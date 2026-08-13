# Try-it networking — CORS, credentials, OAuth2

What actually happens on the wire when a reader clicks "Send", and what the
API side must allow for it to work — the page the README links to, written
for whoever hosts the documentation. The in-app behavior it describes is
specified in [`architecture.md`](architecture.md) §5.4–§5.5 and §5.15, and
what the app makes of a failed or unusual answer is
[`network-insights.md`](network-insights.md).

## 1. CORS: the honest constraint

Test requests are sent by the reader's browser with a native `fetch`: the
API under test must allow the docs' origin (CORS). This is a property of
the zero-backend design, not a bug — there is no server of ours in the
middle to launder the origin.

When the API does not (or cannot) allow the origin, configure a proxy with
`tryIt.proxyUrl` — a URL template where `{{target}}` is replaced by the
encoded target URL. **The app ships no proxy**: host your own. When a proxy
is configured, a toggle appears in the panel; it is off by default.

CORS failures are distinguished from other network errors and explained in
the UI, with the proxy suggested when one is configured — the detection
ladder and its wording live in [`network-insights.md`](network-insights.md).

## 2. Response headers you can't see

Without `Access-Control-Expose-Headers` on the API side, only the browser's
safelisted response headers (`Content-Type`, `Cache-Control`, …) are
readable cross-origin. The response view flags that its header list may be
incomplete — a browser limitation, not a lost header.

## 3. Session cookies (`tryIt.requestCredentials`)

For an API authenticated by a **session cookie** (httpOnly), the browser
neither stores nor sends the cookie cross-origin by default. Set
`tryIt.requestCredentials: "include"` in the config. The server must then
respond `Access-Control-Allow-Credentials: true` with an **explicit**
origin (not `*`), and the cookie must be `SameSite=None; Secure`. If the
docs are hosted on the API's own origin, the `"same-origin"` default is
enough.

⚠️ `"include"` is **incompatible with `Access-Control-Allow-Origin: *`**:
the browser rejects the preflight ("No Allow Credentials") even when there
is no cookie to send. So the right mode depends on the target API — which
is why `tryIt` is overridable per spec: in multi-spec, set it on the
relevant `specs[]` entry rather than at the root (it merges key by key):

```json
{ "id": "billing", "url": "…", "tryIt": { "requestCredentials": "include" } }
```

Valid values are `"omit"`, `"same-origin"` (default) and `"include"`;
anything else falls back to the default with a console warning
([`multi-spec.md`](multi-spec.md) §2).

## 4. OAuth2 flows, without a backend

For `oauth2` schemes, the Credentials card can run two flows entirely
in-browser: **Authorization Code + PKCE** (full-page redirect to the
authorization server, return to the docs, code exchange in the browser)
and **client credentials** (direct POST to the token endpoint). The
obtained token is stored as the sensitive variable `auth.X` of the active
environment — the manual token field remains the fallback for every other
flow.

Requirements, per flow:

- `oauth: { "schemeName": { clientId: "…" } }` in the config provides the
  default clientId; the `auth.X.clientId` environment variable overrides
  it.
- The `redirect_uri` sent is the host page URL (without hash): it must be
  registered as-is with the authorization server.
- The token endpoint must allow the docs' origin in CORS — it is a fetch
  from the browser, like any try-it call (§1 applies).
- **No secret in the config**: the host page is public. The client secret
  (client credentials flow) is entered in the UI and kept as a sensitive
  browser-side variable, never in the config.

In multi-spec, the PKCE return trip carries the spec id, so the token
always lands in the environment of the spec that started the flow
([`multi-spec.md`](multi-spec.md) §6). If your backend can mint a token
for the reader's existing session, skip the flows entirely and hand the
token over at runtime: [`host-credentials.md`](host-credentials.md).
