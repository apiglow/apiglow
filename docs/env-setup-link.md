# Environment setup link

Status: **implemented**.
This document is the functional source of truth for the feature, alongside
[`architecture.md`](architecture.md) (§5.3 bullet, §6.2 bound, §8 security
bullet).

## 1. What this is

A single URL that configures a teammate's environment. A lead dev sets up
"Staging" once — base URL, tenant header, the names of the credential
variables — and hands the team one link. Opening it shows exactly what it
will write, asks, and on acceptance creates or updates that environment and
selects it. No backend, no account, no server round trip: everything travels
in the URL fragment.

The reference point is ReadMe's Personalized Docs, minus the server that
makes it personalized. What we can do without a server is *the setup*, once,
by hand, from someone who already did it.

This is one of two credential-provisioning features and the two do not
compete:

| | This feature | [`host-credentials.md`](host-credentials.md) |
|---|---|---|
| Transport | URL fragment, human to human | `window.apidoc` provider, host page code |
| Trust | untrusted input, explicit gesture required | host-page code, same trust as the page |
| Lifetime | **persisted** in the environment (that is the point) | ephemeral, memory only, re-asked every load |
| Needs | nothing — works on a bare CDN install | a host backend that can mint a token |
| Fills | the whole environment, once | `auth.X` only, continuously |

A static docs page on a CDN with no host code is exactly where
`host-credentials.md` cannot help, and it is this feature's whole
constituency.

## 2. Product decisions (settled)

1. **Never a silent write.** A setup link opens a preview and writes
   nothing until the user presses Apply. Same rule the scenario share link
   already follows (architecture §8), same reason: a URL is not a mandate.
2. **The fragment, never the query string.** A fragment is not sent to the
   server, does not appear in access logs, and is not carried in the
   `Referer` header. The generator can only produce fragment links
   (`setupLinkHash` in the router builds the hash and replaces the current
   URL's fragment, so no code path can put the payload in the real query
   string — structural, and asserted in a test rather than left to
   discipline).
3. **Scrub before anything renders.** The payload is read off
   `window.location.hash` at boot, the URL is rewritten with
   `history.replaceState` before the router ever runs, and the payload lives
   in memory from then on. `replaceState` replaces the current history
   entry, so the credential-bearing URL is not in session history either.
4. **A skeleton is the default, secrets are opt-in per variable.** Rule 12
   says exports redact sensitive values by default and this is an export.
   The generator therefore ships variable *names* and non-sensitive values,
   and every sensitive value costs a deliberate checkbox plus a warning. The
   80 % case does not need the secret anyway: what teammates lack is the
   base URL, the tenant header and the knowledge that the variable is called
   `auth.bearerAuth`, not each other's tokens.
5. **An empty value never overwrites a filled one.** Re-opening a skeleton
   link must not wipe the token a teammate already pasted. Concretely: a
   link variable whose value is empty leaves a non-empty local value alone,
   and the preview says "kept".
6. **Match by name, never duplicate.** An environment whose name matches is
   *updated*, and the preview shows the diff; otherwise it is created.
   Variables the link does not mention are never touched and never deleted —
   a setup link adds and sets, it does not prune.
7. **Locked environments refuse the link outright.** Under
   `environmentsLocked` the config is authoritative on the set and structure
   of environments (architecture §5.3), and a link is a competing authority.
   It is also a case that cannot arise honestly: an installation whose host
   page owns the environments already has the power the link emulates, and
   its lead dev edits the config instead. Refuse, say why, write nothing.
8. **One link, one environment.** No multi-environment payload, no partial
   application. A payload that fails validation anywhere is rejected whole —
   half an environment is worse than none, because it looks configured.
9. **The link is bounded input** (§3.3). Environments are the one
   localStorage dataset with no numeric cap, and §6.2 justifies that by
   "each entry is user-typed". This feature is what would make that sentence
   false, so the caps live here instead.

## 3. The link

### 3.1 Shape

A bare top-of-hash shape (say `#auth-setup=…`) cannot work: the hash
belongs to the router (`#/op/{id}`, `#/page/{slug}`, `#/s/{specId}/…`), and
such a hash would parse as an unknown route and lose the destination. The
app already has a convention for exactly this — an opaque payload riding as
a **pseudo-query of the hash**, used by request sharing (`?req=`) and
scenario sharing (`?d=`):

