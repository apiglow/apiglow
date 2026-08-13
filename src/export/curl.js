// cURL generator (docs/architecture.md §5.7) — pure function, reused by the try-it's live
// preview (docs/architecture.md §5.5). Multiline with `\` continuation, POSIX quoting.

import { redactEntry, templatizeEntry } from './redact.js'

export function shellQuote(value) {
  // Single quotes: only ' needs escaping (close, escape, reopen).
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function toCurl({ method, url, headers = {}, body = null, form = null, file = null }) {
  const lines = [`curl -X ${String(method).toUpperCase()} ${shellQuote(url)}`]
  for (const [name, value] of Object.entries(headers)) {
    lines.push(`-H ${shellQuote(`${name}: ${value}`)}`)
  }
  if (form?.length) {
    // Multipart body: one --form per field, files via the @path syntax. A part
    // that declares an encoding carries it in cURL's own suffix syntax
    // (`;type=`, `;headers=`) — the browser can express the first and not the
    // second, so the export is where a per-part header survives at all.
    for (const f of form) {
      const value = f.fileName !== undefined ? `${f.name}=@${f.fileName}` : `${f.name}=${f.value}`
      const suffix = [
        f.contentType ? `;type=${f.contentType}` : '',
        ...(f.headers ?? []).map((h) => `;headers="${h.name}: ${h.value}"`),
      ].join('')
      lines.push(`--form ${shellQuote(value + suffix)}`)
    }
  } else if (file?.name) {
    // Binary body: `--data-binary` and not `--data`, which would strip the
    // newlines and turn any non-text file into garbage.
    lines.push(`--data-binary ${shellQuote(`@${file.name}`)}`)
  } else if (body !== null && body !== undefined && body !== '') {
    lines.push(`--data ${shellQuote(body)}`)
  }
  return lines.join(' \\\n  ')
}

// cURL export of a history entry. substitute=false → template output with
// {{var}} (secrets coming from variables disappear on their own); otherwise
// redaction by default, toggleable off.
export function curlFromEntry(entry, { redact = true, substitute = true } = {}) {
  let source = entry
  if (!substitute) source = templatizeEntry(entry)
  if (redact) source = redactEntry(source)
  const headers = Array.isArray(source.request.headers)
    ? Object.fromEntries(source.request.headers)
    : (source.request.headers ?? {})
  return toCurl({
    method: entry.method,
    url: source.request.url,
    headers,
    body: source.request.body,
    // Present only on a structured body: the entry then also carries a
    // display string in `body`, which these two take precedence over.
    form: source.request.form,
    file: source.request.bodyFile,
  })
}
