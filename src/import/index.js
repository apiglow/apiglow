import { parseCurl } from './curl.js'
import { parseHar } from './har.js'
import { parsePostman } from './postman.js'

// Format detection for the import dialog: the reader pastes or picks a file,
// they do not pick a format. Detection is by content, never by file extension —
// a `.txt` holding a cURL command and a `.json` holding a HAR are both what they
// contain.

export function detectFormat(text) {
  const source = String(text ?? '').trim()
  if (!source) return null
  // Anything that is not a JSON document is read as a command line: the cURL
  // parser then says precisely what it could not find (no URL), where a generic
  // "unknown format" would leave the reader guessing.
  if (!source.startsWith('{')) return 'curl'
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    return null
  }
  if (parsed?.log?.entries) return 'har'
  if (Array.isArray(parsed?.item)) return 'postman'
  return null
}

// One entry point: `{ format, requests, warnings, errors }`. An unrecognized
// input is an error code, never a throw and never a guess (§4.6).
export function parseImport(text) {
  const format = detectFormat(text)
  if (!format) {
    const empty = !String(text ?? '').trim()
    return {
      format: null,
      requests: [],
      warnings: [],
      errors: [{ code: empty ? 'import-empty' : 'import-format-unknown' }],
    }
  }
  const parse = { curl: parseCurl, postman: parsePostman, har: parseHar }[format]
  return { format, ...parse(text) }
}
