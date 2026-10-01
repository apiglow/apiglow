import { mediaEssence } from '../../openapi/body-kind.js'
import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'
import { operationContents } from '../schema-walk.js'

// An `application/problem+json` response whose `status` member disagrees with
// the status code it is documented under: a 404's example saying
// `"status": 400`, or a `status` property pinned to another code. RFC 9457
// §3.1.2 makes `status` the code the origin server generated for this very
// occurrence — a client that reads it (and many log it, or prefer it to the
// line they received) is told something the response contradicts. Usually an
// error schema or example copied from a neighbouring response.
//
// Concrete codes only: a range (`4XX`) or `default` pins no single value.
// Examples are read where they sit — the media type's `example` and
// `examples`, the schema's own — and the schema's `status` property when it
// is pinned to one value (`const`, or a one-member `enum`).
const PROBLEM = 'application/problem+json'

export const problemStatusMismatch = {
  id: 'problem-status-mismatch',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const { kind, status, mediaType, content, dataPath } of operationContents(entry)) {
        if (kind !== 'response' || mediaEssence(mediaType) !== PROBLEM) continue
        if (!/^[1-5]\d\d$/.test(status)) continue
        const code = Number(status)
        const report = (value, at) => {
          if (typeof value !== 'number' || value === code) return
          check(false, { op: entry, dataPath: at, params: { status, value } })
        }
        for (const [value, at] of examples(content, dataPath)) report(value?.status, `${at}/status`)
        const schema = content.schema
        const property = schema?.properties?.status
        if (property && typeof property === 'object') {
          const at = `${dataPath}/schema/properties/status`
          if (property.const !== undefined) report(property.const, `${at}/const`)
          else if (Array.isArray(property.enum) && property.enum.length === 1) {
            report(property.enum[0], `${at}/enum/0`)
          }
        }
      }
    }
  },
}

// [value, pointer] of every example of the media type and of its schema.
function* examples(content, dataPath) {
  if (content.example !== undefined) yield [content.example, `${dataPath}/example`]
  if (
    content.examples &&
    typeof content.examples === 'object' &&
    !Array.isArray(content.examples)
  ) {
    for (const [name, example] of Object.entries(content.examples)) {
      if (!example || typeof example !== 'object') continue
      const key = example.value !== undefined ? 'value' : 'dataValue'
      yield [example[key], `${dataPath}${pointer('examples', name, key)}`]
    }
  }
  const schema = content.schema
  if (!schema || typeof schema !== 'object') return
  if (schema.example !== undefined) yield [schema.example, `${dataPath}/schema/example`]
  for (const [index, value] of listOf(schema.examples).entries()) {
    yield [value, `${dataPath}/schema${pointer('examples', index)}`]
  }
}
