import { componentNames, placeOf } from '../locate.js'
import { pointer } from '../pointer.js'
import { nodeAt } from '../ref-pointer.js'
import { isSubstantive } from '../text.js'
import { isObject } from '../value-check.js'

// Named examples side by side with nothing to tell them apart. This
// documentation lists each entry of an `examples` map as "Example — <key>
// (<summary>)", one after the other, with no picker: without a summary the
// heading is the map key alone, and `example1`, `example2` leave the reader to
// diff the payloads to learn which case each one shows. Other renderers put the
// summary in their example dropdown, where a bare key is just as mute.
//
// Only in a map of two entries or more — a lone example has nothing to be told
// apart from. The summary is judged with `isSubstantive`, the key as its name:
// `summary: "Sold out"` under `soldOut` reads the key back and says nothing
// more. A Reference's own `summary` overrides its target's (3.1+), and is what
// the heading shows. An Example shared through `components.examples` is
// checked once, at the component, under the key of its first use.
export const exampleSummary = {
  id: 'example-summary',
  category: 'readiness',
  severity: 'info',
  run(ctx, check) {
    const components = componentNames(ctx.document, 'examples')
    const done = new Set()
    for (const { type, dataPath } of ctx.objects) {
      if (type !== 'Parameter' && type !== 'Header' && type !== 'MediaType') continue
      // Dereferenced: the entries as the doc shows them, a `$ref`'s siblings
      // laid over its target.
      const examples = nodeAt(ctx.document, `${dataPath}/examples`)
      if (!isObject(examples)) continue
      const entries = Object.entries(examples).filter(([, example]) => isObject(example))
      if (entries.length < 2) continue
      for (const [key, example] of entries) {
        const name = components.get(example)
        if (name !== undefined) {
          if (done.has(example)) continue
          done.add(example)
        }
        const at =
          name === undefined
            ? `${dataPath}${pointer('examples', key)}`
            : pointer('components', 'examples', name)
        check(isSubstantive(example.summary, { name: key }), {
          ...placeOf(ctx.operations, at),
          dataPath: at,
          params: { name: key },
        })
      }
    }
  },
}
