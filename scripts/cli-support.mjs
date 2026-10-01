// What the `apiglow` subcommands share: reading what a config names, the i18n
// catalog `--language` selects, and loading one spec the way the app does.

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { t } from '../src/i18n/index.js'
import { loadApiModel, loadInlineApiModel, SchemaLoadError } from '../src/openapi/loader.js'
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
//
// `anyContent` is the audit's (docs/audit.md §8): a file it could open is a
// file it reports on. Whatever version the document declares, it is read —
// with the newest semantics when this app does not know that version — and a
// file holding no mapping at all comes back as what it holds (`model: null`),
// for the rules about the file itself to name.
export async function loadSpecModel(config, spec, { multi, base, warnings, anyContent = false }) {
  const resolved = resolveSpecConfig(config, spec, { multi })
  for (const warning of resolved.warnings) warnings.push(warning)
  const effective = resolved.config
  const options = {
    hide: effective.openapi.hide,
    // Read from disk like every other declaration, under the config's own
    // directory: handed over as written, ref-parser would resolve a relative
    // overlay against the working directory instead.
    overlays: effective.openapi.overlays.map((entry) =>
      typeof entry === 'string' ? refUrl(entry, base).href : entry,
    ),
    // The reader's own patch is browser storage; an installation-wide seed of
    // it is a document one browser may have edited or dropped, so what a
    // command reads is the documentation as published (docs/user-overlay.md
    // decision 11).
    userOverlay: null,
    anyVersion: anyContent,
  }
  if (!spec.url && !spec.spec) {
    throw new CliError(`spec "${spec.id}": neither a url nor an inline document`)
  }
  const url = spec.spec ? null : refUrl(spec.url, base)
  // A file is read here, and its text handed to the loader: the core never
  // touches the disk, and a text it cannot parse strictly is one it can still
  // read tolerantly (docs/architecture.md §14.21).
  if (url?.protocol === 'file:') {
    try {
      options.body = await readText(url)
    } catch (err) {
      throw new CliError(`spec "${spec.id}" could not be loaded: ${err.message}`)
    }
  }
  try {
    const loaded = spec.spec
      ? await loadInlineApiModel(spec.spec, options)
      : await loadApiModel(url.href, options)
    // An overlay that could not be read or applied leaves the schema as
    // published, which is no reason to stop — but the author has to hear of it.
    for (const warning of loaded.overlays?.warnings ?? []) {
      warnings.push(`spec "${spec.id}": overlay — ${t(`overlay.code.${warning.code}`, warning)}`)
    }
    return { loaded, config: effective }
  } catch (err) {
    if (anyContent && err instanceof SchemaLoadError && err.detail && 'content' in err.detail) {
      const { content, problems } = err.detail
      const loaded = { model: null, source: content, document: content, problems, overlays: null }
      return { loaded, config: effective }
    }
    const cause = err.detail?.cause?.message ?? err.message
    throw new CliError(`spec "${spec.id}" could not be loaded: ${err.code ?? 'error'} — ${cause}`)
  }
}
