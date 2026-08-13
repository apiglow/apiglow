// A docs page as Markdown (docs/docs-pages.md §5), the prose counterpart of
// `toEndpointMarkdown`: what the "Copy page" menu copies, shows raw and saves.
// Pure function — the body is already loaded by the caller, which is the only
// one that knows where the page's text comes from.
import { stripFrontmatter } from '../docs/markdown.js'
import { htmlToText } from '../docs/sections.js'

// The authored body of a docs page, with what the render itself drops: the
// frontmatter is authoring metadata, and an `.html` page is flattened to its
// text — the tags would dominate the prose and this is Markdown by intent.
// Shared with the `llms-full` export, which makes the same choice for the same
// reason (docs/architecture.md §5.14.2) and must not drift from it.
export function docsPageBody(text, format) {
  if (format === 'html') return htmlToText(text)
  // Verbatim for `.txt`: a `---` line in a text file opens nothing.
  if (format === 'text') return String(text ?? '').trim()
  return stripFrontmatter(text).trim()
}

// Whether the body already opens on a level-1 heading. Only its first line is
// examined — the body is trimmed, so that is its first non-blank one: a `# `
// further down is as likely to be a shell comment inside a fence as a heading,
// and a page's own title is at its top or nowhere.
function hasTitleHeading(body) {
  const [first, second = ''] = body.split('\n')
  return /^#\s/.test(first) || /^=+\s*$/.test(second)
}

// `{{var}}` travels literally, never resolved: the rendered page substitutes
// from the selected environment, and those values include credentials (rule
// 12). The template is also what the next reader can re-point at their own
// environment.
export function toDocsPageMarkdown({ title, text, format = 'markdown' }) {
  const body = docsPageBody(text, format)
  const heading = title && !hasTitleHeading(body) ? `# ${title}\n\n` : ''
  return `${heading}${body}\n`
}
