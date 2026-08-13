// MCP server config: the JSON block a reader pastes into their agent's client
// config so it can call this API. What it wires up is an off-the-shelf
// OpenAPI→MCP bridge pointed at this document's URL — an **export artifact**,
// not a runtime feature: the app stays a static bundle and never runs a server.
//
// Two consequences worth stating, because they shape everything below:
//
// - The `mcpServers` envelope is the de-facto client config shape (Claude
//   Desktop's, adopted by the others), not something the MCP specification
//   defines. It is stable in practice; it is still someone else's contract.
// - So are the bridges' own flags and environment variables. They are gathered
//   in `MCP_BRIDGES` — one table, verified against each project's README on
//   2026-08-06, and the single place to fix when one of them moves
//   (`docs/registry/specs-registry.md` carries the watch).
//
// The same registration ships in three shapes — the JSON block, the
// `claude mcp add` command, the editor install links — all built from one
// `toMcpConfig` call, so the reader who copies the command installs what the
// block in front of them says.
//
// Credentials are emitted as placeholders, never as values: the environments
// hold real secrets and an export that leaks them into a file the reader hands
// around would be a defect, not a convenience (rule 12).

import { slugify } from '../openapi/model.js'

export const MCP_BRIDGES = [
  {
    id: 'openapi-mcp-server',
    package: '@ivotoby/openapi-mcp-server',
    docs: 'https://github.com/ivo-toby/mcp-openapi-server',
    supportsOverlays: false,
    build: ({ specUrl, baseUrl, headers }) => ({
      command: 'npx',
      args: ['-y', '@ivotoby/openapi-mcp-server'],
      env: prune({
        OPENAPI_SPEC_PATH: specUrl,
        API_BASE_URL: baseUrl,
        API_HEADERS: headers.map((h) => `${h.name}:${h.value}`).join(',') || undefined,
      }),
    }),
  },
  {
    id: 'api-to-mcp',
    package: '@tyk-technologies/api-to-mcp',
    docs: 'https://github.com/TykTechnologies/api-to-mcp',
    supportsOverlays: true,
    build: ({ specUrl, baseUrl, headers, overlayUrls }) => ({
      command: 'npx',
      args: [
        '-y',
        '@tyk-technologies/api-to-mcp@latest',
        '--spec',
        specUrl,
        ...(baseUrl ? ['--targetUrl', baseUrl] : []),
        ...(overlayUrls.length ? ['--overlays', overlayUrls.join(',')] : []),
        ...(headers.length
          ? ['--headers', JSON.stringify(Object.fromEntries(headers.map((h) => [h.name, h.value])))]
          : []),
      ],
    }),
  },
]

const DEFAULT_BRIDGE_ID = MCP_BRIDGES[0].id

function prune(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))
}

// A scheme's credential as an HTTP header, or null when it has no header form.
// A bridge talks to the API over plain HTTP requests, so a scheme whose
// credential does not travel in a header (`apiKey` in a query or a cookie,
// `mutualTLS`) has nothing to put here — the caller reports it rather than
// emitting a header the API will ignore.
function headerFor(scheme) {
  if (scheme.type === 'http') {
    if (scheme.scheme === 'basic')
      return { name: 'Authorization', value: 'Basic BASE64_CREDENTIALS' }
    if (scheme.scheme === 'bearer') return { name: 'Authorization', value: 'Bearer YOUR_TOKEN' }
    if (!scheme.scheme) return null
    const label = scheme.scheme.charAt(0).toUpperCase() + scheme.scheme.slice(1)
    return { name: 'Authorization', value: `${label} YOUR_CREDENTIALS` }
  }
  if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.paramName) {
    return { name: scheme.paramName, value: 'YOUR_API_KEY' }
  }
  // OAuth2 / OIDC: the bridge cannot run the flow, but the access token it
  // ends up holding travels as a bearer like any other.
  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
    return { name: 'Authorization', value: 'Bearer YOUR_ACCESS_TOKEN' }
  }
  return null
}

function authHeaders(schemes) {
  const headers = []
  const unsupported = []
  for (const scheme of schemes) {
    // A deprecated scheme is not what a new integration should be wired to.
    if (scheme.deprecated) continue
    const header = headerFor(scheme)
    if (!header) {
      unsupported.push(scheme.name)
      continue
    }
    // Two schemes both landing on `Authorization` cannot coexist in one config;
    // the first declared wins, and the reader edits the file if it is the wrong
    // one. Silently emitting both would produce a config that fails at runtime.
    if (headers.some((h) => h.name.toLowerCase() === header.name.toLowerCase())) continue
    headers.push(header)
  }
  return { headers, unsupported }
}

