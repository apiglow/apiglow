import { t } from '../i18n/index.js'
import { modalDismiss, openModal, scrollBlock } from './a11y.js'
import { copyableBlock } from './copy-button.js'
import { el, text } from './dom.js'
import { downloadText } from './download.js'

// "View as Markdown": the source the copy item puts in the clipboard, shown
// before it travels. A hash SPA has no `?format=md` route to hand out — the
// page a reader would link an agent to does not exist — so the raw view is a
// dialog over the doc rather than a route, and what it displays is the exact
// string the copy and the download produce.
//
// Rendered as a Text node in a <pre>: this is Markdown source, not Markdown to
// render, and the point of the view is to see it verbatim (rule 5 costs
// nothing here — nothing is ever parsed as HTML).
export function openMarkdownSource(markdown, { title, filename }) {
  const { backdrop, dismiss } = modalDismiss({
    backdropLabel: t('doc.viewMarkdownClose'),
    closeLabel: t('doc.viewMarkdownClose'),
  })
  const download = el('button', 'btn btn-sm', text(t('doc.viewMarkdownDownload')))
  download.type = 'button'
  download.addEventListener('click', () => downloadText(filename, markdown))
  const source = scrollBlock(
    el(
      'pre',
      'max-h-[60vh] overflow-auto rounded-box border border-base-300 bg-base-200/50 p-3 text-xs whitespace-pre-wrap break-words',
      el('code', '', text(markdown)),
    ),
    t('a11y.scrollable.code'),
  )
  const dialog = el(
    'dialog',
    'modal',
    el(
      'div',
      'modal-box max-w-3xl flex flex-col gap-3',
      dismiss,
      el(
        'header',
        'flex flex-wrap items-baseline gap-x-3 gap-y-1 pe-8',
        el('h3', 'text-lg font-semibold', text(t('doc.viewMarkdown'))),
        el('span', 'text-sm text-subtle', text(title)),
      ),
      copyableBlock(source, () => markdown, t('doc.copyPageMarkdown')),
      el('div', 'modal-action mt-0', download),
    ),
    backdrop,
  )
  dialog.dataset.markdownSource = ''
  // Built per opening and dropped on close: the doc re-renders on every
  // environment change, and a dialog kept in that subtree would be torn out
  // from under the reader mid-read.
  dialog.addEventListener('close', () => dialog.remove(), { once: true })
  document.body.append(dialog)
  openModal(dialog)
  return dialog
}
