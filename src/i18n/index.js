// The import attribute is what makes this module loadable by plain Node too:
// the bake CLI runs the same head derivation as the app (docs/seo.md §4), and
// Node refuses a JSON import that does not declare its type.
import en from './en.json' with { type: 'json' }

// English is bundled inline: the UI can never be broken by
// a network failure on the language file (docs/architecture.md §5.10). `t()` falls back to
// English key by key, then to the key itself.
// The English fallback grows when a lazily loaded part of the app brings its
// own strings (`extendEnglish`).
let english = en
let active = english
let current = 'en'

export function t(key, params = {}) {
  const str = active[key] ?? english[key] ?? key
  return str.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match)
}

export function currentLanguage() {
  return current
}

// A catalog already in hand, from wherever the caller got it: the app fetches
// it, the bake CLI reads it off the disk (docs/seo.md §4). English underneath
// either way, so a key the translation lacks still renders.
export function useDictionary(code, dict) {
  active = dict ? { ...english, ...dict } : english
  current = dict ? code : 'en'
}

// The English strings of a part of the app loaded on demand — the schema
// audit's rule texts ship in audit.js, not in the main bundle
// (docs/architecture.md §14.8). An active translation keeps the last word:
// its catalog already carries these keys.
export function extendEnglish(strings) {
  const extended = { ...english, ...strings }
  active = active === english ? extended : { ...strings, ...active }
  english = extended
}

// Activates a language. 'en' is bundled; any other language is lazy-loaded
// from i18n/{code}.json — only the active language is downloaded.
export async function setLanguage(code) {
  if (!code || code === 'en') {
    useDictionary('en', null)
    return true
  }
  try {
    const response = await fetch(languageFileUrl(code))
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    useDictionary(code, await response.json())
    return true
  } catch (err) {
    console.error(`[api-doc] Failed to load language "${code}", falling back to English:`, err)
    useDictionary('en', null)
    return false
  }
}

function languageFileUrl(code) {
  // In dev, language sources live at the repo root (/i18n); in
  // build they're copied into dist/i18n, resolved via import.meta.url next
  // to app.js (never document.currentScript — null in an ESM module).
  const base = import.meta.env.DEV
    ? new URL('/i18n/', window.location.origin)
    : new URL(/* @vite-ignore */ './i18n/', import.meta.url)
  return new URL(`${encodeURIComponent(code)}.json`, base).href
}
