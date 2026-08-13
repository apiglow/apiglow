# User overlay

This document is the functional source of truth for
the feature, alongside [`architecture.md`](architecture.md) (§5.1.2 for the
overlay pipeline it extends, §5.11 for the editor's placement, §6.2 for its
key, §14.17 for two of the decisions below).

## 1. What this is

The schema is wrong and it is not yours. A parameter typed `string` that
the server rejects unless it is a number, a missing server URL, a required
field the API stopped requiring — and the owner is another team, another
company, or a ticket queue. Today the app renders the schema as published
and the user is stuck: the try-it builds requests from a model they know
to be false.

A **user overlay** is an OpenAPI Overlay 1.1 document authored by the
user, in the app, applied to the schema on top of everything the host
declared. It is the standing workaround: fix the document locally, keep
testing, and — because the fix is a *standard* overlay file — hand it
upstream when the owner is ready, or to the integrator for
`openapi.overlays[]`.

Nothing new is invented: `src/openapi/overlay.js` already applies Overlay
1.1 documents from two host-config sources (§5.1.2), purely and loudly.
This feature adds a third source, owned by the user, persisted in their
browser.

## 2. Product decisions (settled)

1. **One document per spec.** A single user overlay, keyed by the active
   spec. Multiple documents would add ordering UI for no capability an
   Overlay 1.1 `actions` array does not already have.
2. **Applied last.** Root overlays → the spec's own overlays → the user
   overlay. The user's fix wins over the host's declarations, which is the
   point: the host published the defect.
3. **Never silent.** While a user overlay is active, a permanent badge in
   the header — "schema locally patched", i18n'd — links to the editor.
   The diagnostics block (§5.11) lists the user overlay exactly as it
   lists host overlays: actions applied, `info.description`, every
   warning. The badge is the guard against the failure mode this feature
   creates: forgetting that what you are reading diverges from what was
   published.
4. **Apply = reload.** Overlays run on the parsed source before anything
   reads it (§5.1.2), so applying an edit means re-running the pipeline —
   the same stance as a spec switch. "Save & reload" persists, then
   reloads the page. No live patching of the rendered model.
5. **Check without reload.** A dry-run button validates the document
   (shape, RFC 9535 targets) and reports per-action match counts against
   the in-memory parsed source — `applyOverlay` is pure and the source is
   already held, so the check costs no fetch and writes nothing. The
   author sees "target matches 0 nodes" before committing to a reload.
6. **JSON in the editor.** The URL channel keeps accepting YAML (it rides
   the ref-parser); the textarea takes JSON only — the app has no YAML
   serializer to round-trip an edit, and half-YAML support (parse but
   never emit) would make the download in decision 8 lie about what was
   typed. A YAML paste is refused with the reason — a smaller lie than a
   silent translation (`architecture.md` §14.17).
7. **Storage: a spec-scoped localStorage pref, hard-capped.** The
   document lives under the existing `writeSpecPref` mechanism
   (`apidoc:{specId}:user-overlay` — rule 8 mechanism and prefix, no new
   channel). Cap: **64 KB** of serialized document per spec; a save over
   the cap is refused with a visible error and writes nothing (rule 13 —
   policy: hard cap). The settings purge clears it through the
   inventory's default `preferences` group (§5) — asserted in e2e, not
   deduced.
8. **Download is the exit.** A download button emits the document as
   `overlay-{specId}.json` — a standard Overlay 1.1 file, ready for a bug
   report, a pull request, or the host's `openapi.overlays[]`. The
   workaround's natural end state is upstream, and the export is what
   carries it there.
9. **No host veto.** No config flag disables the editor. A user overlay
   edits only this user's view in this browser; a host that curates its
   docs loses nothing, and `hide` still applies after it (overlays edit
   the source, the hide filter runs downstream).
10. **The audit sees the patched document; "download the schema" does
    not.** §5.1.2 establishes that everything reading the parsed source
    sees one document, the overlaid one, and the user overlay joins it —
    so the audit grades the document actually in use, which is the point.
    The schema download is the exception, and not one this feature had to
    argue: it re-fetches the published file as served (YAML stays YAML),
    which is what makes it safe to hand to someone else. The two exits are
    therefore distinct and both honest — the API's own document from the
    home page, the user's patch from decision 8. What the feature does owe
    is the seam between them: wherever the published file is offered, a
    patched browser says the page and the file disagree, and says the patch
    is the reader's own so they know which download carries it
    (`architecture.md` §5.1.2).
