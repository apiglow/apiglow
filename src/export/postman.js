import { redactEntry } from './redact.js'

// Postman Collection v2.1 export (docs/architecture.md §5.7) — pure function, tested by
// snapshot. Insomnia natively imports this format (noted in the README).
// Deterministic: no generated id/date, everything is derived from the entry.

const SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

function parseUrlParts(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    // Relative or template URL: minimal decomposition, `raw` stays usable.
    return { raw: rawUrl, path: rawUrl.split('?')[0].split('/').filter(Boolean), query: [] }
  }
  return {
    raw: rawUrl,
    protocol: url.protocol.replace(':', ''),
    host: url.hostname.split('.'),
    ...(url.port ? { port: url.port } : {}),
    path: url.pathname.split('/').filter(Boolean),
    query: [...url.searchParams.entries()].map(([key, value]) => ({ key, value })),
  }
}

// Postman's three body modes, picked from the structured shape the entry
// carries rather than from its display string. `file.src` is a local path
// Postman resolves at send time — we only ever knew the file's name anyway.
function postmanBody(request, isJson) {
  if (request.form) {
    return {
      mode: 'formdata',
      formdata: request.form.map((f) =>
        f.fileName !== undefined
          ? { key: f.name, type: 'file', src: f.fileName }
          : { key: f.name, type: 'text', value: f.value },
      ),
    }
  }
  if (request.bodyFile) return { mode: 'file', file: { src: request.bodyFile.name } }
  if (request.body == null || request.body === '') return null
  return {
    mode: 'raw',
    raw: request.body,
    ...(isJson ? { options: { raw: { language: 'json' } } } : {}),
  }
}

export function toPostmanCollection(entry, { redact = true } = {}) {
  const source = redact ? redactEntry(entry) : entry
  const headers = Array.isArray(source.request.headers)
    ? source.request.headers
    : Object.entries(source.request.headers ?? {})
  const name = `${entry.method.toUpperCase()} ${entry.path ?? entry.opId ?? ''}`.trim()
  const isJson = headers.some(([k, v]) => k.toLowerCase() === 'content-type' && /json/i.test(v))
  const body = postmanBody(source.request, isJson)

  return {
    info: { name, schema: SCHEMA_URL },
    item: [
      {
        name: entry.opId ?? name,
        request: {
          method: entry.method.toUpperCase(),
          header: headers.map(([key, value]) => ({ key, value })),
          url: parseUrlParts(source.request.url),
          ...(body ? { body } : {}),
        },
        response: [],
      },
    ],
  }
}
