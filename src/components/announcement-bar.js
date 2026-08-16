import { announcementKey } from '../announcements.js'
import { resolveI18n } from '../docs/pages.js'
import { currentLanguage, t } from '../i18n/index.js'
import { announce } from './a11y.js'
import { el, iconButton } from './dom.js'
import { CLOSE_SVG } from './icons.js'
import { markdownInline } from './markdown.js'

// The announcement strip (docs/architecture.md §5.17): what the operator has to
// say, above everything the schema says. It sits at the very top of the layout
// and outside the three scrolling columns, so it is read before the API and
// never scrolls out from under a reader who is deep in an endpoint.
//
// The message is inline Markdown through the shared sanitizer (rule 5): a bold
// word, a code span, and above all the link to the incident page or the
// migration guide, without a call-to-action field to configure.

// Static map, never a built class (rule 2) — the JIT purge only keeps the
// class names it can read here.
const LEVEL_CLASS = {
  info: 'alert alert-info',
  success: 'alert alert-success',
  warning: 'alert alert-warning',
  error: 'alert alert-error',
}

// → the strip, or null when nothing is showing: the caller drops a null child,
// so an installation with no announcement pays no node at all.
export function announcementBar(entries, { onDismiss = () => {} } = {}) {
  if (!entries.length) return null
  const bar = el('section', 'flex shrink-0 flex-col')
  // A named region rather than a bare div: several notices at once are one
  // thing to skip past, and an unnamed landmark is announced as "region".
  bar.setAttribute('aria-label', t('announcement.region'))
  bar.dataset.announcements = ''
  for (const entry of entries) bar.append(announcementRow(entry, bar, onDismiss))
  return bar
}

function announcementRow(entry, bar, onDismiss) {
  const message = markdownInline(resolveI18n(entry.text, currentLanguage()))
  message.classList.add('grow')
  // `flex` over the alert's own grid: a strip is one line of text with a button
  // pushed to its end, not the icon/title/action layout the component assumes.
  const row = el(
    'div',
    `${LEVEL_CLASS[entry.level]} api-announcement flex w-full items-center gap-3 rounded-none border-0 px-4 py-2 text-sm`,
    message,
  )
  row.dataset.announcement = entry.level
  if (!entry.dismissible) return row
  const close = iconButton(
    'btn btn-ghost btn-xs btn-circle shrink-0',
    CLOSE_SVG,
    t('announcement.dismiss'),
  )
  close.addEventListener('click', () => {
    row.remove()
    onDismiss(announcementKey(entry))
    // Focus was on the button that just left the document. It goes to the first
    // notice still offering one — which is not the same question as whether a
    // notice is left at all: a pinned one stays on screen with no button of its
    // own. With the strip emptied it goes too, and focus falls to <body> —
    // which, for the first element of the layout, is one Tab away from where
    // the reader already was.
    if (!bar.firstElementChild) bar.remove()
    else bar.querySelector('button')?.focus()
    announce(t('announcement.dismissed'))
  })
  row.append(close)
  return row
}
