import { readSpecPref, removeSpecPref, writeSpecPref } from '../storage/prefs.js'
import { applyOverlay, OVERLAY_VERSION } from './overlay.js'

// The user's own Overlay 1.1 document (docs/user-overlay.md): the standing
// workaround for a schema whose defects belong to someone else. Everything the
// feature owns that is not rendering lives here — read, write, the cap, the
// validation, the dry run, the seed — so the settings editor, the loader and
// the download cannot disagree on what a stored document is.
//
// It is user data, not host config: it never rides the config channel, and the
// shell knows nothing about it (rule 10).

// Spec-scoped, through the existing preference mechanism and its `apidoc:`
// prefix (rule 8): one document per spec, no new storage channel. Falling in
// the inventory's default `preferences` group is what makes the settings purge
// clear it.
export const USER_OVERLAY_KEY = 'user-overlay'

// The fingerprint of the host's declared document as of the last time this
// browser was given it (decision 11). It is what separates "never offered this
// document" from "offered it, and the reader removed it" — without it, a
// removal would be undone by the next load, which is the failure mode a seeded
// document creates. Deliberately NOT cleared by `clearUserOverlay`: it is the
// record that the offer was made, and it has to outlive the document.
const USER_OVERLAY_SEED_KEY = 'user-overlay-seed'

// Bounded storage (rule 13), policy: hard cap. A save above it is refused and
// writes nothing — a truncated overlay would be a document that still parses
// and says something else. 64 KB is far above the handful of actions a
// workaround needs, and far below the schema someone might paste here by
// mistake.
export const USER_OVERLAY_MAX_BYTES = 64 * 1024

// Measured on what is actually persisted, not on the text typed: indentation is
// the editor's, and the cap is a storage promise. One measurement for the save
// and the seed alike — two of them would eventually disagree on what 64 KB is.
const TEXT_ENCODER = new TextEncoder()
function overlayBytes(serialized) {
  return TEXT_ENCODER.encode(serialized).length
}

export const USER_OVERLAY_INVALID_JSON = 'user-overlay-invalid-json'
export const USER_OVERLAY_NOT_OVERLAY = 'user-overlay-not-overlay'
export const USER_OVERLAY_TOO_LARGE = 'user-overlay-too-large'

// The empty state's starting point, because a blank textarea teaches nothing.
// The example action sits under an extension key instead of in `actions`: JSON
// has no comments, and an example left live would edit the schema on the first
// save. `x-` is the spec's own escape hatch, so the skeleton stays a valid
// overlay while showing the shape of what to write.
export const USER_OVERLAY_SKELETON = `{
  "overlay": "${OVERLAY_VERSION}",
  "info": {
    "title": "Local fixes",
    "description": "Why this overlay exists."
  },
  "actions": [],
  "x-example-action": {
    "target": "$.paths['/pets'].get.parameters[?@.name == 'limit'].schema",
    "update": { "type": "integer" }
  }
}
`

// The exit (decision 8): what the download hands over is a standard Overlay
// 1.1 file, named after the spec it patches so a multi-spec install cannot
// produce three files called the same thing. Mono-spec has nothing to
// disambiguate — the same reasoning that leaves its storage key bare.
export function userOverlayFilename(specId) {
  return specId ? `overlay-${specId}.json` : 'overlay.json'
}

export function readUserOverlay() {
  const stored = readSpecPref(USER_OVERLAY_KEY, null)
  return isPlainObject(stored) ? stored : null
}

