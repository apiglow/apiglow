import { t } from '../i18n/index.js'
import { el, externalLink, text } from './dom.js'

// The one place an `externalDocs` becomes a link. Root, tag, operation and
// schema all declare the same object and all render the same thing — only the
// styling differs, hence the className.
//
// The description IS the label: it is written to be one ("Find out more about
// our store"), so prefixing it with a generic wording would say everything
// twice. That wording is the fallback for a bare URL, nothing else.
export function externalDocsLink(docs, className) {
  if (!docs?.url) return null
  // U+FE0E: bare, U+2197 picks the colour-emoji font on Android and the arrow
  // comes out as a blue tile that ignores `text-subtle`. The variation selector
  // pins it to the text glyph, which is the only one that reads as punctuation.
  // `ms-1` and not the callers' `gap-1`: the link is inline so it can wrap over
  // two lines, and gap does nothing on an inline box — the emoji glyph's own
  // side bearing was standing in for the space until the selector removed it.
  const arrow = el('span', 'text-subtle ms-1', text('↗︎'))
  arrow.setAttribute('aria-hidden', 'true')
  const link = externalLink(
    className,
    docs.url,
    text(docs.description || t('doc.externalDocs')),
    arrow,
  )
  // The label rarely says where it goes; the URL always does.
  link.title = docs.url
  return link
}
