// A file the reader can take away — the schema as served, llms-full.txt — as a
// button plus its explanation, collapsed behind a "?": the label is enough
// after the first visit. Shared by the home page and the audit page, which
// offer the same schema download; the shell is what knows where the file comes
// from and passes a `{ filename, load }` descriptor.

import { t } from '../i18n/index.js'
import { downloadText } from './download.js'
import { el, iconButton, text } from './dom.js'
import { DOWNLOAD_SVG, HELP_SVG } from './icons.js'

// → { control, explanation }: two nodes rather than one, so a bar can line the
// buttons up on a single row and stack their explanations below.
//
// `notes` are the one thing that does NOT hide behind the "?": a file whose
// content differs from the page offering it has to say so before it is
// downloaded, not after the reader thinks to ask what it is. A list rather than
// a sentence — the page and the file can disagree for unrelated reasons at
// once, and running those together would read as one story.
export function downloadAction({ help, helpText, label, filename, load, onError, notes = [] }) {
  // Not `icon()` from dom.js: this span is mutated into a spinner below, so
  // it owns its className. The `aria-hidden` that helper exists to guarantee is
  // set here by hand — the glyph sits next to the label that already names it.
  const glyph = el('span')
  glyph.innerHTML = DOWNLOAD_SVG
  glyph.setAttribute('aria-hidden', 'true')
  const btnLabel = el('span', '', text(label))
  // Soft variant: these are auxiliary actions, they must not weigh
  // more heavily to the eye than the page content.
  const btn = el('button', 'btn btn-sm btn-primary btn-soft gap-1.5', glyph, btnLabel)
  btn.type = 'button'
  btn.addEventListener('click', async () => {
    btn.disabled = true
    glyph.className = 'loading loading-spinner loading-xs'
    glyph.replaceChildren()
    btnLabel.replaceChildren(text(t('app.loading')))
    try {
      downloadText(filename, await load())
    } catch (err) {
      console.error('[api-doc]', err)
      onError?.(err)
    } finally {
      btn.disabled = false
      glyph.className = ''
      glyph.innerHTML = DOWNLOAD_SVG
      btnLabel.replaceChildren(text(label))
    }
  })
  const explanation = el('p', 'text-sm text-subtle hidden', text(helpText))
  const helpBtn = iconButton('btn btn-ghost btn-xs btn-circle', HELP_SVG, help)
  helpBtn.setAttribute('aria-expanded', 'false')
  helpBtn.addEventListener('click', () => {
    const shown = explanation.classList.toggle('hidden')
    helpBtn.setAttribute('aria-expanded', String(!shown))
  })
  return {
    control: el('div', 'flex items-center gap-1', btn, helpBtn),
    explanation,
    notes: notes.map((line) => el('p', 'text-xs text-subtle', text(line))),
  }
}

// Downloads fit on a single line: these are one-off actions, they don't need to
// occupy full-width cards above the page's own content.
export function downloadsBar(actions) {
  if (!actions.length) return null
  return el(
    'div',
    'flex flex-col gap-2 mt-4',
    el('div', 'flex flex-wrap items-center gap-x-4 gap-y-2', ...actions.map((a) => a.control)),
    ...actions.flatMap((a) => a.notes),
    ...actions.map((a) => a.explanation),
  )
}
