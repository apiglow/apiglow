import { t } from '../i18n/index.js'
import { el, text } from './dom.js'

// In-situ marking for the local changelog: the modal says WHAT changed, these
// badges say WHERE — nav (group + operation) and doc content. Removed
// operations no longer have a place to display: only 'added' and
// 'changed' exist here. Static classes (rule 2).
const DOT_CLASS = {
  added: 'status status-success',
  changed: 'status status-warning',
}
const BADGE_CLASS = {
  added: 'badge badge-success badge-soft badge-xs',
  changed: 'badge badge-warning badge-soft badge-xs',
}

function changeLabel(status) {
  return status === 'added' ? t('changelog.mark.added') : t('changelog.mark.changed')
}

// Silent badge for the nav, where the label has no room: the information
// goes through color, the tooltip and the accessible name.
export function changeDot(status, title) {
  if (!DOT_CLASS[status]) return null
  const dot = el('span', `${DOT_CLASS[status]} shrink-0`)
  dot.setAttribute('role', 'img')
  dot.setAttribute('aria-label', title ?? changeLabel(status))
  dot.title = title ?? changeLabel(status)
  return dot
}

export function changeBadge(status) {
  if (!BADGE_CLASS[status]) return null
  return el('span', `${BADGE_CLASS[status]} shrink-0`, text(changeLabel(status)))
}
