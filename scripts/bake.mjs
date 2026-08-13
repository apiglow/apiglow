#!/usr/bin/env node
// `apiglow bake` (docs/seo.md §4): the author-side companion that writes the
// documentation to disk as static files — a `.md` mirror and an `.html`
// snapshot per route, `sitemap.xml`, `llms.txt` and `llms-full.txt`. It is what
// makes a hash-routed, client-rendered install visible to a crawler that runs
// no JavaScript and to an agent that only fetches URLs.
//
// It is not a prerender of the app: no DOM, no web components, no second
// rendering engine. It reads the host config the way the app reads it
// (`src/config.js`, `src/specs.js`), loads the schema through the app's own
// loader, and writes out the pure generators of `src/export/`. If a snapshot
// and the app ever disagree, the generator is what gets fixed — and the in-app
// "Copy page" output disagrees identically, which is how the snapshot tests
// catch the drift.
//
// Two resolutions of the same declaration, and they are not the same address:
//   - READING. What the config names is read from disk, under the config's own
//     directory — a leading `/` included, because the config sits where the
//     site is assembled and that is what the reader's server root will be. A
//     URL carrying a scheme is fetched as it stands. This is what lets a bake
//     run in CI before anything is deployed.
//   - PUBLISHING. Every URL that goes INTO a generated file is resolved against
//     `--site-url`, exactly as a browser resolves it against the host page.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { hostConfig } from '../src/config.js'
import {
  dedentDocsContent,
  docsPageFormat,
  flattenDocsOutline,
  manifestPages,
  mergeDocsPages,
  resolveDocsOutline,
} from '../src/docs/pages.js'
import { publishedArazzo } from '../src/export/arazzo.js'
import { docsPageBody, toDocsPageMarkdown } from '../src/export/docs-page-markdown.js'
import { toEndpointMarkdown } from '../src/export/endpoint-markdown.js'
import { toLlmsFullText } from '../src/export/llms-full.js'
import { toLlmsText } from '../src/export/llms.js'
import { toScenarioMarkdown } from '../src/export/scenario-markdown.js'
import { RECIPE_EXT, bakedPath, bakedUrl, bakedUrls, siteBase } from '../src/export/site-layout.js'
import { toSitemap } from '../src/export/sitemap.js'
import { SNAPSHOT_LABEL_KEYS, toSnapshotHtml } from '../src/export/snapshot-html.js'
import { t, useDictionary } from '../src/i18n/index.js'
import { loadApiModel, loadInlineApiModel } from '../src/openapi/loader.js'
import { opHash, overviewHash, pageHash, scenarioHash, setRouteSpecId } from '../src/router.js'
import { publishedScenarios } from '../src/scenarios/loader.js'
import { headFor } from '../src/shell/head.js'
import { normalizeSpecsConfig, resolveSpecConfig } from '../src/specs.js'

// What the author has to fix before the bake can run at all, as opposed to what
// it can work around and report as a warning.
class BakeError extends Error {}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// Reading side. Under a `file:` base a root-absolute path is taken as relative
// too: `/openapi.json` in a host config means "the site root", and on disk that
// is the directory the config sits in.
function refUrl(ref, base) {
  const value = String(ref ?? '')
  if (HAS_SCHEME.test(value)) return new URL(value)
  return new URL(base.protocol === 'file:' ? value.replace(/^\/+/, '') : value, base)
}

