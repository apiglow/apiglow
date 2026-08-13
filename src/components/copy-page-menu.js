import { toMcpCommand, toMcpDeepLinks } from '../export/mcp.js'
import { t } from '../i18n/index.js'
import { writeClipboard } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { downloadText } from './download.js'
import { detailsDropdown } from './dropdown.js'
import { openMarkdownSource } from './markdown-source-dialog.js'
import {
  CHEVRON_SVG,
  COPY_SVG,
  DOC_TEXT_SVG,
  DOWNLOAD_SVG,
  EXTERNAL_SVG,
  TERMINAL_SVG,
} from './icons.js'

// The hash-based SPA isn't fetchable by URL on the LLM side: the Markdown travels
// in the q parameter, truncated beyond this size to stay under browser/server
// URL limits (~8 KB).
const LLM_PROMPT_MAX_CHARS = 6000

// The assistants the page can be handed to. Both take the prompt in a trailing
// `q` parameter, so the URL is a prefix plus the encoded prompt.
const ASSISTANTS = [
  ['doc.openInChatGPT', 'https://chatgpt.com/?q='],
  ['doc.openInClaude', 'https://claude.ai/new?q='],
]

function llmPrompt(markdown, promptKey) {
  const body =
    markdown.length > LLM_PROMPT_MAX_CHARS
      ? `${markdown.slice(0, LLM_PROMPT_MAX_CHARS)}\n\n…(truncated)`
      : markdown
  return `${t(promptKey)}\n\n${body}`
}

function menuItem(labelKey, svg, onClick) {
  const label = el('span', '', text(t(labelKey)))
  const btn = el('button', 'flex items-center gap-2 text-sm', icon(svg, 'text-subtle'), label)
  btn.type = 'button'
  btn.addEventListener('click', () => onClick({ btn, label }))
  return el('li', '', btn)
}

// A menu entry that hands the click to the OS rather than to us: no target,
// because a custom scheme opens the editor and a blank tab left behind for it
// is litter.
function menuLinkItem(labelKey, href, close) {
  const anchor = el(
    'a',
    'flex items-center gap-2 text-sm',
    icon(EXTERNAL_SVG, 'text-subtle'),
    el('span', '', text(t(labelKey))),
  )
  anchor.href = href
  anchor.addEventListener('click', () => close())
  return el('li', '', anchor)
}

// Copy confirmation, on the item's own label: the menu stays open long enough
// for it to be read, then closes itself.
function confirmCopy(label, labelKey, close) {
  label.replaceChildren(text(t('export.copied')))
  setTimeout(() => {
    label.replaceChildren(text(t(labelKey)))
    close()
  }, 900)
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
    el('li', 'menu-title text-label uppercase', text(t('doc.agentSection'))),
    menuItem('doc.copyMcpCommand', TERMINAL_SVG, async ({ label }) => {
      if (await writeClipboard(toMcpCommand(mcp).command)) {
        confirmCopy(label, 'doc.copyMcpCommand', close)
      }
    }),
    menuLinkItem('doc.addToCursor', cursor, close),
    menuLinkItem('doc.addToVsCode', vscode, close),
  ]
}

// Whole doc (llms-full.txt): async generation — the remote Markdown pages are
// downloaded by the shell's provider, so the row carries a loading state and
// survives an unreachable page the same way the home page's button does.
function llmsFullItem(llmsFullExport, close) {
  if (!llmsFullExport) return null
  return menuItem('doc.exportLlmsFull', DOWNLOAD_SVG, async ({ btn, label }) => {
    btn.disabled = true
    label.replaceChildren(text(t('app.loading')))
    try {
      downloadText('llms-full.txt', await llmsFullExport())
    } catch (err) {
      console.error('[api-doc]', err)
    } finally {
      btn.disabled = false
      label.replaceChildren(text(t('doc.exportLlmsFull')))
      close()
    }
  })
}

// "Copy page" menu (docs/architecture.md §5.14.1): the hand-off surface, one
// menu for the two kinds of page the app renders — an endpoint's reference and
// a prose page. Three kinds of take-away, in one menu because they answer the
// same question ("give me this page elsewhere") — the Markdown of THIS page
// (copied, read raw), the same prose handed to an assistant, and the whole API
// wired to an agent (llms-full.txt, the MCP registration in its three shapes).
//
// `markdown` is a getter, so the menu never holds a string older than the click.
// `mcp` is a provider of the API-wide config context (§5.14): what an agent
// needs is the whole document, and the config never narrows to one page — but
// its base URL follows the selected environment, so it is read when the menu is
// built, not when it is configured.
export function copyPageMenu({ markdown, title, filename, promptKey, llmsFullExport = null, mcp }) {
  const trigger = el(
    'summary',
    'btn btn-sm btn-ghost border border-base-300 gap-1.5 font-normal',
    icon(COPY_SVG, 'text-subtle'),
    el('span', '', text(t('doc.copyPage'))),
    icon(CHEVRON_SVG),
  )
  // The menu is filled after the dropdown exists: every item closes it, and
  // taking `close` from it is what spares the items a forward reference.
  const menu = el(
    'ul',
    'dropdown-content menu bg-base-100 rounded-box border border-base-300 shadow-sm z-10 w-64 p-1',
  )
  const { details, close } = detailsDropdown('dropdown-end shrink-0', trigger, menu)

  const openIn = (prefix) => () => {
    window.open(prefix + encodeURIComponent(llmPrompt(markdown(), promptKey)), '_blank', 'noopener')
    close()
  }
  menu.append(
    ...[
      menuItem('doc.copyPageMarkdown', COPY_SVG, async ({ label }) => {
        if (await writeClipboard(markdown())) confirmCopy(label, 'doc.copyPageMarkdown', close)
      }),
      menuItem('doc.viewMarkdown', DOC_TEXT_SVG, () => {
        close()
        openMarkdownSource(markdown(), { title, filename })
      }),
      ...ASSISTANTS.map(([key, prefix]) => menuItem(key, EXTERNAL_SVG, openIn(prefix))),
      llmsFullItem(llmsFullExport, close),
      ...agentItems(mcp?.(), close),
    ].filter(Boolean),
  )
  return details
}
