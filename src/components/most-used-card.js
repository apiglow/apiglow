import { t } from '../i18n/index.js'
import { opHash } from '../router.js'
import { el, text } from './dom.js'
import { methodBadgeClass } from './method-colors.js'

// The endpoints this browser called most (docs/architecture.md §5.6). A hosted
// tool's "popular endpoints" is telemetry across every reader; ours cannot be
// that and does not pretend to — the title says whose calls these are, and the
// card is absent until the reader has made some. That is the honest version of
// the feature, and the only one a page with no backend can offer.
export function mostUsedCard(top, ops) {
  const rows = (top ?? []).map((item) => [item, ops.get(item.opId)]).filter(([, op]) => op)
  if (!rows.length) return null
  return el(
    'div',
    'card card-border border-base-300 bg-base-200/50',
    el(
      'div',
      'card-body p-4 gap-3',
      el(
        'div',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1',
        el('h2', 'card-title text-base', text(t('welcome.mostUsed'))),
        el('span', 'text-sm text-subtle', text(t('welcome.mostUsedIntro'))),
      ),
      el('ul', 'flex flex-col', ...rows.map(([item, op]) => row(item, op))),
    ),
  )
}

function row(item, op) {
  const link = el(
    'a',
    'flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 api-row hover:bg-base-200 rounded px-1 -mx-1',
    el('span', methodBadgeClass(op.method), text(op.method)),
    el('span', 'font-mono text-sm truncate', text(op.path)),
    op.summary ? el('span', 'text-sm text-subtle truncate', text(op.summary)) : null,
    // The count closes the line: it is what ranks the list, and reading it
    // last keeps the endpoint the thing you scan for.
    el(
      'span',
      'ms-auto text-xs font-mono tabular-nums text-faint shrink-0',
      text(t('welcome.mostUsedCount', { n: item.count })),
    ),
  )
  link.href = opHash(op.id)
  link.dataset.mostUsed = op.id
  return el('li', '', link)
}