async function readText(url) {
  if (url.protocol === 'file:') return readFile(fileURLToPath(url), 'utf8')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url.href}`)
  return response.text()
}

// Publishing side: the address the same declaration answers at once the site is
// served, which is where every generated link has to point.
function publishUrl(ref, siteUrl) {
  const value = String(ref ?? '')
  if (!value) return ''
  return HAS_SCHEME.test(value) ? value : new URL(value, siteBase(siteUrl)).href
}

// The `docsPages` manifest form (docs/docs-pages.md §2.2): the same resolution
// the shell does, minus the browser. Relative page URLs rebase on the
// manifest's own address, which is what makes a docs folder movable in one
// piece — and here that address is a file on disk.
async function docsEntries(raw, base, warnings) {
  if (typeof raw !== 'string') return Array.isArray(raw) ? raw : []
  const url = refUrl(raw, base)
  try {
    return manifestPages(JSON.parse(await readText(url)), url.href)
  } catch (err) {
    warnings.push(`docsPages manifest ${raw} could not be read (${err.message}) — no page from it`)
    return []
  }
}

// → [{ page, text, format }] for the pages that have a body here. A page the
// host page carries in an element (`contentId`) has none: it lives in HTML the
// bake never sees, and saying so is better than emitting an empty mirror.
// The reads run together — a docs folder is a folder of independent files —
// and the results are collected in page order, so the warnings a run prints
// stay the same from one bake to the next.
async function docsBodies(pages, base, warnings) {
  const results = await Promise.all(
    pages.map(async (page) => {
      if (page.content) {
        return { page, text: dedentDocsContent(page.content), format: docsPageFormat(page) }
      }
      if (!page.url) {
        return { page, skipped: `page "${page.slug}" is carried by the host page (contentId)` }
      }
      try {
        return { page, text: await readText(refUrl(page.url, base)), format: docsPageFormat(page) }
      } catch (err) {
        return { page, skipped: `page "${page.slug}" could not be read (${err.message})` }
      }
    }),
  )
  const loaded = []
  for (const result of results) {
    if (result.skipped) warnings.push(`${result.skipped} — not baked`)
    else loaded.push(result)
  }
  return loaded
}

// What the bake adds to the publishable set: the recipe it writes next to the
// mirror, and the address that file answers at.
async function bakedScenarios(entries, { ops, base, specId, specUrl, siteUrl, warnings }) {
  const published = await publishedScenarios(entries, {
    ops,
    fetchText: (url) => readText(refUrl(url, base)),
    onSkip: (record) =>
      warnings.push(
        `scenario "${record.id}" could not be loaded (${record.error?.code}) — not baked`,
      ),
  })
  return published.map((entry) => {
    const recipe = publishedArazzo(entry, { ops, specUrl })
    if (!recipe) {
      warnings.push(
        `scenario "${entry.id}": the schema is not published, so a generated recipe would name a source no runner can fetch — no Arazzo recipe baked`,
      )
    }
    return {
      ...entry,
      recipe,
      // Once the bake has run, every link points at what it wrote, the recipe
      // included: the map is served from this tree and its entries are uniform
      // there. The author's own file stays exactly where it was, and it is the
      // CI panel that keeps naming that address (§3.2).
      recipeUrl: recipe
        ? bakedUrl(siteUrl, { kind: 'scenario', id: entry.id, specId }, RECIPE_EXT)
        : '',
    }
  })
}

function firstBaseUrl(model, environments, { specUrl, siteUrl }) {
  const declared = environments.find((env) => env?.baseUrl)?.baseUrl
  if (declared) return declared
  const server = model.servers?.[0]?.url
  if (!server) return ''
  // Same base as the app's: what the document says it is, else where it is
  // served from — a relative `/api/v3` is meaningless without one, and an
  // inline schema is served from the host page like everything else it carries.
  return new URL(server, model.baseUri || specUrl || siteBase(siteUrl)).href
}

// A schema this CLI could not read is the end of the run, not a warning: every
// file below derives from it. The loader's typed code plus what it was reading,
// because "malformed" alone names neither the file nor what was wrong with it.
async function loadModel(spec, { base, options }) {
  if (!spec.url && !spec.spec) {
    throw new BakeError(`spec "${spec.id}": neither a url nor an inline document to bake`)
  }
  try {
    return spec.spec
      ? await loadInlineApiModel(spec.spec, options)
      : await loadApiModel(refUrl(spec.url, base).href, options)
  } catch (err) {
    const cause = err.detail?.cause?.message ?? err.message
    throw new BakeError(`spec "${spec.id}" could not be loaded: ${err.code ?? 'error'} — ${cause}`)
  }
}

// One spec, everything the emitters need: the model, the pages with their
// bodies, the published workflows, and the two URLs the generated files talk
// about (the schema's, and the API's).
async function loadSpec(spec, { config, rootDocsPages, multi, base, siteUrl, language, warnings }) {
  const resolved = resolveSpecConfig(config, spec, { multi })
  for (const warning of resolved.warnings) warnings.push(warning)
  const effective = resolved.config
  const options = {
    hide: effective.openapi.hide,
    overlays: effective.openapi.overlays,
    // The reader's own patch is browser storage; an installation-wide seed of
    // it is a document one browser may have edited or dropped, so what the bake
    // publishes is the documentation as published (docs/user-overlay.md
    // decision 11).
    userOverlay: null,
  }
  const loaded = await loadModel(spec, { base, options })

  const docsPages =
    typeof config.docsPages === 'string' || typeof spec.docsPages === 'string'
      ? mergeDocsPages(rootDocsPages, await docsEntries(spec.docsPages, base, warnings), warnings)
      : effective.docsPages
  const outline = resolveDocsOutline(docsPages, language)
  const pages = await docsBodies(flattenDocsOutline(outline), base, warnings)

  const model = loaded.model
  const ops = [...model.operations, ...model.webhooks]
  // An inline schema is published by nobody: there is no document to link, and
  // no `sourceDescriptions` a runner could fetch (docs/architecture.md §5.14).
  const specUrl = spec.url ? publishUrl(spec.url, siteUrl) : ''
  const specId = multi ? spec.id : ''
  const scenarios =
    effective.features.scenarios === false
      ? []
      : await bakedScenarios(effective.scenarios, {
          ops,
          base,
          specId,
          specUrl,
          siteUrl,
          warnings,
        })

  return {
    specId,
    model,
    ops,
    pages,
    outline: bakedOutline(outline, new Set(pages.map(({ page }) => page.slug))),
    scenarios,
    specUrl,
    baseUrl: firstBaseUrl(model, effective.environments, { specUrl, siteUrl }),
    // How many overlays stand between the published document and what this
    // documentation renders: the caveat every hand-off pointing at that URL
    // owes its reader.
    overlays: loaded.overlays?.actions ? loaded.overlays.count : 0,
  }
}

// Everything one spec contributes to the tree. `files` is the whole output, so
// the multi-spec loop simply writes into it under its own `s/{specId}/` prefix.
function emitSpec(source, { files, siteUrl, language, labels }) {
  const { specId, model, ops, pages, outline, scenarios, specUrl, baseUrl, overlays } = source
  // The hash builders carry the multi-spec prefix, locked here exactly as the
  // shell locks it at boot: the links back into the app are the app's own.
  setRouteSpecId(specId || null)
  const home = siteBase(siteUrl)
  const mdUrls = bakedUrls(siteUrl, { specId, ext: 'md' })

  const emit = (target, { head, markdown, content = markdown, appHash }) => {
    const hasMirror = typeof markdown === 'string'
    if (hasMirror) files.set(bakedPath(target, 'md'), markdown)
    files.set(
      bakedPath(target, 'html'),
      toSnapshotHtml({
        markdown: content,
        title: head.title,
        description: head.description,
        jsonLd: head.jsonLd,
        canonical: bakedUrl(siteUrl, target, 'html'),
        appUrl: `${home}${appHash}`,
        markdownUrl: hasMirror ? bakedUrl(siteUrl, target, 'md') : '',
        lang: language,
        labels,
      }),
    )
  }

  for (const { page, text, format } of pages) {
    emit(
      { kind: 'page', id: page.slug, specId },
      {
        head: headFor({ type: 'page', page, text, format }, model),
        markdown: toDocsPageMarkdown({ title: page.title, text, format }),
        appHash: pageHash(page.slug),
      },
    )
  }

  for (const entry of scenarios) {
    const target = { kind: 'scenario', id: entry.id, specId }
    // The recipe next to the mirror (docs/scenario-handoff.md §3.4): the
    // authored document copied whole, or the one `toArazzo` generates. Written
    // as JSON either way — a document authored in YAML is re-serialized rather
    // than copied byte for byte, and its comments do not survive.
    if (entry.recipe) {
      files.set(bakedPath(target, RECIPE_EXT), `${JSON.stringify(entry.recipe, null, 2)}\n`)
    }
    emit(target, {
      head: headFor({ type: 'scenario', scenario: entry.scenario, title: entry.title }, model),
      markdown: toScenarioMarkdown(entry.scenario, { ops, baseUrl, heading: entry.title }),
      appHash: scenarioHash(entry.id),
    })
  }

  for (const op of ops) {
    emit(
      { kind: 'op', id: op.id, specId },
      {
        head: headFor({ type: 'op', op }, model),
        markdown: toEndpointMarkdown(op, { baseUrl }),
        appHash: opHash(op.id),
      },
    )
  }

  // The overview snapshot is the map of everything above, linking the `.html`
  // pages — which is `llms.txt` with the human-facing mapper. It carries no
  // `.md` mirror of its own: an agent reads the served `llms.txt` instead, and
  // this page exists so a crawler arriving at the site root finds a link to
  // every snapshot rather than a sitemap and nothing else.
  const index = (urls) =>
    toLlmsText(model, {
      docsUrl: siteUrl,
      baseUrl,
      specUrl,
      outline,
      overlays,
      scenarios,
      urls,
    })
  emit(
    { kind: 'overview', specId },
    {
      head: headFor({ type: 'overview' }, model),
      markdown: null,
      content: index(bakedUrls(siteUrl, { specId, ext: 'html' })),
      appHash: overviewHash(),
    },
  )

  return {
    llms: index(mdUrls),
    llmsFull: toLlmsFullText(model, {
      baseUrl,
      pages: pages.map(({ page, text, format }) => ({
        slug: page.slug,
        title: page.title,
        content: docsPageBody(text, format),
      })),
      // The recipe already published above, handed over as the entry's own
      // document: `publishedArazzo` then returns it untouched instead of
      // generating a second, identical one per scenario.
      scenarios: scenarios.map((entry) => ({ ...entry, arazzo: entry.recipe })),
      specUrl,
      urls: mdUrls,
    }),
    sitemapSource: { specId, model, pages: pages.map(({ page }) => page), scenarios },
  }
}

// The nav's arrangement, minus what the bake could not read: a page with no
// body is emitted nowhere, and a map linking a file nobody wrote is worse than
// one entry fewer. External links stay — they were never ours to serve.
function bakedOutline(outline, slugs) {
  const kept = (entry) => entry.kind !== 'page' || slugs.has(entry.slug)
  return outline
    .map((entry) =>
      entry.kind === 'group' ? { ...entry, entries: entry.entries.filter(kept) } : entry,
    )
    .filter((entry) => (entry.kind === 'group' ? entry.entries.length > 0 : kept(entry)))
}

export async function bake({
  config: raw,
  // Where the config's own declarations are read from: its directory, and the
  // working directory for a caller that has no file to point at.
  base = pathToFileURL(`${process.cwd()}/`),
  siteUrl,
  language = 'en',
} = {}) {
  if (!siteUrl) throw new BakeError('--site-url is required: every emitted URL derives from it')
  const config = hostConfig(raw)
  // Baking a documentation that asks not to be indexed is a contradiction, and
  // a silent one: the tree would be written, served, and crawled.
  if (config.seo.index === false) {
    throw new BakeError('the config says seo: { index: false } — there is nothing to publish')
  }
  useDictionary(language, await catalog(language))
  const labels = Object.fromEntries(
    Object.entries(SNAPSHOT_LABEL_KEYS).map(([name, key]) => [name, t(key)]),
  )

  const warnings = []
  let specsConfig
  try {
    specsConfig = normalizeSpecsConfig(config.openapi)
  } catch (err) {
    // An invalid id or a duplicate one: the app refuses to boot on it, and the
    // bake would otherwise write a tree at addresses that install cannot serve.
    throw new BakeError(err.message)
  }
  for (const warning of specsConfig.warnings) warnings.push(warning)

  // The root manifest describes the whole install, not one spec: read once,
  // or a multi-spec bake fetches the same file per spec and repeats its
  // failure warning as many times.
  const rootDocsPages = await docsEntries(config.docsPages, base, warnings)

  const files = new Map()
  const llms = []
  const llmsFull = []
  const sitemapSources = []
  for (const spec of specsConfig.specs) {
    const source = await loadSpec(spec, {
      config,
      rootDocsPages,
      multi: specsConfig.multi,
      base,
      siteUrl,
      language,
      warnings,
    })
    const emitted = emitSpec(source, { files, siteUrl, language, labels })
    llms.push(emitted.llms)
    llmsFull.push(emitted.llmsFull)
    sitemapSources.push(emitted.sitemapSource)
  }

  // The root files cover the whole site: one address a crawler is given, one
  // map an agent reads first, whatever the install nests underneath.
  files.set('sitemap.xml', toSitemap(sitemapSources, { siteUrl }))
  files.set('llms.txt', llms.join('\n'))
  files.set('llms-full.txt', llmsFull.join('\n'))
  return { files, warnings }
}

// Where the catalogs sit relative to the file being run, and both answers are
// right: next to the sources for `scripts/bake.mjs` in the repo, next to the
// bundle for `dist/bake.js` in the published package, where the app build has
// already copied them into `dist/i18n/`.
const CATALOG_BASES = ['../i18n/', './i18n/']

// The catalog `--language` selects, read off the disk: the snapshots' chrome is
// a product surface and a French install publishes French pages (rule 9).
async function catalog(language) {
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
  throw new BakeError(`unknown --language "${language}" (${last.message})`)
}

// The tree is a handful of directories holding two files per route: creating
// each one once, then writing in parallel, is what keeps a large spec from
// paying one round trip per file.
async function writeTree(out, files) {
  const targets = [...files].map(([path, content]) => [resolvePath(out, path), content])
  const dirs = new Set(targets.map(([target]) => dirname(target)))
  await Promise.all([...dirs].map((dir) => mkdir(dir, { recursive: true })))
  await Promise.all(targets.map(([target, content]) => writeFile(target, content, 'utf8')))
}

const USAGE = `Usage: apiglow bake --config <file> --site-url <url> --out <dir> [--language en|fr]

  --config     the JSON config the host page inlines in #api-doc-config
  --site-url   absolute URL of the deployed documentation page
  --out        directory the static tree is written to
  --language   catalog used for the snapshots' chrome (default: en)`

