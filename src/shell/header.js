// The application's top bar. Every value arrives already resolved — `app.js`
// reads the host config and hands over the parts (rule 10).
//
// The parts are named rather than ordered: the bar composes a brand block, a
// search trigger that changes shape with the viewport, and several groups of
// tools, and a positional signature could only tell them apart by counting.
import { el, text } from '../components/dom.js'
import { CLOCK_SVG } from '../components/icons.js'
import { searchTrigger } from '../components/search-palette.js'
import { homeHash } from '../router.js'

// The search trigger the header centers from lg up (the drawer keeps its own
// below). A button dressed as a field: the real input lives in the palette.
export function headerSearchField(onOpen) {
  return searchTrigger(
    onOpen,
    'input input-sm w-72 xl:w-96 cursor-pointer items-center gap-2 bg-base-200/40 text-subtle transition-colors hover:bg-base-200',
  )
}

export function header({
  branding,
  apiVersion = null,
  navToggle = null,
  specSwitcher = null,
  search = null,
  tools = [],
}) {
  // The branding block leads back to the home (of the active spec in multi-spec).
  const brand = el(
    'a',
    'flex items-center gap-3 px-2 rounded-box hover:bg-base-200 transition-colors',
  )
  brand.href = homeHash()
  if (branding.logoUrl) {
    const logo = el('img', 'h-8 w-8 object-contain')
    logo.src = branding.logoUrl
    logo.alt = ''
    brand.append(logo)
  }
  brand.append(
    el('span', 'font-display text-lg font-semibold tracking-tight', text(branding.productName)),
  )
  if (apiVersion)
    brand.append(el('span', 'badge badge-ghost badge-sm font-mono', text(String(apiVersion))))
  // Below md, the tools (env, history, theme, language) don't fit on the
  // same line as the branding: navbar-start/end each go full
  // width and the toolbar takes a second line, scrollable as a last
  // resort on very small screens. The threshold is md, not sm: the tools
  // aren't shrinkable (btn = flex-shrink 0) and, between 640 and 768,
  // overflowed navbar-end from the left, over the branding.
  // The centered search only exists from lg up — below, the drawer's own
  // trigger covers it, and one visible trigger at a time is what keeps the
  // palette's accessible name unambiguous.
  return el(
    'header',
    'navbar bg-base-100 border-b border-base-300 min-h-14 gap-1 flex-wrap gap-y-1 md:flex-nowrap',
    el('div', 'navbar-start min-w-0 gap-1 max-md:w-full', navToggle, brand, specSwitcher),
    search ? el('div', 'navbar-center hidden lg:flex', search) : null,
    el(
      'div',
      // No overflow-x below md: a scrollable container would clip the
      // tools' dropdowns (the env selector first). The
      // tools wrap to a new line if they don't fit.
      'navbar-end gap-1 sm:gap-2 pe-2 max-md:w-full max-md:flex-wrap max-md:justify-start max-md:pb-1',
      ...tools,
    ),
  )
}

export function historyIcon() {
  // Inline icon (no icon dependency) — decorative only.
  const span = el('span', 'text-subtle')
  span.innerHTML = CLOCK_SVG
  span.setAttribute('aria-hidden', 'true')
  return span
}
