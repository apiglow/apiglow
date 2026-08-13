import { describe, expect, it } from 'vitest'
import {
  MCP_BRIDGES,
  toMcpCommand,
  toMcpConfig,
  toMcpConfigJson,
  toMcpDeepLinks,
} from '../src/export/mcp.js'

const base = {
  title: 'Pet Store',
  specUrl: 'https://api.example.com/openapi.json',
  baseUrl: 'https://api.example.com/v1/',
}

const bearer = { name: 'bearerAuth', type: 'http', scheme: 'bearer' }
const apiKeyHeader = { name: 'apiKeyAuth', type: 'apiKey', in: 'header', paramName: 'X-API-Key' }

describe('MCP server config export', () => {
  it('wires each bridge to the schema URL', () => {
    for (const bridge of MCP_BRIDGES) {
      expect(
        toMcpConfig({ ...base, securitySchemes: [bearer], bridgeId: bridge.id }).config,
      ).toMatchSnapshot(bridge.id)
    }
  })

  it('names the server after the API title', () => {
    expect(Object.keys(toMcpConfig(base).config.mcpServers)).toEqual(['pet-store'])
    expect(Object.keys(toMcpConfig({ ...base, title: '' }).config.mcpServers)).toEqual(['api'])
  })

  it('generates nothing without a schema URL', () => {
    const result = toMcpConfig({ ...base, specUrl: '' })
    expect(result.config).toBeNull()
    expect(result.warnings).toEqual(['noSpecUrl'])
  })

  it('turns security schemes into placeholder headers', () => {
    const { headers, warnings } = toMcpConfig({
      ...base,
      securitySchemes: [apiKeyHeader, { name: 'basicAuth', type: 'http', scheme: 'basic' }],
    })
    expect(headers).toEqual([
      { name: 'X-API-Key', value: 'YOUR_API_KEY' },
      { name: 'Authorization', value: 'Basic BASE64_CREDENTIALS' },
    ])
    expect(warnings).toContain('authPlaceholder')
  })

  it('keeps the first scheme when two would claim the same header', () => {
    const { headers } = toMcpConfig({
      ...base,
      securitySchemes: [bearer, { name: 'oauth', type: 'oauth2' }],
    })
    expect(headers).toEqual([{ name: 'Authorization', value: 'Bearer YOUR_TOKEN' }])
  })

  it('reports a scheme that cannot travel as a header, and skips a deprecated one', () => {
    const { headers, warnings } = toMcpConfig({
      ...base,
      securitySchemes: [
        { name: 'cookieKey', type: 'apiKey', in: 'cookie', paramName: 'session' },
        { name: 'mtls', type: 'mutualTLS' },
        { ...bearer, deprecated: true },
      ],
    })
    expect(headers).toEqual([])
    expect(warnings).toContain('authUnsupported')
    expect(warnings).not.toContain('authPlaceholder')
  })

  it('passes overlays to the bridge that reads them, warns for the one that does not', () => {
    const overlayUrls = ['https://docs.example.com/overlay.yaml']
    const reading = MCP_BRIDGES.find((b) => b.supportsOverlays)
    const blind = MCP_BRIDGES.find((b) => !b.supportsOverlays)
    const applied = toMcpConfig({ ...base, overlayUrls, bridgeId: reading.id })
    expect(JSON.stringify(applied.config)).toContain(overlayUrls[0])
    expect(applied.warnings).not.toContain('overlaysIgnored')
    const ignored = toMcpConfig({ ...base, overlayUrls, bridgeId: blind.id })
    expect(JSON.stringify(ignored.config)).not.toContain(overlayUrls[0])
    expect(ignored.warnings).toContain('overlaysIgnored')
  })

  // An overlay with no URL — inline in the host page, or the reader's own patch
  // — cannot travel whatever the bridge supports. The bridge that reads
  // overlays is the one whose config looks complete while missing it, so it
  // gets the warning too.
  it('warns about overlays no bridge can be pointed at, on every bridge', () => {
    for (const bridge of MCP_BRIDGES) {
      const { warnings } = toMcpConfig({ ...base, localOverlays: true, bridgeId: bridge.id })
      expect(warnings).toContain('overlaysLocal')
    }
    expect(toMcpConfig(base).warnings).not.toContain('overlaysLocal')
  })

  // Hiding lives in the host page, never in the document: the bridge fetches
  // the URL and turns the curated-out operations into tools.
  it('warns that a bridge will expose the operations this documentation hides', () => {
    expect(toMcpConfig({ ...base, hiddenOperations: 2 }).warnings).toContain('hidden')
    expect(toMcpConfig(base).warnings).not.toContain('hidden')
  })

  it('flags a missing base URL rather than emitting an empty one', () => {
    const { config, warnings } = toMcpConfig({ ...base, baseUrl: '' })
    expect(warnings).toContain('noBaseUrl')
    expect(JSON.stringify(config)).not.toContain('""')
  })

  it('falls back to the default bridge on an unknown id', () => {
    expect(toMcpConfig({ ...base, bridgeId: 'nope' }).config).toEqual(
      toMcpConfig({ ...base, bridgeId: MCP_BRIDGES[0].id }).config,
    )
  })

  it('serializes to indented JSON, empty when there is nothing to generate', () => {
    expect(toMcpConfigJson(base).json).toMatch(/^\{\n {2}"mcpServers"/)
    expect(toMcpConfigJson({ ...base, specUrl: '' }).json).toBe('')
  })
})

describe('MCP registration hand-off', () => {
  it('writes the CLI form of every bridge config', () => {
    for (const bridge of MCP_BRIDGES) {
      expect(
        toMcpCommand({ ...base, securitySchemes: [apiKeyHeader], bridgeId: bridge.id }).command,
      ).toMatchSnapshot(bridge.id)
    }
  })

  it('quotes what a shell would otherwise read as its own', () => {
    // The Tyk bridge passes headers as a JSON argument: unquoted, the braces
    // and the quotes belong to the shell and the bridge sees a mangled value.
    const tyk = MCP_BRIDGES.find((b) => b.supportsOverlays)
    const { command } = toMcpCommand({
      ...base,
      securitySchemes: [apiKeyHeader],
      bridgeId: tyk.id,
    })
    expect(command).toContain(`--headers '{"X-API-Key":"YOUR_API_KEY"}'`)
    // A URL, a package name and a KEY=VALUE pair need none of it.
    expect(command).toContain('--spec https://api.example.com/openapi.json')
  })

  it('names the server, and generates nothing without a schema URL', () => {
    expect(toMcpCommand(base).command).toMatch(/^claude mcp add pet-store /)
    const { command, warnings } = toMcpCommand({ ...base, specUrl: '' })
    expect(command).toBe('')
    expect(warnings).toEqual(['noSpecUrl'])
  })

  it('builds install links carrying the very entry the config shows', () => {
    const { cursor, vscode } = toMcpDeepLinks({ ...base, securitySchemes: [bearer] })
    const entry = toMcpConfig({ ...base, securitySchemes: [bearer] }).config.mcpServers['pet-store']
    const config = new URL(cursor).searchParams.get('config')
    expect(JSON.parse(atob(config))).toEqual(entry)
    expect(JSON.parse(decodeURIComponent(vscode.split('?')[1]))).toEqual({
      name: 'pet-store',
      ...entry,
    })
  })

  it('encodes a URL the latin-1 base64 would choke on', () => {
    const specUrl = 'https://api.example.com/schéma.json'
    const { cursor } = toMcpDeepLinks({ ...base, specUrl })
    const bytes = Uint8Array.from(atob(new URL(cursor).searchParams.get('config')), (c) =>
      c.charCodeAt(0),
    )
    const entry = JSON.parse(new TextDecoder().decode(bytes))
    expect(entry.env.OPENAPI_SPEC_PATH).toBe(specUrl)
  })

  it('has no links to offer without a schema URL', () => {
    expect(toMcpDeepLinks({ ...base, specUrl: '' })).toEqual({
      cursor: null,
      vscode: null,
      warnings: ['noSpecUrl'],
    })
  })
})
