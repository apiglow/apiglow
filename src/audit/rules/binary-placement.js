import { mediaEssence } from '../../openapi/body-kind.js'
import { isBinarySchema, subschemas } from '../schema-keywords.js'
import { operationContents, SCHEMA_DEPTH } from '../schema-walk.js'

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
        if (!JSON_MEDIA.test(mediaEssence(mediaType))) continue
        collect(content.schema, mediaEssence(mediaType), placed)
        collect(content.itemSchema, mediaEssence(mediaType), placed)
      }
    }
    for (const { schema, dataPath, op, location } of ctx.schemas) {
      if (!placed.has(schema) || !isBinarySchema(schema)) continue
      check(false, { op, location, dataPath, params: { container: placed.get(schema) } })
    }
  },
}

// Every schema reachable from `root`, mapped to the first container it was met
// in: a binary property nested in an array of objects is still inside the
// JSON. Bounded by identity and depth (rule 7).
function collect(root, container, placed) {
  const walk = (schema, depth) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
    if (depth > SCHEMA_DEPTH || placed.has(schema)) return
    placed.set(schema, container)
    for (const [sub] of subschemas(schema)) walk(sub, depth + 1)
  }
  walk(root, 0)
}
