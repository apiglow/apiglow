// Host-defined daisyUI themes (docs/custom-themes.md). A daisyUI 5 theme is
// nothing but a block of CSS custom properties scoped to a `data-theme`
// selector, so branding the docs is pure string generation done at boot from
// `theme.custom` — no rebuild, no new dependency.
//
// This module is the pure half: no DOM, no host config (rule 10). `app.js`
// hands it plain data, probes the base themes it asks for, and decides how to
// surface the warnings it returns.

// The daisyUI 5 theme contract, verbatim variable names (decision 4): zero
// translation layer, so the output of the daisyUI theme generator pastes
// straight into `tokens` and a future daisyUI token is one entry away.
const COLOR_TOKENS = [
  '--color-base-100',
  '--color-base-200',
  '--color-base-300',
  '--color-base-content',
  '--color-primary',
  '--color-primary-content',
  '--color-secondary',
  '--color-secondary-content',
  '--color-accent',
  '--color-accent-content',
  '--color-neutral',
  '--color-neutral-content',
  '--color-info',
  '--color-info-content',
  '--color-success',
  '--color-success-content',
  '--color-warning',
  '--color-warning-content',
  '--color-error',
  '--color-error-content',
]

export const THEME_TOKENS = [
  ...COLOR_TOKENS,
  '--radius-selector',
  '--radius-field',
  '--radius-box',
  '--size-selector',
  '--size-field',
  '--border',
  '--depth',
  '--noise',
]

// What `app.js` reads off the hidden `data-theme` probe to resolve `extends`:
// the tokens plus the property `colorScheme` maps to.
export const PROBE_PROPERTIES = ['color-scheme', ...THEME_TOKENS]

// daisyUI (pinned in package.json) — the set the build ships (rule 3), i.e. the legal
// `extends` targets. Only used to warn: an unknown name is still honoured, so
// a daisyUI bump that adds a theme costs a console line, not a broken config.
export const BUILTIN_THEMES = [
  // The signature pair is compiled into app.css like the standard set, so it
  // is a legal `extends` base too.
  'apiglow',
  'apiglow-dark',
  'abyss',
  'acid',
  'aqua',
  'autumn',
  'black',
  'bumblebee',
  'business',
  'caramellatte',
  'cmyk',
  'coffee',
  'corporate',
  'cupcake',
  'cyberpunk',
  'dark',
  'dim',
  'dracula',
  'emerald',
  'fantasy',
  'forest',
  'garden',
  'halloween',
  'lemonade',
  'light',
  'lofi',
  'luxury',
  'night',
  'nord',
  'pastel',
  'retro',
  'silk',
  'sunset',
  'synthwave',
  'valentine',
  'winter',
  'wireframe',
]

// CSS-identifier-safe, so interpolating the name into a selector needs no
// escaping — the guarantee the generated `:is(…)` selector below relies on.
const NAME_RE = /^[a-z][a-z0-9-]*$/

const TOKENS = new Set(THEME_TOKENS)
const BUILTINS = new Set(BUILTIN_THEMES)

// Values are host-authored CSS emitted verbatim inside a <style>: pass any
// color/length syntax through, reject only what could escape the declaration.
function isSafeValue(value) {
  if (!value) return false
  if (/[;{}<>]/.test(value)) return false
  return ![...value].some((char) => {
    const code = char.codePointAt(0)
    return code < 0x20 || code === 0x7f
  })
}

// Guarded: `NAME_RE.test(undefined)` would happily match the string "undefined".
const isValidName = (name) => typeof name === 'string' && NAME_RE.test(name)

const where = (index, name) =>
  name ? `theme.custom[${index}] ("${name}")` : `theme.custom[${index}]`