```
https://docs.example.com/#/?setup=eyJ2Ijox…
https://docs.example.com/#/s/petstore/?setup=eyJ2Ijox…
https://docs.example.com/#/op/getPetById?setup=eyJ2Ijox…
```

Because it is a parameter and not a route, the link keeps its destination:
"here is the endpoint I mean, already configured" is one link, not two.

### 3.2 Payload

base64url JSON — `toBase64Url` / `fromBase64Url` from
`src/export/share.js`, already the codec of both other share links.

```jsonc
{
  "v": 1,
  "spec": "petstore",              // multi-spec only; omitted in mono-spec
  "env": {
    "name": "Staging",
    "baseUrl": "https://staging.example.com/v3",
    "color": "amber",              // through normalizeEnvColor; unknown → none
    "vars": [                      // [name, value, sensitive]
      ["auth.bearerAuth", "", true],
      ["tenant", "acme", false]
    ],
    "headers": [["X-Tenant", "acme"]]
  }
}
```

Compact pair/triple arrays rather than objects, for the same reason
`encodeShareState` uses them: this travels in a URL and every key name is
paid for twice, once in base64 and once in percent-encoding.

`sensitive` travels even when the value does not — the flag is the sender's
statement that this variable *is* a secret, and it is what makes the
recipient's field masked from the moment it is created. Losing it would mean
the first teammate to paste a token gets an unmasked one.

### 3.3 Caps

Decoding is total: any deviation returns `null`, never throws (the
`decodeShareState` discipline, and for the same reason — this is a URL).
A name appearing twice — variables or headers — rejects the link too: a
duplicate would preview twice and write once, which is decision 8's own
reasoning. Beyond shape, the payload is bounded:

| Bound | Value | Why |
|---|---|---|
| decoded payload | 8 KB | ~11 KB of base64, already past what any chat client forwards intact; a hard stop long before localStorage is at risk |
| variables | 50 | more than any real environment; the same order as `tryit.headers`' 50 names |
| default headers | 20 | |
| name length | 200 chars | variable names, header names, environment name |
| value length | 4 KB | a JWT is ~1 KB; 4 KB is generous and still bounded |

Over any bound, the whole link is rejected (decision 8) with the same
invalid-link message as a corrupt payload. The distinction matters to a
developer reading the console, not to the user: `console.error` carries
which bound failed, the UI does not.

### 3.4 Generation

In the environment manager, a band of its own — not two more buttons in the
CRUD toolbar, which is where the feature started and where it read as a
third way to mutate the environment, at Delete's weight and behind a label
("Share as link") that only meant something to someone who already knew.
The band names the job first ("Set a teammate up — one link configures
their environment"), then offers the two ways in: **"Share “{name}”"**,
which is this environment and says which, and the §3.5 builder beside it.
Sharing opens a dialog of its own (`env-share-dialog.js`): a generator is
not the environments editor, and the manager owns neither of the two.

- A checklist of everything that can travel: base URL, color, each default
  header, each variable. Non-sensitive rows are checked by default;
  **sensitive rows are unchecked** (decision 4) —
  `defaultSetupSelection(env)` gives the dialog its initial state, from the
  same core that encodes. An unchecked variable still travels *by name*,
  with an empty value — that is the skeleton, and the rule lives in the
  core encoder (`encodeSetupLink(env, selection, { specId })`), not in the
  dialog's checkboxes: the selection is read strictly (an absent key = not
  selected), so a partial selection can only ever under-share. An
  unselected *header* does not travel at all — unlike a variable, its
  value is its whole point.
- Checking the first sensitive row reveals a warning, once, in place:
  anyone holding this link holds this credential, and a link lives on in the
  chat that carried it. The warning is text, not a confirm dialog — it must
  be readable while deciding, not dismissed before.
- The link renders in a read-only field with a copy button
  (`copy-button.js`).
- Length is shown, with a warning past **2000 characters**
  (`SETUP_CAPS.urlWarnChars`): below that every chat client, issue tracker
  and browser forwards a URL intact; above it, some truncate silently,
  which is the worst failure mode a link has.
- Locked mode has no generation entry point, because the manager itself is
  not instantiated there (architecture §5.3) — consistent with decision 7 by
  construction rather than by a second check.

### 3.5 The builder

§3.4 generation starts from an environment the lead already owns: to hand
the team a link, they must first create the environment locally, with
values they may not want to keep. The builder removes that requirement —
a from-scratch form that produces the same link without an environment
ever existing on the lead's machine.

