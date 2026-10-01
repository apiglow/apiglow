import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'

// Two entries of the top-level `tags` list with the same name ("Each tag name
// in the list MUST be unique", OAS 3.x, OpenAPI Object). Operations point at a
// tag by name, so the two are one group: this documentation keeps the first
// declaration and drops the second — its description, its external docs, its
// place in the order — without a word. One check per repeated name, on the
// later entry.
export const tagUnique = {
  id: 'tag-unique',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const seen = new Set()
    for (const [index, tag] of listOf(ctx.source?.tags).entries()) {
      if (!tag || typeof tag !== 'object' || typeof tag.name !== 'string') continue
      if (!seen.has(tag.name)) {
        seen.add(tag.name)
        continue
      }
      const dataPath = pointer('tags', index, 'name')
      check(false, { location: `tags.${index}`, dataPath, params: { name: tag.name } })
    }
  },
}
