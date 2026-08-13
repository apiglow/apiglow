import { el } from './dom.js'

// Floating list anchored to an input field, shared by the enum combobox
// and the variable autocomplete.
//
// It lives in the top layer (popover) rather than as an absolute dropdown: its hosts
// would clip it (table cell in overflow-x-auto, scrollable try-it
// panel) and `position: fixed` wouldn't survive the mobile drawer's
// `transform`. Position computed in JS — CSS anchoring, for its part, is still
// missing from Firefox and Safari (cf. dropdown.js).
//
// This module only handles the lifecycle and placement: the content, the
// keyboard and the "what is selected" state belong to the caller, who has
// its own state to reset — hence `onOutside` rather than an
// autonomous close.

// Below this free height under the field, the list flips above.
const FLIP_THRESHOLD_PX = 160

// The Popover API lands after the low end of the declared support baseline
// (Chrome 114 / Safari 17 vs a baseline of Chrome 111 / Safari 16.4), so the
// top layer is an enhancement, not a given. Without it the list is still a
// body-level `position: fixed` element — correct everywhere except stacked
// against a modal `<dialog>`, which owns the top layer alone. Callers that can
// open inside a dialog pick a different control instead (`leafField` falls back
// to a native `<select>`); the autocomplete only ever decorates in-page fields.
export const TOP_LAYER_SUPPORTED = typeof HTMLElement.prototype.showPopover === 'function'

export function anchoredList(extraClasses = '') {
  const list = el(
    'ul',
    `menu menu-sm flex-nowrap bg-base-100 rounded-box border border-base-300 shadow-lg overflow-y-auto ${extraClasses}`,
  )
  if (TOP_LAYER_SUPPORTED) list.popover = 'manual'
  // Static, per rule 2 — and only meaningful without the top layer, which
  // ignores z-index entirely.
  else list.classList.add('z-50')
  list.setAttribute('role', 'listbox')
  list.style.position = 'fixed'
  list.style.margin = '0'

  let anchor = null
  let onOutside = null
  const isOpen = () => list.isConnected

  const place = () => {
    const rect = anchor.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 8
    const above = rect.top - 8
    const flip = below < FLIP_THRESHOLD_PX && above > below
    list.style.width = `${rect.width}px`
    list.style.left = `${rect.left}px`
    list.style.maxHeight = `${Math.max(96, flip ? above : below)}px`
    list.style.top = flip ? 'auto' : `${rect.bottom + 4}px`
    list.style.bottom = flip ? `${window.innerHeight - rect.top + 4}px` : 'auto'
  }

  const onPointerDown = (event) => {
    if (!anchor?.contains(event.target) && !list.contains(event.target)) onOutside?.()
  }
  // The list is anchored to a field that can disappear from under it (doc
  // re-render while it's open): every repositioning checks for that.
  const onReflow = () => (anchor?.isConnected ? place() : onOutside?.())

  return {
    list,
    isOpen,
    place,
    // Reopening on another field (autocomplete follows focus) just
    // moves the anchor: the popover stays in the top layer.
    open(element, outside) {
      anchor = element
      onOutside = outside
      if (isOpen()) {
        place()
        return
      }
      document.body.append(list)
      place()
      if (TOP_LAYER_SUPPORTED) list.showPopover()
      document.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('scroll', onReflow, true)
      window.addEventListener('resize', onReflow)
    },
    close() {
      if (!isOpen()) return
      if (TOP_LAYER_SUPPORTED) list.hidePopover()
      list.remove()
      anchor = null
      onOutside = null
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    },
  }
}
