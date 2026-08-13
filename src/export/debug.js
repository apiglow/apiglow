import { MASK, redactEntry } from './redact.js'

// "Full debug" export (plain text): EVERYTHING the tool knows about an
// entry — context, request (line, headers, body), response (status,
// headers, body), error, variables used. Pure function, tested by snapshot.
// Designed to be pasted as-is into a ticket or a chat.

function headerLines(headers) {
  const entries = Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  return entries.map(([name, value]) => `${name}: ${value}`)
}

export function toDebugReport(entry, { redact = true } = {}) {
  const source = redact ? redactEntry(entry) : entry
  const lines = []
  lines.push('=== DEBUG REPORT ===')
  lines.push(`Date: ${new Date(entry.timestamp).toISOString()}`)
  lines.push(
    `Operation: ${entry.opId ?? '-'} (${entry.method.toUpperCase()} ${entry.path ?? ''})`.trimEnd(),
  )
  if (entry.envName) lines.push(`Environment: ${entry.envName}`)
  lines.push(`Duration: ${entry.durationMs} ms`)
  lines.push(`Proxied: ${entry.proxied ? 'yes' : 'no'}`)
  if (entry.truncatedRequest) lines.push('Warning: request body truncated by history storage')
  if (entry.truncatedResponse) lines.push('Warning: response body truncated by history storage')

  lines.push('')
  lines.push('--- Request ---')
  lines.push(`${entry.method.toUpperCase()} ${source.request.url}`)
  lines.push(...headerLines(source.request.headers))
  if (source.request.body != null && source.request.body !== '') {
    lines.push('')
    lines.push(source.request.body)
  }

  lines.push('')
  lines.push('--- Response ---')
  if (source.response) {
    lines.push(`HTTP ${source.response.status} ${source.response.statusText ?? ''}`.trimEnd())
    lines.push(...headerLines(source.response.headers))
    if (source.response.body != null && source.response.body !== '') {
      lines.push('')
      lines.push(source.response.body)
    }
  } else {
    lines.push('(no response received)')
  }

  if (entry.error) {
    lines.push('')
    lines.push('--- Error ---')
    lines.push(String(entry.error))
  }

  if (entry.usedVariables?.length) {
    lines.push('')
    lines.push('--- Environment variables used ---')
    for (const v of entry.usedVariables) {
      const value = redact && v.sensitive ? MASK : v.value
      lines.push(`${v.name} = ${value}${v.sensitive ? '  (sensitive)' : ''}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}
