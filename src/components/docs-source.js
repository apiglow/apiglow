// Where a docs page's body comes from (docs/docs-pages.md §2.6): the config
// itself, an element of the host page, or the network. One question — "give me
// this page's text and the pipeline to render it with" — for the three
// consumers that used to ask their own: the page component, the llms-full
// export and the search index.
//
// Lives here rather than in `src/shell/` because the page component reads it
// too, and a component never imports from the shell.
import { dedentDocsContent, docsFormat, docsPageFormat } from '../docs/pages.js'
import { fetchTextCached } from './remote-text.js'

// A `<script>` of a non-executable type is the only element whose content the
// HTML parser leaves strictly alone — a `<template>` would parse the markdown
// as markup and eat every tag in it. Its `type` already says what it holds, so
// a page pointing at one rarely needs to repeat itself with `format`.
const SCRIPT_TYPE_FORMATS = {
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'text/html': 'html',
  'text/plain': 'text',
}

function elementFormat(element) {
  const type = (element.getAttribute('type') ?? '').split(';')[0].trim().toLowerCase()
  return SCRIPT_TYPE_FORMATS[type] ?? null
}

// → { text, format }. Throws like a failed fetch does — an unreachable page and
// a missing element are the same kind of mistake, and callers already handle it.
export async function loadDocsPageSource(page) {
  if (page.content) {
    return { text: dedentDocsContent(page.content), format: docsPageFormat(page) }
  }
  if (page.contentId) {
    const element = document.getElementById(page.contentId)
    if (!element) throw new Error(`no element with id "${page.contentId}"`)
    return {
      text: dedentDocsContent(element.textContent),
      format: docsFormat(page.format) ?? elementFormat(element) ?? 'markdown',
    }
  }
  return { text: await fetchTextCached(page.url), format: docsPageFormat(page) }
}

// What to name in an error message: a page carried by the host has no URL to
// print, and the id it failed to find is the actionable half.
export function docsPageSourceLabel(page) {
  if (page.url) return page.url
  if (page.contentId) return `#${page.contentId}`
  return page.slug
}
