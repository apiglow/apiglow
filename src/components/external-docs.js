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
  const arrow = el('span', 'text-subtle', text('↗'))
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
