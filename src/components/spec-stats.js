// The document in figures — what the schema declares, nothing the app adds on
// top. Shared by the home page and the audit page so a reader who compares the
// two is comparing the same units, counted the same way.
//
// Entries are `[key, value]` in display order; the caller decides what to leave
// out (a document with no webhook has no webhook stat), and the label comes
// from `welcome.{key}`.

import { t } from '../i18n/index.js'
import { el, text } from './dom.js'

export function specStats(entries) {
  const stats = entries.filter(([, value]) => value != null)
  if (!stats.length) return null
  return el(
    'div',
    'stats stats-vertical sm:stats-horizontal shadow-sm border border-base-300',
    ...stats.map(([key, value]) =>
      el(
        'div',
        'stat py-3',
        el('div', 'stat-title text-xs', text(t(`welcome.${key}`))),
        el('div', 'stat-value text-2xl', text(String(value))),
      ),
    ),
  )
}
