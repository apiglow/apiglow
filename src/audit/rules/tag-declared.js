import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'

// A tag operations carry that the top-level `tags` list does not declare. It
// still makes a navigation group here, but one with nothing to say: no
// description, no external docs, no 3.2 summary or parent, and no place of
// its own in the order — undeclared groups come after every declared one, in
// the order operations first use them. The `tags` list is where the author
// decides the reading order and introduces each chapter.
//
// Operations under `paths` only: the navigation lists webhooks flat, never by
// tag. One check per distinct tag name operations carry; the finding sits on
// the first operation carrying an undeclared one.
export const tagDeclared = {
  id: 'tag-declared',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const declared = new Set(
      listOf(ctx.document.tags)
        .filter((tag) => tag && typeof tag.name === 'string')
        .map((tag) => tag.name),
    )
    const seen = new Set()
    for (const entry of ctx.operations) {
      if (entry.kind !== 'operation') continue
      for (const [index, name] of listOf(entry.op.tags).entries()) {
        if (typeof name !== 'string' || seen.has(name)) continue
        seen.add(name)
        check(declared.has(name), {
          op: entry,
          dataPath: `${entry.pointer}${pointer('tags', index)}`,
          params: { name },
        })
      }
    }
  },
}
