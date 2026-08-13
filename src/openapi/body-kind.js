// The editable shape of a request body, derived once from a normalized media
// type entry (`model.js` → `contents[i]`) so that nothing downstream
// re-derives it: the try-it panel picks its editor from it, the central doc
// mirrors that editor, `request-builder` picks its serialization and the
// exports pick their syntax.
//
//   json       text editor, JSON validation, structured fields in the doc
//   multipart  one field per top-level property, sent as FormData
//   urlencoded the same fields, serialized into a query string
//   binary     a whole file (or raw text) as the body
//   text       textual with no structure we can offer (XML, plain, YAML)
//
// Absorbing the version difference here is what keeps rule 6 intact: 3.0
// spells a file `format: binary`, 3.1+ lets the media type carry it alone,
// and both land on `binary` without a single `isV31` anywhere.

const JSON_RE = /json/i

// Textual families we can honestly put in a textarea. Everything outside is
// bytes — an `image/png` or `application/pdf` body is a file, and there is no
// keyboard that produces one.
const TEXT_ESSENCES = new Set([
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/csv',
  'application/graphql',
  'application/javascript',
  'application/ecmascript',
  'application/sql',
  'application/x-ndjson',
  'application/ndjson',
])
const TEXT_SUFFIX_RE = /\+(xml|yaml|json)$/i

export function bodyKind(content) {
  const media = mediaEssence(content?.mediaType)
  if (media === 'application/x-www-form-urlencoded') return 'urlencoded'
  if (media.startsWith('multipart/')) return 'multipart'
  // The schema's own statement wins over the media type family: a document
  // declaring `format: binary` means a file whatever it wrapped it in.
  if (isFileSchema(content?.schema)) return 'binary'
  if (!media) return 'text'
  if (JSON_RE.test(media)) return 'json'
  if (media.startsWith('text/') || TEXT_ESSENCES.has(media) || TEXT_SUFFIX_RE.test(media))
    return 'text'
  return 'binary'
}

// A schema position that stands for a file rather than for a value. `format:
// byte` is deliberately absent: it is base64 *text*, which types fine.
export function isFileSchema(schema) {
  return schema?.format === 'binary'
}

// The two kinds edited as a flat list of fields rather than as a body.
export function isFieldsKind(kind) {
  return kind === 'multipart' || kind === 'urlencoded'
}

// The one textual form of a file body, shared by the history, the cURL
// preview, the exports and the editor's chip so they never drift apart.
// Deliberately not a sentence: no `t()` key, nothing to translate.
export function fileBodyLabel(file) {
  if (!file?.name) return ''
  const details = [formatFileSize(file.size), file.type].filter(Boolean).join(', ')
  return details ? `@${file.name} (${details})` : `@${file.name}`
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// `type/subtype`, lowercased, parameters (`; charset=…`) stripped. Exported for
// the importers, which compare a `Content-Type` read off a pasted command
// against what the document declares.
export function mediaEssence(mediaType) {
  return String(mediaType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
}
