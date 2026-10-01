import { mediaEssence } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { operationContents } from '../schema-walk.js'

// Raw bytes declared where only text can go: a binary string (`format:
// binary`, or 3.1's `contentMediaType` of a binary family without a
// `contentEncoding`) inside a JSON payload, or in a parameter. JSON is text,
// and so are a URL and a header: a file has to travel there base64-encoded
// (`format: byte`, `contentEncoding: base64`), or as its own body. Generators
// type the field as a byte stream they cannot serialize. This documentation
// prefills an empty string where the file would go — or, for a whole JSON body
// declared binary, offers a file picker and sends the file labelled as JSON.
//
// Multipart parts and non-JSON bodies are files' rightful place and are not
// looked at. Reported once per schema, at its declaration (`ctx.schemas`).
const JSON_MEDIA = /json/i

// Media types whose payload is never text: a `contentMediaType` from these
// families, unencoded, is bytes. Text families (`text/*`, JSON, XML) are a
// string's legitimate content and stay out.
const BINARY_MEDIA =
  /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|vnd\.)/i

// Same keywords as the shared schema walk: a binary property nested in an
// array of objects is still inside the JSON.
const ONE = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains']
const LIST = ['allOf', 'oneOf', 'anyOf', 'prefixItems']
const MAX_DEPTH = 24

export const binaryPlacement = {
  id: 'binary-placement',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    const placed = new Map()
    for (const entry of ctx.operations) {
      for (const { param } of entry.parameters) {
        if (param.in && typeof param.in === 'string') collect(param.schema, param.in, placed)
      }
      for (const { mediaType, content } of operationContents(entry)) {
        if (JSON_MEDIA.test(mediaEssence(mediaType))) {
          collect(content.schema, mediaEssence(mediaType), placed)
        }
      }
    }
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!placed.has(schema) || !isBinary(schema)) continue
      check(false, { op, location, dataPath, params: { container: placed.get(schema) } })
    }
  },
}

// Every schema reachable from `root`, mapped to the first container it was met
// in. Bounded by identity and depth (rule 7).
function collect(root, container, placed) {
  const walk = (schema, depth) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
    if (depth > MAX_DEPTH || placed.has(schema)) return
    placed.set(schema, container)
    const properties = schema.properties
    if (properties && typeof properties === 'object') {
      for (const child of Object.values(properties)) walk(child, depth + 1)
    }
    for (const keyword of ONE) walk(schema[keyword], depth + 1)
    for (const keyword of LIST) for (const child of listOf(schema[keyword])) walk(child, depth + 1)
  }
  walk(root, 0)
}

function isBinary(schema) {
  if (schema.format === 'binary') return true
  return (
    typeof schema.contentMediaType === 'string' &&
    schema.contentEncoding === undefined &&
    BINARY_MEDIA.test(schema.contentMediaType)
  )
}
