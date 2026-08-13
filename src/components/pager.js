import { t } from '../i18n/index.js'
import { el, text } from './dom.js'

// The "previous / next" footer, shared by the endpoint doc and the docs pages.
// Both walk their own nav order and build their own hrefs, but the bar itself
// is one visual and accessible contract: same buttons, same empty-slot trick,
// same accessible name shape. Two copies had already drifted — one carried a
// landmark label, the other none.

// `page`: { href, label, title?, dataset? }.
function pagerLink(page, directionKey, isNext) {
  const arrow = el('span', 'text-subtle shrink-0', text(isNext ? '→' : '←'))
  const name = el('span', 'truncate', text(page.label))
  const link = el(
    'a',
    'btn btn-soft min-w-0 max-w-[48%]',
    ...(isNext ? [name, arrow] : [arrow, name]),
  )
  link.href = page.href
  if (page.title) link.title = page.title
  for (const [key, value] of Object.entries(page.dataset ?? {})) link.dataset[key] = value
  link.setAttribute('aria-label', `${t(directionKey)} — ${page.label}`)
  return link
}

// `labels`: { prev, next, section } — i18n keys, so each caller names its own
// unit ("previous operation" vs "previous page").
export function pagerSection({ prev, next }, labels) {
  if (!prev && !next) return null
  const nav = el(
    'nav',
    'mt-10 pt-6 border-t border-base-300/70 flex items-center justify-between gap-3',
    // An empty span holds the absent slot: justify-between keeps the remaining
    // button on its own side.
    prev ? pagerLink(prev, labels.prev, false) : el('span'),
    next ? pagerLink(next, labels.next, true) : el('span'),
  )
  nav.setAttribute('aria-label', t(labels.section))
  return nav
}
