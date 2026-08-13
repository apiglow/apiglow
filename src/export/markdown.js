import { redactEntry } from './redact.js'

// Shareable Markdown export (docs/architecture.md §5.7): request + response + context,
// designed to be pasted as-is into a GitHub issue. Pure function, tested by
// snapshot.

function headerLines(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  return entries.map(([name, value]) => `${name}: ${value}`).join('\n')
}

function fenceLang(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  const contentType = entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
  return /json/i.test(contentType) ? 'json' : ''
}

export function toMarkdownReport(entry, { redact = true } = {}) {
  const source = redact ? redactEntry(entry) : entry
  const lines = []
  lines.push(`# \`${entry.method.toUpperCase()}\` ${entry.path ?? source.request.url}`)
  lines.push('')
  if (entry.envName) lines.push(`- **Environment**: ${entry.envName}`)
  lines.push(`- **Date**: ${new Date(entry.timestamp).toISOString()}`)
  lines.push(`- **Duration**: ${entry.durationMs} ms`)
  if (entry.response)
    lines.push(
      `- **Status**: ${entry.response.status} ${entry.response.statusText ?? ''}`.trimEnd(),
    )
  else if (entry.error) lines.push(`- **Status**: network error (no response)`)
  lines.push('')
  lines.push('## Request')
  lines.push('')
  lines.push('```http')
  lines.push(`${entry.method.toUpperCase()} ${source.request.url}`)
  const reqHeaders = headerLines(source.request.headers)
  if (reqHeaders) lines.push(reqHeaders)
  lines.push('```')
  if (source.request.body) {
    lines.push('')
    lines.push(`\`\`\`${fenceLang(source.request.headers)}`)
    lines.push(source.request.body)
    lines.push('```')
  }
  if (source.response) {
    lines.push('')
    lines.push('## Response')
    lines.push('')
    lines.push('```http')
    lines.push(`${source.response.status} ${source.response.statusText ?? ''}`.trimEnd())
    const respHeaders = headerLines(source.response.headers)
    if (respHeaders) lines.push(respHeaders)
    lines.push('```')
    if (source.response.body) {
      lines.push('')
      lines.push(`\`\`\`${fenceLang(source.response.headers)}`)
      lines.push(source.response.body)
      lines.push('```')
    }
  }
  lines.push('')
  return lines.join('\n')
}
