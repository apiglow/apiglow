import { listOf } from '../../openapi/model.js'
import { pointer } from '../pointer.js'
import { isSubstantive } from '../text.js'

// A declared tag with no description, or one that only reads its name back
// (`pets: "Pets"`) or holds a placeholder. A tag is a chapter of the
// documentation, and its description is the chapter's introduction: other
// renderers print it at the head of the group, this documentation shows it as
// the navigation group's tooltip. Without it, the reader learns what the
// group covers by opening its operations one by one.
//
// Tags whose 3.2 `kind` is not navigational count too: they are still
// documented, as badges. One check per declared tag.
export const tagDescribed = {
  id: 'tag-described',
  category: 'completeness',
  severity: 'info',
  run(ctx, check) {
    for (const [index, tag] of listOf(ctx.source?.tags).entries()) {
      if (!tag || typeof tag !== 'object' || typeof tag.name !== 'string') continue
      check(isSubstantive(tag.description, { name: tag.name }), {
        location: `tags.${index}`,
        dataPath: pointer('tags', index, 'description'),
        params: { name: tag.name },
      })
    }
  },
}