11. **A starting patch can come from the config.** `openapi.userOverlay` — a
    document inline or a URL (JSON or YAML, same reader as `overlays[]`),
    overridable per spec by **replacement**, since decision 1 allows one
    document per spec — is written into the reader's own slot on a browser
    that has none. It is then an ordinary user overlay: applied last (decision
    2), editable, checkable, downloadable, removable. What separates it from
    `overlays[]` is ownership, not effect — an `overlays[]` entry belongs to
    the host for good, this one is handed over — and that buys the case
    `overlays[]` cannot serve: a fix the installation wants to *offer* rather
    than impose (a sandbox server, a tenant-specific relaxation), plus an
    editor whose starting point targets nodes of the schema at hand instead of
    the generic skeleton. Three consequences:
    - **handed over once, not enforced.** The fingerprint of the seeded
      document is stored beside it (§6.2, key `user-overlay-seed`). Same
      fingerprint = this browser has already been given this document, and
      whatever became of it since — kept, edited, removed — stands. That is
      what makes "remove the patch" survive the reload it triggers, and the
      reason the fingerprint outlives the document.
    - **a new declared document replaces the local copy**, local edits
      included: the alternative is a copy drifting silently against a schema
      that keeps moving, which is the failure this feature exists to expose
      ([`architecture.md`](architecture.md) §14.17). The exit before that
      happens is decision 8's download.
    - **never attributed to the reader.** Until they save an edit of their
      own, the editor's heading, its `fromHost` line and the diagnostics say
      the patch came from the documentation. Decision 3 is about not hiding
      that the schema is patched; this is about not hiding by whom.

    A declared document that is not an overlay, or over decision 7's cap, is
    refused and named in the diagnostics — never applied, never stored.
    Decision 9 is untouched: this is a starting point, not a veto. Nothing
    here lets a host keep a patch on a reader who removes it.

## 3. The editor

A section in the settings panel, adjacent to the diagnostics block —
warnings from the user overlay land in the block the user is already
looking at. Contents:

- A textarea holding the document (monospace, plain — not a code editor
  dependency; rule: build on the platform), framed as the file the download
  emits: the frame's header carries that filename, and beside it the
  document's weight against the cap of decision 7 — or, when the text does
  not parse, what it is instead of an overlay. A badge on the section's
  heading says whether a patch is currently applied, which the textarea
  cannot: it looks the same holding the skeleton and holding a saved
  document.
- **Check** — decision 5's dry-run. Results render under the frame, in one
  of their own: the summary as its header, then per action the target, its
  match count, and any warning `overlay.js` would emit, reusing its warning
  codes and their i18n. Before a first run, and again on the first keystroke
  after one, the block says what Check is for instead of holding a verdict
  about text that has since changed.
- **Save & reload** — validates like Check, refuses on parse error or over
  the cap (decision 7), otherwise persists and reloads.
- **Download** — decision 8. Enabled whenever the textarea parses.
- **Remove the patch** — removes the stored document and reloads. A confirm
  step, as the one destructive action here, and offered only when there is
  something to remove.
- A line, when the document came from `openapi.userOverlay` (decision 11),
  saying so and stating the two ways out of it — edit, and it is yours; remove,
  and it stays removed. It sits right above the buttons that do both.
- An empty state seeding the textarea with a minimal valid skeleton
  (`overlay: 1.1`, `info.title`, one example action). The example sits under
  an `x-` key rather than in `actions`: JSON has no comments, and a live
  example would edit the schema on the first save.

All strings under `userOverlay.*`, `en` + `fr` (rule 9). The dialog-free
placement keeps rule 15 simple: the section is ordinary settings content;
the badge is a link, the live region announces save/clear outcomes.

## 4. Security and privacy

- **Trust**: the document is user-typed input applied to a document the
  app already treats as untrusted. Everything it can produce is schema
  content, rendered through the existing sanitization (rule 5); JSONPath
  evaluation keeps `overlay.js`'s rule 7 bounds (match caps, engine depth
  cap). No new execution surface: an overlay carries data, never code.
- **Privacy**: the document never leaves the browser except by the user's
  own download gesture. It may embed values the user considers private;
  it is not an export path that redacts (rule 12 governs *generated*
  exports of captured values) — what the user typed is what the file
  holds, and the editor is the place they typed it.
- **Core vs shell** (rule 10): read/write/cap/validate live in a core
  module (`src/openapi/user-overlay.js`) beside `overlay.js`; the loader
  appends the stored document after the host's overlays (decision 2). The
  **stored** document is user data and never rides the config channel;
  the one config-borne piece is decision 11's starting patch
  (`openapi.userOverlay`), which the shell passes down like any other
  option and the loader seeds into storage — from there on it is user
  data like the rest.

## 5. Architecture

