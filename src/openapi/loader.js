import $RefParser from '@apidevtools/json-schema-ref-parser'
import { dereferenceInternal } from './deref.js'
import { normalizeDocument } from './model.js'
import { applyOverlays } from './overlay.js'
import { convertSwagger2, isSwagger2 } from './swagger2.js'
import { readUserOverlay, seedUserOverlay, USER_OVERLAY_TOO_LARGE } from './user-overlay.js'

// Typed error: the UI translates `code` into a distinct educational message
// (docs/architecture.md §5.1: CORS, 404, malformed content, invalid schema).
export class SchemaLoadError extends Error {
  constructor(code, detail = {}) {
    super(`schema load failed: ${code}`)
    this.name = 'SchemaLoadError'
    this.code = code // 'network' | 'http' | 'malformed' | 'invalid-schema' | 'unsupported-version'
    this.detail = detail
  }
}

// ref-parser's built-in HTTP resolver depends on Buffer (Node) and throws
// "Buffer is not defined" in the browser; we substitute a minimal fetch
// resolver returning text — ref-parser's JSON/YAML parsers accept
// strings. Also used for external HTTP $refs.
const fetchHttpResolver = {
  order: 100,
  canRead: /^https?:\/\//i,
  async read(file) {
    const response = await fetch(file.url)
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status}: ${file.url}`)
      err.status = response.status
      throw err
    }
    return response.text()
  },
}

// ref-parser's parsers call Buffer.isBuffer even in the browser
// ("Buffer is not defined"): an inert stub is enough since our resolver
// only produces strings. ??= guarantees never overwriting the real
// Buffer on Node, nor any polyfill the host page might have.
function stubBuffer() {
  globalThis.Buffer ??= { isBuffer: () => false }
}

// One macrotask boundary. The load pipeline's stages — parse, dereference,
// normalize — each cost hundreds of milliseconds on a heavy document, and a
// pipeline awaited end-to-end runs them all in ONE task: microtasks never let
// the browser breathe. A boundary between stages keeps every task under the
// blocking cap of rule 14 and lets the loading view actually paint.
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

// What a load produces: the normalized model the whole app renders from, plus
// the two raw shapes the schema audit needs (docs/audit.md §5) — `source` as
// served, `$ref`s intact, and `document` dereferenced. Nothing but the audit
// and the user overlay's dry run read the raw ones (rule 6) — both are
// user-triggered, which is why `source` is a lazy getter: its consumers pay
// for it on first access instead of every boot paying for them.
function loaded(sourceOf, document, options, overlays = null) {
  const result = { model: buildModel(document, options), document, overlays }
  Object.defineProperty(result, 'source', { get: sourceOf, enumerable: true })
  return result
}

// Overlays (`options.overlays`, filled by the shell from the host config —
// rule 10) are resolved and applied here, on the parsed document, BEFORE the
// 2.0 conversion: an overlay targets the file its author has in front of them,
// and that file may be a 2.0 one. Everything downstream — the audit's `source`
// included — therefore sees one document, the overlaid one, which is also the
// one the app renders.
//
// The user's own overlay (docs/user-overlay.md) is a third source, appended
// last: their fix wins over the host's declarations, because the host is who
// published the defect. It comes from storage rather than from `options` — it
// is user data, and the shell never carries it. `options.userOverlay` is the
// one thing the shell does carry about it: the document this installation hands
// a browser that has none yet (decision 11), seeded here because this is where
// the parser that reads it already runs, and just before the read it feeds.
async function overlaid(doc, options, resolve) {
  const warnings = []
  await seedFromHost(options.userOverlay, resolve, warnings)
  const user = readUserOverlay()
  const hosted = options.overlays ?? []
  // A seed that could not be honoured still has to be sayable, so its warning
  // alone is enough to open the diagnostics block.
  if (!hosted.length && !user && !warnings.length)
    return { document: doc, diagnostics: null, documents: [] }
  const documents = []
  for (const entry of hosted) {
    const document = await overlayDocument(entry, resolve, warnings)
    if (document) documents.push(document)
  }
  if (user) documents.push(user)
  const applied = applyOverlays(doc, documents)
  return {
    document: applied.document,
    // The resolved overlay documents themselves, kept so the lazy `source`
    // rebuild replays exactly what this boot applied — re-reading storage
    // there could apply a patch the rendered schema never saw.
    documents,
    diagnostics: {
      count: hosted.length + (user ? 1 : 0),
      actions: applied.actions,
      warnings: [...warnings, ...applied.warnings],
      infos: applied.infos,
      // Which of the applied documents is the user's, so the diagnostics block
      // and the header badge can name it rather than let it pass for the
      // host's. Last by construction, hence the count.
      user: user ? documents.length : null,
    },
  }
}

// One overlay entry → one document: the object as declared, or the file it
// points at. ref-parser rather than fetch + JSON.parse: overlays are written in
// YAML as often as in JSON, and this is the parser we already ship.
async function overlayDocument(entry, resolve, warnings) {
  if (entry && typeof entry === 'object') return entry
  if (typeof entry !== 'string' || !entry.trim()) {
    warnings.push({ code: 'overlay-invalid' })
    return null
  }
  try {
    return await $RefParser.parse(entry, { resolve })
  } catch (err) {
    console.error('[api-doc] overlay fetch failed:', entry, err)
    warnings.push({ code: 'overlay-fetch-failed', url: entry })
    return null
  }
}

// The installation's starting patch (docs/user-overlay.md decision 11): same
// two forms as an `overlays[]` entry, and the same reader — a host that already
// keeps its overlays as YAML files has no reason to make an exception of this
// one. What `seedUserOverlay` refuses (not an overlay, over the cap) is
// reported like anything else an overlay declaration got wrong: the schema
// renders as published, and the diagnostics say why.
async function seedFromHost(declared, resolve, warnings) {
  if (declared == null) return
  const document = await overlayDocument(declared, resolve, warnings)
  if (!document) return
  const result = seedUserOverlay(document)
  if (result.ok) return
  warnings.push({
    code:
      result.code === USER_OVERLAY_TOO_LARGE
        ? 'user-overlay-seed-too-large'
        : 'user-overlay-seed-invalid',
  })
}

// Swagger 2.0 is read by converting it once, here, before anything downstream
// sees it (`swagger2.js`). It happens on the `$ref`-BEARING document, ahead of
// dereference, because the converter also rewrites the pointers the moved
// components changed (`#/definitions/Pet` → `#/components/schemas/Pet`) — which
// a dereferenced document no longer has. Everything after this line, the audit
// included, therefore works on one shape: a 3.0 document.
function upconverted(doc) {
  return isSwagger2(doc) ? convertSwagger2(doc) : doc
}

// 3.2 `$self`: the URI the document claims as its own. When present it is the
// base every relative `$ref` and every relative server URL resolves against —
// a document served from a mirror still points at the same places. `null` when
// the document declares none (or declares one we cannot resolve): the URL it
// was fetched from then remains the base, which is what 3.0/3.1 always meant.
function documentBase(doc, url) {
  const self = typeof doc?.$self === 'string' ? doc.$self.trim() : ''
  if (!self) return null
  try {
    return new URL(self, url ?? globalThis.location?.href ?? 'https://schema.invalid/').href
  } catch {
    return null
  }
}

// A `file:` URL never comes from a browser: it is what the bake CLI hands over
// for a schema sitting next to the config on disk (docs/seo.md §4). There is no
// CORS to tell a 404 apart from, and `fetch` cannot read one anyway — ref-parser
// reads it off the disk, and an unreadable file surfaces as `malformed` with the
// system error as its cause.
const FILE_URL = /^file:/i

// `options` is passed through as-is to normalization (today: `hide`) —
// the shell injects into it what it read from the host config, the core never
// reads it itself (rule 10).
export async function loadApiModel(url, options = {}) {
  // Classification fetch before ref-parser: a fetch failure in the browser
  // (opaque TypeError) means either network down OR CORS blocking, whereas a
  // received response lets HTTP errors be distinguished cleanly. The body is
  // read here too — it is the document, and reading it once spares ref-parser
  // a second 12 MB round through the HTTP cache. `options.response` is that
  // same request already in flight (the shell's boot prefetch): same
  // classification, one transfer instead of two.
  let text = null
  if (!FILE_URL.test(String(url))) {
    let response
    try {
      response = await (options.response ?? fetch(url))
    } catch (err) {
      throw new SchemaLoadError('network', { cause: err })
    }
    if (!response.ok) throw new SchemaLoadError('http', { status: response.status })
    try {
      // `options.body` is the prefetch's already-started read of that same
      // response — awaiting the one in flight instead of calling text() here
      // keeps the string assembly overlapped with boot.
      text = (await options.body) ?? (await response.text())
    } catch (err) {
      throw new SchemaLoadError('network', { cause: err })
    }
  }

  stubBuffer()

  const resolve = { http: fetchHttpResolver }
  let sourceOf
  let dereferenced
  let baseUri = null
  let overlays = null
  try {
    // JSON documents skip ref-parser for the root read: `JSON.parse` on the
    // text in hand is what ref-parser would do after re-reading the URL, and
    // succeeding here is also what proves the lazy `source` below can rebuild
    // from the same text. YAML (or `file:`, where ref-parser reads the disk)
    // takes the ref-parser path unchanged. Either way only the root document
    // is read at this point, so `$ref`s stay intact for the audit's shape.
    let root = null
    if (text !== null) {
      try {
        root = JSON.parse(text)
      } catch {
        root = null
      }
    }
    const isJson = root !== null && typeof root === 'object'
    if (!isJson) root = await $RefParser.parse(url, { resolve })
    const parsed = await overlaid(root, options, resolve)
    overlays = parsed.diagnostics
    const source = upconverted(parsed.document)
    // `$self` moves the base: external `$ref`s resolve against what the
    // document says it is, not against where this copy happens to sit.
    baseUri = documentBase(source, url)
    if (isJson) {
      // Dereference IN PLACE and rebuild `source` on demand from the kept
      // text: cloning 12 MB up front taxed every boot for the benefit of the
      // audit and the dry run, the two things a session may never open.
      // Memoized — both consumers must see the same object, and the rebuild
      // replays this boot's own overlay documents (`parsed.documents`).
      const rebuild = () =>
        upconverted(
          parsed.documents.length
            ? applyOverlays(JSON.parse(text), parsed.documents).document
            : JSON.parse(text),
        )
      let memo = null
      sourceOf = () => {
        memo ??= rebuild()
        return memo
      }
      await nextTask()
      try {
        dereferenced = dereferenceInternal(source)
      } catch {
        // Beyond the fast pass (external `$ref`, pointer through a ref, …):
        // the canonical crawler takes over, on a fresh document — `source`
        // may hold half-done substitutions from the aborted pass.
        dereferenced = await $RefParser.dereference(baseUri ?? url, rebuild(), { resolve })
      }
    } else {
      // No text to rebuild from (or not rebuildable synchronously): the parsed
      // document stays the source, and the clone pays for the audit up front,
      // as it always has.
      sourceOf = () => source
      await nextTask()
      const clone = structuredClone(source)
      try {
        dereferenced = dereferenceInternal(clone)
      } catch {
        dereferenced = await $RefParser.dereference(baseUri ?? url, structuredClone(source), {
          resolve,
        })
      }
    }
  } catch (err) {
    throw new SchemaLoadError('malformed', { cause: err })
  }
  // Stage boundaries around normalization (`loaded` runs it): dereference,
  // normalize and the caller's first render each get their own task.
  await nextTask()
  const result = loaded(sourceOf, dereferenced, { ...options, baseUri }, overlays)
  await nextTask()
  return result
}

// Schema provided inline by the host page (JS object or JSON string): same
// pipeline as loadApiModel minus the network step. Internal $refs are resolved
// as usual; relative external $refs resolve against the host
// page, for lack of a document URL.
export async function loadInlineApiModel(source, options = {}) {
  let doc
  if (typeof source === 'string') {
    try {
      doc = JSON.parse(source)
    } catch {
      // Not JSON: YAML, which a host page has every reason to paste as-is
      // rather than convert. ref-parser already carries a YAML parser (and
      // JSON is a subset of YAML) — reaching it means handing it a URL it can
      // read, so the text is served through a one-shot resolver on a synthetic
      // scheme. No new dependency: platform-first (architecture.md §14.2).
      doc = await parseInlineYaml(source)
    }
  } else if (source && typeof source === 'object') {
    // ref-parser mutates the document it's given: the host page's
    // config must not end up dereferenced (and cyclic) under the
    // integrator's feet.
    doc = structuredClone(source)
  } else {
    throw new SchemaLoadError('invalid-schema')
  }
  stubBuffer()
  const resolve = { http: fetchHttpResolver }
  const overlaidDoc = await overlaid(doc, options, resolve)
  doc = upconverted(overlaidDoc.document)
  let dereferenced
  const baseUri = documentBase(doc, globalThis.location?.href ?? null)
  try {
    // `doc` is already our own copy: it stays the `$ref`-bearing source and the
    // dereferencing works on a second clone.
    const clone = structuredClone(doc)
    await nextTask()
    try {
      dereferenced = dereferenceInternal(clone)
    } catch {
      const fresh = structuredClone(doc)
      dereferenced = baseUri
        ? await $RefParser.dereference(baseUri, fresh, { resolve })
        : await $RefParser.dereference(fresh, { resolve })
    }
  } catch (err) {
    throw new SchemaLoadError('malformed', { cause: err })
  }
  await nextTask()
  const result = loaded(() => doc, dereferenced, { ...options, baseUri }, overlaidDoc.diagnostics)
  await nextTask()
  return result
}

// Any document the app is handed as text, JSON or YAML. Exported for the
// scenario import: Arazzo workflows are written in YAML at least as often as
// in JSON, and this is the one YAML parser the bundle carries
// (platform-first dependency rule, architecture.md §14.2).
export async function parseDocumentText(text) {
  try {
    return JSON.parse(text)
  } catch {
    return parseInlineYaml(text)
  }
}

// Synthetic URL: only its extension matters, and it is what makes ref-parser
// pick its YAML parser instead of guessing from bytes.
const INLINE_YAML_URL = 'inline:/spec.yaml'

async function parseInlineYaml(text) {
  stubBuffer()
  try {
    return await $RefParser.parse(INLINE_YAML_URL, {
      resolve: {
        inline: { order: 1, canRead: /^inline:/, read: () => text },
        // The document is a string in memory: nothing else is reachable from
        // it, and a `$ref` to a file path would be a surprise, not a feature.
        file: false,
      },
    })
  } catch (err) {
    throw new SchemaLoadError('malformed', { cause: err })
  }
}

// The version lines this app claims to support (rule 19). Exported because the
// About dialog advertises them: one list, so the promise made to the reader and
// the check that rejects a document cannot say different things.
export const SUPPORTED_OPENAPI_VERSIONS = ['3.0', '3.1', '3.2']
// Read too, through conversion rather than through normalization: the app never
// renders a 2.0 document, it renders the 3.0 one `swagger2.js` makes of it. Same
// reason for exporting it — the About dialog says it, and so does the error.
export const SUPPORTED_SWAGGER_VERSIONS = ['2.0']
const SUPPORTED_OPENAPI_RE = new RegExp(
  `^(${SUPPORTED_OPENAPI_VERSIONS.map((v) => v.replace('.', '\\.')).join('|')})(\\.|$)`,
)

// Validation + normalization of an already dereferenced document. Separate from
// loadApiModel so it's testable without network access (fixtures).
export function buildModel(doc, options = {}) {
  // A raw 2.0 document reaches this path from a fixture or a host page that
  // hands over an already-dereferenced object: converting here too keeps the
  // entry points equivalent. On a document the loader already converted, and on
  // a dereferenced one, the `$ref` rewrite has nothing to rewrite — the rest of
  // the conversion is what matters either way.
  const converted = upconverted(doc)
  const version = typeof converted?.openapi === 'string' ? converted.openapi : null
  if (!version) {
    // A Swagger version we have no conversion table for is "valid but
    // unsupported", to be distinguished from arbitrary JSON that isn't an
    // OpenAPI schema at all.
    if (typeof doc?.swagger === 'string')
      throw new SchemaLoadError('unsupported-version', { found: doc.swagger })
    throw new SchemaLoadError('invalid-schema')
  }
  if (!SUPPORTED_OPENAPI_RE.test(version))
    throw new SchemaLoadError('unsupported-version', { found: version })
  try {
    return normalizeDocument(converted, options)
  } catch (err) {
    throw new SchemaLoadError('invalid-schema', { cause: err })
  }
}
