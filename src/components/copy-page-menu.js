import { t } from '../i18n/index.js'
import { writeClipboard } from './copy-button.js'
import { el, icon, text } from './dom.js'
import { detailsDropdown } from './dropdown.js'
import { CHEVRON_SVG, COPY_SVG, DOC_TEXT_SVG, EXTERNAL_SVG } from './icons.js'
import { openMarkdownSource } from './markdown-source-dialog.js'
import { confirmCopy, menuItem } from './menu-items.js'

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

// "Copy page" menu (docs/architecture.md §5.14.1): this page and nothing
// wider, for the two kinds of page the app renders — an endpoint's reference
// and a prose page. Its Markdown copied or read raw, then the same prose handed
// to an assistant. What covers the whole API lives in the header's "Copy for
// AI" menu (`ai-menu.js`).
//
// `markdown` is a getter, so the menu never holds a string older than the click.
export function copyPageMenu({ markdown, title, filename, promptKey }) {
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
    menuItem('doc.copyPageMarkdown', COPY_SVG, async ({ label }) => {
      if (await writeClipboard(markdown())) confirmCopy(label, 'doc.copyPageMarkdown', close)
    }),
    menuItem('doc.viewMarkdown', DOC_TEXT_SVG, () => {
      close()
      openMarkdownSource(markdown(), { title, filename })
    }),
    ...ASSISTANTS.map(([key, prefix]) => menuItem(key, EXTERNAL_SVG, openIn(prefix))),
  )
  return details
}
