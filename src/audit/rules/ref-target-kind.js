import { placeOf } from '../locate.js'
import { objectLabel } from '../openapi-objects.js'
import { internalTarget } from '../ref-pointer.js'

// A `$ref` whose target is another kind of object than the place it stands in:
// a Schema where a Parameter belongs, a `components/parameters` entry used as a
// response Header (a Header has no `name` nor `in`), a Response where a Request
// Body belongs. The loader substitutes whatever it finds, so this documentation
// renders the target read as the wrong object — a parameter with no name, a
// body described by a status line — and validators reject the document.
//
// The target's kind is the one the typed walk gave the node at that pointer —
// where it is declared, components or not; a target that is itself a `$ref`
// stands for what it expects. A target the walk did not type (another file, an
// extension, a payload) gets no verdict. A Path Item's `$ref` must reach a Path
// Item. One check per mismatch; a `$ref` that leads nowhere is `ref-resolves`'.
export const refTargetKind = {
  id: 'ref-target-kind',
  category: 'correctness',
  severity: 'error',
  run(ctx, check) {
    const kinds = new Map()
    for (const { type, expected, dataPath } of ctx.objects) {
      kinds.set(dataPath, type === 'Reference' ? expected : type)
    }
    const verify = (ref, expected, dataPath) => {
      const target = internalTarget(ref)
      if (target === null) return
      const actual = kinds.get(target)
      if (!actual || actual === expected) return
      const at = `${dataPath}/$ref`
      check(false, {
        ...placeOf(ctx.operations, at),
        dataPath: at,
        params: { ref, expected: objectLabel(expected), actual: objectLabel(actual) },
      })
    }
    for (const { type, expected, node, dataPath } of ctx.objects) {
      if (type === 'Reference') verify(node.$ref, expected, dataPath)
      else if (type === 'PathItem' && typeof node.$ref === 'string') {
        verify(node.$ref, 'PathItem', dataPath)
      }
    }
  },
}