| Where | What |
|---|---|
| `src/openapi/user-overlay.js` (core) | Read/write through `readSpecPref`/`writeSpecPref`, the 64 KB cap, JSON validation, the dry-run (`checkUserOverlay(text, source)` — parses the text, then dry-runs `overlay.js`'s pure `applyOverlay` against the source already in memory), the skeleton seed, and decision 11's rule: `seedUserOverlay` (fingerprint in, one write out) and `userOverlayOrigin`. |
| `src/openapi/loader.js` | Resolves what the host declared (document or URL, decision 11) and seeds it before reading storage; appends the user overlay last (decision 2); reports which of the applied documents is the user's and whose it is, so the badge and the diagnostics can name both. |
| `src/specs.js`, `src/app.js` | `openapi.userOverlay` through the config channel: the one openapi key a `specs[]` entry replaces instead of accumulating. |
| `src/components/settings-panel.js` | The §3 section, plus the "yours" tag on the diagnostics entries. |
| `src/shell/toolbar.js`, `src/app.js` | The header badge while active, opening the panel focused on the editor. |
| `src/storage/maintenance.js` | Nothing to add: the key falls in the inventory's default `preferences` group, which is what the settings purge clears (asserted in e2e, not deduced). |
| `src/i18n/en.json`, `i18n/fr.json` | `userOverlay.*`. |
| `docs/architecture.md` | §5.1.2 carries the third source and its order; §14.17 records decisions 6, 9 and 11's replacement rule. |
| `CONTRIBUTING.md` | Feature→test map row (rule 16). |

No new runtime dependency. `docs/openapi-coverage.md` is untouched — the
Overlay 1.1 semantics are already implemented; this changes where a
document can come from, not what one can say.

## 6. Testing (rule 16)

Vitest (`tests/user-overlay.test.js`), pure core:

- round trip: write → read returns the document, spec-scoped (two spec ids
  do not collide, mono-spec bare key);
- cap: at 64 KB and one byte past → refused past, nothing written;
- invalid JSON, valid JSON that is not an overlay (no `overlay` field, no
  `actions`) → refused with the right code;
- `checkUserOverlay`: match counts per action against a fixture source, a
  non-RFC 9535 target and a zero-match target produce `overlay.js`'s
  warning codes;
- the host's starting patch (decision 11): seeded into an empty slot and
  applied, with the origin reported as the host's; unchanged on a second load
  of the same document, the reader's edit of it kept; not resurrected after a
  removal, and re-seeded when the declared document changes — including after
  a removal; refused when it is not an overlay or over the cap, with the
  diagnostics code and nothing written; seeded per spec.

Playwright (`tests/e2e/user-overlay.spec.js`), packed bundle:

- the seeded skeleton, then a saved patch renaming an operation summary →
  reload → the rendered doc shows the patched text, the badge is visible
  and opens the editor focused, the diagnostics name the overlay as the
  user's own;
- host + user overlay on the same node → the user's edit wins
  (decision 2), and the count covers all three documents;
- Check reports the match count per action and a zero-match target,
  without writing or reloading;
- over-cap save, and a YAML paste → visible error, storage untouched, the
  download disabled on what does not parse;
- Remove → confirm → reload → published schema back, badge gone, key gone;
- the patch and its downloaded `overlay-{specId}.json` are spec-scoped;
- settings purge removes the key (decision 7);
- the audit grades the patched document while the schema download still
  serves the published file, and both pages say the two disagree
  (decision 10);
- a patch declared by the host (decision 11, `app-seed-overlay.html` — the URL
  form, in YAML): applied on the first visit, disclosed by the badge, and
  named as the documentation's in the editor and the diagnostics; the reader's
  edit of it flips both to theirs; removing it holds across a further reload,
  the fingerprint staying behind.

`tests/e2e/a11y.spec.js`: the badge, the editor section and the dry-run
report join the sweep.

## 7. Out of scope (recorded so they aren't re-litigated)

- **A per-node GUI** ("fix this field" from the endpoint doc, generating
  targeted actions). The natural extension, over this exact storage and
  order —
  but it is an editable surface per node kind plus a JSONPath generator,
  and the raw editor is the workaround.
- **YAML in the textarea** (decision 6).
- **Sharing a user overlay via link.** The download file shared over any
  channel is the same payload with none of the URL constraints; a link
  adds a codec, caps and a landing dialog for no reach the file lacks.
- **Multiple documents per spec** (decision 1).
- **Live re-render without reload** (decision 4) — the pipeline reads
  overlays once by design, and a second application path is the drift
  this app structurally refuses (§5.1.2's "one document" argument).
