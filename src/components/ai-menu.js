import { toMcpCommand, toMcpDeepLinks } from '../export/mcp.js'
import { t } from '../i18n/index.js'
import { writeClipboard, writeClipboardLater } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadText } from './download.js'
import { detailsDropdown } from './dropdown.js'
import { CHEVRON_SVG_SM, COPY_SVG, DOWNLOAD_SVG, SPARKLES_SVG, TERMINAL_SVG } from './icons.js'
import { confirmCopy, menuItem, menuLinkItem, menuTitle } from './menu-items.js'

// An item whose text has to be generated first — llms-full.txt fetches the
// docs pages — so the row says it is working, and a page that cannot be
// reached ends the wait instead of leaving the row disabled. `run` resolves to
// true when it put something on the clipboard, which is what earns the
// "Copied" face; a download has its own feedback in the browser.
function pendingItem(labelKey, svg, run, close) {
  return menuItem(labelKey, svg, async ({ btn, label }) => {
    btn.disabled = true
    label.replaceChildren(text(t('app.loading')))
    let copied = false
    try {
      copied = await run()
    } catch (err) {
      console.error('[api-doc]', err)
    }
    btn.disabled = false
    if (copied) return confirmCopy(label, labelKey, close)
    label.replaceChildren(text(t(labelKey)))
    close()
  })
}

function docsItems({ llmsTextExport, llmsFullExport }, close) {
  const download = (filename, load) => async () => {
    downloadText(filename, await load())
    return false
  }
  return [
    menuTitle('ai.docsSection'),
    // The territory before the map: pasted into a chat, llms-full.txt is the
    // documentation, while llms.txt is a list of links an assistant can only
    // follow on an install that serves the `.md` mirrors (docs/seo.md §4).
    pendingItem('ai.copyFull', COPY_SVG, () => writeClipboardLater(llmsFullExport), close),
    pendingItem('ai.copyIndex', COPY_SVG, () => writeClipboardLater(llmsTextExport), close),
    pendingItem(
      'doc.exportLlmsFull',
      DOWNLOAD_SVG,
      download('llms-full.txt', llmsFullExport),
      close,
    ),
    pendingItem('ai.downloadIndex', DOWNLOAD_SVG, download('llms.txt', llmsTextExport), close),
  ]
}

// Agent hand-off: the MCP registration of the whole API, in the shapes the
// reader's own tool takes it in. Empty — like the home card — when the schema
// has no URL a bridge could fetch: there is nothing to register, and an install
// link pointing at nothing is worse than no link. This is the one place that
// rule is decided; everything upstream may hand over whatever context it holds.
function agentItems(mcp, close) {
  if (!mcp?.specUrl) return []
  const { cursor, vscode } = toMcpDeepLinks(mcp)
  return [
    menuTitle('doc.agentSection'),
    menuItem('doc.copyMcpCommand', TERMINAL_SVG, async ({ label }) => {
      if (await writeClipboard(toMcpCommand(mcp).command)) {
        confirmCopy(label, 'doc.copyMcpCommand', close)
      }
    }),
    menuLinkItem('doc.addToCursor', cursor, close),
    menuLinkItem('doc.addToVsCode', vscode, close),
  ]
}

// "Copy for AI" (docs/architecture.md §5.14.1): the whole API, handed to an
// assistant or wired to an agent, from every page. The per-page counterpart is
// the "Copy page" menu.
//
// `mcp` is a provider: the registration's base URL follows the selected
// environment, so the items are built each time the menu opens rather than
// once with the bar.
export function aiMenu({ llmsTextExport, llmsFullExport, mcp }) {
  // Below lg the label goes and the glyph stands alone, square like its
  // neighbours: the acting zone may not shrink (§5.16), and the name stays in
  // the accessible name and the tooltip.
  const trigger = el(
    'summary',
    'btn btn-sm btn-ghost gap-1.5 font-normal max-lg:btn-square',
    icon(SPARKLES_SVG, 'shrink-0'),
    el('span', 'max-lg:hidden', text(t('ai.menu'))),
    icon(CHEVRON_SVG_SM, 'shrink-0 max-lg:hidden'),
  )
  trigger.setAttribute('aria-label', t('ai.menu'))
  trigger.title = t('ai.menu')
  const menu = el(
    'ul',
    'dropdown-content menu bg-base-100 rounded-box border border-base-300 shadow-sm z-50 w-72 p-1',
  )
  const { details, close } = detailsDropdown('dropdown-end', trigger, menu)
  details.dataset.aiMenu = ''
  details.addEventListener('toggle', () => {
    if (!details.open) return
    menu.replaceChildren(
      ...docsItems({ llmsTextExport, llmsFullExport }, close),
      ...agentItems(mcp(), close),
    )
  })
  return details
}
