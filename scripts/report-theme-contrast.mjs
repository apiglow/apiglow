// Contrast of the design layer's ink recipes, on every daisyUI theme the
// build ships (rule 3). **Informative: it gates nothing.** The floor is
// enforced on the `apiglow` pair alone, which is what the default install
// paints; the stock themes are the library's palette and we do not repaint
// them (docs/architecture.md §12). What this report buys is the other half of
// that decision — an integrator who picks `dracula` from `theme.available`
// gets to see what it costs before shipping it.
//
// It drives a browser because the recipes are not readable off the tokens: a
// `-soft` background is a `color-mix()` in oklab over `--color-base-100`, the
// secondary levels are another `color-mix()` against `transparent`, and a
// stock theme states its colors in `oklch()`. Only an engine resolves that
// stack, so the ratio is computed from the painted pixels, as
// `tests/e2e/a11y.spec.js` does inside a modal — the same method, restated
// here with an opacity term rather than shared, so a report can never move the
// gate. Chromium comes from the e2e toolchain; nothing here ships.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { BUILTIN_THEMES } from '../src/theming/custom-themes.js'

const FLOOR = 4.5
const root = fileURLToPath(new URL('..', import.meta.url))
const cssPath = join(root, 'dist', 'app.css')

if (!existsSync(cssPath)) {
  console.error('dist/app.css is missing — run `npm run build` first.')
  process.exit(1)
}

// The semantic set minus `neutral`: it is a surface token on the dark halves,
// so nothing inks with it (a badge with nothing semantic to say is
// `badge-ghost`, §12) and measuring it would report a pair the app never
// paints.
const SEMANTIC = ['primary', 'secondary', 'accent', 'info', 'success', 'warning', 'error']
const ALERT = ['info', 'success', 'warning', 'error']

// highlight.js follows the theme instead of carrying a stylesheet
// (`src/styles/app.css`), so each token class is one semantic color as ink.
// The blocks it paints sit on `bg-base-200` everywhere the app renders them.
const HLJS = [
  ['hljs (plain)', 'hljs', 'base-content'],
  ['hljs-comment', 'hljs-comment', 'base-content 66%'],
  ['hljs-keyword', 'hljs-keyword', 'primary'],
  ['hljs-string', 'hljs-string', 'success'],
  ['hljs-number', 'hljs-number', 'secondary'],
  ['hljs-attr', 'hljs-attr', 'accent'],
  ['hljs-title', 'hljs-title', 'info'],
  ['hljs-meta', 'hljs-meta', 'warning'],
]

// Every recipe that paints a theme token as TEXT. daisyUI's plain components
// (`badge-primary`, `btn-error`) pair a color with its own `-content` token
// and are the library's own business; these are the ones whose ink is a color
// meant to be read on a surface. `.menu-title`, `.stat-title`, `.label`, table
// heads and inactive tabs are re-colored at exactly the `text-subtle` recipe,
// so they are that row rather than five copies of it.
const SAMPLES = [
  ...SEMANTIC.map((color) => ({
    group: 'badge-soft',
    label: color,
    html: `<span class="badge badge-soft badge-${color}" %probe%>GET</span>`,
  })),
  ...SEMANTIC.map((color) => ({
    group: 'badge-outline',
    label: color,
    html: `<span class="badge badge-outline badge-${color}" %probe%>GET</span>`,
  })),
  {
    group: 'badge-ghost',
    label: 'base-content',
    html: `<span class="badge badge-ghost" %probe%>HEAD</span>`,
  },
  ...ALERT.map((color) => ({
    group: 'alert-soft',
    label: color,
    html: `<div class="alert alert-soft alert-${color}"><span %probe%>message</span></div>`,
  })),
  ...HLJS.map(([label, cls, ink]) => ({
    group: 'hljs on base-200',
    label: `${label} (${ink})`,
    surface: 'bg-base-200',
    html: `<pre class="p-2"><code class="hljs"><span class="${cls}" %probe%>token</span></code></pre>`,
  })),
  {
    group: 'text-subtle',
    label: 'on base-100',
    html: `<p class="text-subtle" %probe%>secondary text</p>`,
  },
  {
    group: 'text-subtle',
    label: 'on base-200',
    surface: 'bg-base-200',
    html: `<p class="text-subtle" %probe%>secondary text</p>`,
  },
  {
    group: 'text-faint',
    label: 'on base-100',
    html: `<p class="text-faint" %probe%>tertiary text</p>`,
  },
  {
    group: 'text-faint',
    label: 'on base-200',
    surface: 'bg-base-200',
    html: `<p class="text-faint" %probe%>tertiary text</p>`,
  },
]