// → { themes, warnings }. Lenient by design (decision 6): anything wrong is
// dropped with a warning, nothing throws — a styling concern must never take
// the documentation down.
export function validateCustomThemes(definitions, { available = [] } = {}) {
  const list = Array.isArray(definitions) ? definitions : []
  const warnings = []
  const themes = []
  const declared = new Set(
    list.map((raw) => (isPlainObject(raw) ? raw.name : null)).filter(isValidName),
  )
  const seen = new Set()

  for (const [index, raw] of list.entries()) {
    if (!isPlainObject(raw)) {
      warnings.push(`${where(index)}: ignored, expected an object`)
      continue
    }
    const name = raw.name
    if (!isValidName(name)) {
      warnings.push(`${where(index)}: ignored, "name" must match ${NAME_RE.source}`)
      continue
    }
    if (seen.has(name)) {
      warnings.push(`${where(index, name)}: ignored, duplicate of an earlier definition`)
      continue
    }
    seen.add(name)
    if (!available.includes(name)) {
      warnings.push(
        `${where(index, name)}: injected but absent from theme.available, so not selectable`,
      )
    }

    themes.push({
      name,
      extends: resolveExtends(raw.extends, { index, name, declared, warnings }),
      colorScheme: resolveColorScheme(raw.colorScheme, { index, name, warnings }),
      tokens: resolveTokens(raw.tokens, { index, name, warnings }),
    })
  }

  for (const theme of themes) {
    if (!theme.extends && !Object.keys(theme.tokens).length) {
      warnings.push(`theme.custom ("${theme.name}"): defines no token, it will change nothing`)
    }
  }

  return { themes, warnings }
}

function resolveExtends(value, { index, name, declared, warnings }) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value) {
    warnings.push(`${where(index, name)}: "extends" ignored, expected a theme name`)
    return null
  }
  // A built-in of the same name wins over a same-named custom entry: that is
  // exactly the in-place override case (decision 5) extending its own base.
  if (BUILTINS.has(value)) return value
  if (declared.has(value)) {
    warnings.push(
      `${where(index, name)}: "extends" ignored, "${value}" is a custom theme and extending one is out of scope`,
    )
    return null
  }
  warnings.push(
    `${where(index, name)}: "${value}" is not a known built-in daisyUI theme, its values may not resolve`,
  )
  return value
}

function resolveColorScheme(value, { index, name, warnings }) {
  if (value === undefined || value === null) return null
  if (value !== 'light' && value !== 'dark') {
    warnings.push(`${where(index, name)}: "colorScheme" ignored, expected "light" or "dark"`)
    return null
  }
  return value
}

function resolveTokens(value, { index, name, warnings }) {
  const tokens = {}
  if (value === undefined || value === null) return tokens
  if (!isPlainObject(value)) {
    warnings.push(`${where(index, name)}: "tokens" ignored, expected an object`)
    return tokens
  }
  for (const [token, raw] of Object.entries(value)) {
    if (!TOKENS.has(token)) {
      warnings.push(`${where(index, name)}: unknown token "${token}", skipped`)
      continue
    }
    const declaration = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
    if (!isSafeValue(declaration)) {
      warnings.push(`${where(index, name)}: invalid value for "${token}", skipped`)
      continue
    }
    tokens[token] = declaration
  }
  return tokens
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The base themes `app.js` has to probe, in declaration order.
export function baseThemesOf(themes) {
  return [...new Set(themes.map((theme) => theme.extends).filter(Boolean))]
}

// daisyUI does not scope themes under a bare `[data-theme=x]`; mirroring its
// own selector shape keeps an in-place override of a built-in (decision 5) at
// equal specificity, where document order decides — and our block comes last.
// Safe to interpolate: NAME_RE forbids anything needing escaping.
function themeSelector(name) {
  return `:is(:root:has(input.theme-controller[value="${name}"]:checked),[data-theme="${name}"])`
}

// `baseValues` = { [baseThemeName]: { 'color-scheme': …, '--color-…': … } },
// as read from the probe. Themes without `extends`, or whose base was not
// probed, simply emit their own tokens and let the cascade fill the rest.
export function renderCustomThemesCss(themes, baseValues = {}) {
  let css = ''
  for (const theme of themes) {
    const base = sanitizeBaseValues(baseValues[theme.extends])
    const declarations = []

    const colorScheme = theme.colorScheme ?? base['color-scheme'] ?? null
    if (colorScheme) declarations.push(['color-scheme', colorScheme])
    for (const token of THEME_TOKENS) {
      const value = theme.tokens[token] ?? base[token]
      if (value) declarations.push([token, value])
    }

    if (!declarations.length) continue
    const body = declarations.map(([property, value]) => `  ${property}: ${value};`).join('\n')
    css += `${themeSelector(theme.name)} {\n${body}\n}\n`
  }
  return css
}

// Probe readings are browser-produced, but they land in the same <style> as
// host values, so they go through the same filter.
function sanitizeBaseValues(values) {
  const base = {}
  if (!isPlainObject(values)) return base
  for (const property of PROBE_PROPERTIES) {
    const value = typeof values[property] === 'string' ? values[property].trim() : ''
    if (isSafeValue(value)) base[property] = value
  }
  return base
}
