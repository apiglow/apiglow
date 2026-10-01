import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'

// A 3.2 tag whose `parent` names no declared tag, or whose chain of parents
// comes back to itself ("The named tag MUST exist in the API description, and
// circular references between parent and child tags MUST NOT be used", Tag
// Object). The nesting it asked for cannot be built: this documentation files
// the tag at the top level of the navigation instead, and a tool that follows
// the chain without a guard loops. In older versions `parent` is
// `version-construct`'s. One check per tag in fault — every tag of a loop.
export const tagParent = {
  id: 'tag-parent',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    if (ctx.version.minor < 2) return
    const tags = listOf(ctx.source?.tags)
    const parentOf = new Map()
    for (const tag of tags) {
      if (tag && typeof tag.name === 'string' && !parentOf.has(tag.name)) {
        parentOf.set(tag.name, typeof tag.parent === 'string' ? tag.parent : undefined)
      }
    }
    for (const [index, tag] of tags.entries()) {
      if (!tag || typeof tag.parent !== 'string' || typeof tag.name !== 'string') continue
      if (parentOf.has(tag.parent) && !loops(tag.name, parentOf)) continue
      check(false, {
        location: `tags.${index}`,
        dataPath: pointer('tags', index, 'parent'),
        params: { name: tag.name, parent: tag.parent },
      })
    }
  },
}

// Whether following parents from `name` comes back to it. Bounded by the
// number of tags: a chain longer than that has repeated itself.
function loops(name, parentOf) {
  let current = parentOf.get(name)
  for (let step = 0; step <= parentOf.size && current !== undefined; step += 1) {
    if (current === name) return true
    current = parentOf.get(current)
  }
  return false
}
