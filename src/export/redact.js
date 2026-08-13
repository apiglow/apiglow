// Redaction of sensitive values (docs/architecture.md §5.6/§5.7) — pure functions. The
// history entry carries the list of secret values actually used; each
// occurrence is replaced by a mask, both on display and on export (enabled
// by default, explicitly toggleable off).

export const MASK = '••••'

export function redactText(value, sensitiveValues, mask = MASK) {
  let out = String(value ?? '')
  for (const secret of sensitiveValues ?? []) {
    if (!secret) continue
    out = out.split(secret).join(mask)
  }
  return out
}

// Applies `fn` to the textual pieces of an entry (url, headers, bodies)
// without mutating the original.
function transformEntry(entry, fn) {
  const mapHeaders = (headers) => {
    if (!headers) return headers
    if (Array.isArray(headers)) return headers.map(([k, v]) => [k, fn(v)])
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, fn(v)]))
  }
  const mapBody = (body) => (body === null || body === undefined ? body : fn(body))
  // Multipart field values go through too: they are user input like any
  // other, and a secret pasted into one would otherwise reach the export in
  // plain text. File names are left alone — they name a local file, they
  // don't carry a resolved variable.
  const mapForm = (form) =>
    form?.map((field) =>
      field.fileName !== undefined ? field : { ...field, value: fn(field.value) },
    )
  return {
    ...entry,
    request: entry.request
      ? {
          ...entry.request,
          url: fn(entry.request.url),
          headers: mapHeaders(entry.request.headers),
          body: mapBody(entry.request.body),
          ...(entry.request.form ? { form: mapForm(entry.request.form) } : {}),
        }
      : entry.request,
    response: entry.response
      ? {
          ...entry.response,
          headers: mapHeaders(entry.response.headers),
          body: mapBody(entry.response.body),
        }
      : entry.response,
  }
}

// Redacted copy of a history entry.
export function redactEntry(entry, mask = MASK) {
  const secrets = entry.sensitiveValues ?? []
  return transformEntry(entry, (value) => redactText(value, secrets, mask))
}

// "Template" variant ("substitute variables" toggle off, docs/architecture.md §5.7): values
// coming from environment variables are replaced by their {{name}} template.
// Only applies to entries carrying `usedVariables`; sensitive values outside
// of variables stay in plain text — combine with redactEntry if needed.
export function templatizeEntry(entry) {
  const variables = (entry.usedVariables ?? []).filter((v) => v.value)
  const apply = (value) =>
    variables.reduce((acc, v) => acc.split(v.value).join(`{{${v.name}}}`), String(value ?? ''))
  return transformEntry(entry, apply)
}
