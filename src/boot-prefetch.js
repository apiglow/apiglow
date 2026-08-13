// Fires the schema fetch before the rest of the bundle evaluates.
//
// This module has ZERO imports on purpose: Rollup evaluates modules
// dependency-first, so being app.js's first dependency-free import puts this
// code ahead of every library's module-scope initialization. The schema
// transfer — hundreds of milliseconds of mostly idle CPU on a heavy document —
// then overlaps bundle evaluation and the boot preamble instead of starting
// after them (rule 14).
//
// Shell-side by design (rule 10): this reads the host config, so it lives
// with app.js, and the loader only ever receives the resulting Response
// promise as an option — never the config. Deliberately conservative: it
// covers the single-spec `openapi.url` form and bows out on anything else
// (multi-spec, inline documents); `app.js` only uses the prefetch when the
// URL it resolved matches this one, so a miss costs one duplicate request at
// worst — absorbed by the HTTP cache — and never a wrong document.
function startPrefetch() {
  try {
    const raw = document.getElementById('api-doc-config')?.textContent
    if (!raw) return null
    const config = JSON.parse(raw)
    if (config?.specs !== undefined) return null
    const url = config?.openapi?.url
    if (typeof url !== 'string' || !url.trim()) return null
    const response = fetch(url)
    // Body read started here too: assembling a 12 MB string streams off the
    // network stack while the main thread is busy evaluating the bundle —
    // awaited later, it holds the boot idle for the same duration instead.
    // Only an ok response is drained: the loader classifies the others.
    const body = response.then((r) => (r.ok ? r.text() : null)).catch(() => null)
    return { url, response, body }
  } catch {
    return null
  }
}

export const prefetchedSchema = startPrefetch()