Decisions:

1. **A pure generator.** The builder writes nothing, ever — not even
   non-silently. Generating a link is not creating an environment; the
   dialog has no persistence path at all. A lead who also wants the
   environment locally opens their own link (§4) and applies it, through
   the one write path that exists.
2. **Same codec, same caps.** The form builds a transient environment
   object and an all-selected selection, and feeds the existing
   `encodeSetupLink(env, selection, { specId })`. No second encoder — the
   website's demo form re-implementing the payload by hand is exactly the
   duplication this feature retires. The builder refuses to encode a form
   that violates a §3.3 cap (row counts, lengths, a name used twice), live,
   instead of producing a link the landing would refuse — and the last word
   on that is `decodeSetupLink` itself, run on what was just encoded, which
   is also the only practical check of the byte cap. The form's messages
   name the bound that failed, unlike the landing's (§3.3): here the person
   reading them is the one who can fix it.
3. **Two entry points, one dialog.** A dedicated component
   (`env-setup-builder.js`, like §3.4's own dialog — the manager holds no
   generator):
   opened from the §3.4 band ("Build from scratch" — *build*, not *create*,
   because decision 1 means nothing is created; it is also the only action
   that band shows when there is no environment to share) and from a card on
   the overview/welcome view — the place a lead actually lands. The card
   needs its **own** `environmentsLocked` check: decision 7 is enforced
   for the manager by non-instantiation, and that construction does not
   cover a card living on the overview.
4. **Sensitive rows default to the skeleton.** A variable row is name,
   value, a *sensitive* flag and a *carry the value* checkbox — carry
   unchecked by default for sensitive rows, with the §3.4 warning revealed
   on first check. An uncarried variable travels by name with an empty
   value, exactly as §3.4 defines the skeleton.
5. **Preview as recipient.** One button closes the builder and sets the
   current page's hash to the generated link. The §4.1 mid-session arrival
   scrubs it and opens the landing dialog — the lead sees exactly what the
   recipient will see because it *is* the recipient's dialog, not a
   rendering of it. The preview cannot drift from the landing, for the
   same reason `planSetup` exists: one code path. Cancel writes nothing;
   Apply is a real apply, and the builder says so next to the button.
6. **Multi-spec targets the active spec** — the `spec` field is encoded as
   in §3.2; building for another spec means switching to it first, same
   stance as §8.

Form fields: environment name (required), base URL, color (the
`normalizeEnvColor` palette), variable rows, default-header rows. Text
fields re-encode on `input` rather than on blur — the link is the thing
being built, and it tracks the form as it is typed; only structural changes
(a row added or removed, the sensitive flag, the color) rebuild the form.
Below them, the same output as §3.4 — literally the same component
(`setup-link-output.js`): the link in a read-only field with a copy button,
and the `SETUP_CAPS.urlWarnChars` length warning. The builder adds no codec
of its own, which is the assertion decision 2 makes: what it contributes to
`src/env/setup-link.js` is the form's shaping and its bound *codes*, on the
same side of the line as `defaultSetupSelection` and for the same reason.

## 4. Landing

### 4.1 Sequence

1. **Scrub.** Before the router starts, `parseSetupLink(window.location.hash)`
   returns `{ payload, scrubbedHash }`; the shell calls
   `history.replaceState(null, '', scrubbedHash)`. `replaceState` does not
   fire `hashchange`, so `startRouter`'s initial emit reads the clean hash
   and the rest of the app never learns the link existed. The scrub is
   purely textual, so a `#/s/{specId}/` prefix survives it and spec
   resolution (`specs.js` §4.2) is unaffected.

   A link can also arrive **without a boot**: pasted into the address bar
   of a tab already on the docs page, it changes the hash of the same
   document and `boot()` never runs again. The router callback therefore
   performs the same scrub-then-preview when a payload appears
   mid-session — decision 3 is about the URL, not about how the app
   happened to start. Guarded by its own e2e.
2. **Decode.** `decodeSetupLink(payload)` → payload or `null`.
3. **Refuse, with a reason.** Three refusals, each its own message,
   each writing nothing:
   - invalid or over-cap payload → `envSetup.invalid`;
   - `spec` present and ≠ the active spec id → `envSetup.wrongSpec`, naming
     both. This check is belt and braces: an unknown `#/s/{id}/` already
     falls back silently to the default spec, and a silent fallback here
     would write staging credentials into the wrong API's environment;
   - `envStore.locked` → `envSetup.locked`.
   A refusal is a toast, not a full-page error: the link rides on a real
   route and that route must still render.