export async function main(argv) {
  // The package installs this file as the `apiglow` binary, where baking is one
  // command among the ones a later version may add; from the repo it is run as
  // the script it is. Both spellings reach the same run.
  const args = argv[0] === 'bake' ? argv.slice(1) : argv
  let values
  try {
    ;({ values } = parseArgs({
      args,
      options: {
        config: { type: 'string' },
        'site-url': { type: 'string' },
        out: { type: 'string' },
        language: { type: 'string', default: 'en' },
        help: { type: 'boolean', default: false },
      },
    }))
  } catch (err) {
    throw new BakeError(`${err.message}\n\n${USAGE}`)
  }
  if (values.help) return USAGE
  for (const name of ['config', 'site-url', 'out']) {
    if (!values[name]) throw new BakeError(`--${name} is required\n\n${USAGE}`)
  }
  const configPath = resolvePath(values.config)
  let config
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (err) {
    throw new BakeError(`--config ${values.config} could not be read: ${err.message}`)
  }
  const { files, warnings } = await bake({
    config,
    // The config's own directory is where its relative declarations live, the
    // way the host page is where they live once served.
    base: pathToFileURL(configPath),
    siteUrl: values['site-url'],
    language: values.language,
  })
  await writeTree(values.out, files)
  return [
    ...warnings.map((warning) => `warning: ${warning}`),
    `Baked ${files.size} files into ${values.out}`,
  ].join('\n')
}

// Run only when invoked as a program: the integration test imports `bake()`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(await main(process.argv.slice(2)))
  } catch (err) {
    console.error(err instanceof BakeError ? `apiglow bake: ${err.message}` : err)
    process.exitCode = 1
  }
}
