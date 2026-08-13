// Ephemeral notifications (result of OAuth flows): stacked bottom
// right, self-removing.
import { el, text } from '../components/dom.js'

const TOAST_CLASS = {
  success: 'alert alert-success',
  warning: 'alert alert-warning',
  error: 'alert alert-error',
}

const TOAST_MS = 6000

// → { node, show(type, message) }: the caller places the stack in its layout
// and keeps the emitter, which is what everything downstream is handed.
export function createToaster() {
  const node = el('div', 'toast toast-end z-50')
  const show = (type, message) => {
    const alert = el('div', TOAST_CLASS[type] ?? TOAST_CLASS.error, el('span', '', text(message)))
    alert.setAttribute('role', 'status')
    node.append(alert)
    setTimeout(() => alert.remove(), TOAST_MS)
  }
  return { node, show }
}
