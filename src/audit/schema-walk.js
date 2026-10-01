// Shared traversal of the schemas of a dereferenced document. Rules that check
// a schema (required properties, examples, defaults) iterate `ctx.schemas`
// instead of re-walking the document each: one walk, one check per distinct
// schema object.

import { bodyKind } from '../openapi/body-kind.js'
import { pointer } from './pointer.js'
import { subschemas } from './schema-keywords.js'

// Depth budget (rule 7), shared by every walk over the schemas of the
// dereferenced document. Identity dedup already terminates cycles materialized
// by ref-parser; the budget bounds the other unbounded case, a document that
// nests fresh objects forever.
export const SCHEMA_DEPTH = 24

// Media types carried by an operation: request body then responses, each with
// the pointer to its own declaration site.
export function* operationContents(entry) {
  for (const [mediaType, content] of Object.entries(entry.op.requestBody?.content ?? {})) {
    if (!content || typeof content !== 'object') continue
    yield {
      kind: 'request',
      mediaType,
      content,
      dataPath: `${entry.pointer}${pointer('requestBody', 'content', mediaType)}`,
    }
  }
  for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
    for (const [mediaType, content] of Object.entries(response?.content ?? {})) {
      if (!content || typeof content !== 'object') continue
      yield {
        kind: 'response',
        status,
        mediaType,
        content,
        dataPath: `${entry.pointer}${pointer('responses', status, 'content', mediaType)}`,
      }
    }
  }
}

// A media type whose payload is a file — a PDF, an image, `format: binary` —
// by the app's own verdict (`body-kind.js`): the try-it takes it from a file
// picker, the doc shows no sample of it, and no hand-written example could stand
// for its bytes. The example rules have nothing to ask of it.
export function carriesFile({ mediaType, content }) {
  return bodyKind({ mediaType, schema: content.schema }) === 'binary'
}

// → [{ schema, dataPath, op, location }] — `op` is the operation entry the
// schema was reached from (null for a component), `location` its display label
// when there is no operation to name.
export function collectSchemas(document, operations) {
  const seen = new Set()
  const entries = []

  const visit = (schema, dataPath, op, location, depth = 0) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return
    if (depth > SCHEMA_DEPTH || seen.has(schema)) return
    seen.add(schema)
    entries.push({ schema, dataPath, op, location })
    const child = (sub, ...segments) =>
      visit(sub, `${dataPath}${pointer(...segments)}`, op, location, depth + 1)

    // 2020-12 applicators included: a schema hidden in a conditional branch or
    // a `$defs` is a schema all the same, and every rule that grades one must
    // see it.
    for (const [sub, ...segments] of subschemas(schema)) child(sub, ...segments)
  }

  // Components first: a schema shared by an operation and `components.schemas`
  // is then reported at its definition site — where the author fixes it once,
  // rather than at whichever operation happened to be walked first.
  for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
    visit(schema, pointer('components', 'schemas', name), null, `components.schemas.${name}`)
  }

  for (const entry of operations) {
    for (const { param, dataPath } of entry.parameters) {
      visit(param.schema, `${dataPath}/schema`, entry, null)
      // A parameter serialized by media type (`content`) carries its schema
      // there — 3.2's `querystring` always does.
      for (const [mediaType, content] of Object.entries(param.content ?? {})) {
        visit(content?.schema, `${dataPath}${pointer('content', mediaType, 'schema')}`, entry, null)
      }
    }
    for (const { content, dataPath } of operationContents(entry)) {
      visit(content.schema, `${dataPath}/schema`, entry, null)
      // 3.2 sequential media types: `itemSchema` describes one element of the
      // stream and can exist without `schema`.
      visit(content.itemSchema, `${dataPath}/itemSchema`, entry, null)
    }
    for (const [status, response] of Object.entries(entry.op.responses ?? {})) {
      for (const [name, header] of Object.entries(response?.headers ?? {})) {
        const base = `${entry.pointer}${pointer('responses', status, 'headers', name)}`
        visit(header?.schema, `${base}/schema`, entry, null)
        // A header serialized by media type carries its schema there, like a
        // parameter.
        for (const [mediaType, content] of Object.entries(header?.content ?? {})) {
          visit(content?.schema, `${base}${pointer('content', mediaType, 'schema')}`, entry, null)
        }
      }
    }
  }

  return entries
}
