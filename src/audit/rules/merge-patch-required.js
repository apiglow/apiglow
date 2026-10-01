import { listOf } from '../../openapi/model.js'
import { mediaEssence } from '../../openapi/body-kind.js'
import { operationContents } from '../schema-walk.js'

// A JSON Merge Patch body (`application/merge-patch+json`, RFC 7396) whose
// schema lists required properties. A merge patch carries only the members
// that change — any of them may be omitted (RFC 7396 §2) — so a required list
// says the opposite: usually the resource's own schema, reused for its patch.
// Clients built from it must send the whole resource on every update, and the
// try-it marks every field mandatory.
//
// Read on the request body's own schema and the members of its `allOf`, where
// a reused resource schema usually sits. One check per patch body that
// requires anything, none otherwise.
const MERGE_PATCH = 'application/merge-patch+json'

export const mergePatchRequired = {
  id: 'merge-patch-required',
  category: 'correctness',
  severity: 'warning',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      for (const { kind, mediaType, content, dataPath } of operationContents(entry)) {
        if (kind !== 'request' || mediaEssence(mediaType) !== MERGE_PATCH) continue
        const schema = content.schema
        if (!schema || typeof schema !== 'object') continue
        const required = [schema, ...listOf(schema.allOf)].flatMap((part) =>
          part && typeof part === 'object' ? listOf(part.required) : [],
        )
        const names = [...new Set(required.filter((name) => typeof name === 'string'))]
        if (!names.length) continue
        check(false, {
          op: entry,
          dataPath: `${dataPath}/schema`,
          params: { properties: names.join(', ') },
        })
      }
    }
  },
}
