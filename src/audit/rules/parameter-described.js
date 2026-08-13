import { hasText } from '../text.js'

// The try-it form labels a field with the parameter name and explains it with
// its description. Without one, the reader has a box to fill and no idea what
// belongs in it.
export const parameterDescribed = {
  id: 'parameter-described',
  category: 'completeness',
  severity: 'warning',
  run(ctx, check) {
    // A `$ref`'d parameter is one object shared by every operation using it
    // (the document is dereferenced): one decision, one check, one finding.
    const seen = new Set()
    for (const entry of ctx.operations) {
      for (const { param, dataPath } of entry.parameters) {
        if (seen.has(param)) continue
        seen.add(param)
        check(hasText(param.description), {
          op: entry,
          dataPath,
          params: { name: param.name ?? '' },
        })
      }
    }
  },
}
