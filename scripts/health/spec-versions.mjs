// Registry-vs-code arm of `/spec-sync`'s drift check (step 4): every version
// constant the code carries must match the `Implemented` column of
// docs/registry/specs-registry.md. The online half of the check — what is *published* —
// is not scriptable and stays a fetch during the run.
//
// Owned by `/spec-sync`, not by `/code-health` — deliberately absent from the
// `npm run health` aggregate for the same reason `health:skills` is: that
// aggregate is code-health's contract.
import { headline, read, section } from './lib.mjs'

// One entry per registry row whose implemented version exists as a constant
// in src/. Formats with no versioned constant (cURL, llms.txt, MCP envelope,
// JSON Schema dialect inside the model) have nothing mechanical to compare.
const CHECKS = [
  {
    format: 'OpenAPI',
    file: 'src/openapi/loader.js',
    versions: (t) =>
      JSON.parse(t.match(/SUPPORTED_OPENAPI_VERSIONS = (\[.*?\])/)[1].replaceAll("'", '"')),
  },
  {
    format: 'Swagger (OpenAPI 2.0)',
    file: 'src/openapi/loader.js',
    versions: (t) =>
      JSON.parse(t.match(/SUPPORTED_SWAGGER_VERSIONS = (\[.*?\])/)[1].replaceAll("'", '"')),
  },
  {
    format: 'OpenAPI Overlay',
    file: 'src/openapi/overlay.js',
    versions: (t) => [t.match(/OVERLAY_VERSION = '([^']+)'/)[1]],
  },
  {
    format: 'Arazzo',
    file: 'src/export/arazzo.js',
    versions: (t) => [t.match(/ARAZZO_VERSION = '([^']+)'/)[1]],
  },
  {
    format: 'HAR',
    file: 'src/export/har.js',
    versions: (t) => [t.match(/version: '([^']+)'/)[1]],
  },
  {
    format: 'Postman Collection',
    file: 'src/export/postman.js',
    versions: (t) => [t.match(/collection\/(v[\d.]+)\/collection\.json/)[1]],
  },
]

const registry = read('docs/registry/specs-registry.md')
const mismatches = []
for (const { format, file, versions } of CHECKS) {
  const row = registry.split('\n').find((l) => l.startsWith(`| ${format} `))
  if (!row) {
    mismatches.push(`${format} — no registry row`)
    continue
  }
  const implemented = row.split('|')[3].trim()
  for (const v of versions(read(file))) {
    if (!implemented.includes(v)) {
      mismatches.push(`${format} — code says ${v} (${file}), registry says "${implemented}"`)
    }
  }
}
headline(
  'spec version strings matching the registry',
  `${CHECKS.length - new Set(mismatches.map((m) => m.split(' — ')[0])).size}/${CHECKS.length}`,
  'formats',
)
section('mismatched', mismatches)
