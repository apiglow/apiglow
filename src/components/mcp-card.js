import { MCP_BRIDGES, toMcpCommand, toMcpConfigJson, toMcpDeepLinks } from '../export/mcp.js'
import { t } from '../i18n/index.js'
import { copyTextButton } from './copy-button.js'
import { el, externalLink, selectField, text } from './dom.js'
import { highlightSource } from './markdown.js'
import {
  setWarnings,
  takeAwayDownload,
  takeAwayPanel,
  takeAwaySource,
  warningList,
} from './take-away-panel.js'

// "Use this API from an agent": the MCP config block, on the home page next to
// the other take-away files. The shell — collapsed, the JSON shown rather than
// only downloaded, the warnings above it so a placeholder credential is visibly
// a placeholder — is shared and lives in `take-away-panel.js`; the home page
// has to stay one screen.
//
// The command and the install links below the block are the same registration
// in the shapes other tools take it in, and they sit *under* the JSON:
// whichever one is clicked, what it installs has already been read.

const WARNING_KEYS = {
  noBaseUrl: 'mcp.warn.noBaseUrl',
  authPlaceholder: 'mcp.warn.authPlaceholder',
  authUnsupported: 'mcp.warn.authUnsupported',
  overlaysIgnored: 'mcp.warn.overlaysIgnored',
  overlaysLocal: 'mcp.warn.overlaysLocal',
  hidden: 'mcp.warn.hidden',
}

// `specUrl` empty (inline schema) → no card at all: a bridge fetches the
// document by URL, and there is none to give it.
//
// `state` / `onState`: the welcome view is rebuilt whole whenever a history
// read or a purge lands while it is on screen, and this card with it. The open
// state and the selected bridge live in the shell so neither is taken back from
// the reader by a write they did not make (`take-away-panel.js`).
export function mcpCard({
  title,
  specUrl,
  baseUrl,
  securitySchemes = [],
  overlayUrls = [],
  localOverlays = false,
  hiddenOperations = 0,
  state = {},
  onState = () => {},
}) {
  if (!specUrl) return null

  const bridgeField = selectField({
    id: 'mcp-bridge-select',
    label: t('mcp.bridge'),
    options: MCP_BRIDGES.map((bridge) => ({ value: bridge.id, label: bridge.package })),
    value: state.bridgeId ?? MCP_BRIDGES[0].id,
    onChange: (value) => {
      onState({ bridgeId: value })
      refresh()
    },
  })

  const docsLink = externalLink('link link-hover text-xs text-subtle', MCP_BRIDGES[0].docs)
  const warnings = warningList()
  let json = ''
  const block = takeAwaySource(() => json, t('mcp.copy'), 'block')
  const download = takeAwayDownload(t('mcp.download'), () => ({
    filename: 'mcp.json',
    content: json,
  }))

  // The same registration, for the readers who never open a config file: one
  // line for a terminal, one click for an editor that installs from a URL
  // scheme. All three shapes come from the same bridge selection above — what
  // the block shows is what they install.
  let command = ''
  const copyCommand = copyTextButton({
    classes: 'btn btn-sm',
    label: t('mcp.copyCommand'),
    getText: () => command,
  })
  const cursorLink = el('a', 'btn btn-sm', text(t('mcp.addToCursor')))
  const vscodeLink = el('a', 'btn btn-sm', text(t('mcp.addToVsCode')))

  const refresh = () => {
    const bridge = MCP_BRIDGES.find((b) => b.id === bridgeField.select.value) ?? MCP_BRIDGES[0]
    const options = {
      title,
      specUrl,
      baseUrl,
      securitySchemes,
      overlayUrls,
      localOverlays,
      hiddenOperations,
      bridgeId: bridge.id,
    }
    const result = toMcpConfigJson(options)
    json = result.json
    command = toMcpCommand(options).command
    const links = toMcpDeepLinks(options)
    cursorLink.href = links.cursor
    vscodeLink.href = links.vscode
    // The JSON is generated from the model (API title, header names): hljs
    // escapes, DOMPurify runs behind it in highlightSource (rule 5).
    block.code.innerHTML = highlightSource(json, 'json')
    docsLink.href = bridge.docs
    docsLink.replaceChildren(text(t('mcp.docs', { bridge: bridge.package })))
    setWarnings(
      warnings,
      result.warnings.map((warning) => t(WARNING_KEYS[warning])),
    )
  }
  refresh()

  return takeAwayPanel(
    { title: t('mcp.title'), intro: t('mcp.intro'), state, onState },
    el('div', 'flex flex-col gap-1', bridgeField.node, docsLink),
    warnings,
    block.node,
    el('div', 'flex flex-wrap items-center gap-2', download, copyCommand, cursorLink, vscodeLink),
    el('p', 'text-xs text-subtle', text(t('mcp.note'))),
  )
}
