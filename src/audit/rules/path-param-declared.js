import { templateNames, wellFormed } from '../path-template.js'

// A `{template}` with no matching parameter: the doc has no field to fill it
// with, and the try-it sends the literal `{id}` in the URL.
//
// A key `path-syntax` rejects (unbalanced or repeated braces, no leading `/`)
// is that rule's alone: its placeholders are not reliably names, and the key
// is reported once.
export const pathParamDeclared = {
  id: 'path-param-declared',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const entry of ctx.operations) {
      // A webhook is keyed by a name, not by a URL template.
      if (entry.kind !== 'operation' || !wellFormed(entry.path)) continue
      const declared = new Set(
        entry.parameters.filter(({ param }) => param.in === 'path').map(({ param }) => param.name),
      )
      for (const name of templateNames(entry.path)) {
        check(declared.has(name), { op: entry, params: { name } })
      }
    }
  },
}