// The list of themes is the module that declares what the build ships, never a
// list typed here — but a theme absent from the compiled CSS would silently
// measure the page's default and read as passing, so the two are crossed.
const css = readFileSync(cssPath, 'utf8')
const missing = BUILTIN_THEMES.filter((theme) => !css.includes(`[data-theme=${theme}]`))
const themes = BUILTIN_THEMES.filter((theme) => !missing.includes(theme))

const body = themes
  .map((theme, t) => {
    const samples = SAMPLES.map(
      (sample, s) =>
        `<div class="${sample.surface ?? 'bg-base-100'} p-2">${sample.html.replace('%probe%', `data-probe="${t}.${s}"`)}</div>`,
    ).join('')
    return `<div data-theme="${theme}">${samples}</div>`
  })
  .join('')

// No D-Bus session bus for headless Chromium — see playwright.config.js.
process.env.DBUS_SESSION_BUS_ADDRESS = '/dev/null'
const browser = await chromium.launch()
let measured
try {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><body>${body}</body></html>`)
  await page.addStyleTag({ path: cssPath })

  measured = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    // Layers painted in order over an opaque white start, source-over: a
    // transparent one contributes nothing and a translucent one blends, exactly
    // as on screen. `alpha` carries the element's own `opacity`, which the
    // computed `color` does not include: a recipe that dims that way — daisyUI
    // has a few — would otherwise be reported at full ink strength.
    const paint = (layers, alpha = 1) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.globalAlpha = 1
      for (const [i, layer] of ['#ffffff', ...layers].entries()) {
        ctx.globalAlpha = i === layers.length ? alpha : 1
        ctx.fillStyle = layer
        ctx.fillRect(0, 0, 1, 1)
      }
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      const channels = [r, g, b].map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    return [...document.querySelectorAll('[data-probe]')].map((node) => {
      const backgrounds = []
      let alpha = 1
      for (let el = node; el; el = el.parentElement) {
        const style = getComputedStyle(el)
        backgrounds.unshift(style.backgroundColor)
        alpha *= Number(style.opacity)
      }
      const background = paint(backgrounds)
      const ink = paint([...backgrounds, getComputedStyle(node).color], alpha)
      const [lighter, darker] = background > ink ? [background, ink] : [ink, background]
      return { probe: node.dataset.probe, ratio: (lighter + 0.05) / (darker + 0.05) }
    })
  })
} finally {
  await browser.close()
}

const byTheme = new Map(themes.map((theme) => [theme, []]))
for (const { probe, ratio } of measured) {
  const [t, s] = probe.split('.').map(Number)
  const sample = SAMPLES[s]
  byTheme.get(themes[t]).push({ pair: `${sample.group} — ${sample.label}`, ratio })
}
for (const pairs of byTheme.values()) pairs.sort((a, b) => a.ratio - b.ratio)

const all = process.argv.includes('--all')
const report = [...byTheme].map(([theme, pairs]) => ({
  theme,
  pairs,
  under: pairs.filter((pair) => pair.ratio < FLOOR),
}))
// Worst first: the point of the table is choosing a theme, so the ones that
// cost the most have to be readable without scrolling to them.
report.sort((a, b) => b.under.length - a.under.length || a.pairs[0].ratio - b.pairs[0].ratio)

const failing = report.filter((entry) => entry.under.length)
const total = failing.reduce((n, entry) => n + entry.under.length, 0)

console.log('Theme contrast — informative, gates nothing (docs/architecture.md §12).')
console.log(
  `${themes.length} themes × ${SAMPLES.length} ink recipes, measured on the painted pixels of dist/app.css.\n`,
)
if (missing.length) console.log(`not compiled into dist/app.css, skipped: ${missing.join(', ')}\n`)
console.log(
  `pairs under ${FLOOR}:1: ${total} over ${failing.length} of ${themes.length} themes` +
    `${all ? '' : ' (--all lists every pair)'}`,
)

for (const { theme, pairs, under } of report) {
  const listed = all ? pairs : under
  if (!listed.length) continue
  console.log(
    `\n  ${theme} — ${under.length} under the floor, worst ${pairs[0].ratio.toFixed(2)}:1`,
  )
  for (const { pair, ratio } of listed) {
    console.log(`    ${ratio.toFixed(2).padStart(5)}${ratio < FLOOR ? ' ✗' : '  '}  ${pair}`)
  }
}

const clear = report.filter((entry) => !entry.under.length)
console.log(
  `\nclear at ${FLOOR}:1 on every recipe: ${clear.length ? clear.map((entry) => entry.theme).join(', ') : 'none'}`,
)