4. **Preview.** Otherwise a modal dialog, opened after the first render so
   the documentation is visible behind it — deferred by a microtask, never
   by an animation frame. The payload has left the URL and lives only in
   memory, so anything waiting on a *paint* loses the link outright in a
   document that is never painted (background tab, occluded window,
   prerender), and loses it silently: no dialog, no toast, no console line.
   Guarded by its own e2e.
5. **Apply or cancel.** Cancel discards the payload; there is no "later",
   and the dialog says so, because the URL is already gone.

### 4.2 The plan, computed in the core

`planSetup(payload, { env })` — pure, tested — turns the payload and the
matching environment (or `null`) into what the dialog renders and what apply
executes. One function, so the preview cannot promise something the write
does not do:

```js
{
  mode: 'create' | 'update',
  name,
  baseUrl: { from, to } | null,   // null when unchanged or not carried
  color:   { from, to } | null,
  variables: [{ name, action, sensitive, value }],
  headers:   [{ name, action, value }],
}
```

`action` is one of:

- `add` — the variable does not exist locally; it is created, with the
  link's `sensitive` flag;
- `set` — it exists and the link carries a non-empty value that differs;
- `keep` — the link carries an empty value and the local one is non-empty
  (decision 5), or the values are already identical.

`sensitive` on a plan row is the **effective** flag — the link's on `add`
rows, the local variable's otherwise — because the preview masks by it,
and a `set` over a locally-sensitive variable rendered unmasked is exactly
what §4.3 forbids. The *write* applies sensitivity on creation only, which
is `EnvStore.setVariable`'s existing contract: a choice made in the
environment manager is never overwritten, and a link is not a reason to
make it the exception.

### 4.3 Rendering

The dialog is a plain daisyUI `dialog` opened through `openModal`
(`a11y.js`), so focus is trapped and returned on close (rule 15).

- A one-line verdict: environment *created* or *updated*, by name.
- Base URL and color as before → after, the "before" only on update.
- A table of variables: name, what happens (`add` / `set` / `keep` as
  i18n'd words, never colour alone), and the value — masked as `••••` when
  the row is sensitive and carries a value, rendered as an explicit "empty,
  you fill it in" when it carries none. A sensitive value is never revealed
  in the preview; the user is accepting a credential, not reading one.
- Default headers, same treatment.
- Apply / Cancel. Apply writes, selects the environment, closes, toasts and
  `announce()`s the outcome (rule 15 — the write is async from the user's
  point of view and a toast alone is not heard).

All strings under `envSetup.*`, `en` + `fr` (rule 9).

## 5. Security and privacy

- **Trust boundary**: the payload is untrusted input from a URL, handled
  like `decodeShareState` — total decode, no throw, every field
  re-typed, everything unrecognized dropped. It can only ever produce
  environment content: names, string values, a color from a closed palette.
  It cannot name a storage key, reach another spec's environments (§4.1,
  refusal 2), or execute anything (no scripting surface anywhere in the app,
  architecture §8).
- **What the scrub does and does not buy.** It removes the credential from
  the address bar and from session history. It does not remove it from the
  chat message that carried it, the recipient's clipboard, or a browser
  profile that syncs typed URLs. The generator's warning (§3.4) says this in
  the one place where someone can still act on it, and this document does
  not pretend the scrub is more than half a mitigation.
- **A link with no secret has no such problem**, which is why the skeleton
  is the default and not merely the recommendation.
- **Storage** (rule 8, rule 13): no new dataset and no new mechanism —
  writes go through `EnvStore`, which is the existing `environments`
  localStorage key. What changes is the *justification* of its
  uncapped-ness, and §3.3 is the replacement. `storageInventory()`
  (`src/storage/maintenance.js`) needs no new entry: applying a link adds
  no localStorage key beyond `environment.selected`, which the inventory
  already declares — so no dataset survives a purge the settings panel
  claims to have done. Checked, not deduced: the assertion lives in
  `tests/e2e/env-setup-link.spec.js`.
- **Redaction** (rule 12): a variable created by a link with
  `sensitive: true` is sensitive from birth, so every existing export path
  redacts it with no change — it reaches `src/export/redact.js` through
  the same `EnvStore` field as any other secret, and is masked in the
  history like one. Also checked in `tests/e2e/env-setup-link.spec.js`
  rather than deduced.
