import { t } from '../i18n/index.js'
import { el, icon, text } from './dom.js'
import { EXTERNAL_SVG } from './icons.js'

// The rows of the two hand-off menus — "Copy page" on a page, "Copy for AI" in
// the header (docs/architecture.md §5.14.1) — so that a copy confirms itself
// and a link out reads the same in both.

export function menuItem(labelKey, svg, onClick) {
  const label = el('span', '', text(t(labelKey)))
  const btn = el('button', 'flex items-center gap-2 text-sm', icon(svg, 'text-subtle'), label)
  btn.type = 'button'
  btn.addEventListener('click', () => onClick({ btn, label }))
  return el('li', '', btn)
}

// A menu entry that hands the click to the OS rather than to us: no target,
// because a custom scheme opens the editor and a blank tab left behind for it
// is litter.
export function menuLinkItem(labelKey, href, close) {
  const anchor = el(
    'a',
    'flex items-center gap-2 text-sm',
    icon(EXTERNAL_SVG, 'text-subtle'),
    el('span', '', text(t(labelKey))),
  )
  anchor.href = href
  anchor.addEventListener('click', () => close())
  return el('li', '', anchor)
}

export function menuTitle(labelKey) {
  return el('li', 'menu-title text-label uppercase', text(t(labelKey)))
}

// Copy confirmation, on the item's own label: the menu stays open long enough
// for it to be read, then closes itself.
export function confirmCopy(label, labelKey, close) {
  label.replaceChildren(text(t('export.copied')))
  setTimeout(() => {
    label.replaceChildren(text(t(labelKey)))
    close()
  }, 900)
}
