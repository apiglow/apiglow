// Operator announcements (docs/architecture.md §5.17): the strip across the top
// of the page through which the documentation's operator says what the schema
// cannot — a maintenance window, a deprecation date, a version that just
// shipped.
//
// Pure module: normalization, the schedule window, and the bookkeeping of what
// the reader has closed. The shell fetches the remote form and owns the
// storage; nothing here touches either.

import { resolveI18n } from './docs/pages.js'

const LEVELS = new Set(['info', 'success', 'warning', 'error'])

// Bounded like the header memory next to it (architecture §6.2): 50 keys,
// oldest dropped. Nothing here can tell which announcements the operator has
// retired, so the set is capped rather than pruned — a dismissal that falls off
// the end costs one banner shown twice.
const DISMISSED_MAX = 50

// A declared instant → epoch ms, or null when there is nothing to read. An
// unparseable date is a typo, not a schedule: it widens the window rather than
// hiding the announcement forever, because a notice nobody can see is the one
// failure the operator has no way of noticing either.
function instant(raw, field, path, warnings) {
  if (raw === undefined || raw === null || raw === '') return null
  const ms = Date.parse(String(raw))
  if (Number.isNaN(ms)) {
    warnings.push(`${path}: unreadable ${field} "${raw}", ignored`)
    return null
  }
  return ms
}

// `text` follows the same i18n'd-field contract as a docs page title
// (docs-pages.md §2.3) and is resolved by the same function, so the two cannot
// drift. It is kept in its declared form: resolution happens at render, once
// the reader's language is known.
export function normalizeAnnouncements(raw, warnings = []) {
  if (!Array.isArray(raw)) return []
  const entries = []
  const seen = new Set()
  raw.forEach((item, i) => {
    const path = `announcements[${i}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      warnings.push(`${path}: dropped, not an object`)
      return
    }
    if (!resolveI18n(item.text, 'en')) {
      warnings.push(`${path}: dropped, "text" is required`)
      return
    }
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null
    if (id && seen.has(id)) {
      warnings.push(`announcements: duplicate id "${id}" — both entries share one dismissal`)
    }
    if (id) seen.add(id)
    let level = 'info'
    if (item.level !== undefined) {
      if (LEVELS.has(item.level)) level = item.level
      else warnings.push(`${path}: unknown level "${item.level}", falling back to "info"`)
    }
    const startsAt = instant(item.startsAt, 'startsAt', path, warnings)
    const endsAt = instant(item.endsAt, 'endsAt', path, warnings)
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt) {
      warnings.push(`${path}: endsAt is not after startsAt — this announcement can never show`)
    }
    entries.push({
      id,
      text: item.text,
      level,
      // Closable unless the operator says otherwise: the exception is the
      // notice that must stay on screen (an outage, a deadline), not the rule.
      dismissible: item.dismissible !== false,
      startsAt,
      endsAt,
    })
  })
  return entries
}

// The remote form's envelope, once the caller has the bytes. Top-level object
// rather than a bare array, for the same reason the docs manifest is one
// (docs-pages.md §2.2): it leaves room to grow, and a bare array is a file
// written against the wrong shape rather than a second accepted form.
export function manifestAnnouncements(data) {
  if (!Array.isArray(data?.announcements)) {
    throw new Error('announcements file has no "announcements" array')
  }
  return data.announcements
}

// FNV-1a, local rather than shared with the overlay seed's identical hash
// (openapi/user-overlay.js): both have to stay byte-stable forever, and sharing
// one would tie two features' stored keys to a single line of code.
function fingerprint(value) {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

// What a dismissal is stored under. Without a declared `id`, the DECLARED text
// is what identifies the announcement: the key is then the same in every
// language, and changes exactly when the operator edits the message — which is
// the behaviour an operator expects (new message, shown again). Declaring an
// `id` buys the opposite: a typo fix that does not re-open the banner on every
// reader's screen. The `~` marks the derived form, so it can never collide with
// an author's id.
export function announcementKey(entry) {
  return entry.id ?? `~${fingerprint(JSON.stringify(entry.text))}`
}

// What the reader actually sees: inside its window, and not already closed.
// A non-dismissible entry ignores a stored dismissal — flipping `dismissible`
// to false is how an operator pins a notice everyone has already waved away.
export function visibleAnnouncements(entries, { now = Date.now(), dismissed = [] } = {}) {
  const closed = new Set(dismissed)
  return entries.filter(
    (entry) =>
      (entry.startsAt === null || now >= entry.startsAt) &&
      (entry.endsAt === null || now < entry.endsAt) &&
      !(entry.dismissible && closed.has(announcementKey(entry))),
  )
}

export function rememberDismissed(dismissed, key) {
  const kept = (Array.isArray(dismissed) ? dismissed : []).filter((item) => item !== key)
  return [...kept, key].slice(-DISMISSED_MAX)
}