- **Core vs shell** (rule 10): the codec, the caps, `planSetup` and
  `applySetupPlan` are core and know nothing of `window`; the shell owns the
  hash (reading it, calling `replaceState`), the three refusals and the
  toast. The plan and its execution sit side by side on purpose — they have
  to agree on the `keep`/`add`/`set` vocabulary, and a preview that promises
  what the write does not do is the failure this feature has to exclude.

## 6. Architecture

| Where | What |
|---|---|
| `src/env/setup-link.js` (core, pure) | `encodeSetupLink(env, selection, { specId })`, `defaultSetupSelection(env)`, `decodeSetupLink(encoded)`, the §3.3 caps and the §3.4 URL warning threshold (`SETUP_CAPS.urlWarnChars`), `planSetup(payload, { env })`, `applySetupPlan(plan, { envStore, env })`. Also the generators' shared side: `setupSharesSecret(env, selection)` — the one definition of "a secret travels", which §3.4 and §3.5 both warn on — and the §3.5 form's shaping, `setupFormPayload(form) → { env, selection }` (trimmed names, untrimmed values, blank rows dropped) plus `setupFormIssues(env)` returning bound *codes*. No DOM, no `window`. |
| `src/router.js` | `parseSetupLink(hash) → { payload, scrubbedHash }` — pure and textual: strips the `setup` pseudo-query parameter, drops the `?` if nothing else remains, falls back to `#/` only when an actual scrub reduced the hash to nothing (a hash without the parameter is returned unchanged, never rewritten). `setupLinkHash(encoded)` builds generator links (decision 2, structural). `parseHash` is untouched. |
| `src/app.js` (shell) | Scrub at boot before `startRouter` and on every hash-only arrival (one `takeSetupLink`); decode; the three refusals; open the preview after first render; call `applySetupPlan`, then toast and announce. Mounts the §3.5 builder, hands the welcome view the card behind its own `environmentsLocked` check, and performs the preview-as-recipient hash write. |
| `src/components/env-setup-dialog.js` | The §4.3 preview, driven entirely by the `planSetup` result. |
| `src/components/env-setup-builder.js` | The §3.5 form, transient state only, encoding through the core on every edit; the wording of the refusals, mapped from `setupFormIssues`' codes; plus `setupBuilderCard()`, the overview entry point (the caller owns the locked check). |
| `src/components/setup-link-output.js` | The §3.4 output block — read-only field, copy button, length and secret warnings — shared by the two generators. |
| `src/components/env-color-picker.js` | The closed-palette color choice, shared by the manager's editor and the builder's form. |
| `src/components/env-fields.js` | The row controls the two environment editors share: `envValueBox` (masking, eye toggle, the `basis-40` narrow-screen answer) and `removeRowButton`. |
| `src/components/env-share-dialog.js` | The §3.4 generator: the row-by-row checklist over `defaultSetupSelection`, the encoding, and the shared output block. Its own element and not a modal inside the manager — the manager edits environments, and a generator that moved in would make it the place every environment-shaped dialog accretes. |
| `src/components/env-manager.js` | The §3.4 band and nothing of the link itself: two buttons calling `onShare(env)` and `onBuild()`, both wired by the shell, which is also what gates them on `environmentsLocked`. Its editor box is tagged `data-env-editor`, which the shared e2e helpers target rather than "the `.modal-box`". |
| `src/i18n/en.json`, `i18n/fr.json` | `envSetup.*`, both languages. |
| `docs/architecture.md` | §5.3 bullet, §6.2 justification, §8 security bullet. |
| `CONTRIBUTING.md` | Feature→test map row (rule 16). |

No new runtime dependency, no OpenAPI construct touched — so no README note
and nothing for `docs/openapi-coverage.md`.

## 7. Testing

Vitest (`tests/env-setup-link.test.js`), pure core:

- round trip: encode → decode returns the same environment, sensitive flags
  included;
- decode of garbage, of valid base64 that is not JSON, of JSON with `v ≠ 1`,
  of every field at the wrong type, of a duplicated name → `null`, never a
  throw;
- each §3.3 cap, at the bound and one past it → `null` past it;
- `planSetup` on a missing environment → `mode: 'create'`, every variable
  `add`;
- `planSetup` on a matching name → `mode: 'update'`, with: empty link value
  over a filled local value → `keep` (decision 5); a link variable absent
  locally, even empty over an empty store → `add`; differing values →
  `set`; identical values → `keep`; a local variable the link does not
  mention → absent from the plan (decision 6);