// What the textarea and the downloaded file both show. Indented: the document
// is stored parsed, so this is the only formatting the user ever sees, and a
// one-line overlay is not editable.
export function formatUserOverlay(document) {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function parseUserOverlay(text) {
  let document
  try {
    document = JSON.parse(text)
  } catch {
    return { ok: false, code: USER_OVERLAY_INVALID_JSON }
  }
  if (!isOverlayDocument(document)) return { ok: false, code: USER_OVERLAY_NOT_OVERLAY }
  return { ok: true, document }
}

// Deliberately as lenient as `overlay.js` is: a document carrying `actions` is
// an overlay whatever it calls itself, and one declaring `overlay` with no
// action yet is a document being written. What this refuses is JSON that is not
// an overlay at all — a schema pasted in the wrong box, most likely.
function isOverlayDocument(document) {
  if (!isPlainObject(document)) return false
  return typeof document.overlay === 'string' || Array.isArray(document.actions)
}

export function saveUserOverlay(text) {
  const parsed = parseUserOverlay(text)
  if (!parsed.ok) return parsed
  const bytes = overlayBytes(JSON.stringify(parsed.document))
  if (bytes > USER_OVERLAY_MAX_BYTES) return { ok: false, code: USER_OVERLAY_TOO_LARGE, bytes }
  writeSpecPref(USER_OVERLAY_KEY, parsed.document)
  return { ok: true, document: parsed.document, bytes }
}

export function clearUserOverlay() {
  // The seed fingerprint stays behind on purpose: removing the patch has to
  // survive the reload it triggers, and the host's document is unchanged.
  removeSpecPref(USER_OVERLAY_KEY)
}

// --- the host's declared document (decision 11) -----------------------------

// FNV-1a over the serialized document. Not a checksum anyone relies on: it
// answers one question — "is this the same document the reader was already
// given?" — and a collision costs a skipped re-seed, not a wrong render. Both
// sides are parsed JSON from the same source, so key order is stable.
// Deliberately not `diff.js`'s hash: that one is versioned and free to change
// with the walk it serves, and a change there would silently re-seed every
// reader's slot. This one has to mean the same thing forever.
function fingerprintOf(serialized) {
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

// The host declares a document, the browser adopts it once, the reader owns it
// afterwards. One rule covers the three cases: seed if the fingerprint stored
// here is not the one of the document currently declared.
//   • nothing stored  → first visit, the document is written and applied;
//   • same fingerprint → the reader has already been given THIS document —
//     whatever they did with it since (kept, edited, removed) stands;
//   • different       → the host published a new version of its patch, and it
//     replaces the local copy, edits included. That is the contract, stated in
//     config.example.js: changing the declared document re-seeds every browser.
//     The reader's exit before that happens is the download button.
// Same validation and same cap as a save: a document the reader could not save
// back is not one to force on them.
export function seedUserOverlay(document) {
  if (!isOverlayDocument(document)) return { ok: false, code: USER_OVERLAY_NOT_OVERLAY }
  const serialized = JSON.stringify(document)
  // The fingerprint first, the cap second: on every load past the first the
  // answer is "already given", and that path should not weigh the document.
  // A refused document never gets a fingerprint written, so it cannot match.
  const fingerprint = fingerprintOf(serialized)
  if (readSpecPref(USER_OVERLAY_SEED_KEY, null) === fingerprint) return { ok: true }
  if (overlayBytes(serialized) > USER_OVERLAY_MAX_BYTES) {
    return { ok: false, code: USER_OVERLAY_TOO_LARGE }
  }
  writeSpecPref(USER_OVERLAY_KEY, document)
  writeSpecPref(USER_OVERLAY_SEED_KEY, fingerprint)
  return { ok: true }
}

// Who the active document belongs to: 'host' while it is still, byte for byte,
// what the installation declared, 'user' from the first edit the reader saves.
// The badge and the diagnostics say "yours" about a document the reader wrote —
// attributing the host's patch to them would make the one thing they cannot
// have caused look like their own doing.
export function userOverlayOrigin() {
  const stored = readUserOverlay()
  if (!stored) return null
  const seed = readSpecPref(USER_OVERLAY_SEED_KEY, null)
  return seed && seed === fingerprintOf(JSON.stringify(stored)) ? 'host' : 'user'
}

// The dry run: the document applied to the parsed source held in memory, with
// the result thrown away. `applyOverlay` is pure and clones before touching
// anything, so this costs no fetch and writes nothing — the author sees the
// warnings and the per-action match counts *before* committing to the reload
// that a real apply is.
export function checkUserOverlay(text, source) {
  const parsed = parseUserOverlay(text)
  if (!parsed.ok) return parsed
  const { warnings, documentWarnings, actions, trace } = applyOverlay(source, parsed.document)
  return { ok: true, warnings, documentWarnings, actions, trace }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
