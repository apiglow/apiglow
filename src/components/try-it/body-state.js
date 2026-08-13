// Pure derivations that seed and constrain the try-it editors: what the
// body/header fields start with, and what the file picker accepts. No DOM,
// no panel state — the panel calls these once per operation or per media
// type change and keeps the result in `#state`.

import { bodyKind, isFieldsKind, isFileSchema } from '../../openapi/body-kind.js'
import { coerceDeep } from '../../openapi/coerce.js'
import { sampleValue } from '../../openapi/sample.js'
import { paramPrefill } from '../../openapi/prefill.js'
import { displayableExample, isSerializedExample } from '../../openapi/examples.js'
import { isXmlMedia, xmlSample } from '../../openapi/sample-xml.js'
import { readHeaderMemory } from '../../storage/header-memory.js'

// An endpoint's header rows: env defaultHeaders (remembered value takes
// priority — the user's last override), then declared header params
// (remembered value, failing that the value a required one declares), then
// remembered headers the endpoint doesn't declare — the test context follows
// from one route to another.
export function buildHeaderRows(env, op) {
  const memory = readHeaderMemory()
  const rows = []
  const seen = new Set()
  const push = (name, value) => {
    rows.push({ name, value })
    seen.add(name.toLowerCase())
  }
  for (const h of env?.defaultHeaders ?? []) {
    if (h.name) push(h.name, memory[h.name.toLowerCase()]?.value ?? h.value)
  }
  for (const p of op.parameters.filter((p) => p.in === 'header')) {
    if (!seen.has(p.name.toLowerCase()))
      push(p.name, memory[p.name.toLowerCase()]?.value ?? paramPrefill(p) ?? '')
  }
  for (const [key, m] of Object.entries(memory)) {
    if (!seen.has(key)) push(m.name, m.value)
  }
  return rows
}

// Editable fields of a multipart or urlencoded body: top-level properties of
// the object schema — real bodies of both kinds are flat (file + metadata,
// or a handful of scalars).
function formFieldsFrom(content, kind) {
  const schema = content?.schema
  if (schema?.kind !== 'object') return []
  return (schema.properties ?? [])
    .filter((p) => !p.schema?.readOnly)
    .map((p) => ({
      name: p.name,
      schema: p.schema,
      required: p.required,
      // Only multipart can carry a file part. urlencoded percent-encodes its
      // values, so a `format: binary` property degrades there to a text field
      // (paste base64) rather than to a picker that would lie about what
      // leaves — the documented fallback rule 19 asks for.
      binary: kind === 'multipart' && isFileSchema(p.schema),
      value: '',
      file: null,
    }))
}

// Editor state derived from the selected media type. Single place that reads
// the body's kind: every other branch in the panel tests `state.bodyKind`.
export function bodyStateFor(content) {
  const kind = bodyKind(content)
  return {
    bodyKind: kind,
    formFields: isFieldsKind(kind) ? formFieldsFrom(content, kind) : null,
    bodyFile: null,
    // A binary body opens on the picker — that is what the endpoint takes.
    // The text editor stays one click away: typing a raw payload into an
    // octet-stream is a real debugging move, and it was all the textarea
    // ever offered here.
    bodySource: kind === 'binary' ? 'file' : 'text',
    body: isFieldsKind(kind) ? '' : prefillBody(content),
  }
}

// Narrows the OS file picker to what the endpoint declares. Never a
// constraint on what can be sent: a wildcard or absent media type sets
// nothing, and the user can always override the Content-Type header.
export function acceptAttribute(mediaType) {
  const essence = String(mediaType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!essence || essence === 'application/octet-stream' || essence.endsWith('/*')) return ''
  return essence
}

// Body pre-filling: declared example, otherwise minimal skeleton derived
// from the schema (bounded depth, readOnly excluded, cycles cut by
// `circular`). Exported: the webhook simulator pre-fills its payload the
// same way.
export function prefillBody(content) {
  if (!content) return ''
  // An external example is a URL pointing at the payload, never the payload:
  // pre-filling the editor with it would send the address of the example
  // instead of the example. Skipped, and the skeleton below is built instead.
  const example = displayableExample(content.examples)
  if (example) {
    // Already-serialized example (3.2 `serializedValue`, or a plain string
    // `value`): copied as-is. Otherwise its leaves are checked against the
    // schema's types — an example quoting a number would be rejected on send.
    return isSerializedExample(example)
      ? String(example.value)
      : JSON.stringify(coerceDeep(example.value, content.schema), null, 2)
  }
  // An XML body gets an XML skeleton, not an empty textarea: the schema says
  // just as much here as it does in JSON, and hand-writing the envelope of a
  // document you can already read is busywork.
  if (isXmlMedia(content.mediaType)) return xmlSample(content.schema)
  if (!/json/i.test(content.mediaType ?? '')) return ''
  const skeleton = sampleValue(content.schema)
  return skeleton === null ? '' : JSON.stringify(skeleton, null, 2)
}