- `sensitive` on every plan row is the effective flag (§4.2): the link's on
  `add`, the local variable's on `set`/`keep`;
- the builder's side of the same codec (§3.5): a transient environment built
  from form-shaped rows round-trips through encode → decode, an uncarried
  sensitive row travelling by name only; and each shape the form refuses —
  past a row cap, a name or value cap, the byte cap, a name used twice —
  produces a payload the landing refuses, which is *why* the form refuses it.

`tests/router.test.js`:

- `parseSetupLink` on each route shape, with and without the parameter,
  with a `#/s/{id}/` prefix, with `setup` alongside `req`; the scrubbed hash
  is byte-identical to the input minus the parameter; a hash reduced to
  nothing becomes `#/`.

Playwright (`tests/e2e/env-setup-link.spec.js`), packed bundle:

- **create**: open a link built by the encoder → dialog lists the
  environment; Apply → the environment exists, is selected, its variables
  are set; **and `page.url()` contains no `setup=` before any gesture**
  (decision 3, asserted first, because it is the guarantee that cannot be
  checked afterwards);
- **mid-session arrival**: a `setup` hash set on the already-running page
  is scrubbed and previewed the same way (§4.1);
- **no paint required**: with `requestAnimationFrame` neutralised, the
  preview still opens and still applies (§4.1 step 4);
- **cancel**: nothing is written and the URL is still clean;
- **update + skeleton**: an environment with a token already set, re-opened
  with a skeleton link → the token survives, the new variables land, the
  preview said `keep`;
- **secret masking**: a link carrying a sensitive value shows `••••`, never
  the value, in the DOM;
- **invalid** link → toast, no dialog, route still rendered;
- **wrong spec** in multi-spec → refusal naming both specs, and the other
  spec's environments are untouched;
- **round trip**: generate from the manager, read the field, reopen the app
  on that URL, apply, compare — one test that both halves are the same
  codec;
- **generator defaults**: sensitive rows unchecked, the warning appears only
  once a sensitive row is checked, the link is a fragment link (decision 2);
- **builder** (§3.5): a form nobody saved produces a fragment link, the
  skeleton by default and the warning on carrying a secret, with storage
  unchanged throughout (decision 1); an over-cap or duplicated-name form
  empties the field, names the bound and disables the preview, then recovers
  in place; preview-as-recipient opens the landing dialog on an
  already-scrubbed URL, Apply creates the environment and Cancel leaves
  `apidoc:environments` byte-identical; the manager's toolbar action opens
  the same dialog;
- the §5 storage-inventory and redaction assertions.

`tests/e2e/env-locked.spec.js`:

- a setup link under `environmentsLocked` → refusal message, no dialog, no
  environment created or modified;
- no builder either: no overview card, no element mounted, no manager action
  (§3.5, decision 3).

`tests/e2e/a11y.spec.js`: the preview dialog and the builder form are both in
the sweep (rule 15).

Demo: neither demo page locks its environments, so the manager's §3.4 band
(both actions) and the overview card are reachable in both with no fixture
work and no `mock-sw.js` change.

## 8. Open question

One thing this spec deliberately does not settle, because the answer is
cheap to change and expensive to guess: whether Apply should also **switch
the active spec** when a multi-spec link names a spec that is not active. It
would mean a reload (a spec change reloads the page, `multi-spec.md` §4) and
re-reading a payload that has just been scrubbed — so the payload would have
to survive the reload, in `sessionStorage`, which is a mechanism this
feature otherwise does not need. §4.1 refuses instead. Revisit only if a
multi-spec install actually reports the friction.

## 9. Out of scope (recorded so they aren't re-litigated)

- **Multi-environment links.** One link, one environment (decision 8).
- **Expiring or single-use links.** Both need a server; there isn't one.
  A link is valid until the credential in it is rotated, and that is the
  honest description.
- **A link that also carries scenarios, history or preferences.** Scenarios
  already have their own share link; the rest is not team setup.
- **Encrypting the payload behind a passphrase.** It moves the secret from
  one channel to two, which is real, but it also invents a key-exchange UX
  in a docs viewer. Revisit only on demand, and as a layer over this exact
  payload.
- **A declarative setup URL in the host config.** That is
  `host-credentials.md` §10's built-in-provider extension, not this feature.
