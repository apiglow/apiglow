import { el } from './dom.js'

// daisyUI dropdown as <details>/<summary> rather than a "focusable div":
// tapping a non-form element doesn't give it focus on mobile
// (Safari iOS in particular) and the list would never open. The popover
// variant, for its part, depends on CSS anchoring which is absent from Firefox and Safari.
// Trade-off: <details> doesn't close itself, hence the listeners
// below — attached on open, removed on close, and abandoned
// if the node was replaced by a re-render while the list was open.
export function detailsDropdown(classes, summary, content) {
  const details = el('details', `dropdown ${classes}`, summary, content)
  const close = () => {
    details.open = false
  }
  const detach = () => {
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('keydown', onKeyDown)
  }
  const onPointerDown = (event) => {
    if (!details.isConnected) return detach()
    if (!details.contains(event.target)) close()
  }
  const onKeyDown = (event) => {
    if (!details.isConnected) return detach()
    if (event.key === 'Escape') close()
  }
  details.addEventListener('toggle', () => {
    if (!details.open) return detach()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
  })
  return { details, close }
}
