import { placeOf } from '../locate.js'
import { internalTarget, nodeAt } from '../ref-pointer.js'

// A `$ref` that leads nowhere: a pointer to a component that was renamed or
// never written, a file that is not there. The loader no longer gives up on the
// whole document for it — it leaves the `$ref` in place and renders the rest —
// so what the reader sees is a hole: no parameter, no schema, no response where
// the reference stands. Validators and code generators stop on it outright.
//
// Read on the dereferenced document: every `$ref` the typed walk saw (a
// Reference where an object may stand, a Path Item's own `$ref`) whose pointer
// still holds a `$ref` there was not resolved. A `$ref` inside an example or a
// default is data (the loader leaves those alone) and the walk never sees it.
// One check per broken reference, at the end of the chain: a `$ref` to a `$ref`
// that leads nowhere is reported once, where the pointer misses.
export const refResolves = {
  id: 'ref-resolves',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    for (const { type, node, dataPath } of ctx.objects) {
      if (type !== 'Reference' && !(type === 'PathItem' && typeof node.$ref === 'string')) continue
      const resolved = nodeAt(ctx.document, dataPath)
      if (!resolved || typeof resolved !== 'object' || resolved.$ref !== node.$ref) continue
      // A pointer that does land, on a `$ref` that does not: the break is
      // further down the chain, and reported there.
      const target = internalTarget(node.$ref)
      if (target !== null && nodeAt(ctx.source, target) !== undefined) continue
      const at = `${dataPath}/$ref`
      check(false, { ...placeOf(ctx.operations, at), dataPath: at, params: { ref: node.$ref } })
    }
  },
}
