// Host-defined daisyUI themes: probing the built-in palettes and emitting the
// custom ones. Split out of app.js, which stays the only reader of the host
// config — this module receives the definitions and the stylesheet <link>,
// never the config object.
//
// `cssLink` is a parameter rather than module state: the <link> is built in
// app.js against `import.meta.url` (rule 4), and that resolution must keep
// happening in the module the build treats as the entry.
import { el } from '../components/dom.js'
import {
  baseThemesOf,
  PROBE_PROPERTIES,
  renderCustomThemesCss,
  validateCustomThemes,
} from '../theming/custom-themes.js'

// Reads a base theme's resolved values off a hidden element carrying its
// `data-theme`: the built-in themes live only in the built stylesheet, and
// walking its `cssRules` would throw on a CDN-hosted (cross-origin) sheet.
function probeBaseThemes(names) {
  const values = {}
  if (!names.length) return values
  const probe = el('div', 'hidden')
  document.body.append(probe)
  for (const name of names) {
    probe.dataset.theme = name
    const computed = getComputedStyle(probe)
    values[name] = Object.fromEntries(
      PROBE_PROPERTIES.map((property) => [property, computed.getPropertyValue(property)]),
    )
  }
  probe.remove()
  return values
}

// Host-defined daisyUI themes (docs/custom-themes.md §5). The <style> is
// appended synchronously right after the app.css link, so its document-order
// position — what breaks the tie at equal specificity, and thus what makes an
// in-place override of a built-in win — is fixed whatever the network does.
export function injectCustomThemes(definitions, available, cssLink) {
  const { themes, warnings } = validateCustomThemes(definitions, { available })
  for (const warning of warnings) console.warn('[api-doc]', warning)
  if (!themes.length) return
  const style = document.createElement('style')
  style.dataset.apidocCustomThemes = ''
  document.head.append(style)
  const bases = baseThemesOf(themes)
  const fill = () => {
    style.textContent = renderCustomThemesCss(themes, probeBaseThemes(bases))
  }
  // In dev there is no link — Vite injects the CSS at import time, so it is
  // already applied and the probe can run now. In prod it has to wait for the
  // stylesheet; themes that extend nothing need no base and are styled
  // immediately. `error` fills too: an unreachable app.css styles nothing
  // anyway, and the themes still deserve their own tokens.
  if (!cssLink || !bases.length) {
    fill()
    return
  }
  style.textContent = renderCustomThemesCss(themes.filter((theme) => !theme.extends))
  cssLink.addEventListener('load', fill, { once: true })
  cssLink.addEventListener('error', fill, { once: true })
}