// → { config, warnings, headers } — `config` null when there is nothing to
// point a bridge at. Warnings are codes, translated by the caller (same
// contract as the importers in `src/import/`).
export function toMcpConfig({
  title = '',
  specUrl = '',
  baseUrl = '',
  securitySchemes = [],
  overlayUrls = [],
  localOverlays = false,
  hiddenOperations = 0,
  bridgeId = DEFAULT_BRIDGE_ID,
} = {}) {
  const bridge = MCP_BRIDGES.find((b) => b.id === bridgeId) ?? MCP_BRIDGES[0]
  const warnings = []
  // An inline schema, or one behind a URL the reader's machine cannot reach,
  // leaves the bridge with nothing to fetch. Nothing is generated rather than
  // a config that fails on first run.
  if (!specUrl) return { config: null, warnings: ['noSpecUrl'], headers: [] }
  if (!baseUrl) warnings.push('noBaseUrl')

  const { headers, unsupported } = authHeaders(securitySchemes)
  if (headers.length) warnings.push('authPlaceholder')
  if (unsupported.length) warnings.push('authUnsupported')
  if (overlayUrls.length && !bridge.supportsOverlays) warnings.push('overlaysIgnored')
  // An overlay with no URL cannot be handed over whatever the bridge supports:
  // it is inline in the host page, or it is the reader's own patch. Said on
  // every bridge, including the ones that read overlays — those are exactly the
  // ones whose config looks complete while missing one.
  if (localOverlays) warnings.push('overlaysLocal')
  // Hiding lives in this page, never in the document: a bridge fetching the URL
  // gets the operations the host curated out, and turns each into a tool. The
  // only surface where that becomes an action rather than a stale link.
  if (hiddenOperations) warnings.push('hidden')

  const entry = bridge.build({
    specUrl,
    baseUrl: baseUrl ? String(baseUrl).replace(/\/+$/, '') : '',
    headers,
    overlayUrls: bridge.supportsOverlays ? overlayUrls : [],
  })
  return {
    config: { mcpServers: { [slugify(title) || 'api']: entry } },
    warnings,
    headers,
  }
}

export function toMcpConfigJson(options) {
  const { config, warnings, headers } = toMcpConfig(options)
  return { json: config ? `${JSON.stringify(config, null, 2)}\n` : '', warnings, headers }
}

// The server entry alone, without the `mcpServers` envelope, plus the name it
// is filed under: what the command and the deep links below each need, and the
// one place that knows the config has exactly one entry.
function serverEntry(options) {
  const { config, warnings, headers } = toMcpConfig(options)
  if (!config) return { name: '', entry: null, warnings, headers }
  const [name, entry] = Object.entries(config.mcpServers)[0]
  return { name, entry, warnings, headers }
}

// POSIX shell quoting: bare when the word is made of characters no shell reads,
// single-quoted otherwise — the `--headers {"X-API-Key":"…"}` argument is JSON,
// and pasted unquoted the braces and quotes are the shell's, not the bridge's.
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/

function shellQuote(word) {
  const value = String(word)
  if (SHELL_SAFE.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// The same registration as the JSON block, as the one line a reader pastes into
// a terminal — `claude mcp add`, the CLI form of the `mcpServers` envelope the
// config uses. It is one client's command, not a standard: it lives here next
// to `MCP_BRIDGES` for the same reason and moves with it.
//
// → { command, warnings } — `command` empty when there is nothing to point a
// bridge at, exactly like the config.
export function toMcpCommand(options) {
  const { name, entry, warnings } = serverEntry(options)
  if (!entry) return { command: '', warnings }
  const env = Object.entries(entry.env ?? {}).flatMap(([key, value]) => [
    '--env',
    shellQuote(`${key}=${value}`),
  ])
  // `--` before the bridge's own command: everything after it belongs to the
  // server being registered, and a bridge flag that happens to collide with a
  // `claude mcp add` one would otherwise be eaten by the CLI.
  const parts = [
    'claude',
    'mcp',
    'add',
    shellQuote(name),
    ...env,
    '--',
    shellQuote(entry.command),
    ...(entry.args ?? []).map(shellQuote),
  ]
  return { command: parts.join(' '), warnings }
}

// Base64 of UTF-8, which `btoa` alone is not: an API title outside latin-1
// throws there, and the name travels inside the encoded config.
function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// One-click install links for the two editors that register an MCP server from
// a URL scheme. Same caveat as the envelope: these are each editor's contract,
// not the MCP specification's — they are built from the very entry the JSON
// block shows, so a reader who follows a link installs what they read.
//
// → { cursor, vscode, warnings } — both null when there is no config.
export function toMcpDeepLinks(options) {
  const { name, entry, warnings } = serverEntry(options)
  if (!entry) return { cursor: null, vscode: null, warnings }
  const cursor = `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(
    name,
  )}&config=${encodeURIComponent(base64Utf8(JSON.stringify(entry)))}`
  // VS Code takes the server object with its name inside, as a plain
  // (URL-encoded) JSON query — no base64.
  const vscode = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, ...entry }))}`
  return { cursor, vscode, warnings }
}
