import { placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { hasText, isSubstantive } from '../text.js'

// A short label holding a placeholder — `info.title: "API"` passes,
// `"Title"`, `"TODO"`, `"string"`, `"lorem ipsum"` do not. These fields are
// display text and nothing else: the title heads every page and the browser
// tab, the summaries stand for the API, a tag group or a response wherever
// they are shown. A placeholder there is printed as the name of the thing.
// `isSubstantive` without a name: a label has no identifier to read back.
//
// `info.title`, `info.summary`, a Tag's and a Response's `summary` (3.1 and
// 3.2 fields; read whatever the version, since this documentation shows them
// whatever the version — a field the version lacks is `unknown-field`'s).
// Operation summaries are `operation-summary-present`'s and
// `operation-summary-style`'s; descriptions are the `*-described` rules'. One
// check per such field holding text.
const FIELDS = {
  Info: [
    ['title', 'info.title'],
    ['summary', 'info.summary'],
  ],
  Tag: [['summary', 'tags.summary']],
  Response: [['summary', 'responses.summary']],
}

export const placeholderText = {
  id: 'placeholder-text',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      for (const [key, field] of FIELDS[type] ?? []) {
        const value = node[key]
        if (!hasText(value)) continue
        const at = `${dataPath}${pointer(key)}`
        check(isSubstantive(value), {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { field, value },
        })
      }
    }
  },
}
