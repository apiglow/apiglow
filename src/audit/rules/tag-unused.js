import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'

// A declared tag nothing carries: no operation, no webhook, no callback, and
// it is no 3.2 `parent` of a tag that is carried. This documentation builds
// its navigation from the tags operations carry, so this one is hidden, its
// description and external docs with it — written for no reader. Usually a
// leftover from a removed endpoint, or a typo on the operations' side
// (`Pet` declared, `Pets` used — `tag-declared` then flags the other half).
//
// A webhook's or a callback's tag counts as carried, although this
// documentation files neither under a tag: other renderers do. Parents count
// whatever the version, as the navigation reads them. One check per declared
// tag.
export const tagUnused = {
  id: 'tag-unused',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const tags = listOf(ctx.source?.tags)
    const parentOf = new Map()
    for (const tag of tags) {
      if (tag && typeof tag.name === 'string' && !parentOf.has(tag.name)) {
        parentOf.set(tag.name, typeof tag.parent === 'string' ? tag.parent : undefined)
      }
    }
    const carried = new Set()
    for (const entry of ctx.operations) {
      for (const name of listOf(entry.op.tags)) {
        // Up the parent chain, bounded by the number of tags: a loop is
        // `tag-parent`'s, and must not hang this one.
        let current = typeof name === 'string' ? name : undefined
        for (let step = 0; current !== undefined && step <= parentOf.size; step += 1) {
          if (carried.has(current)) break
          carried.add(current)
          current = parentOf.get(current)
        }
      }
    }
    for (const [index, tag] of tags.entries()) {
      if (!tag || typeof tag !== 'object' || typeof tag.name !== 'string') continue
      check(carried.has(tag.name), {
        location: `tags.${index}`,
        dataPath: pointer('tags', index),
        params: { name: tag.name },
      })
    }
  },
}
