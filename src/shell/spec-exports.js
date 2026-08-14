// Everything this spec publishes about itself: the two LLM-facing exports, the
// MCP context and the schema download. Grouped because they answer the same
// question from the same values — which document, at which address, under how
// many overlays — and a divergence between them would have a hand-off name a
// different API than the download offers.
//
// Separate from `exports.js`, which stays free of any DOM import so it can be
// tested in the node environment: the download descriptors come from `views.js`,
// and that module reaches the custom elements.
import { llmsFullExporter, llmsTextExporter } from './exports.js'
import { specDownloadNotes, specSourceDownload } from './views.js'

export function createSpecExports({
  model,
  pages,
  outline,
  scenarios,
  ops,
  fetchText,
  envStore,
  fallbackBaseUrl,
  activeSpec,
  schemaUrl,
  pageUrl,
  overlays,
  specOverlays = [],
}) {
  const exportBaseUrl = () => envStore.selected()?.baseUrl || fallbackBaseUrl

  // A schema given inline has no URL to hand out: neither the llms.txt
  // "Reference" section nor an MCP bridge can point at a document that only
  // exists inside this page. Nor can a generated Arazzo recipe, whose
  // `sourceDescriptions` no runner would be able to fetch
  // (docs/scenario-handoff.md §2).
  const publicSpecUrl = activeSpec.url ? schemaUrl : ''

  const llmsFullExport = llmsFullExporter({
    model,
    pages,
    scenarios,
    ops,
    fetchText,
    baseUrl: exportBaseUrl,
    specUrl: publicSpecUrl,
  })

  // How many overlays stand between the URL above and what this app renders —
  // 0 when they changed nothing, since a document nothing edited is the file.
  // The same gate `specOverlayNote` applies, for the same reason: every hand-off
  // pointing at the published URL owes the reader that number.
  const overlayCount = overlays?.actions ? overlays.count : 0

  const llmsTextExport = llmsTextExporter({
    model,
    outline,
    docsUrl: pageUrl,
    specUrl: publicSpecUrl,
    baseUrl: exportBaseUrl,
    overlays: overlayCount,
    scenarios,
    ops,
    fetchText,
  })

  // MCP config: only overlays declared by URL can travel to a bridge — an
  // inline overlay object lives in the host page and there is nothing to name.
  // `openapi.userOverlay` stays out even when it is a URL: what it produces is
  // a document in ONE browser's slot, which that reader may have edited or
  // removed, so a bridge naming it would claim a view nobody is guaranteed to
  // have (docs/user-overlay.md decision 11).
  const overlayUrls = specOverlays
    .filter((entry) => typeof entry === 'string')
    .map((url) => new URL(url, window.location.href).href)

  // The other side of that rule: what a bridge cannot be pointed at, it will
  // not see — and until it is said out loud, a config generated from a patched
  // documentation quietly registers a different API. Counted rather than
  // inferred from `overlayUrls.length`, which says nothing about the user's own
  // patch or about an overlay that matched nothing.
  const localOverlays = overlayCount > overlayUrls.length

  // The one MCP context, for the home card and for both hand-off menus — an
  // endpoint's and a prose page's. A provider rather than a value: the base URL
  // follows the selected environment, and a prose page, unlike the endpoint
  // doc, does not re-render when that changes. The "no URL, no config" rule
  // stays with its consumers, which each already apply it.
  const mcpContext = () => ({
    title: model.info.title,
    specUrl: publicSpecUrl,
    baseUrl: exportBaseUrl(),
    securitySchemes: model.securitySchemes,
    overlayUrls,
    localOverlays,
    hiddenOperations: model.hiddenOperations ?? 0,
  })

  const specDownload = {
    ...specSourceDownload(activeSpec, schemaUrl),
    notes: specDownloadNotes(model, overlays),
  }

  return { llmsFullExport, llmsTextExport, mcpContext, specDownload }
}
