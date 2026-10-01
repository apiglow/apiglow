// What the `apiglow` subcommands share: reading what a config names, the i18n
// catalog `--language` selects, and loading one spec the way the app does.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadApiModel, loadInlineApiModel } from '../src/openapi/loader.js'
import { resolveSpecConfig } from '../src/specs.js'

// What the author has to fix before the command can run at all, as opposed to
// what it can work around and report as a warning.
export class CliError extends Error {}

export const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// Reading side. Under a `file:` base a root-absolute path is taken as relative
// too: `/openapi.json` in a host config means "the site root", and on disk that
// is the directory the config sits in.
export function refUrl(ref, base) {
  const value = String(ref ?? '')
  if (HAS_SCHEME.test(value)) return new URL(value)
  return new URL(base.protocol === 'file:' ? value.replace(/^\/+/, '') : value, base)
}

export async function readText(url) {
  if (url.protocol === 'file:') return readFile(fileURLToPath(url), 'utf8')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.href}`)
  return response.text()
}

// Where the catalogs sit relative to this module once it runs, and both answers
// are right: next to the sources for `scripts/` in the repo, next to the bundle
// for `dist/cli.js` in the published package, where the app build has already
// copied them into `dist/i18n/`.
const CATALOG_BASES = ['../i18n/', './i18n/']

// The catalog `--language` selects, read off the disk: what a command writes
// for a reader is a product surface, and a French install reads French (rule 9).
export async function catalog(language) {
  if (!language || language === 'en') return null
  let last
  for (const base of CATALOG_BASES) {
    const url = new URL(`${base}${language}.json`, import.meta.url)
    try {
      return JSON.parse(await readFile(fileURLToPath(url), 'utf8'))
    } catch (err) {
      last = err
    }
  }
  throw new CliError(`unknown --language "${language}" (${last.message})`)
}

// One spec of the install, loaded with the overlays and hide patterns its
// effective config declares → { loaded, config }. A schema the command could
// not read is the end of the run, not a warning: everything a command writes
// derives from it. The loader's typed code plus what it was reading, because
// "malformed" alone names neither the file nor what was wrong with it.
export async function loadSpecModel(config, spec, { multi, base, warnings }) {
  const resolved = resolveSpecConfig(config, spec, { multi })
  for (const warning of resolved.warnings) warnings.push(warning)
  const effective = resolved.config
  const options = {
    hide: effective.openapi.hide,
    overlays: effective.openapi.overlays,
    // The reader's own patch is browser storage; an installation-wide seed of
    // it is a document one browser may have edited or dropped, so what a
    // command reads is the documentation as published (docs/user-overlay.md
    // decision 11).
    userOverlay: null,
  }
  if (!spec.url && !spec.spec) {
    throw new CliError(`spec "${spec.id}": neither a url nor an inline document`)
  }
  try {
    const loaded = spec.spec
      ? await loadInlineApiModel(spec.spec, options)
      : await loadApiModel(refUrl(spec.url, base).href, options)
    return { loaded, config: effective }
  } catch (err) {
    const cause = err.detail?.cause?.message ?? err.message
    throw new CliError(`spec "${spec.id}" could not be loaded: ${err.code ?? 'error'} — ${cause}`)
  }
}
