import { t } from '../i18n/index.js'
import { ENV_COLORS, ENV_SWATCH } from '../env/colors.js'
import { el, text } from './dom.js'

// The environment's identification color: the closed palette of `env/colors.js`
// plus "no color". One implementation for the two places that offer the choice —
// the manager, which commits it to the store, and the setup-link builder, which
// only holds it in a form.
//
// Swatches are deliberately tiny: they are color markers, not buttons to read.
// The selection ring is repositioned by the CALLER's re-render, which is what
// both callers do on a pick anyway.
export function envColorPicker(selected, onPick) {
  const swatch = (color, classes, label) => {
    const btn = el('button', `size-4 shrink-0 rounded-full cursor-pointer ${classes}`)
    btn.type = 'button'
    btn.title = label
    btn.setAttribute('aria-label', label)
    btn.setAttribute('aria-pressed', String(selected === color))
    if (selected === color)
      btn.classList.add('ring-2', 'ring-base-content', 'ring-offset-2', 'ring-offset-base-100')
    btn.addEventListener('click', () => onPick(color))
    return btn
  }
  return el(
    'div',
    'flex flex-wrap items-center gap-1.5',
    el('span', 'text-xs text-subtle me-1', text(t('env.color'))),
    swatch(null, 'border border-base-300', t('env.colorNone')),
    ...ENV_COLORS.map((color) => swatch(color, ENV_SWATCH[color], t(`env.color.${color}`))),
  )
}
