// The application's top bar. Every value arrives already resolved — `app.js`
// reads the host config and hands over the parts (rule 10).
//
// Four zones, and the order is the reading (§5.16): which document, how to
// find something in it, what to act on it with, and — last, set apart — the
// app itself. The parts are named rather than ordered because the bar composes
// a brand block, a search trigger that changes shape with the viewport and
// several groups of tools, and a positional signature could only tell them
// apart by counting.
import { el, iconButton, text } from '../components/dom.js'
import { SEARCH_SVG } from '../components/icons.js'
import { searchTrigger } from '../components/search-palette.js'
import { t } from '../i18n/index.js'
import { homeHash } from '../router.js'

// A button dressed as a field, centered from md up: the real input lives in
// the palette. Below md there is no room for a field and the icon below takes
// over — one visible trigger at a time is what keeps the palette's accessible
// name unambiguous.
export function headerSearchField(onOpen) {
  const field = searchTrigger(
    onOpen,
    // Narrow where the bar is tight and wide where it is not: at md the field
    // and the two flanks together are within a few pixels of the viewport, and
    // a field is still a field at 176 px.
    'input input-sm w-44 lg:w-72 xl:w-96 cursor-pointer items-center gap-2 bg-base-200/40 text-subtle transition-colors hover:bg-base-200',
  )
  // The shortcut chip is worth 55 px of a 176 px field only where the field has
  // them to spare. Below lg the placeholder would ellipse to pay for it, which
  // trades the thing that says what the control does for the thing that says
  // how to reach it faster.
  field.querySelector('kbd')?.classList.add('max-lg:hidden')
  return field
}

// The phone's search: the same palette, one tap, in the bar rather than two
// taps deep inside the navigation drawer. On a documentation site this is the
// first thing a reader reaches for, and it was the one control the small
// screens did not carry.
export function headerSearchButton(onOpen) {
  const button = iconButton(
    'btn btn-sm btn-ghost btn-square md:hidden',
    SEARCH_SVG,
    t('search.placeholder'),
  )
  button.addEventListener('click', onOpen)
  return button
}

// The 1 px rule that separates two zones. Present only where both sides are —
// the search zone folds away below md and takes its own rules with it.
function zoneRule() {
  return el('div', 'h-6 w-px shrink-0 bg-base-300')
}

export function header({
  branding,
  apiVersion = null,
  navToggle = null,
  specSwitcher = null,
  status = [],
  searchField = null,
  searchButton = null,
  tools = [],
  appMenu = null,
}) {
  // The branding block leads back to the home (of the active spec in multi-spec).
  const brand = el(
    'a',
    'flex min-w-0 items-center gap-2 px-2 rounded-box hover:bg-base-200 transition-colors',
  )
  brand.href = homeHash()
  if (branding.logoUrl) {
    const logo = el('img', 'h-8 w-8 shrink-0 object-contain')
    logo.src = branding.logoUrl
    logo.alt = ''
    brand.append(logo)
  }
  // `min-w-0` as well as `truncate`: a flex item refuses to go below its
  // content's width without it, and the name would then push the zone wider
  // instead of ellipsing — which is how the whole brand block gets squeezed
  // out of a narrow bar rather than shortened.
  const name = el(
    'span',
    'font-display min-w-0 truncate text-lg font-semibold tracking-tight',
    text(branding.productName),
  )
  // Below sm the logo is the identity on its own and the name yields the ~80 px
  // the acting zone cannot give up — a glyph has one size, a word does not. An
  // install with no logo has nothing else to be recognised by, so there the
  // name stays at every width.
  if (branding.logoUrl) name.classList.add('max-sm:hidden')
  brand.append(name)
  // The version is the first thing to go, and it goes early: it is on the home
  // page, in the diagnostics and in the document title, whereas the API's own
  // name has nowhere else to be. Below lg its 60 px are what let that name read
  // in full instead of ending in an ellipsis.
  if (apiVersion)
    brand.append(
      el('span', 'badge badge-ghost badge-sm font-mono max-lg:hidden', text(String(apiVersion))),
    )
  // The status badges sit with the brand, not with the tools: they qualify the
  // document the bar names — "Petstore 1.0.27, changed, patched" reads as one
  // block — and the acting zone stays nothing but actions.
  //
  // `grow basis-0` on both flanks rather than daisyUI's flat halves: they still
  // split the leftover space evenly — which is what keeps the search centered —
  // but they yield instead of spilling sideways over each other, which is what
  // used to force a line per zone on every phone.
  //
  // The two flanks yield differently, and that asymmetry is the whole layout:
  // the naming side may be squeezed (the version drops, then the name, then
  // the rest truncates), the acting side may not — a glyph has one size. Hence
  // `min-w-fit` on the end and `min-w-0` on the start. One line then holds from
  // 320 px up, and `max-sm:flex-wrap` is the net under the widest phone case
  // (both status badges up at once), where wrapping beats a clipped bar.
  return el(
    'header',
    'navbar bg-base-100 border-b border-base-300 min-h-14 gap-1 px-2 flex-wrap gap-y-1',
    el(
      'div',
      'navbar-start min-w-0 grow basis-0 gap-1 max-sm:flex-wrap',
      navToggle,
      brand,
      specSwitcher,
      ...status,
    ),
    searchField
      ? el(
          'div',
          'navbar-center hidden shrink-0 gap-3 md:flex',
          zoneRule(),
          searchField,
          zoneRule(),
        )
      : null,
    el(
      'div',
      'navbar-end min-w-fit grow basis-0 gap-1 lg:gap-2 max-sm:flex-wrap',
      searchButton,
      ...tools,
      appMenu ? zoneRule() : null,
      appMenu,
    ),
  )
}
